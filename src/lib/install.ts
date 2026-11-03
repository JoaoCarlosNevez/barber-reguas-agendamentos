// Instalação do app da equipe (PWA).
// Android/Chrome: guarda o evento beforeinstallprompt para um botão "Instalar"
// abrir a janela nativa. iPhone: não existe API; mostramos o passo a passo.
import { useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

let capturing = false

/** Chamado no main.tsx: o evento pode disparar antes de qualquer componente montar. */
export function initInstallCapture() {
  if (capturing) return
  capturing = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    emit()
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'unavailable'

function snapshot(): InstallMode {
  if (installed || isStandalone()) return 'installed'
  if (deferred) return 'prompt'
  if (isIos()) return 'ios'
  return 'unavailable'
}

export function useInstall(): { mode: InstallMode; install: () => Promise<void> } {
  const mode = useSyncExternalStore(subscribe, snapshot)
  return {
    mode,
    install: async () => {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
      deferred = null
      emit()
    },
  }
}
