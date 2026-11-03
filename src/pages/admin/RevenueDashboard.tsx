import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState, ErrorState, Spinner } from '@/components/states'
import { Card } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { APP_TIMEZONE } from '@/lib/env'
import { formatPrice, PAYMENT_LABEL, PAYMENT_METHODS } from '@/lib/format'
import { addDays, dateInTz, zonedToUtc } from '@/lib/shared'
import { supabase } from '@/lib/supabase'
import { useNow } from '@/hooks/useNow'

const PERIODS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes-passado', label: 'Mês passado' },
] as const
type PeriodId = (typeof PERIODS)[number]['id']

/** Intervalo [from, to) em datas locais da barbearia (YYYY-MM-DD). */
function periodRange(id: PeriodId, today: string): { from: string; to: string } {
  const [y = 0, m = 1] = today.split('-').map(Number)
  const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`
  if (id === 'hoje') return { from: today, to: addDays(today, 1) }
  if (id === '7d') return { from: addDays(today, -6), to: addDays(today, 1) }
  if (id === 'mes') return { from: monthStart(y, m), to: m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1) }
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return { from: monthStart(py, pm), to: monthStart(y, m) }
}

function useRevenue(from: string, to: string) {
  return useQuery({
    queryKey: ['revenue', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, status, paid_cents, payment_method, barber:barbers(id, display_name), appointment_services(service_name, price_cents)')
        .gte('starts_at', zonedToUtc(from, 0, APP_TIMEZONE).toISOString())
        .lt('starts_at', zonedToUtc(to, 0, APP_TIMEZONE).toISOString())
        .in('status', ['completed', 'no_show', 'scheduled'])
      if (error) throw error
      return data
    },
  })
}

interface Row {
  key: string
  label: string
  value: number
  detail: string
}

function group<T>(items: T[], keyOf: (t: T) => string, labelOf: (t: T) => string, valueOf: (t: T) => number): Row[] {
  const map = new Map<string, Row & { count: number }>()
  for (const it of items) {
    const k = keyOf(it)
    const cur = map.get(k) ?? { key: k, label: labelOf(it), value: 0, detail: '', count: 0 }
    cur.value += valueOf(it)
    cur.count += 1
    map.set(k, cur)
  }
  return [...map.values()]
    .map((r) => ({ ...r, detail: `${r.count} atendimento${r.count === 1 ? '' : 's'}` }))
    .sort((a, b) => b.value - a.value)
}

/** Faturamento do dono: o que foi recebido nos atendimentos concluídos. */
export function RevenueDashboard() {
  const now = useNow()
  const today = dateInTz(now, APP_TIMEZONE)
  const [period, setPeriod] = useState<PeriodId>('hoje')
  const { from, to } = periodRange(period, today)
  const q = useRevenue(from, to)

  const priceOf = (a: { appointment_services: { price_cents: number }[] }) =>
    a.appointment_services.reduce((t, s) => t + s.price_cents, 0)

  const all = q.data ?? []
  const done = all.filter((a) => a.status === 'completed')
  const paid = (a: (typeof done)[number]) => a.paid_cents ?? priceOf(a)
  const total = done.reduce((t, a) => t + paid(a), 0)
  const ticket = done.length ? Math.round(total / done.length) : 0
  const noShows = all.filter((a) => a.status === 'no_show').length
  const pending = all.filter((a) => a.status === 'scheduled')
  const pendingValue = pending.reduce((t, a) => t + priceOf(a), 0)

  const byBarber = group(
    done,
    (a) => a.barber?.id ?? '-',
    (a) => a.barber?.display_name ?? 'Sem barbeiro',
    paid,
  )
  const byMethod = group(
    done.filter((a) => a.payment_method),
    (a) => a.payment_method ?? '',
    (a) => (a.payment_method ? PAYMENT_LABEL[a.payment_method] : ''),
    paid,
  ).sort((a, b) => PAYMENT_METHODS.indexOf(a.key as never) - PAYMENT_METHODS.indexOf(b.key as never))
  const services = group(
    done.flatMap((a) => a.appointment_services),
    (s) => s.service_name,
    (s) => s.service_name,
    () => 1,
  ).map((r) => ({ ...r, detail: '' }))

  return (
    <section className="space-y-5">
      <fieldset className="-mx-4 flex gap-1 overflow-x-auto px-4">
        <legend className="sr-only">Período</legend>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={period === p.id}
            onClick={() => setPeriod(p.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              period === p.id ? 'border-accent text-accent' : 'border-line text-muted hover:text-cream'
            }`}
          >
            {p.label}
          </button>
        ))}
      </fieldset>

      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : (
        <>
          <Card className="py-5 text-center">
            <p className="text-sm text-muted">Faturamento</p>
            <p className="font-display text-5xl font-bold text-accent">{formatPrice(total)}</p>
            <p className="mt-1 text-sm text-muted">
              {done.length} atendimento{done.length === 1 ? '' : 's'} concluído{done.length === 1 ? '' : 's'}
            </p>
          </Card>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat value={formatPrice(ticket)} label="ticket médio" />
            <Stat value={String(noShows)} label={noShows === 1 ? 'falta' : 'faltas'} />
            <Stat value={formatPrice(pendingValue)} label={`a concluir (${pending.length})`} />
          </div>

          {done.length === 0 ? (
            <EmptyState title="Nada recebido ainda">
              O faturamento entra quando o barbeiro conclui o atendimento e informa o pagamento.
            </EmptyState>
          ) : (
            <>
              <BarList title="Por barbeiro" rows={byBarber} format={formatPrice} />
              <BarList title="Por forma de pagamento" rows={byMethod} format={formatPrice} />
              <BarList title="Serviços mais feitos" rows={services} format={(n) => `${n}×`} />
            </>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card className="px-2 py-3">
      <p className="font-display text-xl font-bold leading-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Card>
  )
}

/** Lista com barras horizontais (uma série, uma cor) e o valor escrito em texto. */
function BarList({ title, rows, format }: { title: string; rows: Row[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} title={`${r.label}: ${format(r.value)}${r.detail ? ` · ${r.detail}` : ''}`}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{r.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {format(r.value)}
                {r.detail ? <span className="ml-1 font-normal text-muted">· {r.detail}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
              <div className="h-2 rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
