import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { EmptyState, ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Input, Notice, SectionTitle } from '@/components/ui'
import { callFunction, errorMessage } from '@/lib/api'
import { APP_TIMEZONE } from '@/lib/env'
import { formatShortDate, formatTime } from '@/lib/format'
import { addDays, dateInTz, zonedToUtc } from '@/lib/shared'
import { supabase, type Tables } from '@/lib/supabase'
import { useNow } from '@/hooks/useNow'
import { type BarberRow, useAdminServices, useAllBarbers } from './queries'

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
    void qc.invalidateQueries({ queryKey: ['catalog'] })
    void qc.invalidateQueries({ queryKey: ['availability'] })
  }
}

export function BarbersAdmin() {
  const barbers = useAllBarbers()
  const [open, setOpen] = useState<string | 'new' | null>(null)

  if (barbers.isPending) return <Spinner />
  if (barbers.isError) return <ErrorState message={errorMessage(barbers.error)} />

  return (
    <section>
      <SectionTitle
        action={
          open !== 'new' ? (
            <Button size="sm" onClick={() => setOpen('new')}>
              + Novo barbeiro
            </Button>
          ) : null
        }
      >
        Barbeiros
      </SectionTitle>
      <div className="space-y-2">
        {open === 'new' ? <NewBarberForm onDone={() => setOpen(null)} /> : null}
        {barbers.data.length === 0 && open !== 'new' ? (
          <EmptyState title="Nenhum barbeiro">Cadastre quem vai atender para abrir a agenda.</EmptyState>
        ) : null}
        {barbers.data.map((b) => (
          <Card key={b.id} className={b.active ? '' : 'opacity-70'}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={open === b.id}
              onClick={() => setOpen(open === b.id ? null : b.id)}
            >
              <span>
                <span className="font-semibold">{b.display_name}</span>{' '}
                {b.active ? null : <Badge>inativo</Badge>}
                <span className="block text-sm text-muted">{b.barber_services.length} serviço(s)</span>
              </span>
              <span aria-hidden className="text-muted">
                {open === b.id ? '▲' : '▼'}
              </span>
            </button>
            {open === b.id ? <BarberEditor barber={b} /> : null}
          </Card>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Novo barbeiro
// ---------------------------------------------------------------------------
const newSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(80),
  email: z.email('E-mail inválido.'),
  password: z.string().min(8, 'Mínimo de 8 caracteres.').max(72),
})
type NewValues = z.infer<typeof newSchema>

function NewBarberForm({ onDone }: { onDone: () => void }) {
  const services = useAdminServices()
  const invalidate = useInvalidateAll()
  const [picked, setServiceIds] = useState<string[] | null>(null)
  const serviceIds = picked ?? services.data?.filter((s) => s.active).map((s) => s.id) ?? []
  const form = useForm<NewValues>({
    resolver: zodResolver(newSchema),
    defaultValues: { name: '', email: '', password: '' },
  })

  const create = useMutation({
    mutationFn: (v: NewValues) => callFunction('admin-create-barber', { ...v, service_ids: serviceIds }),
    onSuccess: () => {
      invalidate()
      onDone()
    },
  })

  return (
    <Card className="border-brass/50">
      <form noValidate onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3">
        <p className="text-sm text-muted">
          Cria o login do barbeiro. Passe o e-mail e a senha para ele; ele pode trocar a senha depois em "Esqueci minha
          senha".
        </p>
        <Input label="Nome de exibição" error={form.formState.errors.name?.message} {...form.register('name')} />
        <Input
          label="E-mail de login"
          type="email"
          autoComplete="off"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Input
          label="Senha inicial"
          type="text"
          autoComplete="off"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        {services.data?.length ? (
          <fieldset>
            <legend className="mb-1 text-sm text-muted">Serviços que faz</legend>
            <ServiceChecks
              services={services.data.filter((s) => s.active)}
              value={serviceIds}
              onChange={setServiceIds}
            />
          </fieldset>
        ) : null}
        <p className="text-xs text-muted">Expediente inicial: seg–sex 9h–19h (almoço 12h–13h), sáb 9h–14h.</p>
        {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending}>
            Cadastrar
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  )
}

function ServiceChecks({
  services,
  value,
  onChange,
}: {
  services: { id: string; name: string }[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {services.map((s) => {
        const on = value.includes(s.id)
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              on ? 'border-brass bg-brass/15 text-brass' : 'border-line text-muted'
            }`}
          >
            {on ? '✓ ' : ''}
            {s.name}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------
function BarberEditor({ barber }: { barber: BarberRow }) {
  return (
    <div className="mt-4 space-y-6 border-t border-line pt-4">
      <BarberBasics barber={barber} />
      <BarberServices barber={barber} />
      <WorkingHoursEditor barberId={barber.id} />
      <TimeOffEditor barberId={barber.id} />
    </div>
  )
}

function BarberBasics({ barber }: { barber: BarberRow }) {
  const invalidate = useInvalidateAll()
  const [name, setName] = useState(barber.display_name)
  const save = useMutation({
    mutationFn: async (patch: { display_name?: string; active?: boolean }) => {
      const { error } = await supabase.from('barbers').update(patch).eq('id', barber.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <Input label="Nome de exibição" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          variant="secondary"
          disabled={name.trim() === barber.display_name || name.trim().length < 1}
          loading={save.isPending && save.variables.display_name !== undefined}
          onClick={() => save.mutate({ display_name: name.trim() })}
        >
          Salvar
        </Button>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5 accent-[var(--color-brass)]"
          checked={barber.active}
          onChange={(e) => save.mutate({ active: e.target.checked })}
        />
        Ativo (aparece no agendamento)
      </label>
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
    </div>
  )
}

function BarberServices({ barber }: { barber: BarberRow }) {
  const services = useAdminServices()
  const invalidate = useInvalidateAll()
  const current = barber.barber_services.map((s) => s.service_id)

  const set = useMutation({
    mutationFn: async (next: string[]) => {
      const add = next.filter((id) => !current.includes(id))
      const remove = current.filter((id) => !next.includes(id))
      if (add.length) {
        const { error } = await supabase
          .from('barber_services')
          .insert(add.map((service_id) => ({ barber_id: barber.id, service_id })))
        if (error) throw error
      }
      if (remove.length) {
        const { error } = await supabase
          .from('barber_services')
          .delete()
          .eq('barber_id', barber.id)
          .in('service_id', remove)
        if (error) throw error
      }
    },
    onSuccess: invalidate,
  })

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">Serviços</h3>
      {services.data ? (
        <ServiceChecks services={services.data.filter((s) => s.active)} value={current} onChange={(ids) => set.mutate(ids)} />
      ) : (
        <Spinner />
      )}
      {set.isError ? (
        <div className="mt-2">
          <Notice tone="error">{errorMessage(set.error)}</Notice>
        </div>
      ) : null}
    </div>
  )
}

interface DayRow {
  weekday: number
  enabled: boolean
  start: string
  end: string
  breakStart: string
  breakEnd: string
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

function WorkingHoursEditor({ barberId }: { barberId: string }) {
  const hours = useQuery({
    queryKey: ['admin', 'working_hours', barberId],
    queryFn: async () => {
      const { data, error } = await supabase.from('working_hours').select('*').eq('barber_id', barberId)
      if (error) throw error
      return data
    },
  })
  if (hours.isPending) return <Spinner />
  if (hours.isError) return <ErrorState message={errorMessage(hours.error)} />
  return <WorkingHoursForm barberId={barberId} initial={hours.data} />
}

function WorkingHoursForm({ barberId, initial }: { barberId: string; initial: Tables<'working_hours'>[] }) {
  const invalidate = useInvalidateAll()
  const [rows, setRows] = useState<DayRow[]>(() =>
    [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
      const h = initial.find((x) => x.weekday === weekday)
      return {
        weekday,
        enabled: Boolean(h),
        start: hhmm(h?.start_time) || '09:00',
        end: hhmm(h?.end_time) || '18:00',
        breakStart: hhmm(h?.break_start),
        breakEnd: hhmm(h?.break_end),
      }
    }),
  )

  const save = useMutation({
    mutationFn: async (list: DayRow[]) => {
      for (const r of list) {
        if (r.enabled && !(r.start < r.end)) throw new Error(`${WEEKDAYS[r.weekday]}: início deve ser antes do fim.`)
        if (r.enabled && Boolean(r.breakStart) !== Boolean(r.breakEnd)) {
          throw new Error(`${WEEKDAYS[r.weekday]}: preencha início e fim do intervalo (ou deixe os dois vazios).`)
        }
        if (r.enabled && r.breakStart && !(r.start <= r.breakStart && r.breakStart < r.breakEnd && r.breakEnd <= r.end)) {
          throw new Error(`${WEEKDAYS[r.weekday]}: intervalo precisa estar dentro do expediente.`)
        }
      }
      const upserts = list
        .filter((r) => r.enabled)
        .map((r) => ({
          barber_id: barberId,
          weekday: r.weekday,
          start_time: r.start,
          end_time: r.end,
          break_start: r.breakStart || null,
          break_end: r.breakEnd || null,
        }))
      const off = list.filter((r) => !r.enabled).map((r) => r.weekday)
      if (upserts.length) {
        const { error } = await supabase.from('working_hours').upsert(upserts, { onConflict: 'barber_id,weekday' })
        if (error) throw error
      }
      if (off.length) {
        const { error } = await supabase.from('working_hours').delete().eq('barber_id', barberId).in('weekday', off)
        if (error) throw error
      }
    },
    onSuccess: invalidate,
  })

  const update = (weekday: number, patch: Partial<DayRow>) =>
    setRows((cur) => cur.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)))

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">Expediente</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.weekday} className="rounded-lg bg-surface-2 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-brass)]"
                checked={r.enabled}
                onChange={(e) => update(r.weekday, { enabled: e.target.checked })}
              />
              {WEEKDAYS[r.weekday]}
              {!r.enabled ? <span className="font-normal text-muted">· folga</span> : null}
            </label>
            {r.enabled ? (
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <TimeField label="Abre" value={r.start} onChange={(v) => update(r.weekday, { start: v })} />
                <TimeField label="Fecha" value={r.end} onChange={(v) => update(r.weekday, { end: v })} />
                <TimeField label="Almoço de" value={r.breakStart} onChange={(v) => update(r.weekday, { breakStart: v })} />
                <TimeField label="Almoço até" value={r.breakEnd} onChange={(v) => update(r.weekday, { breakEnd: v })} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {save.isError ? (
        <div className="mt-2">
          <Notice tone="error">{errorMessage(save.error)}</Notice>
        </div>
      ) : null}
      {save.isSuccess ? (
        <div className="mt-2">
          <Notice tone="success">Expediente salvo.</Notice>
        </div>
      ) : null}
      <Button className="mt-3" variant="secondary" loading={save.isPending} onClick={() => save.mutate(rows)}>
        Salvar expediente
      </Button>
    </div>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="time"
        step={900}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-cream"
      />
    </label>
  )
}

function TimeOffEditor({ barberId }: { barberId: string }) {
  const invalidate = useInvalidateAll()
  const now = useNow()
  const today = dateInTz(now, APP_TIMEZONE)
  const [date, setDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [allDay, setAllDay] = useState(true)
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('12:00')
  const [reason, setReason] = useState('')

  const list = useQuery({
    queryKey: ['admin', 'time_off', barberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off')
        .select('*')
        .eq('barber_id', barberId)
        .gte('ends_at', new Date(Date.now() - 86_400_000).toISOString())
        .order('starts_at')
      if (error) throw error
      return data
    },
  })

  const add = useMutation({
    mutationFn: async () => {
      const [h1 = 0, m1 = 0] = from.split(':').map(Number)
      const [h2 = 0, m2 = 0] = to.split(':').map(Number)
      const startsAt = allDay ? zonedToUtc(date, 0, APP_TIMEZONE) : zonedToUtc(date, h1 * 60 + m1, APP_TIMEZONE)
      const endsAt = allDay
        ? zonedToUtc(addDays(endDate < date ? date : endDate, 1), 0, APP_TIMEZONE)
        : zonedToUtc(date, h2 * 60 + m2, APP_TIMEZONE)
      if (endsAt <= startsAt) throw new Error('O fim precisa ser depois do início.')
      const { error } = await supabase.from('time_off').insert({
        barber_id: barberId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        reason: reason.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setReason('')
      invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_off').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return (
    <div>
      <h3 className="mb-1 text-base font-semibold">Folgas e bloqueios</h3>
      <p className="mb-2 text-xs text-muted">Horários bloqueados somem da agenda online. Agendamentos já feitos continuam.</p>
      {list.data?.length ? (
        <ul className="mb-3 divide-y divide-line rounded-lg bg-surface-2">
          {list.data.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="inline-block first-letter:uppercase">{formatShortDate(t.starts_at)}</span> {formatTime(t.starts_at)} →{' '}
                <span className="inline-block first-letter:uppercase">{formatShortDate(t.ends_at)}</span> {formatTime(t.ends_at)}
                {t.reason ? <span className="text-muted"> · {t.reason}</span> : null}
              </span>
              <Button size="sm" variant="ghost" loading={remove.isPending && remove.variables === t.id} onClick={() => remove.mutate(t.id)}>
                Remover
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2 rounded-lg border border-dashed border-line p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-brass)]"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          Dia(s) inteiro(s)
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Input label={allDay ? 'De' : 'Dia'} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          {allDay ? (
            <Input label="Até" type="date" min={date} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <TimeField label="Das" value={from} onChange={setFrom} />
              <TimeField label="Até" value={to} onChange={setTo} />
            </div>
          )}
        </div>
        <Input label="Motivo (opcional)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
        <Button variant="secondary" size="sm" loading={add.isPending} onClick={() => add.mutate()}>
          + Bloquear
        </Button>
      </div>
    </div>
  )
}
