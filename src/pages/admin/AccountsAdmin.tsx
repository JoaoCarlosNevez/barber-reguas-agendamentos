import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState, ErrorState, Spinner } from '@/components/states'
import { Badge, Button, Card, Notice, SectionTitle } from '@/components/ui'
import { callFunction, errorMessage } from '@/lib/api'
import { ROLE_LABEL } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { NewBarberForm, PasswordReset } from './BarbersAdmin'

/** Super admin: donos e barbeiros (papel e senha). */
export function AccountsAdmin() {
  const qc = useQueryClient()
  const [open, setOpen] = useState<string | 'new-admin' | 'new-barber' | null>(null)

  const staff = useQuery({
    queryKey: ['admin', 'staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, role, barbers(display_name, active)')
        .in('role', ['admin', 'barber'])
        .order('role')
        .order('name')
      if (error) throw error
      return data
    },
  })

  const setRole = useMutation({
    mutationFn: (v: { user_id: string; role: 'barber' | 'admin' }) => callFunction('super-set-role', v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  })

  if (staff.isPending) return <Spinner />
  if (staff.isError) return <ErrorState message={errorMessage(staff.error)} />

  return (
    <section>
      <SectionTitle>Equipe</SectionTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setOpen('new-admin')}>+ Novo dono</Button>
        <Button variant="secondary" onClick={() => setOpen('new-barber')}>
          + Novo barbeiro
        </Button>
      </div>
      <p className="mb-3 text-sm text-muted">
        O <strong className="text-cream">dono</strong> gerencia a barbearia pelo app (serviços, barbeiros, horários,
        fidelidade). O <strong className="text-cream">barbeiro</strong> só vê a própria agenda.
      </p>
      {setRole.isError ? (
        <div className="mb-3">
          <Notice tone="error">{errorMessage(setRole.error)}</Notice>
        </div>
      ) : null}
      <div className="space-y-2">
        {open === 'new-admin' ? <NewBarberForm kind="admin" onDone={() => setOpen(null)} /> : null}
        {open === 'new-barber' ? <NewBarberForm onDone={() => setOpen(null)} /> : null}
        {staff.data.length === 0 && open === null ? (
          <EmptyState title="Ninguém na equipe">Cadastre o dono da barbearia para começar.</EmptyState>
        ) : null}
        {staff.data.map((p) => {
          const next = p.role === 'admin' ? 'barber' : 'admin'
          return (
            <Card key={p.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-semibold">{p.name}</span>{' '}
                  <Badge tone={p.role === 'admin' ? 'scheduled' : 'neutral'}>{ROLE_LABEL[p.role]}</Badge>
                  <span className="block text-sm text-muted">
                    {p.barbers
                      ? `Na agenda como "${p.barbers.display_name}"${p.barbers.active ? '' : ' (inativo)'}`
                      : 'Não atende'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={setRole.isPending && setRole.variables.user_id === p.id}
                    onClick={() => setRole.mutate({ user_id: p.id, role: next })}
                  >
                    {next === 'admin' ? 'Tornar dono' : 'Tornar barbeiro'}
                  </Button>
                  <Button size="sm" variant="ghost" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    Senha
                  </Button>
                </div>
              </div>
              {open === p.id ? (
                <div className="mt-4 border-t border-line pt-4">
                  <PasswordReset userId={p.id} />
                </div>
              ) : null}
            </Card>
          )
        })}
      </div>
    </section>
  )
}
