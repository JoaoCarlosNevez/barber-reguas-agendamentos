import { useQuery } from '@tanstack/react-query'
import { useAuth } from './auth'
import { type Enums, supabase } from './supabase'

export interface SubscriptionRow {
  id: string
  plan_name: string
  cuts_included: number
  starts_on: string
  ends_on: string
  price_cents: number
  payment_method: Enums<'payment_method'> | null
  paid_at: string | null
}

/** Assinatura que vale hoje (ou null). */
export function currentSubscription<T extends { starts_on: string; ends_on: string }>(subs: T[], today: string) {
  return subs.find((s) => s.starts_on <= today && today < s.ends_on) ?? null
}


/**
 * Assinaturas do cliente logado (só role customer), com cortes usados.
 * Usada na área do cliente e no resumo do agendamento.
 */
export function useMySubscriptions(enabled: boolean) {
  const { session } = useAuth()
  const uid = session?.user.id ?? ''
  return useQuery({
    queryKey: ['my-subscriptions', uid],
    enabled: enabled && uid !== '',
    queryFn: async () => {
      const { data: me, error: meErr } = await supabase.from('customers').select('id').eq('auth_user_id', uid).maybeSingle()
      if (meErr) throw meErr
      if (!me) return []
      const { data: subs, error } = await supabase
        .from('customer_subscriptions')
        .select('id, plan_name, cuts_included, covered_service_ids, starts_on, ends_on')
        .eq('customer_id', me.id)
        .order('starts_on')
      if (error) throw error
      if (!subs.length) return []
      const { data: usage, error: uErr } = await supabase.rpc('subscription_usage', { p_ids: subs.map((s) => s.id) })
      if (uErr) throw uErr
      const used = new Map(usage.map((u) => [u.subscription_id, u.used]))
      return subs.map((s) => ({ ...s, used: used.get(s.id) ?? 0 }))
    },
  })
}

/** "2026-12-10" (exclusivo) -> "09/12" */
export function subscriptionLastDay(endsOn: string): string {
  const [y = 0, m = 1, d = 1] = endsOn.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d - 1)),
  )
}
