import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { BarbersAdmin } from './BarbersAdmin'
import { CustomersAdmin } from './CustomersAdmin'
import { LoyaltyAdmin } from './LoyaltyAdmin'
import { RevenueDashboard } from './RevenueDashboard'
import { ServicesAdmin } from './ServicesAdmin'
import { SettingsAdmin } from './SettingsAdmin'

const MANAGE_TABS = {
  faturamento: { label: 'Faturamento', render: () => <RevenueDashboard /> },
  barbeiros: { label: 'Barbeiros', render: () => <BarbersAdmin /> },
  clientes: { label: 'Clientes', render: () => <CustomersAdmin /> },
  servicos: { label: 'Serviços', render: () => <ServicesAdmin /> },
  fidelidade: { label: 'Fidelidade', render: () => <LoyaltyAdmin /> },
  ajustes: { label: 'Ajustes', render: () => <SettingsAdmin /> },
} satisfies Record<string, { label: string; render: () => ReactNode }>

type ManageTabId = keyof typeof MANAGE_TABS
const TAB_IDS = Object.keys(MANAGE_TABS) as ManageTabId[]

/** Gestão da barbearia pelo app do dono (/app/gestao). */
export function ManageTabs() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('aba')
  const tab: ManageTabId = TAB_IDS.includes(raw as ManageTabId) ? (raw as ManageTabId) : 'faturamento'

  return (
    <div className="space-y-6">
      <nav aria-label="Seções" className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setParams({ aba: id }, { replace: true })}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              tab === id ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted hover:text-cream'
            }`}
          >
            {MANAGE_TABS[id].label}
          </button>
        ))}
      </nav>
      {MANAGE_TABS[tab].render()}
    </div>
  )
}
