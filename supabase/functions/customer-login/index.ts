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
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { sameFirstName } from '../_shared/names.ts'
import { normalizeBrPhone } from '../_shared/phone.ts'
import { clientIp, enforceRateLimits } from '../_shared/security.ts'
import { adminClient } from '../_shared/supabase.ts'

const FN = 'customer-login'
const NAME_MISMATCH = 'O nome não confere com o cadastro deste celular. Use o mesmo nome do seu primeiro agendamento.'

const bodySchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(80, 'Nome muito longo.'),
  phone: z.string().trim().min(8, 'Informe seu celular.').max(30),
})

/** E-mail interno da conta (nunca recebe mensagens; só identifica o usuário no Auth). */
const syntheticEmail = (e164: string) => `cliente${e164.replace(/\D/g, '')}@clientes.agendamento.app`

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

  // Conta de cliente dona desse celular (a mais antiga). Contas da equipe com
  // esse celular não contam: login de cliente nunca abre conta da equipe.
  const { data: rows, error: findErr } = await db
    .from('customers')
    .select('id, name, auth_user_id')
    .eq('phone', phone)
    .eq('is_guest', false)
    .not('auth_user_id', 'is', null)
    .order('created_at')
  if (findErr) {
    log.error(FN, 'lookup_failed', { code: findErr.code })
    throw new AppError(500, 'internal_error', 'Não foi possível entrar agora.')
  }
  let existing: (typeof rows)[number] | undefined
  if (rows.length) {
    const { data: profiles } = await db
      .from('profiles')
      .select('id, role')
      .in('id', rows.map((r) => r.auth_user_id ?? ''))
    const customerIds = new Set((profiles ?? []).filter((p) => p.role === 'customer').map((p) => p.id))
    existing = rows.find((r) => r.auth_user_id && customerIds.has(r.auth_user_id))
    if (!existing) {
      throw new AppError(409, 'conflict', 'Este celular é de alguém da equipe. Entre pela área da equipe, com e-mail e senha.')
    }
  }

  let email: string
  let created = false

  if (existing?.auth_user_id) {
    if (!sameFirstName(existing.name, body.name)) throw new AppError(401, 'name_mismatch', NAME_MISMATCH)
    const { data, error } = await db.auth.admin.getUserById(existing.auth_user_id)
    if (error || !data.user.email) {
      log.error(FN, 'get_user_failed', { status: error?.status ?? null })
      throw new AppError(500, 'internal_error', 'Não foi possível entrar agora.')
    }
    email = data.user.email
  } else {
    email = syntheticEmail(phone)
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: body.name, phone },
    })
    if (error || !data.user) {
      log.error(FN, 'create_user_failed', { status: error?.status ?? null })
      throw new AppError(500, 'internal_error', 'Não foi possível criar sua conta agora.')
    }
    created = true
    const userId = data.user.id

    // Histórico de visitante com esse celular passa para a conta nova.
    const [{ data: guest }, { data: mine }] = await Promise.all([
      db.from('customers').select('id').eq('phone', phone).eq('is_guest', true).maybeSingle(),
      db.from('customers').select('id').eq('auth_user_id', userId).maybeSingle(),
    ])
    if (guest && mine) {
      const { error: moveErr } = await db.from('appointments').update({ customer_id: mine.id }).eq('customer_id', guest.id)
      if (moveErr) log.warn(FN, 'adopt_guest_failed', { code: moveErr.code })
      else await db.from('customers').delete().eq('id', guest.id)
    }
  }

  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr || !link.properties?.hashed_token) {
    log.error(FN, 'generate_link_failed', { status: linkErr?.status ?? null })
    throw new AppError(500, 'internal_error', 'Não foi possível entrar agora.')
  }

  log.info(FN, created ? 'customer_created' : 'customer_login')
  return json(req, { token_hash: link.properties.hashed_token, created })
})
