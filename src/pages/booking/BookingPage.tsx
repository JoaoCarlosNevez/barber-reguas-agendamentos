import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNow } from '@/hooks/useNow'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { BrandLogo } from '@/components/Brand'
import { BookingLoader, ErrorState, Spinner } from '@/components/states'
import { Button, Card, Input, Notice } from '@/components/ui'
import { ApiError, callFunction, errorMessage } from '@/lib/api'
import { saveLocalAppointment } from '@/lib/appointments-local'
import { useAuth } from '@/lib/auth'
import { type Catalog, useCatalog } from '@/lib/catalog'
import { APP_TIMEZONE } from '@/lib/env'
import { dayChipParts, formatDuration, formatLongDate, formatPrice } from '@/lib/format'
import { maskBrPhone } from '@/lib/phoneMask'
import { addDays, dateInTz, formatBrPhone, normalizeBrPhone } from '@/lib/shared'
import { supabase } from '@/lib/supabase'
import type { PublicAppointment } from './AppointmentPage'

interface AvailabilityResponse {
  date: string
  duration_min: number
  total_price_cents: number
  barbers: { id: string; display_name: string }[]
  slots: { starts_at: string; time: string; barber_ids: string[] }[]
}

export interface CreatedAppointment {
  token: string
  /** login feito junto com o agendamento (visitante) */
  session?: { token_hash: string }
  appointment: Partial<PublicAppointment> & {
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
        <BrandLogo className="mx-auto mb-6 w-40" />
        <h1 className="text-3xl font-bold">Agenda fechada</h1>
        <p className="mt-2 text-muted">A barbearia ainda não abriu horários online. Volte em breve.</p>
      </section>
    )
  }
  return <BookingFlow catalog={catalog.data} />
}

/** Agendamento em formato de quiz: uma pergunta por tela. */
const STEPS = ['servico', 'barbeiro', 'quando', 'dados'] as const
type StepKey = (typeof STEPS)[number]

function BookingFlow({ catalog }: { catalog: Catalog }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { session, profile } = useAuth()
  const now = useNow()
  const today = dateInTz(now, catalog.settings.timezone)
  const [params, setParams] = useSearchParams()

  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [pickedBarber, setBarberId] = useState<string>('any')
  const [pickedDate, setDate] = useState<string | null>(null)
  const date = pickedDate && pickedDate >= today ? pickedDate : today
  const [pickedSlot, setSlot] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

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
  const barberName =
    barberId === 'any' ? null : (eligibleBarbers.find((b) => b.id === barberId)?.display_name ?? null)

  // Passo atual vem da URL (o "voltar" do celular volta uma pergunta), mas nunca
  // passa do último passo que já dá para responder.
  const reachable =
    serviceIds.length === 0 ? 0 : eligibleBarbers.length === 0 ? 1 : slot ? 3 : 2
  const requested = Math.max(0, STEPS.indexOf((params.get('passo') ?? 'servico') as StepKey))
  const stepIndex = Math.min(requested, reachable)
  const step: StepKey = STEPS[stepIndex] ?? 'servico'

  function goTo(key: StepKey, replace = false) {
    setParams(key === 'servico' ? {} : { passo: key }, { replace })
  }
  function goBack() {
    if (stepIndex === 0) return
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    // veio pelo próprio quiz: usa o histórico; senão (link/recarregou) só troca a pergunta
    if (requested === stepIndex && idx > 0) void navigate(-1)
    else goTo(STEPS[stepIndex - 1] ?? 'servico', true)
  }

  useEffect(() => {
    window.scrollTo({ top: 0 })
    if (stepIndex > 0) headingRef.current?.focus({ preventScroll: true })
  }, [stepIndex])

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
    // Uma chamada só: sem login, o servidor já entra (ou cria a conta) com o
    // mesmo nome + celular, para contar na fidelidade, e devolve a sessão. Se o
    // nome não conferir com a conta desse celular, agenda como visitante.
    mutationFn: (d: Details) =>
      callFunction<CreatedAppointment>('create-appointment', {
        barber_id: barberId,
        service_ids: sortedIds,
        starts_at: slot,
        customer: { name: d.name, phone: d.phone },
        website: d.website ?? '',
        login: !session,
      }),
    onSuccess: (res) => {
      if (res.session) {
        // troca o token por sessão sem segurar a navegação
        void supabase.auth.verifyOtp({ token_hash: res.session.token_hash, type: 'email' }).catch(() => undefined)
      }
      // comprovante abre na hora, sem buscar de novo
      if (res.appointment.status) qc.setQueryData(['appointment', res.token], { appointment: res.appointment })
      saveLocalAppointment({
        token: res.token,
        starts_at: res.appointment.starts_at,
        summary: `${res.appointment.services.map((s) => s.name).join(' + ')} com ${res.appointment.barber.display_name}`,
      })
      void navigate(`/agendamento/${res.token}`, { state: { created: res }, replace: true })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'slot_unavailable') {
        setConflict(err.message)
        setSlot(null)
        void availability.refetch()
        goTo('quando', true) // volta para a pergunta do horário
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

  function pickBarber(id: string) {
    setConflict(null)
    setBarberId(id)
    goTo('quando')
  }

  function pickSlot(startsAt: string) {
    setConflict(null)
    setSlot(startsAt)
    goTo('dados')
  }

  const questions: Record<StepKey, { title: string; hint: string }> = {
    servico: { title: 'O que vamos fazer hoje?', hint: 'Pode escolher mais de um.' },
    barbeiro: { title: 'Com quem você quer cortar?', hint: 'Se tanto faz, a gente pega o primeiro livre.' },
    quando: { title: 'Quando fica bom?', hint: 'Escolha o dia e depois o horário.' },
    dados: {
      title: 'Pra quem é o horário?',
      hint: session
        ? 'Confere seus dados e confirma.'
        : 'Seus agendamentos e selos de fidelidade ficam salvos pelo seu celular, sem senha.',
    },
  }
  const q = questions[step]

  return (
    <div className="pb-32">
      {book.isPending || book.isSuccess ? <BookingLoader /> : null}
      {/* progresso */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={goBack}
          disabled={stepIndex === 0}
          aria-label="Voltar"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-lg text-cream transition-colors hover:border-accent disabled:hidden"
        >
          ←
        </button>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {STEPS.map((k, i) => (
            <span
              key={k}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= stepIndex ? 'bg-accent' : 'bg-line'}`}
            />
          ))}
        </div>
        <span className="w-10 text-right text-xs font-semibold text-muted tabular-nums">
          {stepIndex + 1}/{STEPS.length}
        </span>
      </div>

      <section key={step} aria-labelledby="quiz-q" className="animate-step-in pt-8">
        <p className="font-display text-sm font-semibold tracking-[0.2em] text-blue uppercase">
          Pergunta {stepIndex + 1}
        </p>
        <h1 id="quiz-q" ref={headingRef} tabIndex={-1} className="mt-1 text-4xl font-bold leading-[0.95] outline-none">
          {q.title}
        </h1>
        <p className="mt-2 text-muted">{q.hint}</p>

        <div className="mt-6">
          {step === 'servico' ? (
            <div className="grid gap-2">
              {catalog.services.map((s) => {
                const on = serviceIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleService(s.id)}
                    className={`flex items-center justify-between gap-3 rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.99] ${
                      on ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/50'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className={`grid size-6 shrink-0 place-items-center rounded-md border-2 text-sm font-bold ${
                          on ? 'border-accent bg-accent text-on-accent' : 'border-line'
                        }`}
                      >
                        {on ? '✓' : ''}
                      </span>
                      <span>
                        <span className="block text-lg font-semibold leading-tight">{s.name}</span>
                        <span className="text-sm text-muted">{formatDuration(s.duration_min)}</span>
                      </span>
                    </span>
                    <span className="font-display text-xl font-bold">{formatPrice(s.price_cents)}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {step === 'barbeiro' ? (
            eligibleBarbers.length === 0 ? (
              <div className="space-y-3">
                <Notice>Nenhum barbeiro faz todos esses serviços juntos. Volte e tire algum.</Notice>
                <Button variant="secondary" onClick={goBack}>
                  Voltar aos serviços
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                <AnswerButton
                  on={barberId === 'any'}
                  onClick={() => pickBarber('any')}
                  badge="★"
                  title="Tanto faz"
                  subtitle="Primeiro barbeiro disponível"
                />
                {eligibleBarbers.map((b) => (
                  <AnswerButton
                    key={b.id}
                    on={barberId === b.id}
                    onClick={() => pickBarber(b.id)}
                    badge={b.display_name.trim().charAt(0).toUpperCase()}
                    title={b.display_name}
                  />
                ))}
              </div>
            )
          ) : null}

          {step === 'quando' ? (
            <>
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
                      onClick={() => {
                        setConflict(null)
                        setDate(d)
                      }}
                      className={`flex w-16 shrink-0 snap-start flex-col items-center rounded-2xl border-2 py-2 transition-colors ${
                        on ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface hover:border-accent/50'
                      }`}
                    >
                      <span className="text-xs uppercase">{d === today ? 'hoje' : p.weekday}</span>
                      <span className="font-display text-2xl font-bold leading-tight">{p.day}</span>
                      <span className="text-xs uppercase">{p.month}</span>
                    </button>
                  )
                })}
              </fieldset>

              <div className="mt-5">
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
                  <p className="rounded-2xl border-2 border-dashed border-line p-6 text-center text-muted">
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
                        className={`rounded-xl border-2 py-2.5 font-semibold tabular-nums transition-colors ${
                          slot === s.starts_at
                            ? 'border-accent bg-accent text-on-accent'
                            : 'border-line bg-surface hover:border-accent/60'
                        }`}
                      >
                        {s.time}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-6 text-center text-xs text-muted">Horários em {APP_TIMEZONE.replace('_', ' ')}.</p>
            </>
          ) : null}

          {step === 'dados' && slot && slotInfo ? (
            <>
              <Card className="mb-5 border-accent/40">
                <p className="text-sm font-semibold text-muted first-letter:uppercase">{formatLongDate(slot)}</p>
                <p className="font-display text-4xl font-bold leading-none">{slotInfo.time}</p>
                <p className="mt-2 text-sm text-muted">
                  {selectedServices.map((s) => s.name).join(' + ')} · {formatDuration(totalMin)} ·{' '}
                  {barberName ? `com ${barberName}` : 'com o barbeiro disponível'}
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
            </>
          ) : null}
        </div>
      </section>

      {serviceIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-ink/95 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="min-w-0">
              <p className="font-display text-2xl font-bold leading-none">{formatPrice(totalCents)}</p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {formatDuration(totalMin)}
                {barberName && stepIndex >= 2 ? ` · ${barberName}` : ''}
                {slotInfo && stepIndex >= 3 ? ` · ${slotInfo.time}` : ''}
              </p>
            </div>
            {step === 'servico' ? (
              <Button size="lg" onClick={() => goTo('barbeiro')}>
                Continuar →
              </Button>
            ) : step === 'dados' ? (
              <Button type="submit" form="booking-form" size="lg" loading={book.isPending}>
                Confirmar
              </Button>
            ) : (
              <span className="text-sm text-muted">{step === 'barbeiro' ? 'Escolha um' : 'Escolha um horário'}</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AnswerButton({
  on,
  onClick,
  badge,
  title,
  subtitle,
}: {
  on: boolean
  onClick: () => void
  badge: string
  title: string
  subtitle?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.99] ${
        on ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/50'
      }`}
    >
      <span
        aria-hidden
        className={`grid size-11 shrink-0 place-items-center rounded-full font-display text-xl font-bold ${
          on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-cream'
        }`}
      >
        {badge}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold leading-tight">{title}</span>
        {subtitle ? <span className="text-sm text-muted">{subtitle}</span> : null}
      </span>
      <span aria-hidden className="text-muted">
        →
      </span>
    </button>
  )
}
