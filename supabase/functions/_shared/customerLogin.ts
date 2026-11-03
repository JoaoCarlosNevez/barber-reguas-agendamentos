// Login do cliente sem senha (celular + nome), usado por customer-login e
// pelo create-appointment (que já devolve a sessão junto, em uma chamada só).
import { AppError } from './http.ts'
import { log } from './log.ts'
import { sameFirstName } from './names.ts'
import type { AdminClient } from './supabase.ts'

export const NAME_MISMATCH =
  'O nome não confere com o cadastro deste celular. Use o mesmo nome do seu primeiro agendamento.'

/** E-mail interno da conta (nunca recebe mensagens; só identifica o usuário no Auth). */
const syntheticEmail = (e164: string) => `cliente${e164.replace(/\D/g, '')}@clientes.agendamento.app`

export interface CustomerLogin {
  userId: string
  /** troca por sessão no front com verifyOtp({ token_hash, type: 'email' }) */
  tokenHash: string
  created: boolean
}

/**
 * Acha (ou cria) a conta de cliente do celular `phone` (E.164) e emite um
 * token de login. Lança AppError: name_mismatch (401), conflict (409, celular
 * da equipe) ou internal_error.
 */
export async function loginCustomer(db: AdminClient, FN: string, name: string, phone: string): Promise<CustomerLogin> {
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
    if (!sameFirstName(existing.name, name)) throw new AppError(401, 'name_mismatch', NAME_MISMATCH)
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
      user_metadata: { name: name, phone },
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
  if (linkErr || !link.properties?.hashed_token || !link.user) {
    log.error(FN, 'generate_link_failed', { status: linkErr?.status ?? null })
    throw new AppError(500, 'internal_error', 'Não foi possível entrar agora.')
  }
  log.info(FN, created ? 'customer_created' : 'customer_login')
  return { userId: link.user.id, tokenHash: link.properties.hashed_token, created }
}
