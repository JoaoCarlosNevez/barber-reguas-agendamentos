// HTTP: CORS restrito, respostas JSON padronizadas e tratamento de erros.
import { z } from './deps.ts'
import { log } from './log.ts'

export type ErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'bot_detected'
  | 'slot_unavailable'
  | 'invalid_services'
  | 'date_out_of_range'
  | 'cancel_too_late'
  | 'invalid_state'
  | 'insufficient_stamps'
  | 'conflict'
  | 'push_not_configured'
  | 'internal_error'

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

function allowedOrigins(): string[] {
  const raw = Deno.env.get('APP_ORIGINS')
  if (!raw) return DEFAULT_ORIGINS
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function errorResponse(req: Request, err: AppError): Response {
  const body: { error: { code: ErrorCode; message: string; details?: unknown } } = {
    error: { code: err.code, message: err.message },
  }
  if (err.details !== undefined) body.error.details = err.details
  return json(req, body, err.status)
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new AppError(400, 'bad_request', 'Corpo da requisição deve ser JSON.')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError(422, 'validation_error', 'Dados inválidos.', z.flattenError(parsed.error))
  }
  return parsed.data
}

type Handler = (req: Request) => Promise<Response>

/**
 * Envolve o handler com: preflight CORS, bloqueio de origem não permitida,
 * método POST e conversão de exceções em JSON padronizado.
 */
export function serve(fn: string, handler: Handler): void {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) })
    }

    const origin = req.headers.get('origin')
    if (origin && !allowedOrigins().includes(origin)) {
      return errorResponse(req, new AppError(403, 'forbidden', 'Origem não permitida.'))
    }

    if (req.method !== 'POST') {
      return errorResponse(req, new AppError(405, 'method_not_allowed', 'Use POST.'))
    }

    try {
      return await handler(req)
    } catch (err) {
      if (err instanceof AppError) {
        if (err.status >= 500) log.error(fn, err.code)
        return errorResponse(req, err)
      }
      log.error(fn, 'unhandled', { name: err instanceof Error ? err.name : typeof err })
      return errorResponse(
        req,
        new AppError(500, 'internal_error', 'Erro inesperado. Tente novamente em instantes.'),
      )
    }
  })
}
