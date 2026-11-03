// Envio de Web Push (VAPID). Assinaturas expiradas (404/410) são removidas.
import { webpush } from './deps.ts'
import { log } from './log.ts'
import type { AdminClient } from './supabase.ts'

export interface PushPayload {
  title: string
  body: string
  /** caminho do app aberto ao tocar na notificação */
  url: string
  tag?: string
  /** botões da notificação (Android/desktop; no iPhone só o toque principal) */
  actions?: { action: string; title: string; url: string }[]
}

let configured: boolean | null = null

export function pushConfigured(): boolean {
  if (configured !== null) return configured
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@example.com'
  configured = Boolean(pub && priv)
  if (configured && pub && priv) webpush.setVapidDetails(subject, pub, priv)
  return configured
}

/** Envia para todas as assinaturas do usuário. Retorna quantas foram entregues. */
export async function sendPushToUser(
  db: AdminClient,
  fn: string,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!pushConfigured()) {
    log.warn(fn, 'push_not_configured')
    return 0
  }

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error) {
    log.warn(fn, 'push_subs_load_failed')
    return 0
  }

  const body = JSON.stringify(payload)
  let delivered = 0
  const expired: string[] = []

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 6, urgency: 'high' },
        )
        delivered++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) expired.push(s.id)
        else log.warn(fn, 'push_send_failed', { status: status ?? null })
      }
    }),
  )

  if (expired.length > 0) {
    await db.from('push_subscriptions').delete().in('id', expired)
    log.info(fn, 'push_subs_expired_removed', { count: expired.length })
  }
  return delivered
}
