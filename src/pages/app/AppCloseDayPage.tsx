import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { CloseDay } from '@/components/CloseDay'
import { ErrorState, Spinner } from '@/components/states'
import { Button, Card, Input, Select } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { isManager, useAuth } from '@/lib/auth'
import { APP_TIMEZONE } from '@/lib/env'
import { calendarDate, formatShortDate, formatTime } from '@/lib/format'
import { addDays, dateInTz, zonedToUtc } from '@/lib/shared'
import { supabase } from '@/lib/supabase'
import { useNow } from '@/hooks/useNow'
import { useAllBarbers } from '@/pages/admin/queries'

const longDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** Fechar a agenda de uma data (barbeiro: a própria; dono: de qualquer barbeiro). */
export function AppCloseDayPage() {
  const { session, role } = useAuth()
  const uid = session?.user.id ?? ''
  const manager = isManager(role)
  const today = dateInTz(useNow(), APP_TIMEZONE)
  const [date, setDate] = useState(today)
  const [pickedBarber, setPickedBarber] = useState<string | null>(null)
  const allBarbers = useAllBarbers()

  const me = useQuery({
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

  if (me.isPending) return <Spinner />
  if (me.isError) return <ErrorState message={errorMessage(me.error)} />

  const activeBarbers = (allBarbers.data ?? []).filter((b) => b.active)
  const barberId = manager ? (pickedBarber ?? me.data?.id ?? activeBarbers[0]?.id ?? null) : (me.data?.id ?? null)
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today ? date : null

  return (
    <div className="space-y-5 py-2">
      <h1 className="text-4xl font-bold leading-none">Fechar data</h1>

      <Card className="space-y-3">
        <Input
          label="Data"
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          hint={validDate ? longDay.format(calendarDate(validDate)) : 'Escolha hoje ou uma data futura.'}
        />
        {manager ? (
          <Select label="Barbeiro" value={barberId ?? ''} onChange={(e) => setPickedBarber(e.target.value)}>
            {activeBarbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id === me.data?.id ? `${b.display_name} (eu)` : b.display_name}
              </option>
            ))}
          </Select>
        ) : null}
      </Card>

      {!barberId ? (
        <ErrorState message="Sua conta ainda não está ligada a um cadastro de barbeiro. Fale com o dono da barbearia." />
      ) : (
        <>
          {validDate ? <DayCloser key={`${barberId}-${validDate}`} barberId={barberId} date={validDate} /> : null}
          <ClosedDates barberId={barberId} onPick={setDate} />
        </>
      )}
    </div>
  )
}

/** Busca os horários marcados da data e mostra o fechar/reabrir. */
function DayCloser({ barberId, date }: { barberId: string; date: string }) {
  const scheduled = useQuery({
    queryKey: ['agenda', date, barberId, 'scheduled'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, starts_at, customer:customers(name, phone), appointment_services(service_name)')
        .eq('barber_id', barberId)
        .eq('status', 'scheduled')
        .gte('starts_at', zonedToUtc(date, 0, APP_TIMEZONE).toISOString())
        .lt('starts_at', zonedToUtc(addDays(date, 1), 0, APP_TIMEZONE).toISOString())
        .order('starts_at')
      if (error) throw error
      return data
    },
  })

  if (scheduled.isPending) return <Spinner />
  if (scheduled.isError) return <ErrorState message={errorMessage(scheduled.error)} />
  return <CloseDay barberId={barberId} date={date} scheduled={scheduled.data} />
}

/** Próximos dias/horários fechados do barbeiro. */
function ClosedDates({ barberId, onPick }: { barberId: string; onPick: (date: string) => void }) {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['day-blocks', barberId, 'upcoming'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off')
        .select('id, starts_at, ends_at, reason')
        .eq('barber_id', barberId)
        .gt('ends_at', new Date().toISOString())
        .order('starts_at')
      if (error) throw error
      return data
    },
  })

  const reopen = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_off').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['day-blocks'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'time_off'] })
    },
  })

  if (!list.data?.length) return null

  return (
    <section>
      <h2 className="mb-2 text-xl font-semibold">Datas fechadas</h2>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {list.data.map((t) => {
          const startDay = dateInTz(new Date(t.starts_at), APP_TIMEZONE)
          return (
            <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <button type="button" className="text-left" onClick={() => onPick(startDay)}>
                <span className="inline-block first-letter:uppercase">{formatShortDate(t.starts_at)}</span>{' '}
                {formatTime(t.starts_at)} → <span className="inline-block first-letter:uppercase">{formatShortDate(t.ends_at)}</span>{' '}
                {formatTime(t.ends_at)}
                {t.reason ? <span className="text-muted"> · {t.reason}</span> : null}
              </button>
              <Button
                size="sm"
                variant="ghost"
                loading={reopen.isPending && reopen.variables === t.id}
                onClick={() => reopen.mutate(t.id)}
              >
                Reabrir
              </Button>
            </li>
          )
        })}
      </ul>
      {reopen.isError ? <p className="mt-2 text-sm text-danger">{errorMessage(reopen.error)}</p> : null}
    </section>
  )
}
