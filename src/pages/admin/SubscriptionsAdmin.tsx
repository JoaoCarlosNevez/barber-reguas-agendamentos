import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Input, Notice, Select } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { APP_TIMEZONE } from '@/lib/env'
import { calendarDate, centsToInput, formatPrice, parseBrlToCents, PAYMENT_LABEL, PAYMENT_METHODS } from '@/lib/format'
import { dateInTz } from '@/lib/shared'
import { type Enums, supabase } from '@/lib/supabase'
import { useNow } from '@/hooks/useNow'
import { currentSubscription, type SubscriptionRow } from '@/lib/subscription'
import { useAdminServices, useSubscriptionPlans } from './queries'

type PaymentMethod = Enums<'payment_method'>

const shortDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
/** "2026-11-10" -> "10/11" */
const dayLabel = (d: string) => shortDay.format(calendarDate(d))
/** último dia do período (ends_on é exclusivo) */
const lastDay = (endsOn: string) => {
  const d = calendarDate(endsOn)
  d.setUTCDate(d.getUTCDate() - 1)
  return shortDay.format(d)
}
const addMonth = (d: string) => {
  const [y = 0, m = 1, day = 1] = d.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, day))
  // 31/01 + 1 mês => último dia de fevereiro, igual ao banco
  if (next.getUTCDate() !== day) next.setUTCDate(0)
  return next.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

/** Configurar planos: nome, valor, cortes por mês e serviços cobertos. */
export function PlansAdmin() {
  const plans = useSubscriptionPlans()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <span>
          <span className="block font-semibold">Planos de assinatura</span>
          <span className="block text-sm text-muted">
            {plans.data?.filter((p) => p.active).length ?? 0} ativo(s) · valor e quantidade de cortes
          </span>
        </span>
        <span aria-hidden className="text-muted">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line p-4">
          {plans.isPending ? (
            <Spinner />
          ) : plans.isError ? (
            <ErrorState message={errorMessage(plans.error)} />
          ) : (
            <>
              {plans.data.map((p) =>
                editing === p.id ? (
                  <PlanForm key={p.id} plan={p} onDone={() => setEditing(null)} />
                ) : (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 ${p.active ? '' : 'opacity-60'}`}
                  >
                    <span className="min-w-0 text-sm">
                      <span className="block font-semibold">
                        {p.name}
                        {p.active ? '' : ' (desativado)'}
                      </span>
                      <span className="text-muted">
                        {formatPrice(p.price_cents)}/mês · {p.cuts_per_month} {p.cuts_per_month === 1 ? 'corte' : 'cortes'}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>
                      Editar
                    </Button>
                  </div>
                ),
              )}
              {editing === 'new' ? (
                <PlanForm plan={null} onDone={() => setEditing(null)} />
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
                  + Novo plano
                </Button>
              )}
            </>
          )}
        </div>
      ) : null}
    </Card>
  )
}

type Plan = NonNullable<ReturnType<typeof useSubscriptionPlans>['data']>[number]

function PlanForm({ plan, onDone }: { plan: Plan | null; onDone: () => void }) {
  const qc = useQueryClient()
  const services = useAdminServices()
  const [name, setName] = useState(plan?.name ?? 'Plano 4 cortes')
  const [price, setPrice] = useState(plan ? centsToInput(plan.price_cents) : '')
  const [cuts, setCuts] = useState(String(plan?.cuts_per_month ?? 4))
  const [active, setActive] = useState(plan?.active ?? true)
  const [covered, setCovered] = useState<string[]>(plan?.subscription_plan_services.map((s) => s.service_id) ?? [])
  const cents = parseBrlToCents(price)
  const cutsN = Number(cuts)

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Dê um nome ao plano.')
      if (cents === null) throw new Error('Valor inválido.')
      if (!Number.isInteger(cutsN) || cutsN < 1 || cutsN > 60) throw new Error('Cortes por mês: de 1 a 60.')
      if (!covered.length) throw new Error('Marque pelo menos um serviço coberto.')
      const values = { name: name.trim(), price_cents: cents, cuts_per_month: cutsN, active }
      let id = plan?.id
      if (id) {
        const { error } = await supabase.from('subscription_plans').update(values).eq('id', id)
        if (error) throw error
        const { error: delErr } = await supabase.from('subscription_plan_services').delete().eq('plan_id', id)
        if (delErr) throw delErr
      } else {
        const { data, error } = await supabase.from('subscription_plans').insert(values).select('id').single()
        if (error) throw error
        id = data.id
      }
      const planId = id
      const { error: svcErr } = await supabase
        .from('subscription_plan_services')
        .insert(covered.map((service_id) => ({ plan_id: planId, service_id })))
      if (svcErr) throw svcErr
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'subscription_plans'] })
      onDone()
    },
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!plan) return
      const { error } = await supabase.from('subscription_plans').delete().eq('id', plan.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'subscription_plans'] })
      onDone()
    },
  })

  return (
    <form
      className="space-y-3 rounded-lg border border-dashed border-line p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Input label="Nome do plano" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input label="Valor por mês (R$)" inputMode="decimal" placeholder="150,00" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Input label="Cortes por mês" type="number" min={1} max={60} value={cuts} onChange={(e) => setCuts(e.target.value)} />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm text-muted">Serviços cobertos (o resto o cliente paga à parte)</legend>
        {services.data?.filter((s) => s.active).map((s) => (
          <label key={s.id} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={covered.includes(s.id)}
              onChange={(e) => setCovered(e.target.checked ? [...covered, s.id] : covered.filter((x) => x !== s.id))}
            />
            {s.name} <span className="text-muted">· {formatPrice(s.price_cents)}</span>
          </label>
        ))}
      </fieldset>
      {plan ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-accent)]"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Plano ativo (desativado não aparece para novas assinaturas)
        </label>
      ) : null}
      <p className="text-xs text-muted">Mudanças valem para as próximas ativações/renovações; quem já pagou o mês segue o plano que pagou.</p>
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>
          Salvar plano
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        {plan ? (
          <Button type="button" size="sm" variant="ghost" className="ml-auto text-danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Excluir plano
          </Button>
        ) : null}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Assinatura de um cliente (dentro do card em Clientes)
// ---------------------------------------------------------------------------

export function CustomerSubscription({ customerId, subs }: { customerId: string; subs: SubscriptionRow[] }) {
  const qc = useQueryClient()
  const today = dateInTz(useNow(), APP_TIMEZONE)
  const [adding, setAdding] = useState(false)
  const sorted = [...subs].sort((a, b) => b.starts_on.localeCompare(a.starts_on))
  const current = currentSubscription(sorted, today)
  const upcoming = sorted.filter((s) => s.starts_on > today)
  const latest = sorted[0]
  // renovação começa quando a última termina (se ainda não terminou)
  const nextStart = latest && latest.ends_on > today ? latest.ends_on : today

  const usage = useQuery({
    queryKey: ['admin', 'subscription_usage', current?.id],
    enabled: current !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('subscription_usage', { p_ids: [current?.id ?? ''] })
      if (error) throw error
      return data[0]?.used ?? 0
    },
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'customers'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'subscription_usage'] })
    void qc.invalidateQueries({ queryKey: ['revenue'] })
    void qc.invalidateQueries({ queryKey: ['agenda'] })
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mb-2 text-sm font-semibold">Assinatura</p>
      {current ? (
        <SubscriptionPeriod sub={current} used={usage.data} invalidate={invalidate} />
      ) : (
        <p className="text-sm text-muted">Sem assinatura ativa{latest ? ` (a última terminou em ${lastDay(latest.ends_on)})` : ''}.</p>
      )}
      {upcoming.map((s) => (
        <div key={s.id} className="mt-3 border-t border-line pt-3">
          <p className="mb-1 text-xs text-muted">Próximo mês já lançado</p>
          <SubscriptionPeriod sub={s} used={undefined} invalidate={invalidate} />
        </div>
      ))}
      <div className="mt-3">
        {adding ? (
          <AddSubscriptionForm
            customerId={customerId}
            defaultStart={nextStart}
            renewing={current !== null}
            onDone={() => {
              setAdding(false)
              invalidate()
            }}
          />
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            {current || upcoming.length ? '+ Renovar (próximo mês)' : '+ Ativar assinatura'}
          </Button>
        )}
      </div>
    </div>
  )
}

function SubscriptionPeriod({ sub, used, invalidate }: { sub: SubscriptionRow; used: number | undefined; invalidate: () => void }) {
  const [editingUsed, setEditingUsed] = useState(false)
  const [paying, setPaying] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [usedInput, setUsedInput] = useState(used ?? 0)

  const setUsed = useMutation({
    mutationFn: async (n: number) => {
      const { error } = await supabase.rpc('admin_set_subscription_used', { p_id: sub.id, p_used: n })
      if (error) throw error
    },
    onSuccess: () => {
      setEditingUsed(false)
      invalidate()
    },
  })

  const unpay = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_set_subscription_payment', {
        p_id: sub.id,
        // null = volta para pendente
        p_payment_method: null as unknown as PaymentMethod,
        p_price_cents: sub.price_cents,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_delete_subscription', { p_id: sub.id })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const err = setUsed.error ?? unpay.error ?? remove.error

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-semibold">{sub.plan_name}</span>
          <span className="text-muted">
            {' '}
            · {dayLabel(sub.starts_on)} a {lastDay(sub.ends_on)}
          </span>
        </span>
        {sub.paid_at && sub.payment_method ? (
          <Badge tone="completed">
            Pago {formatPrice(sub.price_cents)} · {PAYMENT_LABEL[sub.payment_method]}
          </Badge>
        ) : (
          <Badge tone="cancelled">Pagamento pendente · {formatPrice(sub.price_cents)}</Badge>
        )}
      </div>

      {used !== undefined ? (
        editingUsed ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Cortes usados:</span>
            <Button size="sm" variant="secondary" aria-label="Menos um" onClick={() => setUsedInput(Math.max(0, usedInput - 1))}>
              −
            </Button>
            <span className="w-8 text-center font-display text-xl font-bold tabular-nums">{usedInput}</span>
            <Button size="sm" variant="secondary" aria-label="Mais um" onClick={() => setUsedInput(Math.min(60, usedInput + 1))}>
              +
            </Button>
            <span className="text-muted">de {sub.cuts_included}</span>
            <Button size="sm" loading={setUsed.isPending} onClick={() => setUsed.mutate(usedInput)}>
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingUsed(false)}>
              Voltar
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              <span className="font-display text-xl font-bold tabular-nums">{used}</span> de {sub.cuts_included} cortes usados
              {used >= sub.cuts_included ? <span className="text-accent"> · acabaram os cortes do mês</span> : null}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setUsedInput(used)
                setEditingUsed(true)
              }}
            >
              Alterar
            </Button>
          </div>
        )
      ) : null}

      {paying ? (
        <PaymentForm
          sub={sub}
          onCancel={() => setPaying(false)}
          onDone={() => {
            setPaying(false)
            invalidate()
          }}
        />
      ) : confirmDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Remover este mês? {sub.paid_at ? 'O valor sai do faturamento. ' : ''}Horários futuros voltam ao preço normal.</span>
          <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remover
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
            Voltar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sub.paid_at ? (
            <Button size="sm" variant="ghost" loading={unpay.isPending} onClick={() => unpay.mutate()}>
              Marcar como não pago
            </Button>
          ) : (
            <Button size="sm" onClick={() => setPaying(true)}>
              ✓ Marcar como pago
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
            Remover
          </Button>
        </div>
      )}
      {err ? <Notice tone="error">{errorMessage(err)}</Notice> : null}
    </div>
  )
}

function MethodPicker({ value, onChange }: { value: PaymentMethod | null; onChange: (m: PaymentMethod) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {PAYMENT_METHODS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
            value === m ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:text-cream'
          }`}
        >
          {PAYMENT_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

function PaymentForm({ sub, onCancel, onDone }: { sub: SubscriptionRow; onCancel: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [amount, setAmount] = useState(centsToInput(sub.price_cents))
  const cents = parseBrlToCents(amount)
  const pay = useMutation({
    mutationFn: async () => {
      if (!method || cents === null) throw new Error('Escolha a forma e o valor.')
      const { error } = await supabase.rpc('admin_set_subscription_payment', {
        p_id: sub.id,
        p_payment_method: method,
        p_price_cents: cents,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <div className="space-y-2">
      <MethodPicker value={method} onChange={setMethod} />
      <Input label="Valor recebido (R$)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {pay.isError ? <Notice tone="error">{errorMessage(pay.error)}</Notice> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={!method || cents === null} loading={pay.isPending} onClick={() => pay.mutate()}>
          Confirmar pagamento
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </div>
  )
}

function AddSubscriptionForm({
  customerId,
  defaultStart,
  renewing,
  onDone,
}: {
  customerId: string
  defaultStart: string
  renewing: boolean
  onDone: () => void
}) {
  const plans = useSubscriptionPlans()
  const active = (plans.data ?? []).filter((p) => p.active)
  const [planId, setPlanId] = useState<string | null>(null)
  const plan = active.find((p) => p.id === planId) ?? active[0]
  const [start, setStart] = useState(defaultStart)
  const [paid, setPaid] = useState(true)
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [amount, setAmount] = useState<string | null>(null)
  const amountValue = amount ?? (plan ? centsToInput(plan.price_cents) : '')
  const cents = parseBrlToCents(amountValue)

  const add = useMutation({
    mutationFn: async () => {
      if (!plan) throw new Error('Cadastre um plano primeiro (Planos de assinatura, acima).')
      if (cents === null) throw new Error('Valor inválido.')
      if (paid && !method) throw new Error('Escolha a forma de pagamento.')
      const { error } = await supabase.rpc('admin_add_subscription', {
        p_customer_id: customerId,
        p_plan_id: plan.id,
        p_starts_on: start,
        p_price_cents: cents,
        ...(paid && method ? { p_payment_method: method } : {}),
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })

  if (plans.isPending) return <Spinner />
  if (!active.length) {
    return (
      <Notice tone="info">
        Nenhum plano ativo. Abra <strong>Planos de assinatura</strong>, no topo desta aba, e cadastre um.
      </Notice>
    )
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-dashed border-line p-3"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate()
      }}
    >
      <p className="text-sm font-semibold">{renewing ? 'Renovar assinatura' : 'Ativar assinatura'}</p>
      <Select
        label="Plano"
        value={plan?.id ?? ''}
        onChange={(e) => {
          setPlanId(e.target.value)
          setAmount(null)
        }}
      >
        {active.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {formatPrice(p.price_cents)} · {p.cuts_per_month} cortes
          </option>
        ))}
      </Select>
      <Input
        label="Começa em"
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        hint={/^\d{4}-\d{2}-\d{2}$/.test(start) ? `Vale até ${lastDay(addMonth(start))}` : undefined}
      />
      <Input label="Valor (R$)" inputMode="decimal" value={amountValue} onChange={(e) => setAmount(e.target.value)} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-accent)]"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
        />
        Já foi pago
      </label>
      {paid ? <MethodPicker value={method} onChange={setMethod} /> : (
        <p className="text-xs text-muted">Fica como pendente: o cliente já pode usar, e o valor entra no faturamento quando você marcar como pago.</p>
      )}
      {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={add.isPending} disabled={paid && !method}>
          {renewing ? 'Renovar' : 'Ativar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={add.isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
