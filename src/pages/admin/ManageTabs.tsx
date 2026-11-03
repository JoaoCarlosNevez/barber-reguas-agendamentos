import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { DayAgenda } from '@/components/DayAgenda'
import { Select } from '@/components/ui'
import { AccountsAdmin } from './AccountsAdmin'
import { BarbersAdmin } from './BarbersAdmin'
import { LoyaltyAdmin } from './LoyaltyAdmin'
import { useAllBarbers } from './queries'
import { ServicesAdmin } from './ServicesAdmin'
import { SettingsAdmin } from './SettingsAdmin'

const MANAGE_TABS = {
  agenda: { label: 'Agenda', render: () => <AllAgendaTab /> },
  servicos: { label: 'Serviços', render: () => <ServicesAdmin /> },
  barbeiros: { label: 'Barbeiros', render: () => <BarbersAdmin /> },
  contas: { label: 'Contas', render: () => <AccountsAdmin /> },
  fidelidade: { label: 'Fidelidade', render: () => <LoyaltyAdmin /> },
  ajustes: { label: 'Ajustes', render: () => <SettingsAdmin /> },
} satisfies Record<string, { label: string; render: () => ReactNode }>

export type ManageTabId = keyof typeof MANAGE_TABS

/** Abas de gestão da barbearia (usadas no app do dono e no painel super admin). */
export function ManageTabs({ tabs, layout = 'pills' }: { tabs: readonly ManageTabId[]; layout?: 'pills' | 'side' }) {
  const [params, setParams] = useSearchParams()
  const raw = params.get('aba')
  const fallback = tabs[0] ?? 'servicos'
  const tab: ManageTabId = tabs.includes(raw as ManageTabId) ? (raw as ManageTabId) : fallback

  const nav = (
    <nav
      aria-label="Seções"
      className={
        layout === 'side'
          ? '-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0'
          : '-mx-4 flex gap-1 overflow-x-auto px-4'
      }
    >
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => setParams({ aba: id }, { replace: true })}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            layout === 'side' ? 'lg:rounded-lg lg:text-left' : ''
          } ${tab === id ? 'bg-brass text-ink' : 'bg-surface-2 text-muted hover:text-cream'}`}
        >
          {MANAGE_TABS[id].label}
        </button>
      ))}
    </nav>
  )

  if (layout === 'side') {
    return (
      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">{nav}</div>
        <div className="min-w-0 max-w-3xl">{MANAGE_TABS[tab].render()}</div>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      {nav}
      {MANAGE_TABS[tab].render()}
    </div>
  )
}

function AllAgendaTab() {
  const barbers = useAllBarbers()
  const [params, setParams] = useSearchParams()
  const barberId = params.get('barbeiro')

  return (
    <div className="space-y-4">
      <Select
        label="Barbeiro"
        value={barberId ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params)
          if (e.target.value) next.set('barbeiro', e.target.value)
          else next.delete('barbeiro')
          setParams(next, { replace: true })
        }}
      >
        <option value="">Todos</option>
        {barbers.data?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.display_name}
            {b.active ? '' : ' (inativo)'}
          </option>
        ))}
      </Select>
      <DayAgenda barberId={barberId} showBarber={!barberId} />
    </div>
  )
}
