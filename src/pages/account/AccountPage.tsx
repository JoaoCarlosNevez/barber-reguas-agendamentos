import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { EmptyState, ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Input, Notice, SectionTitle } from '@/components/ui'
import { callFunction, errorMessage } from '@/lib/api'
import { homeForRole, type Profile, useAuth } from '@/lib/auth'
import { useCatalog } from '@/lib/catalog'
import { formatLongDate, formatPrice, formatShortDate, formatTime, STATUS_LABEL } from '@/lib/format'
import { maskBrPhone } from '@/lib/phoneMask'
import { APP_TIMEZONE } from '@/lib/env'
import { checkCustomerCancel, dateInTz, formatBrPhone, normalizeBrPhone } from '@/lib/shared'
import { currentSubscription, subscriptionLastDay, useMySubscriptions } from '@/lib/subscription'
import { supabase } from '@/lib/supabase'
import { useNow } from '@/hooks/useNow'

export function AccountPage() {
  const { profile, role, signOut } = useAuth()
  if (!profile) return <Spinner />

  return (
    <div className="space-y-8 py-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold leading-none">Olá, {profile.name.split(' ')[0]}</h1>
          {role !== 'customer' ? (
            <Link to={homeForRole(role)} className="mt-2 inline-block text-sm text-blue underline underline-offset-4">
              {role === 'super_admin' ? 'Ir para o painel super admin →' : 'Abrir o app da equipe →'}
            </Link>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sair
        </Button>
      </header>

      {!profile.phone ? (
        <Notice tone="error">Cadastre seu celular abaixo para poder agendar com a sua conta.</Notice>
      ) : null}

      {role === 'customer' ? <CustomerSections /> : null}
      <ProfileForm profile={profile} />
    </div>
  )
}

function useMyData() {
  const { session } = useAuth()
  const uid = session?.user.id ?? ''
  return useQuery({
    queryKey: ['my-data', uid],
    enabled: uid !== '',
    queryFn: async () => {
      const { data: customer, error: cErr } = await supabase
        .from('customers')
        .select('id')
        .eq('auth_user_id', uid)
        .maybeSingle()
      if (cErr) throw cErr
      if (!customer) return { appointments: [], stamps: 0, redemptions: 0 }

      const [appts, stamps, redemptions] = await Promise.all([
        supabase
          .from('appointments')
          .select(
            'id, starts_at, ends_at, status, barber:barbers(display_name), appointment_services(service_name, price_cents)',
          )
          .eq('customer_id', customer.id)
          .order('starts_at', { ascending: false })
          .limit(50),
        supabase
          .from('loyalty_stamps')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', customer.id)
          .is('redemption_id', null),
        supabase
          .from('loyalty_redemptions')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', customer.id),
      ])
      if (appts.error) throw appts.error
      if (stamps.error) throw stamps.error
      if (redemptions.error) throw redemptions.error
      return { appointments: appts.data, stamps: stamps.count ?? 0, redemptions: redemptions.count ?? 0 }
    },
  })
}

function CustomerSections() {
  const data = useMyData()
  const catalog = useCatalog()
  const qc = useQueryClient()
  const now = useNow()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const cancel = useMutation({
    mutationFn: (id: string) => callFunction('cancel-appointment', { appointment_id: id }),
    onSuccess: () => {
      setConfirmId(null)
      void qc.invalidateQueries({ queryKey: ['my-data'] })
    },
  })

  if (data.isPending || catalog.isPending) return <Spinner />
  if (data.isError) return <ErrorState message={errorMessage(data.error)} />

  const rule = catalog.data?.loyaltyRule ?? null
  const cancelHours = catalog.data?.settings.cancel_min_notice_hours ?? 2
  const upcoming = data.data.appointments
    .filter((a) => a.status === 'scheduled' && new Date(a.ends_at) > now)
    .reverse()
  const past = data.data.appointments.filter((a) => !upcoming.includes(a))

  return (
    <>
      <SubscriptionCard />
      {rule ? <LoyaltyCard stamps={data.data.stamps} required={rule.stamps_required} reward={rule.reward_description} redemptions={data.data.redemptions} /> : null}

      <section>
        <SectionTitle
          action={
            <Link to="/" className="text-sm text-blue underline underline-offset-4">
              + Novo horário
            </Link>
          }
        >
          Próximos horários
        </SectionTitle>
        {cancel.isError ? (
          <div className="mb-3">
            <Notice tone="error">{errorMessage(cancel.error)}</Notice>
          </div>
        ) : null}
        {upcoming.length === 0 ? (
          <EmptyState title="Nada marcado">
            <Link to="/" className="text-blue underline underline-offset-4">
              Agende seu próximo corte
            </Link>
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {upcoming.map((a) => {
              const canCancel = checkCustomerCancel(a.status, new Date(a.starts_at), now, cancelHours) === 'ok'
              return (
                <Card key={a.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold first-letter:uppercase">{formatLongDate(a.starts_at)}</p>
                      <p className="font-display text-3xl font-bold text-blue">{formatTime(a.starts_at)}</p>
                      <p className="text-sm text-muted">
                        {a.appointment_services.map((s) => s.service_name).join(' + ')}
                        {a.barber ? ` · ${a.barber.display_name}` : ''}
                      </p>
                    </div>
                    <p className="font-semibold">
                      {formatPrice(a.appointment_services.reduce((t, s) => t + s.price_cents, 0))}
                    </p>
                  </div>
                  {canCancel ? (
                    confirmId === a.id ? (
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={cancel.isPending}
                          onClick={() => cancel.mutate(a.id)}
                        >
                          Confirmar cancelamento
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                          Manter
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setConfirmId(a.id)}>
                        Cancelar
                      </Button>
                    )
                  ) : (
                    <p className="mt-2 text-xs text-muted">
                      Cancelamento online fecha {cancelHours}h antes. Fale com a barbearia.
                    </p>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {past.length > 0 ? (
        <section>
          <SectionTitle>Histórico</SectionTitle>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {past.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="first-letter:uppercase">
                    {formatShortDate(a.starts_at)} · {formatTime(a.starts_at)}
                  </p>
                  <p className="text-muted">{a.appointment_services.map((s) => s.service_name).join(' + ')}</p>
                </div>
                <Badge tone={a.status}>{STATUS_LABEL[a.status]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function LoyaltyCard({
  stamps,
  required,
  reward,
  redemptions,
}: {
  stamps: number
  required: number
  reward: string
  redemptions: number
}) {
  const ready = stamps >= required
  return (
    <section className="rounded-2xl border border-accent/40 bg-gradient-to-br from-surface-2 to-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Cartão fidelidade</h2>
        <span className="text-sm text-muted">
          {Math.min(stamps, required)}/{required}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2" aria-label={`${stamps} de ${required} selos`}>
        {Array.from({ length: required }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={`grid aspect-square place-items-center rounded-full border-2 ${
              i < stamps ? 'border-accent bg-accent' : 'border-dashed border-line'
            }`}
          >
            <img
              src="/brand/shield-white.png"
              alt=""
              width={184}
              height={256}
              className={`h-3/5 w-auto ${i < stamps ? '' : 'opacity-15'}`}
            />
          </span>
        ))}
      </div>
      <p className="mt-4 text-sm">
        {ready ? (
          <strong className="text-accent">Você ganhou: {reward}! Peça ao barbeiro no próximo atendimento.</strong>
        ) : (
          <>
            Faltam <strong className="text-accent">{required - stamps}</strong> para: {reward}.
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">
        Cada atendimento concluído agendado com a sua conta vale 1 selo
        {redemptions > 0 ? ` · ${redemptions} prêmio(s) já resgatado(s)` : ''}.
      </p>
    </section>
  )
}

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome.').max(120),
  phone: z.string().refine((v) => normalizeBrPhone(v) !== null, 'Telefone inválido. Use DDD + número.'),
})
type ProfileValues = z.infer<typeof profileSchema>

export function ProfileForm({ profile }: { profile: Profile }) {
  const qc = useQueryClient()
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: profile.name, phone: profile.phone ? formatBrPhone(profile.phone) : '' },
  })
  const { reset } = form
  useEffect(() => {
    reset({ name: profile.name, phone: profile.phone ? formatBrPhone(profile.phone) : '' })
  }, [profile, reset])

  const save = useMutation({
    mutationFn: async (v: ProfileValues) => {
      const { error } = await supabase
        .from('profiles')
        .update({ name: v.name, phone: normalizeBrPhone(v.phone) })
        .eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profile'] })
      void qc.invalidateQueries({ queryKey: ['my-data'] })
    },
  })

  return (
    <section>
      <SectionTitle>Meus dados</SectionTitle>
      <Card>
        <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          <Input label="Nome" autoComplete="name" error={form.formState.errors.name?.message} {...form.register('name')} />
          <Input
            label="Celular (WhatsApp)"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            error={form.formState.errors.phone?.message}
            {...form.register('phone', {
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                e.target.value = maskBrPhone(e.target.value)
              },
            })}
          />
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess && !form.formState.isDirty ? <Notice tone="success">Dados salvos.</Notice> : null}
          <Button type="submit" variant="secondary" loading={save.isPending}>
            Salvar
          </Button>
        </form>
      </Card>
    </section>
  )
}

function SubscriptionCard() {
  const subs = useMySubscriptions(true)
  const today = dateInTz(useNow(), APP_TIMEZONE)
  const current = currentSubscription(subs.data ?? [], today)
  if (!current) return null
  const left = Math.max(0, current.cuts_included - current.used)
  return (
    <section className="rounded-2xl border border-blue/40 bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Sua assinatura</h2>
        <span className="text-sm text-muted">até {subscriptionLastDay(current.ends_on)}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{current.plan_name}</p>
      <p className="mt-3">
        <span className="font-display text-4xl font-bold">{current.used}</span>
        <span className="text-muted"> de {current.cuts_included} cortes usados</span>
      </p>
      <p className="mt-1 text-sm">
        {left > 0 ? (
          <>
            Ainda tem <strong className="text-accent">{left}</strong> {left === 1 ? 'corte' : 'cortes'} neste mês. É só
            agendar com este celular.
          </>
        ) : (
          'Os cortes deste mês acabaram. Novos agendamentos têm o preço normal até renovar.'
        )}
      </p>
    </section>
  )
}
