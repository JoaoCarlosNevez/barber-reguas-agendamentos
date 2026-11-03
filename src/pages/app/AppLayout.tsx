import { Link, NavLink, Outlet } from 'react-router'
import { isManager, useAuth } from '@/lib/auth'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold transition-colors ${
    isActive ? 'text-brass' : 'text-muted hover:text-cream'
  }`

/** App da equipe (PWA instalável): dono e barbeiros. */
export function AppLayout() {
  const { role, session } = useAuth()

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between gap-2 py-4">
        <Link to="/app" className="flex items-center gap-2 font-display text-xl font-bold tracking-widest text-cream uppercase">
          <img src="/favicon.svg" alt="" className="size-7" />
          Barbearia
        </Link>
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">Equipe</span>
      </header>
      <main className="flex-1 pb-28">
        <Outlet />
      </main>
      {session ? (
        <nav
          aria-label="App"
          className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        >
          <div className="mx-auto flex max-w-xl">
            <NavLink to="/app" end className={tabClass}>
              <span aria-hidden className="text-lg leading-none">📅</span>
              Agenda
            </NavLink>
            {isManager(role) ? (
              <NavLink to="/app/gestao" className={tabClass}>
                <span aria-hidden className="text-lg leading-none">⚙️</span>
                Gestão
              </NavLink>
            ) : null}
            <NavLink to="/app/conta" className={tabClass}>
              <span aria-hidden className="text-lg leading-none">👤</span>
              Conta
            </NavLink>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
