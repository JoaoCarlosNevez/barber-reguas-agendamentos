import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <output className="flex items-center justify-center gap-3 py-10 text-muted">
      <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-line border-t-accent" />
      <span>{label}</span>
    </output>
  )
}

export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
      <p>{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-6 text-center">
      <p className="font-display text-lg uppercase">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  )
}

/**
 * Tela cheia de carregamento com a marca, para esperas longas (ex.: confirmar
 * agendamento). As mensagens vão trocando para o cliente saber que não travou.
 */
export function FullScreenLoader({ messages }: { messages: string[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, messages.length - 1)), 2200)
    return () => clearInterval(t)
  }, [messages.length])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/95 px-6 backdrop-blur-sm">
      <output aria-live="polite" className="flex flex-col items-center text-center">
        <span className="relative grid size-28 place-items-center">
          <span aria-hidden className="absolute inset-0 animate-spin rounded-full border-4 border-line border-t-accent" />
          <img src="/brand/shield-white.png" alt="" className="h-14 w-auto animate-pulse" />
        </span>
        <span key={i} className="mt-6 animate-step-in font-display text-2xl font-bold tracking-wide uppercase">
          {messages[i]}
        </span>
        <span className="mt-2 text-sm text-muted">Não feche esta tela.</span>
      </output>
    </div>
  )
}

const BOOKING_MESSAGES = ['Reservando seu horário…', 'Confirmando com a barbearia…', 'Quase lá…']

/** Espera ao confirmar um agendamento (continua na página do comprovante). */
export function BookingLoader({ almostDone = false }: { almostDone?: boolean }) {
  return <FullScreenLoader messages={almostDone ? BOOKING_MESSAGES.slice(-1) : BOOKING_MESSAGES} />
}
