// POST /functions/v1/customer-login  (pública)
// { name, phone }  ->  { token_hash, created }
//
// Login do cliente sem senha: o celular identifica a conta e o primeiro nome
// precisa conferir com o cadastro. Se o celular ainda não tem conta, ela é
// criada na hora (e o histórico de agendamentos feitos sem login com esse
// celular passa para a conta).
//
// A sessão é emitida via magic link gerado pela API admin (nenhum e-mail é
// enviado): o front troca o token_hash por uma sessão com verifyOtp.
// Decisão de produto: nome não é segredo; o risco foi aceito em troca de não
// ter senha. Rate limit por IP e por telefone limita tentativas.
import { loginCustomer } from '../_shared/customerLogin.ts'
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { normalizeBrPhone } from '../_shared/phone.ts'
import { clientIp, enforceRateLimits } from '../_shared/security.ts'
import { adminClient } from '../_shared/supabase.ts'

const FN = 'customer-login'

const bodySchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(80, 'Nome muito longo.'),
  phone: z.string().trim().min(8, 'Informe seu celular.').max(30),
})

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const db = adminClient()

  const phone = normalizeBrPhone(body.phone)
  if (!phone) {
    throw new AppError(422, 'validation_error', 'Celular inválido. Use DDD + número.', {
      fieldErrors: { phone: ['Celular inválido.'] },
    })
  }

  await enforceRateLimits(db, FN, [
    { scope: 'ip', subject: clientIp(req), windowSeconds: 600, max: 20 },
    { scope: 'phone', subject: phone, windowSeconds: 3600, max: 10 },
  ])

  const login = await loginCustomer(db, FN, body.name, phone)
  return json(req, { token_hash: login.tokenHash, created: login.created })
})
