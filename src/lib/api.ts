import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface ApiErrorBody {
  code: string
  message: string
  details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ApiErrorBody['details'] | undefined

  constructor(status: number, code: string, message: string, details?: ApiErrorBody['details']) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Chama uma Edge Function. Com sessão ativa o supabase-js já envia o JWT do
 * usuário; sem sessão vai a anon key (visitante).
 */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (!error) return data as T

  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response
    let parsed: { error?: ApiErrorBody } | null = null
    try {
      parsed = (await res.json()) as { error?: ApiErrorBody }
    } catch {
      parsed = null
    }
    const e = parsed?.error
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? 'Algo deu errado.', e?.details)
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique sua internet.')
  }
  throw new ApiError(0, 'unknown', 'Algo deu errado. Tente novamente.')
}

/** Mensagem amigável para qualquer erro (API, Supabase ou JS). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return translateSupabaseError(err.message)
  }
  return 'Algo deu errado. Tente novamente.'
}

function translateSupabaseError(msg: string): string {
  const map: [RegExp, string][] = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/user already registered/i, 'Já existe uma conta com esse e-mail.'],
    [/email not confirmed/i, 'Confirme seu e-mail antes de entrar.'],
    [/password should be at least/i, 'A senha precisa ter pelo menos 8 caracteres.'],
    [/rate limit/i, 'Muitas tentativas. Aguarde um pouco.'],
    [/appointment_not_started/i, 'Só dá para marcar como atendido depois do horário de início.'],
    [/invalid_status_transition/i, 'Esse agendamento já foi finalizado.'],
    [/payment_required/i, 'Informe a forma de pagamento para concluir.'],
    [/payment_locked/i, 'Só o dono pode corrigir o pagamento de um atendimento concluído.'],
    [/appointments_no_overlap/i, 'Conflito com outro agendamento.'],
    [/failed to fetch|network/i, 'Sem conexão com o servidor.'],
    [/duplicate key/i, 'Esse registro já existe.'],
    [/violates check constraint/i, 'Valores inválidos. Confira os campos.'],
  ]
  for (const [re, text] of map) if (re.test(msg)) return text
  return msg
}
