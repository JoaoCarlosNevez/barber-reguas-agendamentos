import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ErrorState, Spinner } from '@/components/states'
import { Button, Card, Input, Notice, SectionTitle } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { supabase } from '@/lib/supabase'

const schema = z.object({
  stamps_required: z.coerce.number<string | number>().int().min(1, 'Mínimo 1.').max(50, 'Máximo 50.'),
  reward_description: z.string().trim().min(1, 'Descreva o prêmio.').max(200),
})
type Values = z.input<typeof schema>
type Parsed = z.output<typeof schema>

export function LoyaltyAdmin() {
  const qc = useQueryClient()
  const rule = useQuery({
    queryKey: ['admin', 'loyalty_rule'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loyalty_rules')
        .select('*')
        .order('active', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const form = useForm<Values, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: { stamps_required: 10, reward_description: 'Um corte grátis' },
  })
  const { reset } = form
  useEffect(() => {
    if (rule.data) reset({ stamps_required: rule.data.stamps_required, reward_description: rule.data.reward_description })
  }, [rule.data, reset])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
    void qc.invalidateQueries({ queryKey: ['catalog'] })
  }

  const save = useMutation({
    mutationFn: async (v: Parsed) => {
      const { error } = rule.data
        ? await supabase.from('loyalty_rules').update({ ...v, active: true }).eq('id', rule.data.id)
        : await supabase.from('loyalty_rules').insert({ ...v, active: true })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const disable = useMutation({
    mutationFn: async () => {
      if (!rule.data) return
      const { error } = await supabase.from('loyalty_rules').update({ active: false }).eq('id', rule.data.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  if (rule.isPending) return <Spinner />
  if (rule.isError) return <ErrorState message={errorMessage(rule.error)} />
  const active = rule.data?.active ?? false

  return (
    <section>
      <SectionTitle>Programa de fidelidade</SectionTitle>
      <Card>
        <p className="mb-4 text-sm text-muted">
          Cada atendimento concluído de um cliente com conta gera 1 selo. Ao juntar a quantidade definida, o barbeiro
          resgata o prêmio pela agenda. {active ? 'Status: ativo.' : 'Status: desligado.'}
        </p>
        <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3">
          <Input
            label="Selos para ganhar"
            type="number"
            inputMode="numeric"
            error={form.formState.errors.stamps_required?.message}
            {...form.register('stamps_required')}
          />
          <Input
            label="Prêmio"
            error={form.formState.errors.reward_description?.message}
            {...form.register('reward_description')}
          />
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess ? <Notice tone="success">Regra salva.</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending}>
              {active ? 'Salvar' : 'Ativar programa'}
            </Button>
            {active ? (
              <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate()}>
                Desligar
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </section>
  )
}
