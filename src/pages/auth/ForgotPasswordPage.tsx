import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { Button, Input, Notice } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { AuthShell } from './AuthShell'

const schema = z.object({ email: z.email('E-mail inválido.') })
type Values = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const send = useMutation({
    mutationFn: async (v: Values) => {
      const { error } = await supabase.auth.resetPasswordForEmail(v.email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      })
      if (error) throw error
    },
  })

  return (
    <AuthShell title="Esqueci a senha" subtitle="Enviamos um link para você criar uma nova senha.">
      {send.isSuccess ? (
        <Notice tone="success">
          Se existir uma conta com esse e-mail, o link chega em instantes. Confira também o spam.
        </Notice>
      ) : (
        <form noValidate onSubmit={form.handleSubmit((v) => send.mutate(v))} className="space-y-4">
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          {send.isError ? <Notice tone="error">{errorMessage(send.error)}</Notice> : null}
          <Button type="submit" className="w-full" loading={send.isPending}>
            Enviar link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/entrar" className="text-muted underline underline-offset-4 hover:text-cream">
          Voltar para o login
        </Link>
      </p>
    </AuthShell>
  )
}
