import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { EmptyState, ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Input, Notice, SectionTitle } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { formatShortDate, formatTime, STATUS_LABEL } from '@/lib/format'
import { maskBrPhone } from '@/lib/phoneMask'
import { formatBrPhone, normalizeBrPhone } from '@/lib/shared'
import { supabase } from '@/lib/supabase'
import { useNow } from '@/hooks/useNow'
import { APP_TIMEZONE } from '@/lib/env'
import { dateInTz } from '@/lib/shared'
import { currentSubscription } from '@/lib/subscription'
import { CustomerSubscription, PlansAdmin } from './SubscriptionsAdmin'

const PAGE = 50

function useCustomers(search: string) {
  return useQuery({
    queryKey: ['admin', 'customers', search],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('customers')
        .select('id, name, phone, is_guest, auth_user_id, created_at, appointments(starts_at, status), loyalty_stamps(redemption_id), customer_subscriptions(id, plan_name, cuts_included, starts_on, ends_on, price_cents, payment_method, paid_at)')
        .order('name')
        .limit(PAGE)
      // tira caracteres que quebram o filtro do PostgREST
      const text = search.replace(/[,()*%\\]/g, ' ').trim()
      const digits = search.replace(/\D/g, '')
      if (text) {
        const filters = [`name.ilike.*${text}*`]
        if (digits.length >= 2) filters.push(`phone.ilike.*${digits}*`)
        q = q.or(filters.join(','))
      }
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })
}

type Customer = NonNullable<ReturnType<typeof useCustomers>['data']>[number]

/** Gestão › Clientes: busca, histórico, editar e excluir. */
export function CustomersAdmin() {
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search)
  const customers = useCustomers(deferred.trim())
  const [open, setOpen] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  return (
    <section className="space-y-4">
      <PlansAdmin />
      <SectionTitle>Clientes</SectionTitle>
      <Input
        label="Pesquisar"
        type="search"
        placeholder="Nome ou celular"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
      />
      {flash ? (
        <div className="mt-3">
          <Notice tone="success">{flash}</Notice>
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        {customers.isPending ? (
          <Spinner />
        ) : customers.isError ? (
          <ErrorState message={errorMessage(customers.error)} />
        ) : customers.data.length === 0 ? (
          <EmptyState title={deferred.trim() ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'}>
            {deferred.trim() ? 'Confira o nome ou o celular.' : 'Os clientes aparecem aqui depois do primeiro agendamento.'}
          </EmptyState>
        ) : (
          <>
            {customers.data.map((c) => (
              <CustomerCard
                key={c.id}
                customer={c}
                open={open === c.id}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
                onDeleted={() => {
                  setOpen(null)
                  setFlash(`${c.name} foi excluído.`)
                }}
              />
            ))}
            {customers.data.length === PAGE ? (
              <p className="pt-1 text-center text-xs text-muted">
                Mostrando os {PAGE} primeiros. Pesquise para achar outros clientes.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

function CustomerCard({
  customer: c,
  open,
  onToggle,
  onDeleted,
}: {
  customer: Customer
  open: boolean
  onToggle: () => void
  onDeleted: () => void
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const visits = c.appointments.filter((a) => a.status === 'completed')
  const last = visits.map((a) => a.starts_at).sort().at(-1)
  const stamps = c.loyalty_stamps.filter((s) => s.redemption_id === null).length
  const hasAccount = !c.is_guest && c.auth_user_id !== null
  const today = dateInTz(useNow(), APP_TIMEZONE)
  const sub = currentSubscription(c.customer_subscriptions, today)

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${c.name}, ${formatBrPhone(c.phone)}`}
        className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{c.name}</span>
          <span className="block text-sm text-muted tabular-nums">{formatBrPhone(c.phone)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
          <span className="flex gap-1">
            {sub ? <Badge tone={sub.paid_at ? 'scheduled' : 'cancelled'}>{sub.paid_at ? 'Assinante' : 'Assinatura pendente'}</Badge> : null}
            <Badge tone={hasAccount ? 'completed' : 'neutral'}>{hasAccount ? 'Com conta' : 'Visitante'}</Badge>
          </span>
          <span>
            {visits.length} {visits.length === 1 ? 'corte' : 'cortes'}
            {last ? ` · último ${formatShortDate(last)}` : ''}
          </span>
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line p-4">
          {mode === 'edit' ? (
            <EditForm customer={c} onDone={() => setMode('view')} />
          ) : mode === 'delete' ? (
            <DeleteConfirm customer={c} onCancel={() => setMode('view')} onDeleted={onDeleted} />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Cliente desde</dt>
                  <dd>{formatShortDate(c.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Selos de fidelidade</dt>
                  <dd>{hasAccount ? stamps : 'só com conta'}</dd>
                </div>
              </dl>
              <CustomerSubscription customerId={c.id} subs={c.customer_subscriptions} />
              <History appointments={c.appointments} />
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-strong"
                >
                  WhatsApp
                </a>
                <Button size="sm" variant="secondary" onClick={() => setMode('edit')}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setMode('delete')}>
                  Excluir
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </Card>
  )
}

function History({ appointments }: { appointments: Customer['appointments'] }) {
  const list = [...appointments].sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 5)
  if (!list.length) return <p className="text-sm text-muted">Nenhum agendamento.</p>
  return (
    <div>
      <p className="mb-1 text-xs text-muted">Últimos agendamentos</p>
      <ul className="space-y-1 text-sm">
        {list.map((a) => (
          <li key={a.starts_at} className="flex justify-between gap-2">
            <span>
              <span className="inline-block first-letter:uppercase">{formatShortDate(a.starts_at)}</span> ·{' '}
              <span className="tabular-nums">{formatTime(a.starts_at)}</span>
            </span>
            <span className="text-muted">{STATUS_LABEL[a.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EditForm({ customer: c, onDone }: { customer: Customer; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(c.name)
  const [phone, setPhone] = useState(maskBrPhone(formatBrPhone(c.phone)))
  const e164 = normalizeBrPhone(phone)
  const hasAccount = !c.is_guest && c.auth_user_id !== null

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Informe o nome do cliente.')
      if (!e164) throw new Error('Celular inválido. Use DDD + número.')
      const { error } = await supabase.rpc('admin_update_customer', { p_id: c.id, p_name: name.trim(), p_phone: e164 })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'customers'] })
      void qc.invalidateQueries({ queryKey: ['agenda'] })
      onDone()
    },
  })

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Input label="Nome" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <Input
        label="Celular"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(maskBrPhone(e.target.value))}
        error={phone && !e164 ? 'Celular inválido.' : undefined}
      />
      {hasAccount ? (
        <p className="text-xs text-muted">O cliente passa a entrar no site com o nome e o celular novos.</p>
      ) : null}
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>
          Salvar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function DeleteConfirm({
  customer: c,
  onCancel,
  onDeleted,
}: {
  customer: Customer
  onCancel: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const now = useNow().toISOString()
  const upcoming = c.appointments.filter((a) => a.status === 'scheduled' && a.starts_at > now).length
  const total = c.appointments.length

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_delete_customer', { p_id: c.id })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'customers'] })
      void qc.invalidateQueries({ queryKey: ['agenda'] })
      void qc.invalidateQueries({ queryKey: ['revenue'] })
      onDeleted()
    },
  })

  return (
    <div className="space-y-3">
      <p className="font-semibold">Excluir {c.name}?</p>
      <Notice tone="error">
        Isso apaga o cliente e todo o histórico dele ({total} {total === 1 ? 'agendamento' : 'agendamentos'}
        {upcoming ? `, sendo ${upcoming} ainda por vir` : ''}), selos de fidelidade
        {!c.is_guest && c.auth_user_id ? ' e a conta de acesso dele' : ''}. Não dá para desfazer.
        {total ? ' Os atendimentos dele também saem do faturamento.' : ''}
      </Notice>
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
          Excluir de vez
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={remove.isPending}>
          Voltar
        </Button>
      </div>
    </div>
  )
}
