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
        .select('id, status, paid_cents, payment_method, subscription_id, barber:barbers(id, display_name), appointment_services(service_name, price_cents, covered)')
        .gte('starts_at', zonedToUtc(from, 0, APP_TIMEZONE).toISOString())
        .lt('starts_at', zonedToUtc(to, 0, APP_TIMEZONE).toISOString())
        .in('status', ['completed', 'no_show', 'scheduled'])
      if (error) throw error
      return data
    },
  })
}

/** Mensalidades de assinatura pagas no período (entram no dia do pagamento). */
function useSubscriptionRevenue(from: string, to: string) {
  return useQuery({
    queryKey: ['revenue', 'subscriptions', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_subscriptions')
        .select('id, plan_name, price_cents, payment_method')
        .gte('paid_at', zonedToUtc(from, 0, APP_TIMEZONE).toISOString())
        .lt('paid_at', zonedToUtc(to, 0, APP_TIMEZONE).toISOString())
      if (error) throw error
      return data
    },
  })
}

/** Assinaturas que valem hoje: ativas e quantas estão com pagamento pendente. */
function useActiveSubscriptions(today: string) {
  return useQuery({
    queryKey: ['revenue', 'subscriptions-active', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_subscriptions')
        .select('id, price_cents, paid_at')
        .lte('starts_on', today)
        .gt('ends_on', today)
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
  const subsQ = useSubscriptionRevenue(from, to)
  const activeQ = useActiveSubscriptions(today)

  const priceOf = (a: { appointment_services: { price_cents: number; covered: boolean }[] }) =>
    a.appointment_services.reduce((t, s) => t + (s.covered ? 0 : s.price_cents), 0)

  const all = q.data ?? []
  const done = all.filter((a) => a.status === 'completed')
  const paid = (a: (typeof done)[number]) => a.paid_cents ?? priceOf(a)
  const servicesTotal = done.reduce((t, a) => t + paid(a), 0)
  // ticket médio só dos atendimentos cobrados (assinatura sai por R$ 0)
  const charged = done.filter((a) => a.payment_method !== 'subscription').length
  const ticket = charged ? Math.round(servicesTotal / charged) : 0
  const subs = subsQ.data ?? []
  const subsTotal = subs.reduce((t, x) => t + x.price_cents, 0)
  const total = servicesTotal + subsTotal
  const subCuts = done.filter((a) => a.subscription_id).length
  const activeSubs = activeQ.data ?? []
  const pendingSubs = activeSubs.filter((x) => !x.paid_at)
  const noShows = all.filter((a) => a.status === 'no_show').length
  const pending = all.filter((a) => a.status === 'scheduled')
  const pendingValue = pending.reduce((t, a) => t + priceOf(a), 0)

  const byBarber = group(
    done,
    (a) => a.barber?.id ?? '-',
    (a) => a.barber?.display_name ?? 'Sem barbeiro',
    paid,
  )
  // forma de pagamento: atendimentos + mensalidades (sem o "Assinatura" de R$ 0)
  const byMethod = group(
    [
      ...done
        .filter((a) => a.payment_method && a.payment_method !== 'subscription')
        .map((a) => ({ method: a.payment_method ?? 'pix', value: paid(a) })),
      ...subs.map((x) => ({ method: x.payment_method ?? 'pix', value: x.price_cents })),
    ],
    (r) => r.method,
    (r) => PAYMENT_LABEL[r.method],
    (r) => r.value,
  )
    .map((r) => ({ ...r, detail: '' }))
    .sort((a, b) => PAYMENT_METHODS.indexOf(a.key as never) - PAYMENT_METHODS.indexOf(b.key as never))
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

      {q.isPending || subsQ.isPending ? (
        <Spinner />
      ) : q.isError || subsQ.isError ? (
        <ErrorState message={errorMessage(q.error ?? subsQ.error)} />
      ) : (
        <>
          <Card className="py-5 text-center">
            <p className="text-sm text-muted">Faturamento</p>
            <p className="font-display text-5xl font-bold text-accent">{formatPrice(total)}</p>
            <p className="mt-1 text-sm text-muted">
              {done.length} atendimento{done.length === 1 ? '' : 's'} concluído{done.length === 1 ? '' : 's'}
              {subs.length ? ` + ${subs.length} mensalidade${subs.length === 1 ? '' : 's'}` : ''}
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-2 text-center">
            <Stat value={formatPrice(servicesTotal)} label="atendimentos" />
            <Stat value={formatPrice(subsTotal)} label={`assinaturas (${subs.length})`} />
          </div>

          {activeSubs.length || subCuts ? (
            <Card>
              <h3 className="mb-2 text-base font-semibold">Assinaturas</h3>
              <ul className="space-y-1 text-sm">
                <li className="flex justify-between gap-2">
                  <span>Assinantes ativos hoje</span>
                  <span className="font-semibold tabular-nums">{activeSubs.length}</span>
                </li>
                {pendingSubs.length ? (
                  <li className="flex justify-between gap-2 text-accent">
                    <span>Com pagamento pendente</span>
                    <span className="font-semibold tabular-nums">
                      {pendingSubs.length} · {formatPrice(pendingSubs.reduce((t, x) => t + x.price_cents, 0))}
                    </span>
                  </li>
                ) : null}
                <li className="flex justify-between gap-2">
                  <span>Cortes de assinantes no período</span>
                  <span className="font-semibold tabular-nums">{subCuts}</span>
                </li>
                {subs.length ? (
                  <li className="flex justify-between gap-2">
                    <span>Recebido em mensalidades</span>
                    <span className="font-semibold tabular-nums">{formatPrice(subsTotal)}</span>
                  </li>
                ) : null}
              </ul>
            </Card>
          ) : null}

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat value={formatPrice(ticket)} label="ticket médio" />
            <Stat value={String(noShows)} label={noShows === 1 ? 'falta' : 'faltas'} />
            <Stat value={formatPrice(pendingValue)} label={`a concluir (${pending.length})`} />
          </div>

          {done.length === 0 && subs.length === 0 ? (
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
