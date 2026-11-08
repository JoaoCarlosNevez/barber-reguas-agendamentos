import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useAllBarbers() {
  return useQuery({
    queryKey: ['admin', 'barbers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('barbers')
        .select('id, display_name, active, profile_id, barber_services(service_id)')
        .order('display_name')
      if (error) throw error
      return data
    },
  })
}

export type BarberRow = NonNullable<ReturnType<typeof useAllBarbers>['data']>[number]

export function useAdminServices() {
  return useQuery({
    queryKey: ['admin', 'services'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('active', { ascending: false })
        .order('name')
      if (error) throw error
      return data
    },
  })
}

export function useSubscriptionPlans() {
  return useQuery({
    queryKey: ['admin', 'subscription_plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('id, name, price_cents, cuts_per_month, active, subscription_plan_services(service_id)')
        .order('active', { ascending: false })
        .order('price_cents')
      if (error) throw error
      return data
    },
  })
}
