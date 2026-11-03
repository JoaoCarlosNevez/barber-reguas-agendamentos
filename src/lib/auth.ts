import type { Session } from '@supabase/supabase-js'
import { createContext, use } from 'react'
import type { Enums, Tables } from './supabase'

export type Role = Enums<'user_role'>
export type Profile = Tables<'profiles'>

export interface AuthState {
  /** false enquanto a sessão salva ainda está sendo lida */
  ready: boolean
  session: Session | null
  profile: Profile | null
  profileLoading: boolean
  role: Role | null
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}

/** Equipe da barbearia (usa o app PWA em /app). */
export const STAFF_ROLES = ['barber', 'admin', 'super_admin'] as const satisfies readonly Role[]
/** Quem gerencia a barbearia (serviços, barbeiros, horários...). */
export const MANAGER_ROLES = ['admin', 'super_admin'] as const satisfies readonly Role[]

export const isStaff = (role: Role | null) => role !== null && (STAFF_ROLES as readonly Role[]).includes(role)
export const isManager = (role: Role | null) => role !== null && (MANAGER_ROLES as readonly Role[]).includes(role)

/** Para onde mandar o usuário depois do login, conforme o papel. */
export function homeForRole(role: Role | null): string {
  if (role === 'super_admin') return '/admin'
  if (role === 'admin' || role === 'barber') return '/app'
  return '/minha-conta'
}

export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Cliente',
  barber: 'Barbeiro',
  admin: 'Dono',
  super_admin: 'Super admin',
}
