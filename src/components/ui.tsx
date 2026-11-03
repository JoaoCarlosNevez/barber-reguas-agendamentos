import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong disabled:bg-accent/40',
  secondary: 'border border-line bg-surface-2 text-cream hover:border-accent/60 disabled:opacity-50',
  ghost: 'text-muted hover:text-cream disabled:opacity-50',
  danger: 'border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-50',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}) {
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5', lg: 'px-5 py-3.5 text-lg' }
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  )
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</div>
}

const inputClass =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-cream placeholder:text-muted/70 focus:border-accent focus:outline-none aria-[invalid=true]:border-danger'

interface FieldProps {
  label: string
  error?: string | undefined
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(
  function Input({ label, error, hint, id, className = '', ...rest }, ref) {
    const autoId = useId()
    const inputId = id ?? autoId
    return (
      <div className={className}>
        <label htmlFor={inputId} className="mb-1 block text-sm text-muted">
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-err` : undefined}
          className={inputClass}
          {...rest}
        />
        {error ? (
          <p id={`${inputId}-err`} className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : hint ? (
          <p className="mt-1 text-xs text-muted">{hint}</p>
        ) : null}
      </div>
    )
  },
)

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { children: ReactNode }
>(function Select({ label, error, id, className = '', children, ...rest }, ref) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div className={className}>
      <label htmlFor={selectId} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      <select ref={ref} id={selectId} aria-invalid={error ? true : undefined} className={inputClass} {...rest}>
        {children}
      </select>
      {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
    </div>
  )
})

const badgeTones = {
  scheduled: 'bg-blue/15 text-blue',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-danger/15 text-danger',
  no_show: 'bg-muted/15 text-muted',
  neutral: 'bg-surface-2 text-muted',
} as const

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${badgeTones[tone]}`}>
      {children}
    </span>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2">
      <h2 className="text-xl font-semibold">{children}</h2>
      {action}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'error'; children: ReactNode }) {
  const tones = {
    info: 'border-blue/40 bg-blue/10 text-cream',
    success: 'border-success/40 bg-success/10 text-cream',
    error: 'border-danger/40 bg-danger/10 text-cream',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}
