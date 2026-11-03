import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { ErrorState, Spinner } from '@/components/states'
import { Button, Card, Input, Notice, SectionTitle } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { fillReturnMessage } from '@/lib/returnMessage'
import { useAdminServices } from './queries'

const int = (min: number, max: number) =>
  z.coerce.number<string | number>().int('Número inteiro.').min(min, `Mínimo ${min}.`).max(max, `Máximo ${max}.`)

const schema = z
  .object({
    return_reminder_enabled: z.boolean(),
    return_reminder_days: int(1, 180),
    return_reminder_from_hour: int(0, 23),
    return_reminder_until_hour: int(1, 24),
    return_reminder_message: z.string().trim().min(5, 'Escreva a mensagem.').max(600, 'Máximo 600 caracteres.'),
  })
  .refine((v) => v.return_reminder_until_hour > v.return_reminder_from_hour, {
    path: ['return_reminder_until_hour'],
    message: 'Tem que ser depois do início.',
  })
type Values = z.input<typeof schema>
type Parsed = z.output<typeof schema>

/** Dono: lembrete "chamar de volta" (dias, horário, mensagem e serviços que contam). */
export function ReturnReminderSettings() {
  const qc = useQueryClient()
  const msgId = useId()
  const services = useAdminServices()
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').single()
      if (error) throw error
      return data
    },
  })
  const form = useForm<Values, unknown, Parsed>({ resolver: zodResolver(schema) })
  const { reset, control } = form
  useEffect(() => {
    if (settings.data) reset(settings.data)
  }, [settings.data, reset])
  const [enabled, message, days] = useWatch({
    control,
    name: ['return_reminder_enabled', 'return_reminder_message', 'return_reminder_days'],
  })

  const save = useMutation({
    mutationFn: async (v: Parsed) => {
      const { error } = await supabase.from('app_settings').update(v).eq('id', true)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  })

  const toggleService = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { error } = await supabase.from('services').update({ return_reminder: on }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'services'] }),
  })

  if (settings.isPending || services.isPending) return <Spinner />
  if (settings.isError) return <ErrorState message={errorMessage(settings.error)} />
  if (services.isError) return <ErrorState message={errorMessage(services.error)} />

  const e = form.formState.errors
  const preview = fillReturnMessage(message ?? '', 'Carlos Souza', Number(days) || 20, window.location.origin)

  return (
    <section>
      <SectionTitle>Chamar de volta</SectionTitle>
      <Card>
        <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          <p className="text-sm text-muted">
            Depois de alguns dias do atendimento, se o cliente não marcou outro horário, o barbeiro recebe um aviso
            com um botão para chamar no WhatsApp.
          </p>
          <label className="flex items-center gap-3">
            <input type="checkbox" className="size-5 accent-accent" {...form.register('return_reminder_enabled')} />
            <span className="font-semibold">Lembrete ligado</span>
          </label>

          <fieldset disabled={!enabled} className="space-y-4 disabled:opacity-50">
            <Input
              label="Avisar quantos dias depois do atendimento"
              type="number"
              inputMode="numeric"
              error={e.return_reminder_days?.message}
              {...form.register('return_reminder_days')}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Enviar a partir de (hora)"
                type="number"
                inputMode="numeric"
                error={e.return_reminder_from_hour?.message}
                {...form.register('return_reminder_from_hour')}
              />
              <Input
                label="Até (hora)"
                type="number"
                inputMode="numeric"
                error={e.return_reminder_until_hour?.message}
                {...form.register('return_reminder_until_hour')}
              />
            </div>

            <div>
              <label htmlFor={msgId} className="mb-1 block text-sm text-muted">
                Mensagem do WhatsApp
              </label>
              <textarea
                id={msgId}
                rows={4}
                aria-invalid={e.return_reminder_message ? true : undefined}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-cream focus:border-accent focus:outline-none aria-[invalid=true]:border-danger"
                {...form.register('return_reminder_message')}
              />
              {e.return_reminder_message ? (
                <p className="mt-1 text-sm text-danger">{e.return_reminder_message.message}</p>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  Use <code>{'{nome}'}</code> (primeiro nome), <code>{'{dias}'}</code> e <code>{'{link}'}</code> (site
                  para agendar).
                </p>
              )}
              <p className="mt-2 rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">
                <span className="mb-1 block text-xs font-semibold text-muted uppercase">Prévia</span>
                {preview}
              </p>
            </div>
          </fieldset>

          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess ? <Notice tone="success">Lembrete salvo.</Notice> : null}
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </form>

        <div className="mt-6 border-t border-line pt-4">
          <p className="font-semibold">Quais serviços contam</p>
          <p className="mb-3 text-sm text-muted">Só atendimentos com algum destes serviços geram o lembrete.</p>
          <div className="space-y-2">
            {services.data
              .filter((s) => s.active)
              .map((s) => (
                <label key={s.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-accent"
                    checked={s.return_reminder}
                    disabled={toggleService.isPending}
                    onChange={(ev) => toggleService.mutate({ id: s.id, on: ev.target.checked })}
                  />
                  <span>{s.name}</span>
                </label>
              ))}
          </div>
          {toggleService.isError ? (
            <div className="mt-2">
              <Notice tone="error">{errorMessage(toggleService.error)}</Notice>
            </div>
          ) : null}
        </div>
      </Card>
    </section>
  )
}
