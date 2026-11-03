import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Catálogo público (anon pode ler). Barbeiros: só colunas públicas. */
export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [services, barbers, links, settings, rule] = await Promise.all([
        supabase
          .from('services')
          .select('id, name, duration_min, price_cents')
          .eq('active', true)
          .order('name'),
        supabase.from('barbers').select('id, display_name, photo_url').eq('active', true).order('display_name'),
        supabase.from('barber_services').select('barber_id, service_id'),
        supabase.from('app_settings').select('*').single(),
        supabase.from('loyalty_rules').select('stamps_required, reward_description').eq('active', true).maybeSingle(),
      ])
      for (const r of [services, barbers, links, settings, rule]) if (r.error) throw r.error
      if (!settings.data) throw new Error('Configurações da barbearia não encontradas.')
      return {
        services: services.data ?? [],
        barbers: barbers.data ?? [],
        links: links.data ?? [],
        settings: settings.data,
        loyaltyRule: rule.data,
      }
    },
  })
}

export type Catalog = NonNullable<ReturnType<typeof useCatalog>['data']>
