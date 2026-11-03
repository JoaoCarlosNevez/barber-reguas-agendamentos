import { ManageTabs } from '@/pages/admin/ManageTabs'

/** Gestão da barbearia pelo app (dono). */
export function AppManagePage() {
  return (
    <div className="space-y-6 py-2">
      <h1 className="text-4xl font-bold leading-none">Gestão</h1>
      <ManageTabs tabs={['barbeiros', 'servicos', 'fidelidade', 'ajustes']} />
    </div>
  )
}
