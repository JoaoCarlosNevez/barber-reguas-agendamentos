import { callFunction } from './api'
import { supabase } from './supabase'

/**
 * Login do cliente sem senha (celular + nome). Se o celular ainda não tem
 * conta, ela é criada. Troca o token devolvido pela function por uma sessão.
 */
export async function signInCustomer(name: string, phone: string): Promise<{ created: boolean }> {
  const { token_hash, created } = await callFunction<{ token_hash: string; created: boolean }>('customer-login', {
    name,
    phone,
  })
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'email' })
  if (error) throw error
  return { created }
}
