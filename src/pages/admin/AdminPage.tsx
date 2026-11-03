import { Link, Outlet } from 'react-router'
import { Button } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { ManageTabs } from './ManageTabs'

/** Painel do super admin: web (desktop), fora do app instalável. */
export function AdminLayout() {
  const { profile, signOut } = useAuth()
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 lg:px-8">
      <header className="flex items-center justify-between gap-3 border-b border-line py-4">
        <Link to="/admin" className="flex items-center gap-2 font-display text-xl font-bold tracking-widest text-cream uppercase">
          <img src="/favicon.svg" alt="" className="size-7" />
          Barbearia <span className="text-sm font-semibold tracking-normal text-brass normal-case">super admin</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/" className="text-muted hover:text-cream">
            Ver site
          </Link>
          <span className="hidden text-muted sm:inline">{profile?.name}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </header>
      <main className="flex-1 py-6">
        <Outlet />
      </main>
    </div>
  )
}

export function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold leading-none">Administração</h1>
      <ManageTabs layout="side" tabs={['agenda', 'contas', 'barbeiros', 'servicos', 'fidelidade', 'ajustes']} />
    </div>
  )
}
