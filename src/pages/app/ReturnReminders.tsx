import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNow } from '@/hooks/useNow'
import { Button, Card } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { APP_TIMEZONE } from '@/lib/env'
import { formatBrPhone } from '@/lib/shared'
import { supabase } from '@/lib/supabase'

const DAY_MS = 24 * 60 * 60 * 1000
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: APP_TIMEZONE })

function returnMessage(name: string, days: number): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return `Oi, ${first}! Aqui é do Studio Réguas ✂️ Já faz ${days} dias do seu último corte. Vamos agendar seu corte? É só escolher o horário: ${window.location.origin}/`
}

/**
 * "Chamar de volta": clientes cujo último corte foi há 20+ dias e que não
 * marcaram outro horário. Vem do lembrete de retorno (push ao barbeiro).
 * A RLS já limita: barbeiro vê os seus; dono vê todos.
 */
export function ReturnReminders({ barberId, focusId }: { barberId: string | null; focusId: string | null }) {
  const qc = useQueryClient()
  const focusRef = useRef<HTMLDivElement>(null)
  const now = useNow().getTime()

  const list = useQuery({
    queryKey: ['return-pending', barberId],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      let q = supabase
        .from('appointments')
        .select('id, starts_at, barber:barbers(display_name), customer:customers(name, phone)')
        .eq('return_pending', true)
        .order('starts_at')
      if (barberId) q = q.eq('barber_id', barberId)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('appointments').update({ return_pending: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['return-pending'] }),
  })

  useEffect(() => {
    if (focusId && list.data?.some((a) => a.id === focusId)) {
      focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [focusId, list.data])

  if (!list.data?.length) return null

  return (
    <section aria-labelledby="return-title" className="space-y-2">
      <h2 id="return-title" className="flex items-center gap-2 text-xl font-semibold">
        Chamar de volta
        <span className="rounded-full bg-blue/15 px-2 py-0.5 font-sans text-xs text-blue">{list.data.length}</span>
      </h2>
      <p className="text-sm text-muted">Último corte há 20 dias ou mais e nada marcado.</p>
      {list.data.map((a) => {
        const name = a.customer?.name ?? 'Cliente'
        const phone = a.customer?.phone ?? ''
        const days = Math.floor((now - new Date(a.starts_at).getTime()) / DAY_MS)
        const wa = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(returnMessage(name, days))}`
        const focused = a.id === focusId
        return (
          <div key={a.id} ref={focused ? focusRef : undefined}>
            <Card className={focused ? 'border-blue' : ''}>
              <p className="font-semibold">{name}</p>
              <p className="text-sm text-muted">
                Último corte {shortDate.format(new Date(a.starts_at))} · há {days} dias
                {barberId ? '' : ` · ${a.barber?.display_name ?? ''}`}
                {phone ? ` · ${formatBrPhone(phone)}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {phone ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => resolve.mutate(a.id)}
                    className="inline-flex items-center rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong"
                  >
                    Chamar no WhatsApp
                  </a>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => resolve.mutate(a.id)} disabled={resolve.isPending}>
                  Dispensar
                </Button>
              </div>
            </Card>
          </div>
        )
      })}
      {resolve.isError ? <p className="text-sm text-danger">{errorMessage(resolve.error)}</p> : null}
    </section>
  )
}
