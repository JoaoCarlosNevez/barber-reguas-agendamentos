import { useCallback, useEffect, useState } from 'react'
import { callFunction } from './api'
import { env } from './env'
import { supabase } from './supabase'
import { isIos, isStandalone } from './install'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on' | 'loading'

async function detectPushState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (!env.vapidPublicKey) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/** Ativa/desativa Web Push neste aparelho para o usuário logado (barbeiro/admin). */
export function usePush() {
  const [state, setState] = useState<PushState>('loading')

  useEffect(() => {
    let alive = true
    void detectPushState().then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [])

  const enable = useCallback(async () => {
    if (!env.vapidPublicKey) throw new Error('Chave VAPID não configurada.')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setState(permission === 'denied' ? 'denied' : 'off')
      return
    }
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey),
      }))
    await callFunction('push', { action: 'subscribe', subscription: sub.toJSON() })
    setState('on')
  }, [])

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
    setState('off')
  }, [])

  const test = useCallback(() => callFunction<{ delivered: number }>('push', { action: 'test' }), [])

  return { state, enable, disable, test }
}
