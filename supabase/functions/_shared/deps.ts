// Dependências externas centralizadas (versões fixas).
import { z } from 'npm:zod@4.6.7'

// mensagens padrão de validação em português
z.config(z.locales.pt())

export { z }
export { createClient } from 'npm:@supabase/supabase-js@2.118.0'
export type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'

// @deno-types="npm:@types/web-push@3.6.4"
export { default as webpush } from 'npm:web-push@3.6.7'
