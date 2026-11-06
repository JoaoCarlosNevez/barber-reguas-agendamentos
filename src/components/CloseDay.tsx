import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Card, Notice } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { APP_TIMEZONE } from '@/lib/env'
import { formatTime } from '@/lib/format'
import { addDays, zonedToUtc } from '@/lib/shared'
import { supabase } from '@/lib/supabase'
import { cancelWhatsappUrl } from '@/lib/whatsapp'

interface ScheduledAppt {
  id: string
  starts_at: string
  customer: { name: string; phone: string } | null
  appointment_services: { service_name: string }[]
}

/**
 * Fechar a agenda de um dia: bloqueia o dia inteiro (time_off) e, se houver
 * horários marcados, cancela todos — com atalho para avisar cada cliente.
 */
export function CloseDay({ barberId, date, scheduled }: { barberId: string; date: string; scheduled: ScheduledAppt[] }) {
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [cancelled, setCancelled] = useState<ScheduledAppt[]>([])
  const dayStart = zonedToUtc(date, 0, APP_TIMEZONE).toISOString()
  const dayEnd = zonedToUtc(addDays(date, 1), 0, APP_TIMEZONE).toISOString()

  const blocks = useQuery({
    queryKey: ['day-blocks', barberId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off')
        .select('id, starts_at, ends_at')
        .eq('barber_id', barberId)
        .lt('starts_at', dayEnd)
        .gt('ends_at', dayStart)
      if (error) throw error
      return data
    },
  })
  // compara como instante: o banco devolve "+00:00", não "Z"
  const startMs = Date.parse(dayStart)
  const endMs = Date.parse(dayEnd)
  const fullDay = blocks.data?.find((b) => Date.parse(b.starts_at) <= startMs && Date.parse(b.ends_at) >= endMs)
  // só reabre pelo app o bloqueio feito aqui (exatamente este dia)
  const ownBlock = fullDay && Date.parse(fullDay.starts_at) === startMs && Date.parse(fullDay.ends_at) === endMs

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['day-blocks'] })
    void qc.invalidateQueries({ queryKey: ['agenda'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'time_off'] })
    void qc.invalidateQueries({ queryKey: ['revenue'] })
  }

  const close = useMutation({
    mutationFn: async () => {
      // bloqueia primeiro: ninguém consegue marcar enquanto os cancelamentos rodam
      const { error } = await supabase.from('time_off').insert({
        barber_id: barberId,
        starts_at: dayStart,
        ends_at: dayEnd,
        reason: 'Agenda fechada pelo app',
      })
      if (error) throw error
      const done: ScheduledAppt[] = []
      for (const a of scheduled) {
        const { error: cErr } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', a.id)
        if (cErr) throw new Error(`Dia fechado, mas não deu para cancelar o horário das ${formatTime(a.starts_at)}: ${errorMessage(cErr)}`)
        done.push(a)
      }
      return done
    },
    onSuccess: (done) => {
      setAsking(false)
      setCancelled(done)
      refresh()
    },
    onSettled: refresh,
  })

  const reopen = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_off').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setCancelled([])
      refresh()
    },
  })

  if (blocks.isPending) return null

  if (fullDay) {
    return (
      <Card className="border-danger/40">
        <p className="font-semibold">🔒 Agenda fechada neste dia</p>
        <p className="text-sm text-muted">Clientes não conseguem marcar horário.</p>
        {cancelled.length ? <CancelledList list={cancelled} /> : null}
        {ownBlock ? (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            loading={reopen.isPending}
            onClick={() => reopen.mutate(fullDay.id)}
          >
            Reabrir agenda do dia
          </Button>
        ) : (
          <p className="mt-2 text-xs text-muted">Bloqueio de vários dias: reabra em Datas fechadas, abaixo.</p>
        )}
        {reopen.isError ? <p className="mt-2 text-sm text-danger">{errorMessage(reopen.error)}</p> : null}
      </Card>
    )
  }

  if (!asking) {
    return (
      <Button variant="secondary" size="sm" className="w-full" onClick={() => setAsking(true)}>
        🔒 Fechar agenda deste dia
      </Button>
    )
  }

  return (
    <Card className="border-danger/50">
      <p className="font-semibold">Fechar a agenda deste dia?</p>
      {scheduled.length ? (
        <>
          <Notice tone="error">
            Você tem {scheduled.length} {scheduled.length === 1 ? 'agendamento' : 'agendamentos'} neste dia. Para
            fechar, {scheduled.length === 1 ? 'ele será cancelado' : 'todos serão cancelados'}:
          </Notice>
          <ul className="mt-2 space-y-1 text-sm">
            {scheduled.map((a) => (
              <li key={a.id}>
                <span className="font-semibold tabular-nums">{formatTime(a.starts_at)}</span> ·{' '}
                {a.customer?.name ?? 'Cliente'} · {a.appointment_services.map((s) => s.service_name).join(' + ')}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Depois você avisa cada cliente no WhatsApp com um toque.</p>
        </>
      ) : (
        <p className="text-sm text-muted">Nenhum horário marcado. Clientes não vão conseguir agendar neste dia.</p>
      )}
      {close.isError ? (
        <div className="mt-2">
          <Notice tone="error">{errorMessage(close.error)}</Notice>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="danger" size="sm" loading={close.isPending} onClick={() => close.mutate()}>
          {scheduled.length
            ? `Cancelar ${scheduled.length === 1 ? 'o agendamento' : `os ${scheduled.length}`} e fechar`
            : 'Fechar o dia'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)} disabled={close.isPending}>
          Voltar
        </Button>
      </div>
    </Card>
  )
}

function CancelledList({ list }: { list: ScheduledAppt[] }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-sm font-semibold">Avise os clientes cancelados:</p>
      <ul className="space-y-2">
        {list.map((a) => {
          const wa = cancelWhatsappUrl(a)
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-semibold tabular-nums">{formatTime(a.starts_at)}</span> · {a.customer?.name ?? 'Cliente'}
              </span>
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-strong"
                >
                  Avisar no WhatsApp
                </a>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
