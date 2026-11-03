// Token de agendamento, hash, rate limit e anti-bot.
import { AppError } from './http.ts'
import { log } from './log.ts'
import type { AdminClient } from './supabase.ts'

const encoder = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** Token aleatório de 128 bits (base64url, 22 chars) + hash para o banco. */
export async function newAppointmentToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const token = toBase64Url(bytes)
  return { token, hash: await sha256Hex(token) }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return (
    req.headers.get('cf-connecting-ip') ??
    fwd?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

interface Limit {
  /** identificador em claro (IP/telefone) — vira hash antes de ir ao banco */
  subject: string
  scope: string
  windowSeconds: number
  max: number
}

/** Aplica todos os limites; lança 429 no primeiro estourado. */
export async function enforceRateLimits(db: AdminClient, fn: string, limits: Limit[]): Promise<void> {
  const salt = Deno.env.get('RATE_LIMIT_SALT') ?? 'agendareguas'
  for (const l of limits) {
    const key = `${fn}:${l.scope}:${await sha256Hex(`${salt}:${l.subject}`)}`
    const { data, error } = await db.rpc('rate_limit_hit', {
      p_key: key,
      p_window_seconds: l.windowSeconds,
      p_max: l.max,
    })
    if (error) {
      // falha no rate limit não derruba o fluxo, mas fica registrada
      log.warn(fn, 'rate_limit_check_failed', { scope: l.scope })
      continue
    }
    if (data === false) {
      log.warn(fn, 'rate_limited', { scope: l.scope })
      throw new AppError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos e tente de novo.')
    }
  }
}

/** Cloudflare Turnstile — só é exigido se TURNSTILE_SECRET_KEY estiver definido. */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) return
  if (!token) throw new AppError(400, 'bot_detected', 'Confirme que você não é um robô.')

  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip !== 'unknown') body.append('remoteip', ip)

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  })
  const data = (await res.json()) as { success?: boolean }
  if (!data.success) throw new AppError(400, 'bot_detected', 'Verificação anti-robô falhou. Tente de novo.')
}
