import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { Button, Input, Notice } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { homeForRole, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { AuthShell } from './AuthShell'
import { safeNext } from './safeNext'

const schema = z.object({
  email: z.email('E-mail inválido.'),
  password: z.string().min(1, 'Informe a senha.'),
})
type Values = z.infer<typeof schema>

/**
 * Login da equipe (dono, barbeiros, super admin) com e-mail e senha.
 * `app`: dentro do app PWA (/app/entrar); `site`: na web (/entrar/equipe).
 */
export function LoginPage({ variant = 'site' }: { variant?: 'site' | 'app' }) {
  const isApp = variant === 'app'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { session, role, ready } = useAuth()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  const login = useMutation({
    mutationFn: async (v: Values) => {
      const { data, error } = await supabase.auth.signInWithPassword(v)
      if (error) throw error
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
      return profile?.role ?? null
    },
    onSuccess: (r) => void navigate(next ?? (isApp ? '/app' : homeForRole(r)), { replace: true }),
  })

  if (ready && session && role && !login.isPending && !login.isSuccess) {
    return <Navigate to={next ?? (isApp ? '/app' : homeForRole(role))} replace />
  }

  return (
    <AuthShell
      title={isApp ? 'Entrar na equipe' : 'Entrar · equipe'}
      subtitle={
        isApp ? (
          'Use o e-mail e a senha que foram cadastrados para você.'
        ) : (
          <>
            Área do dono e dos barbeiros. É cliente?{' '}
            <Link to="/entrar" className="text-blue underline underline-offset-4">
              Entre com seu celular
            </Link>
          </>
        )
      }
    >
      <form noValidate onSubmit={form.handleSubmit((v) => login.mutate(v))} className="space-y-4">
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Input
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        {login.isError ? <Notice tone="error">{errorMessage(login.error)}</Notice> : null}
        <Button type="submit" className="w-full" size="lg" loading={login.isPending}>
          Entrar
        </Button>
        <p className="text-center text-sm text-muted">Esqueceu a senha? Fale com o dono da barbearia.</p>
      </form>
    </AuthShell>
  )
}
