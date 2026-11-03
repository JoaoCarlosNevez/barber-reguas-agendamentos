import { Spinner } from '@/components/states'
import { Button } from '@/components/ui'
import { ROLE_LABEL, useAuth } from '@/lib/auth'
import { ProfileForm } from '@/pages/account/AccountPage'

export function AppAccountPage() {
  const { profile, role, signOut } = useAuth()
  if (!profile) return <Spinner />

  return (
    <div className="space-y-8 py-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold leading-none">Olá, {profile.name.split(' ')[0]}</h1>
          {role ? <p className="mt-1 text-muted">{ROLE_LABEL[role]}</p> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sair
        </Button>
      </header>
      <ProfileForm profile={profile} />
      <p className="text-center text-sm text-muted">Esqueceu a senha? Fale com o dono da barbearia.</p>
    </div>
  )
}
