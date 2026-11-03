import { useState } from 'react'
import { Button, Card } from '@/components/ui'
import { useInstall } from '@/lib/install'

const KEY = 'install-banner-dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Convite para instalar o app da equipe na tela inicial. */
export function InstallBanner() {
  const { mode, install } = useInstall()
  const [hidden, setHidden] = useState(wasDismissed)

  if (hidden || mode === 'installed' || mode === 'unavailable') return null

  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // sem storage: só esconde nesta visita
    }
  }

  return (
    <Card className="mb-4 border-brass/60">
      <div className="flex items-start gap-3">
        <img src="/pwa-192.png" alt="" className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Instale o app na tela inicial</p>
          {mode === 'prompt' ? (
            <p className="text-sm text-muted">Abre direto na agenda e recebe os avisos de horário.</p>
          ) : (
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sm text-muted">
              <li>
                Toque em <strong className="text-cream">Compartilhar</strong>{' '}
                <span aria-hidden>(o quadrado com a seta ↑)</span>
              </li>
              <li>
                Escolha <strong className="text-cream">Adicionar à Tela de Início</strong>
              </li>
              <li>Abra o app pelo ícone para receber os avisos</li>
            </ol>
          )}
          <div className="mt-3 flex gap-2">
            {mode === 'prompt' ? (
              <Button size="sm" onClick={() => void install()}>
                Instalar app
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Agora não
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
