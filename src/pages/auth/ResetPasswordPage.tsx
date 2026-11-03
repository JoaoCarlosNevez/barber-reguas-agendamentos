import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { z } from 'zod'
import { Spinner } from '@/components/states'
import { Button, Input, Notice } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { AuthShell } from './AuthShell'

const schema = z
  .object({
    password: z.string().min(8, 'Mínimo de 8 caracteres.').max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não conferem.', path: ['confirm'] })
type Values = z.infer<typeof schema>

/** Destino do link de recuperação: o supabase-js lê o token da URL e abre a sessão. */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { ready, session } = useAuth()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } })
  const save = useMutation({
    mutationFn: async (v: Values) => {
      const { error } = await supabase.auth.updateUser({ password: v.password })
      if (error) throw error
    },
    onSuccess: () => void navigate('/minha-conta', { replace: true }),
  })

  if (!ready) return <Spinner />
  if (!session) {
    return (
      <AuthShell title="Link expirado">
        <Notice tone="error">Este link não é mais válido. Peça um novo.</Notice>
        <Link to="/esqueci-senha" className="mt-4 inline-block text-brass underline underline-offset-4">
          Pedir novo link
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Nova senha">
      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <Input
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <Input
          label="Repita a senha"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.confirm?.message}
          {...form.register('confirm')}
        />
        {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        <Button type="submit" className="w-full" loading={save.isPending}>
          Salvar senha
        </Button>
      </form>
    </AuthShell>
  )
}
