import type { ReactNode } from 'react'

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
