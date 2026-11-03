import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState, ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Notice } from '@/components/ui'
import { callFunction, errorMessage } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { APP_TIMEZONE } from '@/lib/env'
import { calendarDate, formatPrice, formatTime, STATUS_LABEL } from '@/lib/format'
import { addDays, dateInTz, formatBrPhone, zonedToUtc } from '@/lib/shared'
import { type Enums, supabase } from '@/lib/supabase'
import { useNow } from '@/hooks/useNow'

type Status = Enums<'appointment_status'>

const longDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

function useDayAgenda(date: string, barberId: string | null) {
  return useQuery({
    queryKey: ['agenda', date, barberId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const from = zonedToUtc(date, 0, APP_TIMEZONE).toISOString()
      const to = zonedToUtc(addDays(date, 1), 0, APP_TIMEZONE).toISOString()
      let q = supabase
        .from('appointments')
        .select(
          `id, starts_at, ends_at, status, cancelled_by,
           barber:barbers(id, display_name),
           customer:customers(id, name, phone, is_guest, auth_user_id),
           appointment_services(service_name, price_cents, duration_min)`,
        )
        .gte('starts_at', from)
        .lt('starts_at', to)
        .order('starts_at')
      if (barberId) q = q.eq('barber_id', barberId)
      const { data, error } = await q
      if (error) throw error

      // selos disponíveis por cliente cadastrado
      const registered = [
        ...new Set(data.filter((a) => a.customer && !a.customer.is_guest).map((a) => a.customer?.id ?? '')),
      ].filter(Boolean)
      const stamps = new Map<string, number>()
      if (registered.length) {
        const { data: rows, error: sErr } = await supabase
          .from('loyalty_stamps')
          .select('customer_id')
          .in('customer_id', registered)
          .is('redemption_id', null)
        if (sErr) throw sErr
        for (const r of rows) stamps.set(r.customer_id, (stamps.get(r.customer_id) ?? 0) + 1)
      }
      return { appointments: data, stamps }
    },
  })
}

function DateNav({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="secondary" size="sm" aria-label="Dia anterior" onClick={() => onChange(addDays(date, -1))}>
        ←
      </Button>
      <div className="text-center">
        <p className="font-semibold first-letter:uppercase">{longDay.format(calendarDate(date))}</p>
        {date !== today ? (
          <button type="button" className="text-xs text-brass underline" onClick={() => onChange(today)}>
            voltar para hoje
          </button>
        ) : (
          <p className="text-xs text-muted">hoje</p>
        )}
      </div>
      <Button variant="secondary" size="sm" aria-label="Próximo dia" onClick={() => onChange(addDays(date, 1))}>
        →
      </Button>
    </div>
  )
}

export function DayAgenda({ barberId, showBarber = false }: { barberId: string | null; showBarber?: boolean }) {
  const nowDate = useNow()
  const today = dateInTz(nowDate, APP_TIMEZONE)
  const [picked, setDate] = useState<string | null>(null)
  const date = picked ?? today
  const agenda = useDayAgenda(date, barberId)
  const catalog = useCatalog()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<{ id: string; status: Status } | null>(null)
  const [flash, setFlash] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase.from('appointments').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setConfirm(null)
      setFlash(null)
      void qc.invalidateQueries({ queryKey: ['agenda'] })
    },
    onError: (err) => setFlash({ tone: 'error', text: errorMessage(err) }),
  })

  const redeem = useMutation({
    mutationFn: (customerId: string) => callFunction('redeem-loyalty', { customer_id: customerId }),
    onSuccess: () => {
      setFlash({ tone: 'success', text: 'Prêmio resgatado! Os selos foram zerados.' })
      void qc.invalidateQueries({ queryKey: ['agenda'] })
    },
    onError: (err) => setFlash({ tone: 'error', text: errorMessage(err) }),
  })

  const rule = catalog.data?.loyaltyRule ?? null
  const list = agenda.data?.appointments ?? []
  const active = list.filter((a) => a.status !== 'cancelled')
  const revenue = list
    .filter((a) => a.status === 'scheduled' || a.status === 'completed')
    .reduce((t, a) => t + a.appointment_services.reduce((s, x) => s + x.price_cents, 0), 0)
  const now = nowDate.getTime()

  return (
    <div className="space-y-4">
      <DateNav date={date} today={today} onChange={setDate} />

      {agenda.data ? (
        <div className="grid grid-cols-2 gap-2 text-center">
          <Card className="py-3">
            <p className="font-display text-3xl font-bold">{active.length}</p>
            <p className="text-xs text-muted">atendimento(s)</p>
          </Card>
          <Card className="py-3">
            <p className="font-display text-3xl font-bold text-brass">{formatPrice(revenue)}</p>
            <p className="text-xs text-muted">previsto</p>
          </Card>
        </div>
      ) : null}

      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}

      {agenda.isPending ? (
        <Spinner />
      ) : agenda.isError ? (
        <ErrorState message={errorMessage(agenda.error)} />
      ) : list.length === 0 ? (
        <EmptyState title="Agenda livre">Nenhum agendamento neste dia.</EmptyState>
      ) : (
        <ol className="space-y-2">
          {list.map((a) => {
            const started = new Date(a.starts_at).getTime() <= now
            const c = a.customer
            const stamps = c ? (agenda.data.stamps.get(c.id) ?? 0) : 0
            const canRedeem = rule && c && !c.is_guest && stamps >= rule.stamps_required
            const isConfirming = confirm?.id === a.id
            return (
              <li key={a.id}>
                <Card className={a.status === 'cancelled' ? 'opacity-50' : ''}>
                  <div className="flex items-start gap-3">
                    <div className="w-16 shrink-0">
                      <p className="font-display text-2xl font-bold leading-none">{formatTime(a.starts_at)}</p>
                      <p className="text-xs text-muted">até {formatTime(a.ends_at)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{c?.name ?? 'Cliente'}</p>
                        <Badge tone={a.status}>{STATUS_LABEL[a.status]}</Badge>
                      </div>
                      <p className="text-sm text-muted">
                        {a.appointment_services.map((s) => s.service_name).join(' + ')} ·{' '}
                        {formatPrice(a.appointment_services.reduce((t, s) => t + s.price_cents, 0))}
                        {showBarber && a.barber ? ` · ${a.barber.display_name}` : ''}
                      </p>
                      {c ? (
                        <p className="mt-1 flex flex-wrap gap-3 text-sm">
                          <a className="text-brass underline underline-offset-2" href={`tel:${c.phone}`}>
                            {formatBrPhone(c.phone)}
                          </a>
                          <a
                            className="text-brass underline underline-offset-2"
                            href={`https://wa.me/${c.phone.replace('+', '')}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            WhatsApp
                          </a>
                        </p>
                      ) : null}
                      {rule && c && !c.is_guest ? (
                        <p className="mt-1 text-xs text-muted">
                          Fidelidade: {stamps}/{rule.stamps_required} selos
                          {canRedeem ? ' · prêmio disponível!' : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {a.status === 'scheduled' ? (
                    isConfirming ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                        <span className="text-sm">
                          {confirm.status === 'cancelled'
                            ? 'Cancelar este horário?'
                            : confirm.status === 'no_show'
                              ? 'Marcar como falta?'
                              : 'Confirmar atendimento?'}
                        </span>
                        <Button
                          size="sm"
                          variant={confirm.status === 'completed' ? 'primary' : 'danger'}
                          loading={setStatus.isPending}
                          onClick={() => setStatus.mutate(confirm)}
                        >
                          Sim
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                          Não
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                        {started ? (
                          <>
                            <Button size="sm" onClick={() => setConfirm({ id: a.id, status: 'completed' })}>
                              ✓ Atendido
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setConfirm({ id: a.id, status: 'no_show' })}
                            >
                              Faltou
                            </Button>
                          </>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: a.id, status: 'cancelled' })}>
                          Cancelar
                        </Button>
                      </div>
                    )
                  ) : null}

                  {canRedeem ? (
                    <div className="mt-3 border-t border-line pt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={redeem.isPending && redeem.variables === c.id}
                        onClick={() => redeem.mutate(c.id)}
                      >
                        🎁 Resgatar: {rule.reward_description}
                      </Button>
                    </div>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
