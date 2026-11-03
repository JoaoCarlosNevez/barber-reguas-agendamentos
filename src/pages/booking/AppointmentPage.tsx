import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { BookingLoader, ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Notice } from '@/components/ui'
import { callFunction, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDuration, formatLongDate, formatPrice, formatTime, STATUS_LABEL } from '@/lib/format'
import { downloadIcs } from '@/lib/ics'
import type { CreatedAppointment } from './BookingPage'

export interface PublicAppointment {
  id: string
  status: keyof typeof STATUS_LABEL
  starts_at: string
  ends_at: string
  timezone: string
  cancelled_by: string | null
  barber: { id: string; display_name: string } | null
  customer_name: string
  services: { id: string; name: string; duration_min: number; price_cents: number }[]
  total_price_cents: number
  cancel_min_notice_hours: number
  cancel_deadline: string
  can_cancel: boolean
}

export function AppointmentPage() {
  const { token = '' } = useParams()
  const location = useLocation()
  const created = (location.state as { created?: CreatedAppointment } | null)?.created
  const justCreated = created?.token === token
  const qc = useQueryClient()
  const { session } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  const query = useQuery({
    queryKey: ['appointment', token],
    queryFn: () => callFunction<{ appointment: PublicAppointment }>('get-appointment', { token }),
    select: (d) => d.appointment,
    retry: false,
  })

  const cancel = useMutation({
    mutationFn: () => callFunction<{ appointment: PublicAppointment }>('cancel-appointment', { token }),
    onSuccess: (d) => {
      qc.setQueryData(['appointment', token], d)
      setConfirming(false)
    },
  })

  if (query.isPending) {
    // logo após confirmar, mantém a mesma tela de espera até o comprovante carregar
    return justCreated ? <BookingLoader almostDone /> : <Spinner />
  }
  if (query.isError) {
    return (
      <section className="py-8">
        <h1 className="mb-4 text-3xl font-bold">Seu agendamento</h1>
        <ErrorState
          message={errorMessage(query.error)}
          action={
            <Link to="/" className="text-accent underline underline-offset-4">
              Fazer um novo agendamento
            </Link>
          }
        />
      </section>
    )
  }

  const a = query.data
  const scheduled = a.status === 'scheduled'
  const url = window.location.href.split('#')[0] ?? window.location.href

  async function share() {
    const text = `Meu horário no Studio Réguas: ${formatLongDate(a.starts_at)} às ${formatTime(a.starts_at)}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Agendamento', text, url })
        return
      } catch {
        // cancelado pelo usuário: cai para copiar
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="space-y-5 py-2">
      {justCreated && scheduled ? (
        <div className="rounded-xl border border-success/40 bg-success/10 p-4">
          <p className="font-display text-2xl font-bold uppercase text-success">Agendado! ✂️</p>
          <p className="mt-1 text-sm">
            Guarde este link: é por ele que você vê ou cancela o horário.
            {created?.appointment.loyalty_eligible
              ? ' Este atendimento vai valer selo no seu cartão fidelidade.'
              : session
                ? ''
                : ' Crie uma conta para juntar selos nas próximas visitas.'}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">Seu agendamento</h1>
        <Badge tone={a.status}>{STATUS_LABEL[a.status]}</Badge>
      </div>

      <Card>
        <p className="text-sm text-muted">Olá, {a.customer_name.split(' ')[0]}</p>
        <p className="mt-2 font-semibold first-letter:uppercase">{formatLongDate(a.starts_at)}</p>
        <p className={`font-display text-5xl font-bold ${scheduled ? 'text-accent' : 'text-muted line-through'}`}>
          {formatTime(a.starts_at)}
        </p>
        <p className="mt-1 text-sm text-muted">
          até {formatTime(a.ends_at)}
          {a.barber ? ` · com ${a.barber.display_name}` : ''}
        </p>

        <ul className="mt-4 divide-y divide-line border-t border-line">
          {a.services.map((s) => (
            <li key={s.id} className="flex justify-between py-2 text-sm">
              <span>
                {s.name} <span className="text-muted">· {formatDuration(s.duration_min)}</span>
              </span>
              <span>{formatPrice(s.price_cents)}</span>
            </li>
          ))}
          <li className="flex justify-between pt-2 font-semibold">
            <span>Total (pagamento no local)</span>
            <span className="text-accent">{formatPrice(a.total_price_cents)}</span>
          </li>
        </ul>
      </Card>

      {scheduled ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              downloadIcs({
                uid: a.id,
                title: `Studio Réguas: ${a.services.map((s) => s.name).join(' + ')}`,
                description: a.barber ? `Com ${a.barber.display_name}. ${url}` : url,
                start: a.starts_at,
                end: a.ends_at,
              })
            }
          >
            📅 Pôr na agenda
          </Button>
          <Button variant="secondary" onClick={() => void share()}>
            {copied ? 'Link copiado!' : '🔗 Compartilhar'}
          </Button>
        </div>
      ) : null}

      {scheduled ? (
        <Card>
          <h2 className="text-lg font-semibold">Não vai conseguir ir?</h2>
          {a.can_cancel ? (
            <>
              <p className="mt-1 text-sm text-muted">
                Dá para cancelar por aqui até {formatTime(a.cancel_deadline)} de{' '}
                {formatLongDate(a.cancel_deadline)}.
              </p>
              {cancel.isError ? (
                <div className="mt-3">
                  <Notice tone="error">{errorMessage(cancel.error)}</Notice>
                </div>
              ) : null}
              {confirming ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                    Sim, cancelar horário
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Manter
                  </Button>
                </div>
              ) : (
                <Button variant="danger" className="mt-3" onClick={() => setConfirming(true)}>
                  Cancelar agendamento
                </Button>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">
              O cancelamento online fecha {a.cancel_min_notice_hours}h antes do horário. Fale direto com a
              barbearia.
            </p>
          )}
        </Card>
      ) : a.status === 'cancelled' ? (
        <Notice>
          Este horário foi cancelado
          {a.cancelled_by === 'customer' ? ' por você' : a.cancelled_by ? ' pela barbearia' : ''}.{' '}
          <Link to="/" className="text-accent underline underline-offset-4">
            Agendar outro
          </Link>
        </Notice>
      ) : null}

      <p className="text-center">
        <Link to="/" className="text-sm text-muted underline underline-offset-4 hover:text-cream">
          Fazer outro agendamento
        </Link>
      </p>
    </section>
  )
}
