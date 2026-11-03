import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { DayAgenda } from '@/components/DayAgenda'
import { PushToggle } from '@/components/PushToggle'
import { ErrorState, Spinner } from '@/components/states'
import { Select } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { isManager, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useAllBarbers } from '@/pages/admin/queries'

export function AppAgendaPage() {
  const { session, profile, role } = useAuth()
  const uid = session?.user.id ?? ''
  const [params] = useSearchParams()
  // vindo do push "atendimento terminou": abre o dia e a conclusão daquele horário
  const focusId = params.get('concluir')
  const rawDay = params.get('dia')
  const focusDay = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : null

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
        <h1 className="text-4xl font-bold leading-none">Agenda</h1>
        <p className="mt-1 text-muted">{barber.data?.display_name ?? profile?.name}</p>
      </header>
      <PushToggle />
      {isManager(role) ? (
        <ManagerAgenda myBarberId={barber.data?.id ?? null} focusId={focusId} focusDay={focusDay} />
      ) : barber.data ? (
        <DayAgenda barberId={barber.data.id} initialDate={focusDay} focusId={focusId} />
      ) : (
        <ErrorState message="Sua conta ainda não está ligada a um cadastro de barbeiro. Fale com o dono da barbearia." />
      )}
    </div>
  )
}

/** Dono: a própria agenda (se atende) ou a de qualquer barbeiro / todos. */
function ManagerAgenda({
  myBarberId,
  focusId,
  focusDay,
}: {
  myBarberId: string | null
  focusId: string | null
  focusDay: string | null
}) {
  const barbers = useAllBarbers()
  const [params, setParams] = useSearchParams()
  const raw = params.get('barbeiro')
  // com um atendimento em foco, mostra todos (o horário pode ser de outro barbeiro)
  const selected = raw === 'todos' || (focusId && !raw) ? null : (raw ?? myBarberId)

  return (
    <div className="space-y-4">
      <Select
        label="Ver agenda de"
        value={selected ?? 'todos'}
        onChange={(e) => setParams({ barbeiro: e.target.value }, { replace: true })}
      >
        <option value="todos">Todos os barbeiros</option>
        {barbers.data?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.id === myBarberId ? `${b.display_name} (eu)` : b.display_name}
            {b.active ? '' : ' (inativo)'}
          </option>
        ))}
      </Select>
      <DayAgenda key={focusId ?? 'agenda'} barberId={selected} showBarber={!selected} initialDate={focusDay} focusId={focusId} />
    </div>
  )
}
