// Lembrete de retorno: X dias depois de um corte concluído, se o cliente não
// tem outro horário depois dele, avisa o barbeiro por push com um botão para
// chamar o cliente no WhatsApp ("Vamos agendar seu corte?").
// Roda junto do completion-reminders (pg_cron a cada 5 min); cada atendimento
// é avaliado uma vez só (return_reminded_at).
import { siteOrigin } from './http.ts'
import { log } from './log.ts'
import { sendPushToUser } from './push.ts'
import type { AdminClient } from './supabase.ts'
import { zonedParts } from './time.ts'

export const RETURN_AFTER_DAYS = 20
/** Não lembra cortes mais velhos que isso (evita enxurrada de avisos antigos). */
const MAX_AGE_DAYS = 45
/** Só manda push em horário comercial, no fuso da barbearia. */
const SEND_FROM_HOUR = 9
const SEND_UNTIL_HOUR = 20
const DAY_MS = 24 * 60 * 60 * 1000

export function isReturnReminderHour(now: Date, tz: string): boolean {
  const h = zonedParts(now, tz).hour
  return h >= SEND_FROM_HOUR && h < SEND_UNTIL_HOUR
}

export function isHaircut(serviceNames: string[]): boolean {
  return serviceNames.some((n) => /corte/i.test(n))
}

export function returnMessage(customerName: string, days: number, site: string): string {
  const first = customerName.trim().split(/\s+/)[0] ?? ''
  return `Oi, ${first}! Aqui é do Studio Réguas ✂️ Já faz ${days} dias do seu último corte. Vamos agendar seu corte? É só escolher o horário: ${site}/`
}

export function whatsappUrl(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

export async function sendReturnReminders(
  db: AdminClient,
  fn: string,
  now: Date,
  tz: string,
): Promise<{ sent: number; inWindow: boolean }> {
  if (!isReturnReminderHour(now, tz)) return { sent: 0, inWindow: false }

  const { data: due, error } = await db
    .from('appointments')
    .select(
      'id, starts_at, customer_id, customer:customers(name, phone), barber:barbers(profile_id), appointment_services(service_name)',
    )
    .eq('status', 'completed')
    .is('return_reminded_at', null)
    .lte('starts_at', new Date(now.getTime() - RETURN_AFTER_DAYS * DAY_MS).toISOString())
    .gt('starts_at', new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS).toISOString())
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
      isHaircut(a.appointment_services.map((s) => s.service_name)) &&
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
      body: `Último corte há ${days} dias e nada marcado. Toque para mandar "Vamos agendar seu corte?" no WhatsApp.`,
      url: `/app/?retorno=${a.id}`,
      tag: `return-${a.id}`,
      actions: [
        {
          action: 'whatsapp',
          title: 'Chamar no WhatsApp',
          url: whatsappUrl(a.customer.phone, returnMessage(name, days, site)),
        },
      ],
    })
    sent++
  }
  if (sent) log.info(fn, 'return_reminders_sent', { count: sent })
  return { sent, inWindow: true }
}
