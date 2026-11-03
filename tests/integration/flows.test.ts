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
const OWNER_EMAIL = 'novo.dono.teste@barbearia.dev'
const SUPER_USER = 'a0000000-0000-4000-8000-000000000000'
const CLIENTE_EMAIL = 'cliente@barbearia.dev'

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
  const isTestUser = (email?: string) =>
    email === BARBER_EMAIL || email === OWNER_EMAIL || (email ?? '').startsWith(`cliente${PHONE_PREFIX.slice(1)}`)
  for (const u of users.users.filter((x) => isTestUser(x.email))) {
    await admin.auth.admin.deleteUser(u.id)
  }
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

describe('admin-set-password', () => {
  it('só admin troca; a senha nova passa a valer', async () => {
    const adm = await tokenFor('admin@barbearia.dev')
    const rafael = await tokenFor('rafael@barbearia.dev')
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const target = users.users.find((u) => u.email === BARBER_EMAIL)
    if (!target) throw new Error('barbeiro de teste não encontrado')
    const body = { user_id: target.id, password: 'Trocada@456' }

    expect((await callFn('admin-set-password', body)).status).toBe(401)
    expect((await callFn('admin-set-password', body, rafael)).status).toBe(403)
    expect((await callFn('admin-set-password', { ...body, password: 'curta' }, adm)).status).toBe(422)

    const ok = await callFn('admin-set-password', body, adm)
    expect(ok.status).toBe(200)

    const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
    const login = await c.auth.signInWithPassword({ email: BARBER_EMAIL, password: 'Trocada@456' })
    expect(login.error).toBeNull()
  })
})

describe('customer-login (celular + nome, sem senha)', () => {
  const verify = async (tokenHash: string) => {
    const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
    const { data, error } = await c.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
    expect(error).toBeNull()
    return { c, userId: data.user?.id ?? '' }
  }

  it('celular novo cria a conta; de novo entra; nome errado é recusado', async () => {
    const phone = `${PHONE_PREFIX}00101`
    const first = await callFn('customer-login', { name: 'Ana Teste', phone })
    expect(first.status).toBe(200)
    expect(first.body.created).toBe(true)
    const { c, userId } = await verify(first.body.token_hash as string)

    const { data: me } = await c.from('customers').select('name, phone, is_guest').eq('auth_user_id', userId).single()
    expect(me).toMatchObject({ phone, is_guest: false })

    const again = await callFn('customer-login', { name: 'ana', phone: phone.replace('+55', '') })
    expect(again.status).toBe(200)
    expect(again.body.created).toBe(false)
    expect((await verify(again.body.token_hash as string)).userId).toBe(userId)

    const wrong = await callFn('customer-login', { name: 'Bruno', phone })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('name_mismatch')

    expect((await callFn('customer-login', { name: 'Ana', phone: '123' })).status).toBe(422)
  })

  it('cliente antigo (cadastro por e-mail) entra pelo celular; visitante vira conta com histórico', async () => {
    const seeded = await callFn('customer-login', { name: 'João', phone: '(11) 98888-7777' })
    expect(seeded.status).toBe(200)
    expect((await verify(seeded.body.token_hash as string)).userId).toBe(CLIENTE_USER)

    // agenda como visitante e depois entra com o mesmo celular
    const phone = `${PHONE_PREFIX}00102`
    const slot = await firstSlot(futureDate(5))
    const booked = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: slot,
      customer: { name: 'Carla Visitante', phone },
    })
    expect(booked.status).toBe(201)

    const login = await callFn('customer-login', { name: 'Carla', phone })
    expect(login.body.created).toBe(true)
    const { c, userId } = await verify(login.body.token_hash as string)
    const { data: mine } = await c.from('customers').select('id').eq('auth_user_id', userId).single()
    const { count } = await admin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', mine?.id ?? '')
    expect(count).toBe(1)
    const { count: guests } = await admin
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone)
      .eq('is_guest', true)
    expect(guests).toBe(0)
  })
})

describe('create-appointment com login na mesma chamada', () => {
  it('visitante já sai logado e com o comprovante completo; nome errado agenda sem sessão', async () => {
    const phone = `${PHONE_PREFIX}00402`
    const slot = await firstSlot(futureDate(7))
    const r = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: slot,
      customer: { name: 'Diego Novo', phone },
      login: true,
    })
    expect(r.status).toBe(201)
    createdAppointments.push(r.body.appointment.id as string)
    expect(r.body.appointment).toMatchObject({ status: 'scheduled', can_cancel: true, loyalty_eligible: true })
    expect(typeof r.body.appointment.cancel_deadline).toBe('string')

    const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
    const { data, error } = await c.auth.verifyOtp({ token_hash: r.body.session.token_hash as string, type: 'email' })
    expect(error).toBeNull()
    const { data: mine } = await c.from('customers').select('id').eq('auth_user_id', data.user?.id ?? '').single()
    const { data: appt } = await admin.from('appointments').select('customer_id').eq('id', r.body.appointment.id).single()
    expect(appt?.customer_id).toBe(mine?.id)

    const slot2 = await firstSlot(futureDate(8))
    const wrong = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: slot2,
      customer: { name: 'Outra Pessoa', phone },
      login: true,
    })
    expect(wrong.status).toBe(201)
    createdAppointments.push(wrong.body.appointment.id as string)
    expect(wrong.body.session).toBeUndefined()
    expect(wrong.body.appointment.loyalty_eligible).toBe(false)
  })
})

describe('um celular = uma conta', () => {
  it('agendar sem login com celular de uma conta entra na conta, mesmo com outro nome', async () => {
    const slot = await firstSlot(futureDate(6))
    const r = await callFn('create-appointment', {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: slot,
      customer: { name: 'Outro Nome', phone: '(11) 98888-7777' },
    })
    expect(r.status).toBe(201)
    createdAppointments.push(r.body.appointment.id as string)
    expect(r.body.appointment.customer_name).toBe('Outro Nome') // não revela o nome da conta
    const { data: account } = await admin.from('customers').select('id').eq('auth_user_id', CLIENTE_USER).single()
    const { data: appt } = await admin.from('appointments').select('customer_id').eq('id', r.body.appointment.id).single()
    expect(appt?.customer_id).toBe(account?.id)
    const { count } = await admin
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('phone', '+5511988887777')
      .eq('is_guest', true)
    expect(count).toBe(0)
  })

  it('login de cliente não abre conta da equipe com o mesmo celular', async () => {
    const phone = `${PHONE_PREFIX}00301`
    const rafaelUser = 'b0000000-0000-4000-8000-000000000001'
    const { error } = await admin.from('customers').insert({ auth_user_id: rafaelUser, is_guest: false, name: 'Rafael', phone })
    expect(error).toBeNull()
    const r = await callFn('customer-login', { name: 'Rafael', phone })
    expect(r.status).toBe(409)
    await admin.from('customers').delete().eq('auth_user_id', rafaelUser)
  })
})

describe('staff-create-appointment (barbeiro agenda pelo app)', () => {
  it('site público com a equipe logada não mostra horário que já passou', async () => {
    const rafael = await tokenFor('rafael@barbearia.dev')
    const today = dateInTz(new Date(), 'America/Sao_Paulo')
    const q = { barber_id: RAFAEL, service_ids: [CORTE], date: today }
    const pub = await callFn('get-availability', q)
    const logged = await callFn('get-availability', q, rafael)
    expect(logged.status).toBe(200)
    expect(logged.body.slots).toEqual(pub.body.slots)
    const now = Date.now()
    for (const s of logged.body.slots as { starts_at: string }[]) expect(Date.parse(s.starts_at)).toBeGreaterThan(now)
  })

  it('barbeiro agenda na própria agenda; não na de outro; cliente não pode', async () => {
    const rafael = await tokenFor('rafael@barbearia.dev')
    const cliente = await tokenFor('cliente@barbearia.dev')
    const date = futureDate(7)
    const avail = await callFn('get-availability', { barber_id: RAFAEL, service_ids: [CORTE], date, staff: true }, rafael)
    expect(avail.status).toBe(200)
    const slot = avail.body.slots[0].starts_at as string
    const body = {
      barber_id: RAFAEL,
      service_ids: [CORTE],
      starts_at: slot,
      customer: { name: 'Cliente Balcão', phone: `${PHONE_PREFIX}00401` },
    }

    expect((await callFn('staff-create-appointment', body)).status).toBe(401)
    expect((await callFn('staff-create-appointment', body, cliente)).status).toBe(403)
    expect((await callFn('staff-create-appointment', { ...body, barber_id: 'ba000000-0000-4000-8000-000000000002' }, rafael)).status).toBe(403)

    const ok = await callFn('staff-create-appointment', body, rafael)
    expect(ok.status).toBe(201)
    expect(ok.body.token).toBeTruthy()
    createdAppointments.push(ok.body.appointment_id as string)

    const again = await callFn('staff-create-appointment', body, rafael)
    expect(again.status).toBe(409)
  })
})

describe('conclusão com pagamento + lembrete', () => {
  it('lembra o barbeiro uma vez; barbeiro conclui informando o pagamento', async () => {
    // atendimento que terminou há ~1h (Corte 30 min), em horário redondo
    const start = new Date(Math.floor((Date.now() - 90 * 60_000) / 900_000) * 900_000)
    const hash = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const { data, error } = await admin.rpc('book_appointment', {
      p_barber_id: RAFAEL,
      p_starts_at: start.toISOString(),
      p_service_ids: [CORTE],
      p_cancel_token_hash: hash,
      p_customer_name: 'Lembrete Teste',
      p_customer_phone: `${PHONE_PREFIX}00201`,
    })
    expect(error).toBeNull()
    const id = data?.[0]?.appointment_id ?? ''

    const first = await callFn('completion-reminders', {})
    expect(first.status).toBe(200)
    const { data: row } = await admin.from('appointments').select('completion_reminded_at').eq('id', id).single()
    expect(row?.completion_reminded_at).not.toBeNull()
    await callFn('completion-reminders', {})
    const { data: again } = await admin.from('appointments').select('completion_reminded_at').eq('id', id).single()
    expect(again?.completion_reminded_at).toBe(row?.completion_reminded_at)

    // barbeiro conclui pelo app: sem pagamento é recusado; com pagamento vale o total
    const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
    await c.auth.signInWithPassword({ email: 'rafael@barbearia.dev', password: 'Senha@123' })
    const noPay = await c.from('appointments').update({ status: 'completed' }).eq('id', id)
    expect(noPay.error?.message).toMatch(/payment_required/)
    const ok = await c.from('appointments').update({ status: 'completed', payment_method: 'pix' }).eq('id', id)
    expect(ok.error).toBeNull()
    const { data: done } = await admin.from('appointments').select('status, paid_cents, payment_method').eq('id', id).single()
    expect(done).toMatchObject({ status: 'completed', paid_cents: 4500, payment_method: 'pix' })
  })
})

describe('lembrete de retorno (20 dias depois do corte)', () => {
  const bookPast = async (daysAgo: number, phone: string, name: string) => {
    const start = new Date(Math.floor((Date.now() - daysAgo * 86_400_000) / 900_000) * 900_000)
    const hash = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const { data, error } = await admin.rpc('book_appointment', {
      p_barber_id: RAFAEL,
      p_starts_at: start.toISOString(),
      p_service_ids: [CORTE],
      p_cancel_token_hash: hash,
      p_customer_name: name,
      p_customer_phone: phone,
    })
    expect(error).toBeNull()
    const id = data?.[0]?.appointment_id ?? ''
    const done = await admin.from('appointments').update({ status: 'completed', payment_method: 'pix' }).eq('id', id)
    expect(done.error).toBeNull()
    return id
  }

  it('avisa uma vez quem não voltou; pula quem já voltou; barbeiro dispensa', async (ctx) => {
    const sumido = await bookPast(21, `${PHONE_PREFIX}00501`, 'Sumido Teste')
    // este voltou depois: o corte antigo não gera lembrete
    const antigo = await bookPast(23, `${PHONE_PREFIX}00502`, 'Voltou Teste')
    await bookPast(2, `${PHONE_PREFIX}00502`, 'Voltou Teste')
    const recente = await bookPast(10, `${PHONE_PREFIX}00503`, 'Recente Teste')

    // horário de envio cobrindo o dia todo, para o teste não depender da hora
    const { data: before } = await admin
      .from('app_settings')
      .select('return_reminder_enabled, return_reminder_days, return_reminder_from_hour, return_reminder_until_hour')
      .single()
    await admin
      .from('app_settings')
      .update({ return_reminder_enabled: true, return_reminder_days: 20, return_reminder_from_hour: 0, return_reminder_until_hour: 24 })
      .eq('id', true)
    ctx.onTestFinished(async () => {
      if (before) await admin.from('app_settings').update(before).eq('id', true)
    })

    const r = await callFn('completion-reminders', {})
    expect(r.status).toBe(200)
    expect(r.body.return_window).toBe(true)

    const rows = async (ids: string[]) =>
      (await admin.from('appointments').select('id, return_pending, return_reminded_at').in('id', ids)).data ?? []
    const byId = new Map((await rows([sumido, antigo, recente])).map((x) => [x.id, x]))
    expect(byId.get(sumido)).toMatchObject({ return_pending: true })
    expect(byId.get(sumido)?.return_reminded_at).not.toBeNull()
    expect(byId.get(antigo)).toMatchObject({ return_pending: false })
    expect(byId.get(antigo)?.return_reminded_at).not.toBeNull()
    expect(byId.get(recente)).toMatchObject({ return_pending: false, return_reminded_at: null })

    // não repete
    const first = byId.get(sumido)?.return_reminded_at
    await callFn('completion-reminders', {})
    expect((await rows([sumido]))[0]?.return_reminded_at).toBe(first)

    // barbeiro vê em "Chamar de volta" e dispensa
    const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
    await c.auth.signInWithPassword({ email: 'rafael@barbearia.dev', password: 'Senha@123' })
    const { data: pending } = await c.from('appointments').select('id').eq('return_pending', true)
    expect(pending?.map((p) => p.id)).toContain(sumido)
    const off = await c.from('appointments').update({ return_pending: false }).eq('id', sumido)
    expect(off.error).toBeNull()
    expect((await rows([sumido]))[0]?.return_pending).toBe(false)
  })
})

describe('lembrete de retorno desligado', () => {
  it('dono desliga: nada é enviado', async (ctx) => {
    const { data: before } = await admin.from('app_settings').select('return_reminder_enabled').single()
    await admin.from('app_settings').update({ return_reminder_enabled: false }).eq('id', true)
    ctx.onTestFinished(async () => {
      if (before) await admin.from('app_settings').update(before).eq('id', true)
    })
    const r = await callFn('completion-reminders', {})
    expect(r.body).toMatchObject({ return_sent: 0, return_window: false })
  })
})

describe('barbeiro fecha a agenda do dia', () => {
  it('bloqueia o próprio dia (some do site); não fecha o de outro; reabre', async () => {
    const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
    await c.auth.signInWithPassword({ email: 'rafael@barbearia.dev', password: 'Senha@123' })
    const date = futureDate(9)
    expect((await callFn('get-availability', { barber_id: RAFAEL, service_ids: [CORTE], date })).body.slots.length).toBeGreaterThan(0)

    const day = { starts_at: zonedToUtc(date, 0, SP).toISOString(), ends_at: zonedToUtc(addDays(date, 1), 0, SP).toISOString() }
    const outro = await c.from('time_off').insert({ ...day, barber_id: 'ba000000-0000-4000-8000-000000000002' })
    expect(outro.error).not.toBeNull()

    const { data: block, error } = await c.from('time_off').insert({ ...day, barber_id: RAFAEL }).select('id').single()
    expect(error).toBeNull()
    try {
      const closed = await callFn('get-availability', { barber_id: RAFAEL, service_ids: [CORTE], date })
      expect(closed.body.slots).toEqual([])
    } finally {
      const del = await c.from('time_off').delete().eq('id', block?.id ?? '').select('id')
      expect(del.data?.length).toBe(1)
    }
  })
})

describe('super admin', () => {
  it('só o super admin cadastra dono; dono nasce admin e também barbeiro', async () => {
    const adm = await tokenFor('admin@barbearia.dev')
    const sup = await tokenFor('super@barbearia.dev')
    const body = { name: 'Dono Teste', email: OWNER_EMAIL, password: 'Senha@123', role: 'admin' }

    expect((await callFn('admin-create-barber', body, adm)).status).toBe(403)
    const ok = await callFn('admin-create-barber', body, sup)
    expect(ok.status).toBe(201)
    const { data } = await admin.from('barbers').select('profiles(role)').eq('id', ok.body.barber_id as string).single()
    expect(data?.profiles?.role).toBe('admin')
  })

  it('dono não troca senha de dono/super admin; super admin troca', async () => {
    const adm = await tokenFor('admin@barbearia.dev')
    const sup = await tokenFor('super@barbearia.dev')
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const owner = users.users.find((u) => u.email === OWNER_EMAIL)
    if (!owner) throw new Error('dono de teste não encontrado')

    expect((await callFn('admin-set-password', { user_id: owner.id, password: 'Trocada@456' }, adm)).status).toBe(403)
    expect((await callFn('admin-set-password', { user_id: SUPER_USER, password: 'Trocada@456' }, adm)).status).toBe(403)
    expect((await callFn('admin-set-password', { user_id: owner.id, password: 'Trocada@456' }, sup)).status).toBe(200)
  })

  it('super-set-role: só super admin; alterna barbeiro <-> dono; não mexe em cliente nem em si mesmo', async () => {
    const adm = await tokenFor('admin@barbearia.dev')
    const sup = await tokenFor('super@barbearia.dev')
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const owner = users.users.find((u) => u.email === OWNER_EMAIL)
    const cliente = users.users.find((u) => u.email === CLIENTE_EMAIL)
    if (!owner || !cliente) throw new Error('usuários de teste não encontrados')

    expect((await callFn('super-set-role', { user_id: owner.id, role: 'barber' }, adm)).status).toBe(403)
    expect((await callFn('super-set-role', { user_id: owner.id, role: 'barber' }, sup)).status).toBe(200)
    const { data: p } = await admin.from('profiles').select('role').eq('id', owner.id).single()
    expect(p?.role).toBe('barber')
    expect((await callFn('super-set-role', { user_id: owner.id, role: 'admin' }, sup)).status).toBe(200)

    expect((await callFn('super-set-role', { user_id: cliente.id, role: 'admin' }, sup)).status).toBe(409)
    expect((await callFn('super-set-role', { user_id: SUPER_USER, role: 'barber' }, sup)).status).toBe(400)
  })

  it('RLS: dono não enxerga o profile do super admin; super admin enxerga todos', async () => {
    const asUser = async (email: string) => {
      const c = createClient<Database>(apiUrl, anonKey, { auth: { persistSession: false } })
      await c.auth.signInWithPassword({ email, password: 'Senha@123' })
      return c
    }
    const adm = await asUser('admin@barbearia.dev')
    const sup = await asUser('super@barbearia.dev')
    const a = await adm.from('profiles').select('id').eq('id', SUPER_USER)
    expect(a.data).toEqual([])
    const s = await sup.from('profiles').select('id').eq('role', 'admin')
    expect(s.data?.length).toBeGreaterThan(0)
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
