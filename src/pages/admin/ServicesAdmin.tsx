import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Input, Notice, SectionTitle } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { formatDuration, formatPrice } from '@/lib/format'
import { supabase, type Tables } from '@/lib/supabase'
import { useAdminServices } from './queries'

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(80),
  duration_min: z.coerce.number<string | number>().int().min(5, 'Mínimo 5 min.').max(480),
  price: z
    .string()
    .trim()
    .regex(/^\d+([,.]\d{1,2})?$/, 'Use o formato 45 ou 45,00.'),
})
type Values = z.input<typeof schema>
type Parsed = z.output<typeof schema>

function toCents(price: string): number {
  return Math.round(Number(price.replace(',', '.')) * 100)
}

export function ServicesAdmin() {
  const services = useAdminServices()
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  if (services.isPending) return <Spinner />
  if (services.isError) return <ErrorState message={errorMessage(services.error)} />

  return (
    <section>
      <SectionTitle
        action={
          editing !== 'new' ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              + Novo serviço
            </Button>
          ) : null
        }
      >
        Serviços
      </SectionTitle>
      <div className="space-y-2">
        {editing === 'new' ? <ServiceForm onDone={() => setEditing(null)} /> : null}
        {services.data.length === 0 && editing !== 'new' ? (
          <Notice>Cadastre o primeiro serviço para abrir a agenda.</Notice>
        ) : null}
        {services.data.map((s) =>
          editing === s.id ? (
            <ServiceForm key={s.id} service={s} onDone={() => setEditing(null)} />
          ) : (
            <Card key={s.id} className={s.active ? '' : 'opacity-60'}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {s.name} {s.active ? null : <Badge>inativo</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDuration(s.duration_min)} · {formatPrice(s.price_cents)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(s.id)}>
                  Editar
                </Button>
              </div>
            </Card>
          ),
        )}
      </div>
    </section>
  )
}

function ServiceForm({ service, onDone }: { service?: Tables<'services'>; onDone: () => void }) {
  const qc = useQueryClient()
  const form = useForm<Values, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: service
      ? {
          name: service.name,
          duration_min: service.duration_min,
          price: (service.price_cents / 100).toFixed(2).replace('.', ','),
        }
      : { name: '', duration_min: 30, price: '' },
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
    void qc.invalidateQueries({ queryKey: ['catalog'] })
  }

  const save = useMutation({
    mutationFn: async (v: Parsed) => {
      const row = { name: v.name, duration_min: v.duration_min, price_cents: toCents(v.price) }
      const { error } = service
        ? await supabase.from('services').update(row).eq('id', service.id)
        : await supabase.from('services').insert(row)
      if (error) throw error
    },
    onSuccess: () => {
      invalidate()
      onDone()
    },
  })

  const toggle = useMutation({
    mutationFn: async () => {
      if (!service) return
      const { error } = await supabase.from('services').update({ active: !service.active }).eq('id', service.id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidate()
      onDone()
    },
  })

  return (
    <Card className="border-brass/50">
      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3">
        <Input label="Nome" error={form.formState.errors.name?.message} {...form.register('name')} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Duração (min)"
            type="number"
            inputMode="numeric"
            step={5}
            error={form.formState.errors.duration_min?.message}
            {...form.register('duration_min')}
          />
          <Input
            label="Preço (R$)"
            inputMode="decimal"
            placeholder="45,00"
            error={form.formState.errors.price?.message}
            {...form.register('price')}
          />
        </div>
        {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        {toggle.isError ? <Notice tone="error">{errorMessage(toggle.error)}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          {service ? (
            <Button
              variant={service.active ? 'danger' : 'secondary'}
              className="ml-auto"
              loading={toggle.isPending}
              onClick={() => toggle.mutate()}
            >
              {service.active ? 'Desativar' : 'Reativar'}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  )
}
