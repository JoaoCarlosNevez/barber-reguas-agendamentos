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

/** Para onde mandar o usuário depois do login, conforme o papel. */
export function homeForRole(role: Role | null): string {
  if (role === 'admin') return '/admin'
  if (role === 'barber') return '/barbeiro'
  return '/minha-conta'
}
