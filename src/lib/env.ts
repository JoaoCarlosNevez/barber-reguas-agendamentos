import { z } from 'zod'

const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_VAPID_PUBLIC_KEY: z.string().optional(),
})

const parsed = envSchema.safeParse(import.meta.env)

if (!parsed.success) {
  throw new Error(
    `Variáveis de ambiente inválidas. Veja .env.example.\n${z.prettifyError(parsed.error)}`,
  )
}

export const env = {
  supabaseUrl: parsed.data.VITE_SUPABASE_URL,
  supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
  functionsUrl: `${parsed.data.VITE_SUPABASE_URL}/functions/v1`,
  vapidPublicKey: parsed.data.VITE_VAPID_PUBLIC_KEY?.startsWith('cole-')
    ? undefined
    : parsed.data.VITE_VAPID_PUBLIC_KEY,
} as const

export const APP_TIMEZONE = 'America/Sao_Paulo'
