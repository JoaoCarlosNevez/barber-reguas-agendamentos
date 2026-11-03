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
