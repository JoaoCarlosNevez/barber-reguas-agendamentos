// POST /functions/v1/super-set-role  (super_admin)
// { user_id, role: "barber" | "admin" }
// Promove um barbeiro a dono (admin) ou rebaixa um dono a barbeiro.
// Não mexe em clientes nem em outros super_admins.
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

const FN = 'super-set-role'

const bodySchema = z.object({
  user_id: z.uuid(),
  role: z.enum(['barber', 'admin']),
})

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const caller = await requireUser(req, ['super_admin'])
  if (body.user_id === caller.id) throw new AppError(400, 'bad_request', 'Você não pode mudar o próprio papel.')
  const db = adminClient()

  const { data: target } = await db.from('profiles').select('role').eq('id', body.user_id).maybeSingle()
  if (!target) throw new AppError(404, 'not_found', 'Usuário não encontrado.')
  if (target.role !== 'barber' && target.role !== 'admin') {
    throw new AppError(409, 'conflict', 'Só dá para alternar entre barbeiro e dono.')
  }

  const { error } = await db.from('profiles').update({ role: body.role }).eq('id', body.user_id)
  if (error) {
    log.error(FN, 'set_role_failed', { code: error.code })
    throw new AppError(500, 'internal_error', 'Não foi possível mudar o papel.')
  }
  // mantém o app_metadata coerente (informativo; o papel válido é o de profiles)
  await db.auth.admin.updateUserById(body.user_id, { app_metadata: { role: body.role } })

  log.info(FN, 'role_set', { user_id: body.user_id, role: body.role })
  return json(req, { ok: true })
})
