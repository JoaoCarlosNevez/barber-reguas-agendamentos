// Notificações ao barbeiro (Web Push). Nunca derruba o fluxo principal:
// qualquer falha vira log e segue.
import { log } from './log.ts'
import { sendPushToUser } from './push.ts'
import type { AdminClient } from './supabase.ts'
import { timeInTz, zonedParts } from './time.ts'

export type BarberEvent =
  | { type: 'appointment_created'; appointmentId: string; barberId: string }
  | { type: 'appointment_cancelled'; appointmentId: string; barberId: string }

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function shortWhen(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz)
  const wd = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? ''
  return `${wd} ${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')} às ${timeInTz(instant, tz)}`
}

export async function notifyBarber(db: AdminClient, fn: string, event: BarberEvent): Promise<void> {
  try {
    const [barberRes, apptRes, settingsRes] = await Promise.all([
      db.from('barbers').select('profile_id').eq('id', event.barberId).single(),
      db
        .from('appointments')
        .select('starts_at, appointment_services(service_name)')
        .eq('id', event.appointmentId)
        .single(),
      db.from('app_settings').select('timezone').single(),
    ])
    if (barberRes.error || apptRes.error || settingsRes.error) {
      log.warn(fn, 'push_context_failed', { appointment_id: event.appointmentId })
      return
    }

    const when = shortWhen(new Date(apptRes.data.starts_at), settingsRes.data.timezone)
    const services = apptRes.data.appointment_services.map((s) => s.service_name).join(' + ')
    const created = event.type === 'appointment_created'

    const delivered = await sendPushToUser(db, fn, barberRes.data.profile_id, {
      title: created ? 'Novo agendamento' : 'Agendamento cancelado',
      body: `${services} · ${when}`,
      url: '/app/',
      tag: `appt-${event.appointmentId}`,
    })
    log.info(fn, 'push_sent', { type: event.type, appointment_id: event.appointmentId, delivered })
  } catch {
    log.warn(fn, 'push_failed', { appointment_id: event.appointmentId })
  }
}
