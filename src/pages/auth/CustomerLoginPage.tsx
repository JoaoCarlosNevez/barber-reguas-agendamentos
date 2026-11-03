import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { Button, Input, Notice } from '@/components/ui'
import { ApiError, errorMessage } from '@/lib/api'
import { homeForRole, useAuth } from '@/lib/auth'
import { signInCustomer } from '@/lib/customerAuth'
import { maskBrPhone } from '@/lib/phoneMask'
import { normalizeBrPhone } from '@/lib/shared'
import { AuthShell } from './AuthShell'
import { safeNext } from './safeNext'

const schema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(80, 'Nome muito longo.'),
  phone: z.string().refine((v) => normalizeBrPhone(v) !== null, 'Celular inválido. Use DDD + número.'),
})
type Values = z.infer<typeof schema>

/** Entrada do cliente: celular + nome, sem senha. Primeira vez cria a conta. */
export function CustomerLoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { session, role, ready } = useAuth()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', phone: '' } })

  const login = useMutation({
    mutationFn: (v: Values) => signInCustomer(v.name, v.phone),
    onSuccess: () => void navigate(next ?? '/minha-conta', { replace: true }),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'name_mismatch') form.setError('name', { message: err.message })
      const fe = err instanceof ApiError ? err.details?.fieldErrors : undefined
      if (fe?.phone?.[0]) form.setError('phone', { message: fe.phone[0] })
    },
  })

  if (ready && session && role && !login.isPending && !login.isSuccess) {
    return <Navigate to={next ?? homeForRole(role)} replace />
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Só seu celular e seu nome, sem senha. Primeira vez? A conta é criada na hora."
    >
      <form noValidate onSubmit={form.handleSubmit((v) => login.mutate(v))} className="space-y-4">
        <Input label="Nome" autoComplete="name" error={form.formState.errors.name?.message} {...form.register('name')} />
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
        {login.isError && !(login.error instanceof ApiError && login.error.code === 'name_mismatch') ? (
          <Notice tone="error">{errorMessage(login.error)}</Notice>
        ) : null}
        <Button type="submit" className="w-full" size="lg" loading={login.isPending}>
          Entrar
        </Button>
        <p className="text-center text-sm text-muted">
          Use o mesmo nome do seu primeiro agendamento.{' '}
          <Link to="/entrar/equipe" className="text-accent underline underline-offset-4">
            Sou da equipe
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
