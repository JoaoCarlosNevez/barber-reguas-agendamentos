import type { ReactNode } from 'react'

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-sm py-6">
      <h1 className="text-4xl font-bold">{title}</h1>
      {subtitle ? <p className="mt-2 text-muted">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  )
}
