import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { z } from 'zod'
import { Button, Input, Notice } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { maskBrPhone } from '@/lib/phoneMask'
import { normalizeBrPhone } from '@/lib/shared'
import { supabase } from '@/lib/supabase'
import { AuthShell } from './AuthShell'

const schema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(80),
  phone: z.string().refine((v) => normalizeBrPhone(v) !== null, 'Telefone inválido. Use DDD + número.'),
  email: z.email('E-mail inválido.'),
  password: z.string().min(8, 'Mínimo de 8 caracteres.').max(72),
})
type Values = z.infer<typeof schema>

export function SignupPage() {
  const navigate = useNavigate()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', phone: '', email: '', password: '' },
  })

  const signup = useMutation({
    mutationFn: async (v: Values) => {
      const { data, error } = await supabase.auth.signUp({
        email: v.email,
        password: v.password,
        options: {
          data: { name: v.name, phone: normalizeBrPhone(v.phone) },
          emailRedirectTo: `${window.location.origin}/minha-conta`,
        },
      })
      if (error) throw error
      return { needsConfirmation: data.session === null }
    },
    onSuccess: ({ needsConfirmation }) => {
      if (!needsConfirmation) void navigate('/minha-conta', { replace: true })
    },
  })

  if (signup.data?.needsConfirmation) {
    return (
      <AuthShell title="Quase lá">
        <Notice tone="success">
          Enviamos um link de confirmação para <strong>{form.getValues('email')}</strong>. Abra o e-mail e toque no
          link para ativar sua conta.
        </Notice>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle={
        <>
          Junte selos a cada corte e ganhe recompensas. Já tem conta?{' '}
          <Link to="/entrar" className="text-brass underline underline-offset-4">
            Entrar
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={form.handleSubmit((v) => signup.mutate(v))} className="space-y-4">
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
          autoComplete="new-password"
          hint="Mínimo de 8 caracteres."
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        {signup.isError ? <Notice tone="error">{errorMessage(signup.error)}</Notice> : null}
        <Button type="submit" className="w-full" size="lg" loading={signup.isPending}>
          Criar conta
        </Button>
      </form>
    </AuthShell>
  )
}
