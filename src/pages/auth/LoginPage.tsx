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

const schema = z.object({
  email: z.email('E-mail inválido.'),
  password: z.string().min(1, 'Informe a senha.'),
})
type Values = z.infer<typeof schema>

/** Só aceita caminhos internos (evita open redirect). */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export function LoginPage() {
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
    onSuccess: (r) => void navigate(next ?? homeForRole(r), { replace: true }),
  })

  if (ready && session && role && !login.isPending && !login.isSuccess) {
    return <Navigate to={next ?? homeForRole(role)} replace />
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle={
        <>
          Não tem conta?{' '}
          <Link to="/cadastro" className="text-brass underline underline-offset-4">
            Crie em 30 segundos
          </Link>
        </>
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
        <p className="text-center text-sm">
          <Link to="/esqueci-senha" className="text-muted underline underline-offset-4 hover:text-cream">
            Esqueci minha senha
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
