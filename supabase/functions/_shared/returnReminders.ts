// Lembrete de retorno: N dias depois de um atendimento concluído (serviços
// marcados pelo dono), se o cliente não tem outro horário depois dele, avisa
// o barbeiro por push com um botão para chamar o cliente no WhatsApp.
// Dias, horário de envio e mensagem vêm de app_settings (Configurações).
// Roda junto do completion-reminders (pg_cron a cada 5 min); cada atendimento
// é avaliado uma vez só (return_reminded_at).
import { siteOrigin } from './http.ts'
import { log } from './log.ts'
import { sendPushToUser } from './push.ts'
import type { AdminClient } from './supabase.ts'
import { zonedParts } from './time.ts'

/** Folga além dos dias configurados (evita enxurrada de avisos antigos). */
const MAX_EXTRA_DAYS = 25
const DAY_MS = 24 * 60 * 60 * 1000

export interface ReturnReminderSettings {
  enabled: boolean
  days: number
  fromHour: number
  untilHour: number
  message: string
}

export function isReturnReminderHour(now: Date, tz: string, s: Pick<ReturnReminderSettings, 'fromHour' | 'untilHour'>): boolean {
  const h = zonedParts(now, tz).hour
  return h >= s.fromHour && h < s.untilHour
}

/** Preenche {nome}, {dias} e {link} da mensagem configurada pelo dono. */
export function returnMessage(template: string, customerName: string, days: number, site: string): string {
  const first = customerName.trim().split(/\s+/)[0] ?? ''
  return template
    .replaceAll('{nome}', first)
    .replaceAll('{dias}', String(days))
    .replaceAll('{link}', `${site}/`)
}

export function whatsappUrl(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

export async function sendReturnReminders(
  db: AdminClient,
  fn: string,
  now: Date,
  tz: string,
  settings: ReturnReminderSettings,
): Promise<{ sent: number; inWindow: boolean }> {
  if (!settings.enabled || !isReturnReminderHour(now, tz, settings)) return { sent: 0, inWindow: false }

  // serviços marcados pelo dono como "gera lembrete de retorno"
  const { data: svc, error: svcErr } = await db.from('services').select('id').eq('return_reminder', true)
  if (svcErr) {
    log.error(fn, 'return_services_failed', { code: svcErr.code })
    return { sent: 0, inWindow: true }
  }
  const counts = new Set(svc.map((s) => s.id))

  const { data: due, error } = await db
    .from('appointments')
    .select(
      'id, starts_at, customer_id, customer:customers(name, phone), barber:barbers(profile_id), appointment_services(service_id)',
    )
    .eq('status', 'completed')
    .is('return_reminded_at', null)
    .lte('starts_at', new Date(now.getTime() - settings.days * DAY_MS).toISOString())
    .gt('starts_at', new Date(now.getTime() - (settings.days + MAX_EXTRA_DAYS) * DAY_MS).toISOString())
    .order('starts_at')
    .limit(50)
  if (error) {
    log.error(fn, 'return_query_failed', { code: error.code })
    return { sent: 0, inWindow: true }
  }

  const site = siteOrigin()
  let sent = 0
  for (const a of due ?? []) {
    // já voltou (ou marcou) depois desse atendimento? então não precisa chamar
    const { count } = await db
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', a.customer_id)
      .in('status', ['scheduled', 'completed'])
      .gt('starts_at', a.starts_at)
    const send =
      (count ?? 0) === 0 &&
      a.appointment_services.some((s) => s.service_id !== null && counts.has(s.service_id)) &&
      Boolean(a.customer?.phone && a.barber)

    // "reserva" antes de enviar: chamadas simultâneas não duplicam
    const { data: claimed } = await db
      .from('appointments')
      .update({ return_reminded_at: now.toISOString(), return_pending: send })
      .eq('id', a.id)
      .is('return_reminded_at', null)
      .select('id')
    if (!send || !claimed?.length || !a.customer || !a.barber) continue

    const days = Math.floor((now.getTime() - new Date(a.starts_at).getTime()) / DAY_MS)
    const name = a.customer.name
    await sendPushToUser(db, fn, a.barber.profile_id, {
      title: `Hora de chamar ${name.split(' ')[0]} de volta ✂️`,
      body: `Último corte há ${days} dias e nada marcado. Toque para chamar no WhatsApp.`,
      url: `/app/?retorno=${a.id}`,
      tag: `return-${a.id}`,
      actions: [
        {
          action: 'whatsapp',
          title: 'Chamar no WhatsApp',
          url: whatsappUrl(a.customer.phone, returnMessage(settings.message, name, days, site)),
        },
      ],
    })
    sent++
  }
  if (sent) log.info(fn, 'return_reminders_sent', { count: sent })
  return { sent, inWindow: true }
}
