import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { homeForRole, type Role, useAuth } from '@/lib/auth'
import { Spinner } from './states'

/** Protege uma rota: exige login e (opcionalmente) um dos papéis. */
export function RequireRole({
  roles,
  loginPath = '/entrar',
  children,
}: {
  roles?: readonly Role[]
  /** Tela de login usada quando não há sessão (o app PWA tem a sua, dentro do escopo). */
  loginPath?: string
  children: ReactNode
}) {
  const { ready, session, role, profileLoading } = useAuth()
  const location = useLocation()

  if (!ready || profileLoading) return <Spinner />
  if (!session) {
    return <Navigate to={`${loginPath}?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  if (roles && (!role || !roles.includes(role))) {
    return (
      <section className="py-10 text-center">
        <h1 className="text-2xl font-bold">Acesso restrito</h1>
        <p className="mt-2 text-muted">Sua conta não tem permissão para esta área.</p>
        <Link to={homeForRole(role)} className="mt-6 inline-block text-accent underline underline-offset-4">
          Ir para minha área
        </Link>
      </section>
    )
  }
  return children
}
