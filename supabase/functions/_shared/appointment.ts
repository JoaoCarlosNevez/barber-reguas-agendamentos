// Leitura de um agendamento (por token ou id) no formato público da API.
import { AppError } from './http.ts'
import { type AppointmentStatus, cancelDeadline, checkCustomerCancel } from './policy.ts'
import type { AdminClient } from './supabase.ts'

const SELECT = `id, barber_id, customer_id, starts_at, ends_at, status, cancelled_by, cancelled_at,
  barber:barbers(id, display_name),
  customer:customers(name, auth_user_id),
  appointment_services(service_id, service_name, price_cents, duration_min)`

export interface LoadedAppointment {
  id: string
  barberId: string
  customerAuthUserId: string | null
  status: AppointmentStatus
  startsAt: Date
  public: Record<string, unknown>
}

export async function loadAppointment(
  db: AdminClient,
  by: { tokenHash: string } | { id: string },
): Promise<LoadedAppointment> {
  const [apptRes, settingsRes] = await Promise.all([
    'tokenHash' in by
      ? db.from('appointments').select(SELECT).eq('cancel_token_hash', by.tokenHash).maybeSingle()
      : db.from('appointments').select(SELECT).eq('id', by.id).maybeSingle(),
    db.from('app_settings').select('timezone, cancel_min_notice_hours').single(),
  ])
  if (apptRes.error || settingsRes.error) {
    throw new AppError(500, 'internal_error', 'Falha ao carregar o agendamento.')
  }
  const a = apptRes.data
  if (!a) throw new AppError(404, 'not_found', 'Agendamento não encontrado. Confira o link.')

  const startsAt = new Date(a.starts_at)
  const hours = settingsRes.data.cancel_min_notice_hours
  const services = a.appointment_services.map((s) => ({
    id: s.service_id,
    name: s.service_name,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
  }))

  return {
    id: a.id,
    barberId: a.barber_id,
    customerAuthUserId: a.customer?.auth_user_id ?? null,
    status: a.status,
    startsAt,
    public: {
      id: a.id,
      status: a.status,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(a.ends_at).toISOString(),
      timezone: settingsRes.data.timezone,
      cancelled_by: a.cancelled_by,
      cancelled_at: a.cancelled_at,
      barber: a.barber ? { id: a.barber.id, display_name: a.barber.display_name } : null,
      customer_name: a.customer?.name ?? '',
      services,
      total_price_cents: services.reduce((acc, s) => acc + s.price_cents, 0),
      cancel_min_notice_hours: hours,
      cancel_deadline: cancelDeadline(startsAt, hours).toISOString(),
      can_cancel: checkCustomerCancel(a.status, startsAt, new Date(), hours) === 'ok',
    },
  }
}
