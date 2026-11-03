// Cliente com service role (ignora RLS) e identificação opcional do usuário.
import type { Database } from './database.types.ts'
import { createClient, type SupabaseClient } from './deps.ts'
import { AppError } from './http.ts'

export type AdminClient = SupabaseClient<Database>

let client: AdminClient | null = null

export function adminClient(): AdminClient {
  if (client) return client
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new AppError(500, 'internal_error', 'Configuração do servidor incompleta.')
  client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7).trim() || null
}

/**
 * Cliente logado (sessão do Supabase Auth) ou null para visitante.
 * Quem valida a sessão é o próprio Supabase Auth (auth.getUser); a function
 * não decodifica nem gera token nenhum. Visitante manda só a anon key.
 */
export async function optionalUser(req: Request): Promise<{ id: string } | null> {
  const token = bearer(req)
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) return null
  const { data, error } = await adminClient().auth.getUser(token)
  if (error || !data.user) throw new AppError(401, 'unauthorized', 'Sessão expirada. Entre novamente.')
  return { id: data.user.id }
}

export type UserRole = 'customer' | 'barber' | 'admin'

export interface AuthedUser {
  id: string
  role: UserRole
}

/** Exige sessão válida; opcionalmente restringe por role (lida de profiles, nunca do token). */
export async function requireUser(req: Request, roles?: readonly UserRole[]): Promise<AuthedUser> {
  const user = await optionalUser(req)
  if (!user) throw new AppError(401, 'unauthorized', 'Entre na sua conta para continuar.')
  const { data, error } = await adminClient().from('profiles').select('role').eq('id', user.id).single()
  if (error) throw new AppError(403, 'forbidden', 'Perfil não encontrado.')
  if (roles && !roles.includes(data.role)) {
    throw new AppError(403, 'forbidden', 'Você não tem permissão para isso.')
  }
  return { id: user.id, role: data.role }
}
