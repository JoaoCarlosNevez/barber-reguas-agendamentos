import { Link, NavLink, Outlet } from 'react-router'
import { homeForRole, isStaff, useAuth } from '@/lib/auth'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 text-sm transition-colors ${isActive ? 'text-brass' : 'text-muted hover:text-cream'}`

/** Site público (web mobile): agendamento e área do cliente. */
export function Layout() {
  const { session, role } = useAuth()

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between gap-2 py-4">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold tracking-widest text-cream uppercase">
          <img src="/favicon.svg" alt="" className="size-7" />
          Barbearia
        </Link>
        <nav aria-label="Principal" className="flex flex-wrap justify-end gap-1">
          <NavLink to="/" end className={navClass}>
            Agendar
          </NavLink>
          {role === 'super_admin' || isStaff(role) ? (
            <NavLink to={homeForRole(role)} className={navClass}>
              Painel
            </NavLink>
          ) : null}
          <NavLink to={session ? '/minha-conta' : '/entrar'} className={navClass}>
            {session ? 'Conta' : 'Entrar'}
          </NavLink>
        </nav>
      </header>
      <main className="flex-1 pb-10">
        <Outlet />
      </main>
    </div>
  )
}
