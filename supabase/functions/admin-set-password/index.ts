// POST /functions/v1/admin-set-password  (admin)
// { user_id, password }
// Define uma nova senha para o usuário. Não existe "esqueci a senha" no app:
// quem esquece pede ao admin, que troca por aqui.
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

const FN = 'admin-set-password'

const bodySchema = z.object({
  user_id: z.uuid(),
  password: z.string().min(8, 'Senha com pelo menos 8 caracteres.').max(72),
})

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  await requireUser(req, ['admin'])
  const db = adminClient()

  const { error } = await db.auth.admin.updateUserById(body.user_id, { password: body.password })
  if (error) {
    if (error.status === 404) throw new AppError(404, 'not_found', 'Usuário não encontrado.')
    log.error(FN, 'set_password_failed', { status: error.status ?? null })
    throw new AppError(500, 'internal_error', 'Não foi possível trocar a senha.')
  }

  log.info(FN, 'password_set', { user_id: body.user_id })
  return json(req, { ok: true })
})
