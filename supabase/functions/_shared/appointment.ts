// Leitura de um agendamento (por token ou id) no formato público da API.
import { AppError } from './http.ts'
import { type AppointmentStatus, cancelDeadline, checkCustomerCancel } from './policy.ts'
import type { AdminClient } from './supabase.ts'

const SELECT = `id, barber_id, customer_id, starts_at, ends_at, status, cancelled_by, cancelled_at, subscription_id,
  barber:barbers(id, display_name),
  customer:customers(name, auth_user_id),
  appointment_services(service_id, service_name, price_cents, duration_min, covered)`

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
    covered: s.covered,
  }))
  const subscription = a.subscription_id ? await loadSubscription(db, a.subscription_id) : null

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
      // a pagar na barbearia (o que a assinatura não cobre)
      amount_due_cents: services.reduce((acc, s) => acc + (s.covered ? 0 : s.price_cents), 0),
      covered_service_ids: services.filter((s) => s.covered).map((s) => s.id),
      subscription,
      cancel_min_notice_hours: hours,
      cancel_deadline: cancelDeadline(startsAt, hours).toISOString(),
      can_cancel: checkCustomerCancel(a.status, startsAt, new Date(), hours) === 'ok',
    },
  }
}

/** Assinatura que cobre o agendamento: plano e cortes usados no período. */
async function loadSubscription(db: AdminClient, id: string) {
  const [{ data: sub }, { data: usage }] = await Promise.all([
    db.from('customer_subscriptions').select('plan_name, cuts_included, ends_on').eq('id', id).maybeSingle(),
    db.rpc('subscription_usage', { p_ids: [id] }),
  ])
  if (!sub) return null
  return {
    plan_name: sub.plan_name,
    cuts_included: sub.cuts_included,
    cuts_used: usage?.[0]?.used ?? 0,
    ends_on: sub.ends_on,
  }
}
