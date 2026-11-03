// Fluxos das Fases 3–6 contra o Supabase local (seed).
// Rodar: npm run test:integration (requer `supabase start` e `supabase functions serve`).
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { addDays, dateInTz, weekdayOf, zonedToUtc } from '../../supabase/functions/_shared/time.ts'
import type { Database } from '../../src/types/database.ts'

const SP = 'America/Sao_Paulo'
const RAFAEL = 'ba000000-0000-4000-8000-000000000001'
const CORTE = '5e000000-0000-4000-8000-000000000001'
const CLIENTE_USER = 'c0000000-0000-4000-8000-000000000001'
const PHONE_PREFIX = '+55119701' // telefones de teste deste arquivo: +55119701XXXXX
const BARBER_EMAIL = 'novo.barbeiro.teste@barbearia.dev'

const apiUrl = inject('apiUrl')
const anonKey = inject('anonKey')
const admin = createClient<Database>(apiUrl, inject('serviceRoleKey'), { auth: { persistSession: false } })

const createdAppointments: string[] = []
const createdRedemptions: string[] = []

async function tokenFor(email: string): Promise<string> {
  const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'Senha@123' })
  if (error) throw error
  return data.session.access_token
}

async function callFn(name: string, body: unknown, jwt?: string) {
  const res = await fetch(`${apiUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: anonKey,
      authorization: `Bearer ${jwt ?? anonKey}`,
      origin: 'http://localhost:5173',
    },
    body: JSON.stringify(body),
  })
  // oxlint-disable-next-line typescript/no-explicit-any -- corpo JSON livre nos asserts
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

/** Dia útil a ≥ 4 dias de hoje (fora da janela de cancelamento). */
function futureDate(offset: number): string {
  let d = addDays(dateInTz(new Date(), SP), offset)
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, 1)
  return d
}

async function firstSlot(date: string, barber = RAFAEL): Promise<string> {
  const r = await callFn('get-availability', { barber_id: barber, service_ids: [CORTE], date })
  expect(r.status).toBe(200)
  const slot = r.body.slots[0]?.starts_at as string | undefined
  if (!slot) throw new Error(`sem horários em ${date}`)
  return slot
}

async function cleanup() {
  const { data: customers } = await admin.from('customers').select('id').like('phone', `${PHONE_PREFIX}%`)
  const ids = (customers ?? []).map((c) => c.id)
  if (ids.length) {
    await admin.from('appointments').delete().in('customer_id', ids)
    await admin.from('customers').delete().in('id', ids)
  }
  if (createdRedemptions.length) await admin.from('loyalty_redemptions').delete().in('id', createdRedemptions)
  if (createdAppointments.length) await admin.from('appointments').delete().in('id', createdAppointments)
  const { data: users } = await admin.auth.admin.listUsers()
  for (const u of users.users.filter((x) => x.email === BARBER_EMAIL)) await admin.auth.admin.deleteUser(u.id)
  await admin.from('push_subscriptions').delete().like('endpoint', 'https://push.example.test/%')
}

beforeAll(cleanup)
afterAll(cleanup)
beforeEach(() => {
  execSync('docker exec supabase_db_agendareguas psql -U postgres -c "truncate private.rate_limits"', {
    stdio: 'ignore',
  })
})

describe('visitante: link do agendamento', () => {
  it('cria, consulta pelo token e cancela; segundo cancelamento é recusado', async () => {
    const startsAt = await firstSlot(futureDate(5))
    const created = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: startsAt,
      customer: { name: 'Visitante Teste', phone: `${PHONE_PREFIX}00001` },
    })
    expect(created.status).toBe(201)
    const token = created.body.token as string
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/)

    const got = await callFn('get-appointment', { token })
    expect(got.status).toBe(200)
    expect(got.body.appointment).toMatchObject({
      status: 'scheduled',
      starts_at: startsAt,
      can_cancel: true,
      total_price_cents: 4500,
      barber: { display_name: 'Rafael' },
    })

    const cancelled = await callFn('cancel-appointment', { token })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.appointment).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', can_cancel: false })

    // horário volta a ficar livre
    const again = await callFn('get-availability', { barber_id: RAFAEL, service_ids: [CORTE], date: futureDate(5) })
    expect(again.body.slots.some((s: { starts_at: string }) => s.starts_at === startsAt)).toBe(true)

    const twice = await callFn('cancel-appointment', { token })
    expect(twice.status).toBe(409)
    expect(twice.body.error.code).toBe('invalid_state')
  })

  it('token inexistente ou malformado', async () => {
    expect((await callFn('get-appointment', { token: 'A'.repeat(22) })).status).toBe(404)
    expect((await callFn('get-appointment', { token: 'curto' })).status).toBe(422)
  })

  it('não cancela dentro da antecedência mínima', async () => {
    const token = 'B'.repeat(22)
    const hash = execSync(`printf %s ${token} | shasum -a 256`, { encoding: 'utf8' }).split(' ')[0] ?? ''
    // daqui ~1h: dentro das 2h em que o cancelamento online fica fechado
    const startsAt = new Date(Math.ceil((Date.now() + 60 * 60_000) / 60_000) * 60_000 + 7_000)
    const { data, error } = await admin.rpc('book_appointment', {
      p_barber_id: RAFAEL,
      p_starts_at: startsAt.toISOString(),
      p_service_ids: [CORTE],
      p_cancel_token_hash: hash,
      p_customer_name: 'Visitante Atrasado',
      p_customer_phone: `${PHONE_PREFIX}00002`,
    })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)

    const r = await callFn('cancel-appointment', { token })
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('cancel_too_late')
  })
})

describe('cliente logado', () => {
  it('agendamento conta para fidelidade e só o dono cancela pelo id', async () => {
    const cliente = await tokenFor('cliente@barbearia.dev')
    const rafael = await tokenFor('rafael@barbearia.dev')
    const startsAt = await firstSlot(futureDate(6))

    const created = await callFn(
      'create-appointment',
      { barber_id: RAFAEL, service_ids: [CORTE], starts_at: startsAt, customer: { name: 'João Cliente', phone: '+5511988887777' } },
      cliente,
    )
    expect(created.status).toBe(201)
    expect(created.body.appointment.loyalty_eligible).toBe(true)
    const id = created.body.appointment.id as string
    createdAppointments.push(id)

    expect((await callFn('cancel-appointment', { appointment_id: id })).status).toBe(401)
    expect((await callFn('cancel-appointment', { appointment_id: id }, rafael)).status).toBe(404)

    const ok = await callFn('cancel-appointment', { appointment_id: id }, cliente)
    expect(ok.status).toBe(200)
    expect(ok.body.appointment.status).toBe('cancelled')
  })
})

describe('redeem-loyalty', () => {
  it('exige barbeiro/admin e selos suficientes; consome os selos', async () => {
    const cliente = await tokenFor('cliente@barbearia.dev')
    const rafael = await tokenFor('rafael@barbearia.dev')
    const { data: customer } = await admin.from('customers').select('id').eq('auth_user_id', CLIENTE_USER).single()
    const customerId = customer?.id ?? ''

    expect((await callFn('redeem-loyalty', { customer_id: customerId })).status).toBe(401)
    expect((await callFn('redeem-loyalty', { customer_id: customerId }, cliente)).status).toBe(403)

    // zera selos livres anteriores para o teste ser determinístico
    const { count: before } = await admin
      .from('loyalty_stamps')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .is('redemption_id', null)
    if ((before ?? 0) >= 10) {
      const r = await callFn('redeem-loyalty', { customer_id: customerId }, rafael)
      if (r.status === 200) createdRedemptions.push(r.body.redemption.id)
    }

    const insufficient = await callFn('redeem-loyalty', { customer_id: customerId }, rafael)
    expect([403, 409]).toContain(insufficient.status)

    // 10 atendimentos concluídos no passado (com o Rafael) -> 10 selos via trigger
    const base = zonedToUtc(addDays(dateInTz(new Date(), SP), -40), 8 * 60, SP).getTime()
    for (let i = 0; i < 10; i++) {
      const hash = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
      const { data, error } = await admin.rpc('book_appointment', {
        p_barber_id: RAFAEL,
        p_starts_at: new Date(base + i * 86_400_000).toISOString(),
        p_service_ids: [CORTE],
        p_cancel_token_hash: hash,
        p_customer_name: 'João Cliente',
        p_customer_phone: '+5511988887777',
        p_auth_user_id: CLIENTE_USER,
      })
      expect(error).toBeNull()
      const apptId = data?.[0]?.appointment_id ?? ''
      createdAppointments.push(apptId)
      const { error: upErr } = await admin.from('appointments').update({ status: 'completed' }).eq('id', apptId)
      expect(upErr).toBeNull()
    }

    const ok = await callFn('redeem-loyalty', { customer_id: customerId }, rafael)
    expect(ok.status).toBe(200)
    expect(ok.body.redemption).toMatchObject({ stamps_used: 10, customer_id: customerId })
    createdRedemptions.push(ok.body.redemption.id)

    const again = await callFn('redeem-loyalty', { customer_id: customerId }, rafael)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('insufficient_stamps')
  })
})

describe('admin-create-barber', () => {
  it('só admin cria; e-mail repetido dá conflito; barbeiro nasce com expediente e serviços', async () => {
    const cliente = await tokenFor('cliente@barbearia.dev')
    const adm = await tokenFor('admin@barbearia.dev')
    const body = { name: 'Novo Teste', email: BARBER_EMAIL, password: 'Senha@123', service_ids: [CORTE] }

    expect((await callFn('admin-create-barber', body)).status).toBe(401)
    expect((await callFn('admin-create-barber', body, cliente)).status).toBe(403)

    const ok = await callFn('admin-create-barber', body, adm)
    expect(ok.status).toBe(201)
    const barberId = ok.body.barber_id as string

    const [{ data: profile }, { count: hours }, { count: services }] = await Promise.all([
      admin.from('barbers').select('profiles(role)').eq('id', barberId).single(),
      admin.from('working_hours').select('id', { count: 'exact', head: true }).eq('barber_id', barberId),
      admin.from('barber_services').select('service_id', { count: 'exact', head: true }).eq('barber_id', barberId),
    ])
    expect(profile?.profiles?.role).toBe('barber')
    expect(hours).toBe(6)
    expect(services).toBe(1)

    // novo barbeiro consegue entrar
    await expect(tokenFor(BARBER_EMAIL)).resolves.toBeTruthy()

    const dup = await callFn('admin-create-barber', body, adm)
    expect(dup.status).toBe(409)
  })
})

describe('push', () => {
  it('só barbeiro/admin assina; teste não quebra com endpoint inválido', async () => {
    const cliente = await tokenFor('cliente@barbearia.dev')
    const rafael = await tokenFor('rafael@barbearia.dev')
    const subscription = {
      endpoint: 'https://push.example.test/sub/1',
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    }

    expect((await callFn('push', { action: 'subscribe', subscription }, cliente)).status).toBe(403)
    const ok = await callFn('push', { action: 'subscribe', subscription }, rafael)
    expect(ok.status).toBe(200)

    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('endpoint', subscription.endpoint)
    expect(count).toBe(1)

    const t = await callFn('push', { action: 'test' }, rafael)
    expect(t.status).toBe(200)
    expect(t.body.delivered).toBe(0)
  })
})
