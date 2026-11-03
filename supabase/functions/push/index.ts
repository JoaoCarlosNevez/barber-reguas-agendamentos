// POST /functions/v1/push  (barbeiro/admin logado)
//   { action: "subscribe", subscription: PushSubscriptionJSON }
//   { action: "test" }   -> envia uma notificação de teste para si mesmo
// Remover assinatura: DELETE direto em push_subscriptions (RLS: só as suas).
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { pushConfigured, sendPushToUser } from '../_shared/push.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

const FN = 'push'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('subscribe'),
    subscription: z.object({
      endpoint: z.url().startsWith('https://').max(1000),
      keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
    }),
  }),
  z.object({ action: z.literal('test') }),
])

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const user = await requireUser(req, ['barber', 'admin', 'super_admin'])
  const db = adminClient()

  if (!pushConfigured()) {
    throw new AppError(503, 'push_not_configured', 'Notificações ainda não configuradas no servidor.')
  }

  if (body.action === 'subscribe') {
    const ua = req.headers.get('user-agent')?.slice(0, 200) ?? null
    const { error } = await db.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
        user_agent: ua,
      },
      { onConflict: 'endpoint' },
    )
    if (error) {
      log.error(FN, 'subscribe_failed', { code: error.code })
      throw new AppError(500, 'internal_error', 'Não foi possível ativar as notificações.')
    }
    log.info(FN, 'subscribed')
    return json(req, { ok: true })
  }

  const delivered = await sendPushToUser(db, FN, user.id, {
    title: 'Notificações ativas ✂️',
    body: 'Você vai receber um aviso a cada novo agendamento.',
    url: '/barbeiro',
    tag: 'test',
  })
  return json(req, { delivered })
})
