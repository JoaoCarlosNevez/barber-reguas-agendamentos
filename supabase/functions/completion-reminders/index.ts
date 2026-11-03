// POST /functions/v1/completion-reminders  (chamada pelo pg_cron a cada 5 min)
// Para cada atendimento que já terminou e continua "agendado", avisa o
// barbeiro por push para marcar como concluído e informar o pagamento.
// Cada atendimento é lembrado uma única vez (completion_reminded_at), então a
// function é idempotente e não expõe dados: não exige autenticação.
// Também dispara o lembrete de retorno (20 dias depois do corte), ver
// _shared/returnReminders.ts.
import { json, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { sendPushToUser } from '../_shared/push.ts'
import { sendReturnReminders } from '../_shared/returnReminders.ts'
import { adminClient } from '../_shared/supabase.ts'
import { dateInTz, timeInTz } from '../_shared/time.ts'

const FN = 'completion-reminders'
/** Não lembra atendimentos que terminaram há mais que isso (evita aviso velho). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000

serve(FN, async (req) => {
  const db = adminClient()
  const now = new Date()

  const [{ data: settings }, { data: due, error }] = await Promise.all([
    db
      .from('app_settings')
      .select(
        'timezone, return_reminder_enabled, return_reminder_days, return_reminder_from_hour, return_reminder_until_hour, return_reminder_message',
      )
      .single(),
    db
      .from('appointments')
      .select('id, starts_at, customer:customers(name), barber:barbers(profile_id), appointment_services(service_name)')
      .eq('status', 'scheduled')
      .is('completion_reminded_at', null)
      .lte('ends_at', now.toISOString())
      .gt('ends_at', new Date(now.getTime() - MAX_AGE_MS).toISOString())
      .order('ends_at')
      .limit(50),
  ])
  if (error) {
    log.error(FN, 'query_failed', { code: error.code })
    return json(req, { reminded: 0 })
  }
  const tz = settings?.timezone ?? 'America/Sao_Paulo'

  let reminded = 0
  for (const a of due ?? []) {
    // "reserva" o lembrete antes de enviar: chamadas simultâneas não duplicam
    const { data: claimed } = await db
      .from('appointments')
      .update({ completion_reminded_at: now.toISOString() })
      .eq('id', a.id)
      .is('completion_reminded_at', null)
      .select('id')
    if (!claimed?.length || !a.barber) continue

    const starts = new Date(a.starts_at)
    const services = a.appointment_services.map((s) => s.service_name).join(' + ')
    await sendPushToUser(db, FN, a.barber.profile_id, {
      title: 'Atendimento terminou',
      body: `${a.customer?.name ?? 'Cliente'} · ${services} (${timeInTz(starts, tz)}). Toque para concluir e informar o pagamento.`,
      url: `/app/?concluir=${a.id}&dia=${dateInTz(starts, tz)}`,
      tag: `done-${a.id}`,
    })
    reminded++
  }

  if (reminded) log.info(FN, 'reminders_sent', { count: reminded })
  const ret = settings
    ? await sendReturnReminders(db, FN, now, tz, {
        enabled: settings.return_reminder_enabled,
        days: settings.return_reminder_days,
        fromHour: settings.return_reminder_from_hour,
        untilHour: settings.return_reminder_until_hour,
        message: settings.return_reminder_message,
      })
    : { sent: 0, inWindow: false }
  return json(req, { reminded, return_sent: ret.sent, return_window: ret.inWindow })
})
