import { useSearchParams } from 'react-router'
import { DayAgenda } from '@/components/DayAgenda'
import { PushToggle } from '@/components/PushToggle'
import { Select } from '@/components/ui'
import { BarbersAdmin } from './BarbersAdmin'
import { LoyaltyAdmin } from './LoyaltyAdmin'
import { useAllBarbers } from './queries'
import { ServicesAdmin } from './ServicesAdmin'
import { SettingsAdmin } from './SettingsAdmin'

const TABS = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'servicos', label: 'Serviços' },
  { id: 'barbeiros', label: 'Barbeiros' },
  { id: 'fidelidade', label: 'Fidelidade' },
  { id: 'ajustes', label: 'Ajustes' },
] as const
type TabId = (typeof TABS)[number]['id']

export function AdminPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('aba')
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'agenda'

  return (
    <div className="space-y-6 py-2">
      <h1 className="text-4xl font-bold leading-none">Administração</h1>
      <nav aria-label="Seções" className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setParams({ aba: t.id }, { replace: true })}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-brass text-ink' : 'bg-surface-2 text-muted hover:text-cream'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'agenda' ? <AgendaTab /> : null}
      {tab === 'servicos' ? <ServicesAdmin /> : null}
      {tab === 'barbeiros' ? <BarbersAdmin /> : null}
      {tab === 'fidelidade' ? <LoyaltyAdmin /> : null}
      {tab === 'ajustes' ? <SettingsAdmin /> : null}
    </div>
  )
}

function AgendaTab() {
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
      <PushToggle />
    </div>
  )
}
