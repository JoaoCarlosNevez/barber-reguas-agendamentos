import { useQuery } from '@tanstack/react-query'
import { DayAgenda } from '@/components/DayAgenda'
import { PushToggle } from '@/components/PushToggle'
import { ErrorState, Spinner } from '@/components/states'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export function BarberPage() {
  const { session, profile } = useAuth()
  const uid = session?.user.id ?? ''

  const barber = useQuery({
    queryKey: ['my-barber', uid],
    enabled: uid !== '',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('barbers')
        .select('id, display_name, active')
        .eq('profile_id', uid)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  if (barber.isPending) return <Spinner />
  if (barber.isError) return <ErrorState message={errorMessage(barber.error)} />

  return (
    <div className="space-y-6 py-2">
      <header>
        <h1 className="text-4xl font-bold leading-none">Minha agenda</h1>
        <p className="mt-1 text-muted">{barber.data?.display_name ?? profile?.name}</p>
      </header>
      <PushToggle />
      {barber.data ? (
        <DayAgenda barberId={barber.data.id} />
      ) : (
        <ErrorState message="Sua conta ainda não está ligada a um cadastro de barbeiro. Fale com o administrador." />
      )}
    </div>
  )
}
