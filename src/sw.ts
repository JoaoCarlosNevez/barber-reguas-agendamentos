/// <reference lib="webworker" />
// Service worker (vite-plugin-pwa, estratégia injectManifest): precache do app
// e recebimento de Web Push.
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  type PrecacheEntry,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] }

// oxlint-disable-next-line no-underscore-dangle -- nome exigido pelo Workbox
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA: navegações caem no index.html (exceto rotas do Supabase)
if (import.meta.env.PROD) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))
}

void self.skipWaiting()
clientsClaim()

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  actions?: { action: string; title: string; url: string }[]
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    data = (event.data?.json() ?? {}) as PushPayload
  } catch {
    data = { body: event.data?.text() ?? '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Studio Réguas', {
      body: data.body ?? '',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      tag: data.tag,
      data: { url: data.url ?? '/app/', actions: data.actions ?? [] },
      ...(data.actions?.length
        ? { actions: data.actions.map((a) => ({ action: a.action, title: a.title })) }
        : {}),
    } as NotificationOptions),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: string; actions?: { action: string; url: string }[] } | null
  // botão da notificação (ex.: "Chamar no WhatsApp") abre o link direto
  const actionUrl = event.action ? data?.actions?.find((a) => a.action === event.action)?.url : undefined
  if (actionUrl) {
    event.waitUntil(self.clients.openWindow(actionUrl))
    return
  }
  const url = data?.url ?? '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of all) {
        if ('focus' in c) {
          await c.focus()
          if ('navigate' in c) await c.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
