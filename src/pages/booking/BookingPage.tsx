import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNow } from '@/hooks/useNow'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { ErrorState, Spinner } from '@/components/states'
import { Button, Card, Input, Notice } from '@/components/ui'
import { ApiError, callFunction, errorMessage } from '@/lib/api'
import { saveLocalAppointment } from '@/lib/appointments-local'
import { useAuth } from '@/lib/auth'
import { type Catalog, useCatalog } from '@/lib/catalog'
import { APP_TIMEZONE } from '@/lib/env'
import { dayChipParts, formatDuration, formatLongDate, formatPrice } from '@/lib/format'
import { signInCustomer } from '@/lib/customerAuth'
import { maskBrPhone } from '@/lib/phoneMask'
import { addDays, dateInTz, formatBrPhone, normalizeBrPhone } from '@/lib/shared'

interface AvailabilityResponse {
  date: string
  duration_min: number
  total_price_cents: number
  barbers: { id: string; display_name: string }[]
  slots: { starts_at: string; time: string; barber_ids: string[] }[]
}

export interface CreatedAppointment {
  token: string
  appointment: {
    id: string
    starts_at: string
    ends_at: string
    total_price_cents: number
    barber: { id: string; display_name: string }
    services: { id: string; name: string; duration_min: number; price_cents: number }[]
    customer_name: string
    loyalty_eligible: boolean
  }
}

const detailsSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(80, 'Nome muito longo.'),
  phone: z
    .string()
    .refine((v) => normalizeBrPhone(v) !== null, 'Telefone inválido. Use DDD + número.'),
  website: z.string().optional(),
})
type Details = z.infer<typeof detailsSchema>

export function BookingPage() {
  const catalog = useCatalog()

  if (catalog.isPending) return <Spinner />
  if (catalog.isError) {
    return (
      <ErrorState
        message={errorMessage(catalog.error)}
        action={
          <Button variant="secondary" size="sm" onClick={() => void catalog.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    )
  }
  if (catalog.data.services.length === 0 || catalog.data.barbers.length === 0) {
    return (
      <section className="py-10 text-center">
        <h1 className="text-3xl font-bold">Agenda fechada</h1>
        <p className="mt-2 text-muted">A barbearia ainda não abriu horários online. Volte em breve.</p>
      </section>
    )
  }
  return <BookingFlow catalog={catalog.data} />
}

function BookingFlow({ catalog }: { catalog: Catalog }) {
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const now = useNow()
  const today = dateInTz(now, catalog.settings.timezone)

  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [pickedBarber, setBarberId] = useState<string>('any')
  const [pickedDate, setDate] = useState<string | null>(null)
  const date = pickedDate && pickedDate >= today ? pickedDate : today
  const [pickedSlot, setSlot] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const detailsRef = useRef<HTMLDivElement>(null)

  // barbeiros que fazem TODOS os serviços escolhidos
  const eligibleBarbers = useMemo(() => {
    if (serviceIds.length === 0) return catalog.barbers
    return catalog.barbers.filter((b) =>
      serviceIds.every((s) => catalog.links.some((l) => l.barber_id === b.id && l.service_id === s)),
    )
  }, [catalog, serviceIds])

  // se o barbeiro escolhido não faz os serviços novos, volta para "qualquer um"
  const barberId = eligibleBarbers.some((b) => b.id === pickedBarber) ? pickedBarber : 'any'

  const days = useMemo(
    () => Array.from({ length: Math.min(catalog.settings.max_booking_days, 30) + 1 }, (_, i) => addDays(today, i)),
    [today, catalog.settings.max_booking_days],
  )

  const sortedIds = [...serviceIds].sort()
  const availability = useQuery({
    queryKey: ['availability', barberId, sortedIds, date],
    enabled: serviceIds.length > 0 && eligibleBarbers.length > 0,
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: () =>
      callFunction<AvailabilityResponse>('get-availability', {
        barber_id: barberId,
        service_ids: sortedIds,
        date,
      }),
  })

  // o horário escolhido só vale se ainda está na lista atual (muda com serviço/barbeiro/dia)
  const slotInfo = availability.data?.slots.find((s) => s.starts_at === pickedSlot)
  const slot = slotInfo ? pickedSlot : null

  const selectedServices = catalog.services.filter((s) => serviceIds.includes(s.id))
  const totalMin = selectedServices.reduce((a, s) => a + s.duration_min, 0)
  const totalCents = selectedServices.reduce((a, s) => a + s.price_cents, 0)

  const form = useForm<Details>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: '', phone: '', website: '' },
  })
  const { reset, getValues } = form
  useEffect(() => {
    if (!profile) return
    const current = getValues()
    reset({
      name: current.name || profile.name,
      phone: current.phone || (profile.phone ? formatBrPhone(profile.phone) : ''),
      website: '',
    })
  }, [profile, reset, getValues])

  const book = useMutation({
    mutationFn: async (d: Details) => {
      // Sem login: entra (ou cria a conta) com o mesmo nome + celular, para o
      // agendamento contar na fidelidade. Se o nome não conferir com a conta
      // desse celular, agenda mesmo assim, como visitante.
      if (!session && !d.website) {
        try {
          await signInCustomer(d.name, d.phone)
        } catch {
          // segue como visitante
        }
      }
      return callFunction<CreatedAppointment>('create-appointment', {
        barber_id: barberId,
        service_ids: sortedIds,
        starts_at: slot,
        customer: { name: d.name, phone: d.phone },
        website: d.website ?? '',
      })
    },
    onSuccess: (res) => {
      saveLocalAppointment({
        token: res.token,
        starts_at: res.appointment.starts_at,
        summary: `${res.appointment.services.map((s) => s.name).join(' + ')} com ${res.appointment.barber.display_name}`,
      })
      void navigate(`/agendamento/${res.token}`, { state: { created: res } })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'slot_unavailable') {
        setConflict(err.message)
        setSlot(null)
        void availability.refetch()
      }
      if (err instanceof ApiError && err.details?.fieldErrors) {
        const fe = err.details.fieldErrors
        if (fe['customer.phone']?.[0]) form.setError('phone', { message: fe['customer.phone'][0] })
        if (fe['customer.name']?.[0]) form.setError('name', { message: fe['customer.name'][0] })
      }
    },
  })

  function toggleService(id: string) {
    setConflict(null)
    setServiceIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  function pickSlot(startsAt: string) {
    setConflict(null)
    setSlot(startsAt)
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="space-y-8 pb-28">
      <header className="pt-2">
        <h1 className="text-4xl font-bold leading-none">Agende seu horário</h1>
        <p className="mt-2 text-muted">
          Escolha o serviço, o barbeiro e o horário. Leva menos de um minuto.
          {!session ? (
            <>
              {' '}
              Seus agendamentos e selos de fidelidade ficam salvos pelo seu celular, sem senha.
            </>
          ) : null}
        </p>
      </header>

      <Step n={1} title="Serviços">
        <div className="grid gap-2">
          {catalog.services.map((s) => {
            const on = serviceIds.includes(s.id)
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleService(s.id)}
                className={`flex items-center justify-between rounded-xl border p-4 text-left transition-colors ${
                  on ? 'border-brass bg-brass/10' : 'border-line bg-surface hover:border-brass/50'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`grid size-5 place-items-center rounded border text-xs ${
                      on ? 'border-brass bg-brass text-ink' : 'border-line'
                    }`}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span>
                    <span className="block font-semibold">{s.name}</span>
                    <span className="text-sm text-muted">{formatDuration(s.duration_min)}</span>
                  </span>
                </span>
                <span className="font-semibold text-brass">{formatPrice(s.price_cents)}</span>
              </button>
            )
          })}
        </div>
      </Step>

      {serviceIds.length > 0 ? (
        <Step n={2} title="Barbeiro">
          {eligibleBarbers.length === 0 ? (
            <Notice>Nenhum barbeiro faz todos esses serviços juntos. Tente tirar algum.</Notice>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Chip on={barberId === 'any'} onClick={() => setBarberId('any')}>
                Qualquer um
              </Chip>
              {eligibleBarbers.map((b) => (
                <Chip key={b.id} on={barberId === b.id} onClick={() => setBarberId(b.id)}>
                  {b.display_name}
                </Chip>
              ))}
            </div>
          )}
        </Step>
      ) : null}

      {serviceIds.length > 0 && eligibleBarbers.length > 0 ? (
        <Step n={3} title="Dia e horário">
          <fieldset className="-mx-4 flex min-w-0 snap-x gap-2 overflow-x-auto px-4 pb-2">
            <legend className="sr-only">Dia</legend>
            {days.map((d) => {
              const p = dayChipParts(d)
              const on = d === date
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDate(d)}
                  className={`flex w-16 shrink-0 snap-start flex-col items-center rounded-xl border py-2 transition-colors ${
                    on ? 'border-brass bg-brass text-ink' : 'border-line bg-surface hover:border-brass/50'
                  }`}
                >
                  <span className="text-xs uppercase">{d === today ? 'hoje' : p.weekday}</span>
                  <span className="font-display text-2xl font-bold leading-tight">{p.day}</span>
                  <span className="text-xs uppercase">{p.month}</span>
                </button>
              )
            })}
          </fieldset>

          <div className="mt-4">
            {conflict ? (
              <div className="mb-3">
                <Notice tone="error">{conflict}</Notice>
              </div>
            ) : null}
            {availability.isPending ? (
              <Spinner label="Buscando horários…" />
            ) : availability.isError ? (
              <ErrorState
                message={errorMessage(availability.error)}
                action={
                  <Button variant="secondary" size="sm" onClick={() => void availability.refetch()}>
                    Tentar de novo
                  </Button>
                }
              />
            ) : availability.data.slots.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
                Sem horários livres neste dia. Tente outro.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {availability.data.slots.map((s) => (
                  <button
                    key={s.starts_at}
                    type="button"
                    aria-pressed={slot === s.starts_at}
                    onClick={() => pickSlot(s.starts_at)}
                    className={`rounded-lg border py-2.5 font-semibold tabular-nums transition-colors ${
                      slot === s.starts_at
                        ? 'border-brass bg-brass text-ink'
                        : 'border-line bg-surface hover:border-brass/60'
                    }`}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Step>
      ) : null}

      {slot && slotInfo ? (
        <div ref={detailsRef} className="scroll-mt-4">
          <Step n={4} title="Seus dados">
            <Card className="mb-4">
              <p className="font-semibold first-letter:uppercase">{formatLongDate(slot)}</p>
              <p className="text-2xl font-display font-bold text-brass">{slotInfo.time}</p>
              <p className="mt-1 text-sm text-muted">
                {selectedServices.map((s) => s.name).join(' + ')} · {formatDuration(totalMin)} ·{' '}
                {barberId === 'any'
                  ? 'com o barbeiro disponível'
                  : `com ${eligibleBarbers.find((b) => b.id === barberId)?.display_name ?? ''}`}
              </p>
            </Card>

            <form
              id="booking-form"
              noValidate
              onSubmit={form.handleSubmit((d) => book.mutate(d))}
              className="space-y-4"
            >
              <Input
                label="Nome"
                autoComplete="name"
                error={form.formState.errors.name?.message}
                {...form.register('name')}
              />
              <Input
                label="Celular (WhatsApp)"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(11) 98765-4321"
                error={form.formState.errors.phone?.message}
                {...form.register('phone', {
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    e.target.value = maskBrPhone(e.target.value)
                  },
                })}
              />
              {/* honeypot: invisível para pessoas */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Site
                  <input tabIndex={-1} autoComplete="off" {...form.register('website')} />
                </label>
              </div>
              {book.isError && !(book.error instanceof ApiError && book.error.code === 'slot_unavailable') ? (
                <Notice tone="error">{errorMessage(book.error)}</Notice>
              ) : null}
            </form>
          </Step>
        </div>
      ) : null}

      {serviceIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-ink/95 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="min-w-0">
              <p className="text-lg font-semibold">{formatPrice(totalCents)}</p>
              <p className="truncate text-xs text-muted">
                {formatDuration(totalMin)}
                {slotInfo ? ` · ${slotInfo.time}` : ''}
              </p>
            </div>
            {slot ? (
              <Button type="submit" form="booking-form" size="lg" loading={book.isPending}>
                Confirmar
              </Button>
            ) : (
              <span className="text-sm text-muted">Escolha um horário</span>
            )}
          </div>
        </div>
      ) : null}

      <p className="text-center text-xs text-muted">Horários em {APP_TIMEZONE.replace('_', ' ')}.</p>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <span className="grid size-7 place-items-center rounded-full bg-surface-2 font-sans text-sm text-brass">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-4 py-2 font-semibold transition-colors ${
        on ? 'border-brass bg-brass text-ink' : 'border-line bg-surface hover:border-brass/50'
      }`}
    >
      {children}
    </button>
  )
}
