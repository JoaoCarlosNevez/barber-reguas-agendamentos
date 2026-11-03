import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        // Só o app da equipe é instalável (o agendamento é web mobile).
        id: '/app/',
        name: 'Studio Réguas · Equipe',
        short_name: 'Studio Réguas',
        description: 'Agenda e gestão do Studio Réguas.',
        lang: 'pt-BR',
        theme_color: '#0c0d10',
        background_color: '#0c0d10',
        display: 'standalone',
        start_url: '/app/',
        scope: '/app/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], globIgnores: ['**/brand/logo-original.png'] },
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
    }),
  ],
  resolve: { tsconfigPaths: true },
  server: { port: 5173 },
})
