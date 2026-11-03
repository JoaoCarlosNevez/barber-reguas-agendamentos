import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AuthProvider } from '@/lib/AuthProvider'
import { initInstallCapture } from '@/lib/install'
import { syncPwaScope } from '@/lib/pwaScope'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/router'
import './index.css'

// Quando um service worker novo assume (deploy novo), recarrega uma vez para
// não ficar rodando a versão antiga guardada em cache.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}

initInstallCapture()
syncPwaScope(router.state.location.pathname)
router.subscribe((state) => syncPwaScope(state.location.pathname))

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root não encontrado')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
