// POST /functions/v1/redeem-loyalty  (barbeiro/admin)
// { customer_id } -> consome os selos da regra ativa e registra o resgate.
// Barbeiro só resgata para clientes que já atendeu.
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

const FN = 'redeem-loyalty'

const bodySchema = z.object({ customer_id: z.uuid() })

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const user = await requireUser(req, ['barber', 'admin'])
  const db = adminClient()

  if (user.role === 'barber') {
    const { count, error } = await db
      .from('appointments')
      .select('id, barbers!inner(profile_id)', { count: 'exact', head: true })
      .eq('customer_id', body.customer_id)
      .eq('barbers.profile_id', user.id)
    if (error) throw new AppError(500, 'internal_error', 'Falha ao validar o cliente.')
    if (!count) throw new AppError(403, 'forbidden', 'Você só pode resgatar para clientes que atendeu.')
  }

  const { data, error } = await db.rpc('redeem_loyalty', {
    p_customer_id: body.customer_id,
    p_redeemed_by: user.id,
  })

  if (error) {
    if (error.message.includes('insufficient_stamps')) {
      throw new AppError(409, 'insufficient_stamps', 'O cliente ainda não tem selos suficientes.')
    }
    if (error.message.includes('customer_not_eligible')) {
      throw new AppError(409, 'invalid_state', 'Só clientes cadastrados participam da fidelidade.')
    }
    if (error.message.includes('no_active_rule')) {
      throw new AppError(409, 'invalid_state', 'Nenhuma regra de fidelidade ativa.')
    }
    log.error(FN, 'redeem_failed', { code: error.code })
    throw new AppError(500, 'internal_error', 'Não foi possível registrar o resgate.')
  }

  log.info(FN, 'redeemed', { redemption_id: data.id, customer_id: body.customer_id })
  return json(req, { redemption: data })
})
