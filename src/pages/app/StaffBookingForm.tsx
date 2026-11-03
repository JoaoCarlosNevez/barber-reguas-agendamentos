import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ErrorState, Spinner } from '@/components/states'
import { Button, Card, Input, Notice, Select } from '@/components/ui'
import { ApiError, callFunction, errorMessage } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { APP_TIMEZONE } from '@/lib/env'
import { formatDuration, formatPrice, formatTime } from '@/lib/format'
import { maskBrPhone } from '@/lib/phoneMask'
import { dateInTz, normalizeBrPhone } from '@/lib/shared'
import { useNow } from '@/hooks/useNow'

interface AvailabilityResponse {
  slots: { starts_at: string; time: string; barber_ids: string[] }[]
}
interface Created {
  appointment_id: string
  token: string
  starts_at: string
}

/** Barbeiro/dono marca um horário para o cliente direto pelo app. */
export function StaffBookingForm({
  barbers,
  defaultBarberId,
  onClose,
}: {
  barbers: { id: string; display_name: string }[]
  defaultBarberId: string
  onClose: () => void
}) {
  const catalog = useCatalog()
  const qc = useQueryClient()
  const today = dateInTz(useNow(), APP_TIMEZONE)
  const [barberId, setBarberId] = useState(defaultBarberId)
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [date, setDate] = useState(today)
  const [slot, setSlot] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const offered = new Set(catalog.data?.links.filter((l) => l.barber_id === barberId).map((l) => l.service_id))
  const services = (catalog.data?.services ?? []).filter((s) => offered.has(s.id))
  const picked = services.filter((s) => serviceIds.includes(s.id))
  const sortedIds = [...serviceIds].sort()

  const availability = useQuery({
    queryKey: ['staff-availability', barberId, sortedIds, date],
    enabled: serviceIds.length > 0 && date >= today,
    queryFn: () =>
      callFunction<AvailabilityResponse>('get-availability', { barber_id: barberId, service_ids: sortedIds, date }),
  })

  const create = useMutation({
    mutationFn: () =>
      callFunction<Created>('staff-create-appointment', {
        barber_id: barberId,
        service_ids: sortedIds,
        starts_at: slot,
        customer: { name: name.trim(), phone },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agenda'] })
      void qc.invalidateQueries({ queryKey: ['staff-availability'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'slot_unavailable') {
        setSlot(null)
        void availability.refetch()
      }
    },
  })

  const reset = () => {
    setServiceIds([])
    setSlot(null)
    setName('')
    setPhone('')
    create.reset()
  }

  if (catalog.isPending) return <Spinner />
  if (catalog.isError) return <ErrorState message={errorMessage(catalog.error)} />

  if (create.isSuccess) {
    const e164 = normalizeBrPhone(phone) ?? ''
    const link = `${window.location.origin}/agendamento/${create.data.token}`
    const msg = `Olá, ${name.trim().split(' ')[0]}! Seu horário está marcado: ${picked
      .map((s) => s.name)
      .join(' + ')}, ${new Date(create.data.starts_at).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: APP_TIMEZONE,
    })} às ${formatTime(create.data.starts_at)}. Detalhes e cancelamento: ${link}`
    return (
      <Card className="border-brass/60">
        <Notice tone="success">
          Agendado para {name.trim()} às {formatTime(create.data.starts_at)}.
        </Notice>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`https://wa.me/${e164.replace('+', '')}?text=${encodeURIComponent(msg)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg bg-brass px-3 py-2 text-sm font-semibold text-ink"
          >
            Enviar confirmação no WhatsApp
          </a>
          <Button size="sm" variant="secondary" onClick={reset}>
            Agendar outro
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </Card>
    )
  }

  const phoneOk = normalizeBrPhone(phone) !== null
  const canSubmit = slot !== null && name.trim().length >= 2 && phoneOk

  return (
    <Card className="space-y-4 border-brass/60">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Novo agendamento</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>

      {barbers.length > 1 ? (
        <Select
          label="Barbeiro"
          value={barberId}
          onChange={(e) => {
            setBarberId(e.target.value)
            setServiceIds([])
            setSlot(null)
          }}
        >
          {barbers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.display_name}
            </option>
          ))}
        </Select>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-sm text-muted">Serviços</legend>
        {services.length === 0 ? (
          <p className="text-sm text-muted">Nenhum serviço ligado a este barbeiro. Ajuste em Gestão → Barbeiros.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {services.map((s) => {
              const on = serviceIds.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSlot(null)
                    setServiceIds((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    on ? 'border-brass bg-brass/15 text-brass' : 'border-line text-muted'
                  }`}
                >
                  {on ? '✓ ' : ''}
                  {s.name} · {formatPrice(s.price_cents)}
                </button>
              )
            })}
          </div>
        )}
        {picked.length ? (
          <p className="mt-2 text-xs text-muted">
            {formatDuration(picked.reduce((t, s) => t + s.duration_min, 0))} ·{' '}
            {formatPrice(picked.reduce((t, s) => t + s.price_cents, 0))}
          </p>
        ) : null}
      </fieldset>

      <Input
        label="Dia"
        type="date"
        min={today}
        value={date}
        onChange={(e) => {
          setDate(e.target.value)
          setSlot(null)
        }}
      />

      {serviceIds.length ? (
        <fieldset>
          <legend className="mb-2 text-sm text-muted">Horário</legend>
          {availability.isPending ? (
            <Spinner />
          ) : availability.isError ? (
            <Notice tone="error">{errorMessage(availability.error)}</Notice>
          ) : availability.data.slots.length === 0 ? (
            <p className="text-sm text-muted">Sem horário livre neste dia.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {availability.data.slots.map((s) => (
                <button
                  key={s.starts_at}
                  type="button"
                  aria-pressed={slot === s.starts_at}
                  onClick={() => setSlot(s.starts_at)}
                  className={`rounded-lg border py-2 text-sm font-semibold tabular-nums transition-colors ${
                    slot === s.starts_at ? 'border-brass bg-brass text-ink' : 'border-line text-cream'
                  }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}

      <Input label="Nome do cliente" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      <Input
        label="Celular do cliente"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="(11) 98765-4321"
        value={phone}
        onChange={(e) => setPhone(maskBrPhone(e.target.value))}
        error={phone && !phoneOk ? 'Celular inválido. Use DDD + número.' : undefined}
      />
      <p className="text-xs text-muted">Se o celular já tem conta, o horário entra no histórico e na fidelidade do cliente.</p>

      {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
      <Button className="w-full" size="lg" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>
        Agendar
      </Button>
    </Card>
  )
}
