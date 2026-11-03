// Concorrência do anti-overbooking contra o Supabase local.
// Rodar: npm run test:integration (requer `supabase start` e `supabase functions serve`).
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { addDays, dateInTz, weekdayOf, zonedToUtc } from '../../supabase/functions/_shared/time.ts'
import type { Database } from '../../src/types/database.ts'

const SP = 'America/Sao_Paulo'
const RAFAEL = 'ba000000-0000-4000-8000-000000000001'
const LUCAS = 'ba000000-0000-4000-8000-000000000002'
const CORTE = '5e000000-0000-4000-8000-000000000001'
const BARBA = '5e000000-0000-4000-8000-000000000002'
const PHONE_PREFIX = '+55119700' // telefones de teste: +55119700XXXXX

const apiUrl = inject('apiUrl')
const anonKey = inject('anonKey')
const admin = createClient<Database>(apiUrl, inject('serviceRoleKey'), {
  auth: { persistSession: false },
})

/** Próximo dia útil (seg–sex) a pelo menos 3 dias de hoje em SP. */
function testDate(): string {
  let d = addDays(dateInTz(new Date(), SP), 3)
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, 1)
  return d
}

const phone = (n: number) => `${PHONE_PREFIX}${String(n).padStart(5, '0')}`
const randomHash = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')

async function cleanup() {
  const { data: customers } = await admin
    .from('customers')
    .select('id')
    .like('phone', `${PHONE_PREFIX}%`)
  const ids = (customers ?? []).map((c) => c.id)
  if (ids.length === 0) return
  await admin.from('appointments').delete().in('customer_id', ids)
  await admin.from('customers').delete().in('id', ids)
}

async function callFn(name: string, body: unknown) {
  const res = await fetch(`${apiUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      origin: 'http://localhost:5173',
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

function resetRateLimits() {
  execSync('docker exec supabase_db_agendareguas psql -U postgres -c "truncate private.rate_limits"', {
    stdio: 'ignore',
  })
}

const DATE = testDate()

beforeAll(cleanup)
afterAll(cleanup)

describe('anti-overbooking no banco (constraint EXCLUDE)', () => {
  it('6 rodadas × 20 reservas simultâneas: sempre exatamente 1 vence, sem deadlock', async () => {
    // rodada 0: Rafael 15:00 (usado nos testes seguintes); demais: Lucas à tarde
    const rounds: Array<{ barber: string; minutes: number }> = [
      { barber: RAFAEL, minutes: 15 * 60 },
      ...[17, 17.5, 18, 18.5, 13.5].map((h) => ({ barber: LUCAS, minutes: h * 60 })),
    ]

    for (const [r, round] of rounds.entries()) {
      const startsAt = zonedToUtc(DATE, round.minutes, SP).toISOString()
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          admin.rpc('book_appointment', {
            p_barber_id: round.barber,
            p_starts_at: startsAt,
            p_service_ids: [CORTE],
            p_cancel_token_hash: randomHash(),
            p_customer_name: `Teste ${r}-${i}`,
            p_customer_phone: phone(1000 + r * 100 + i),
          }),
        ),
      )

      const codes = results.map((res) => res.error?.code ?? 'ok')
      expect(codes.filter((c) => c === 'ok')).toHaveLength(1)
      expect(codes.filter((c) => c === '23P01')).toHaveLength(19) // nenhum deadlock/timeout
    }
  })

  it('horário que se sobrepõe parcialmente também é rejeitado', async () => {
    // Corte+Barba (60 min) às 14:45 invadiria o 15:00 já reservado
    const { error } = await admin.rpc('book_appointment', {
      p_barber_id: RAFAEL,
      p_starts_at: zonedToUtc(DATE, 14 * 60 + 45, SP).toISOString(),
      p_service_ids: [CORTE, BARBA],
      p_cancel_token_hash: randomHash(),
      p_customer_name: 'Teste parcial',
      p_customer_phone: phone(100),
    })
    expect(error?.code).toBe('23P01')
  })
})

describe('Edge Functions (fluxo HTTP completo)', () => {
  beforeEach(resetRateLimits)

  it('get-availability lista o horário e create-appointment aceita só 1 de 10 simultâneos', async () => {
    const av = await callFn('get-availability', {
      barber_id: RAFAEL,
      service_ids: [CORTE, BARBA],
      date: DATE,
    })
    expect(av.status).toBe(200)
    expect(av.body.duration_min).toBe(60)
    expect(av.body.total_price_cents).toBe(8000)

    const slots = av.body.slots as { starts_at: string; time: string }[]
    expect(slots.map((s) => s.time)).not.toContain('15:00') // ocupado no teste anterior
    expect(slots.map((s) => s.time)).not.toContain('11:30') // 60 min invadiria o almoço
    const target = slots.find((s) => s.time === '16:00')
    expect(target).toBeDefined()

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        callFn('create-appointment', {
          barber_id: RAFAEL,
          service_ids: [CORTE, BARBA],
          starts_at: target?.starts_at,
          customer: { name: `Cliente ${i}`, phone: `(11) 9700${String(200 + i).padStart(5, '0')}` }, // com máscara
          website: '',
        }),
      ),
    )

    const created = responses.filter((r) => r.status === 201)
    const conflicts = responses.filter((r) => r.status === 409)
    expect(created).toHaveLength(1)
    expect(conflicts).toHaveLength(9)
    for (const c of conflicts) {
      expect((c.body.error as { code: string }).code).toBe('slot_unavailable')
    }

    // token em claro só na resposta; no banco, apenas o hash
    const createdBody = created[0]?.body as { token: string; appointment: { id: string; ends_at: string } }
    expect(createdBody.token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(createdBody.appointment.ends_at).toBe(
      new Date(new Date(target?.starts_at ?? '').getTime() + 60 * 60_000).toISOString(),
    )
    const { data: row } = await admin
      .from('appointments')
      .select('cancel_token_hash')
      .eq('id', createdBody.appointment.id)
      .single()
    expect(row?.cancel_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.cancel_token_hash).not.toContain(createdBody.token)

    // horário some da disponibilidade
    const after = await callFn('get-availability', {
      barber_id: RAFAEL,
      service_ids: [CORTE, BARBA],
      date: DATE,
    })
    expect((after.body.slots as { time: string }[]).map((s) => s.time)).not.toContain('16:00')
  })

  it('"qualquer disponível" cai no outro barbeiro quando um está ocupado', async () => {
    const av = await callFn('get-availability', { barber_id: 'any', service_ids: [CORTE], date: DATE })
    const slot = (av.body.slots as { time: string; starts_at: string; barber_ids: string[] }[]).find(
      (s) => s.time === '15:00',
    )
    // Rafael está ocupado às 15:00; Lucas não
    expect(slot?.barber_ids).not.toContain(RAFAEL)
    expect(slot?.barber_ids).toHaveLength(1)

    const res = await callFn('create-appointment', {
      barber_id: 'any',
      service_ids: [CORTE],
      starts_at: slot?.starts_at,
      customer: { name: 'Cliente Any', phone: phone(300) },
    })
    expect(res.status).toBe(201)
    expect((res.body.appointment as { barber: { id: string } }).barber.id).not.toBe(RAFAEL)
  })

  it('rejeita horário fora da grade, honeypot e telefone inválido', async () => {
    const offGrid = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: zonedToUtc(DATE, 10 * 60 + 7, SP).toISOString(),
      customer: { name: 'Fora da grade', phone: phone(400) },
    })
    expect(offGrid.status).toBe(409)

    const bot = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: zonedToUtc(DATE, 10 * 60, SP).toISOString(),
      customer: { name: 'Robô', phone: phone(401) },
      website: 'http://spam.example',
    })
    expect(bot.status).toBe(400)
    expect((bot.body.error as { code: string }).code).toBe('bot_detected')

    const badPhone = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: zonedToUtc(DATE, 10 * 60, SP).toISOString(),
      customer: { name: 'Telefone ruim', phone: '1234' },
    })
    expect(badPhone.status).toBe(422)
  })

  it('rate limit por IP: a 11ª tentativa em 10 min recebe 429', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const r = await callFn('create-appointment', {
        barber_id: RAFAEL,
        service_ids: [CORTE],
        starts_at: zonedToUtc(DATE, 10 * 60 + 7, SP).toISOString(), // fora da grade => 409 barato
        customer: { name: 'Rate limit', phone: phone(500 + i) },
      })
      statuses.push(r.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('bloqueia origem fora do CORS', async () => {
    const res = await fetch(`${apiUrl}/functions/v1/get-availability`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: anonKey, origin: 'https://evil.example' },
      body: JSON.stringify({ barber_id: 'any', service_ids: [CORTE], date: DATE }),
    })
    expect(res.status).toBe(403)
  })
})
