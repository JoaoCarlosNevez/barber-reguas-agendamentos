import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ErrorState, Spinner } from '@/components/states'
import { Button, Card, Input, Notice, SectionTitle } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { supabase } from '@/lib/supabase'

const int = (min: number, max: number) =>
  z.coerce.number<string | number>().int('Número inteiro.').min(min, `Mínimo ${min}.`).max(max, `Máximo ${max}.`)

const schema = z.object({
  min_booking_notice_min: int(0, 10_080),
  max_booking_days: int(1, 365),
  cancel_min_notice_hours: int(0, 168),
  slot_step_min: int(5, 120),
})
type Values = z.input<typeof schema>
type Parsed = z.output<typeof schema>

export function SettingsAdmin() {
  const qc = useQueryClient()
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').single()
      if (error) throw error
      return data
    },
  })
  const form = useForm<Values, unknown, Parsed>({ resolver: zodResolver(schema) })
  const { reset } = form
  useEffect(() => {
    if (settings.data) reset(settings.data)
  }, [settings.data, reset])

  const save = useMutation({
    mutationFn: async (v: Parsed) => {
      const { error } = await supabase.from('app_settings').update(v).eq('id', true)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void qc.invalidateQueries({ queryKey: ['catalog'] })
    },
  })

  if (settings.isPending) return <Spinner />
  if (settings.isError) return <ErrorState message={errorMessage(settings.error)} />

  const e = form.formState.errors
  return (
    <section>
      <SectionTitle>Regras da agenda</SectionTitle>
      <Card>
        <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3">
          <Input
            label="Antecedência mínima para agendar (minutos)"
            type="number"
            hint="Ex.: 60 = só aceita horários a partir de 1h no futuro."
            error={e.min_booking_notice_min?.message}
            {...form.register('min_booking_notice_min')}
          />
          <Input
            label="Agenda aberta até (dias à frente)"
            type="number"
            error={e.max_booking_days?.message}
            {...form.register('max_booking_days')}
          />
          <Input
            label="Cliente pode cancelar até (horas antes)"
            type="number"
            error={e.cancel_min_notice_hours?.message}
            {...form.register('cancel_min_notice_hours')}
          />
          <Input
            label="Intervalo entre horários (minutos)"
            type="number"
            hint="Grade de horários oferecidos: 15 = 9:00, 9:15, 9:30…"
            error={e.slot_step_min?.message}
            {...form.register('slot_step_min')}
          />
          <p className="text-xs text-muted">Fuso horário: {settings.data.timezone}</p>
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess ? <Notice tone="success">Configurações salvas.</Notice> : null}
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </form>
      </Card>
    </section>
  )
}
