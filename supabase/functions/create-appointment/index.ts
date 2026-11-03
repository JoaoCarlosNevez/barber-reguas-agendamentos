// POST /functions/v1/create-appointment  (pública; JWT de cliente opcional)
// {
//   barber_id: uuid | "any", service_ids: uuid[], starts_at: ISO-8601,
//   customer: { name, phone }, website?: "" (honeypot), turnstile_token?: string,
//   login?: boolean
// }
// login: true (visitante) entra/cria a conta do celular na mesma chamada e
// devolve `session.token_hash` (o front troca por sessão com verifyOtp). Se o
// nome não conferir, agenda como visitante, sem sessão.
// A resposta já traz o agendamento completo (mesmo formato do get-appointment).
// Preço, duração e ends_at são calculados no servidor. O token em claro é
// devolvido UMA vez; no banco fica só o sha256.
import { loadAppointment } from '../_shared/appointment.ts'
import { loadAvailability, loadSettings } from '../_shared/availability.ts'
import { type CustomerLogin, loginCustomer } from '../_shared/customerLogin.ts'
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { notifyBarberInBackground } from '../_shared/notify.ts'
import { normalizeBrPhone } from '../_shared/phone.ts'
import { barberIdSchema, serviceIdsSchema } from '../_shared/schemas.ts'
import { clientIp, enforceRateLimits, newAppointmentToken, verifyTurnstile } from '../_shared/security.ts'
import { adminClient, optionalUser } from '../_shared/supabase.ts'
import { dateInTz } from '../_shared/time.ts'

const FN = 'create-appointment'
const SLOT_UNAVAILABLE = 'Esse horário não está mais disponível. Escolha outro.'

const bodySchema = z.object({
  barber_id: barberIdSchema,
  service_ids: serviceIdsSchema,
  starts_at: z.iso.datetime({ offset: true }),
  customer: z.object({
    name: z.string().trim().min(2, 'Informe seu nome.').max(80, 'Nome muito longo.'),
    phone: z.string().trim().min(8, 'Informe seu telefone.').max(30),
  }),
  website: z.string().optional(),
  turnstile_token: z.string().max(4096).optional(),
  login: z.boolean().optional(),
})

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const db = adminClient()
  const ip = clientIp(req)

  // Honeypot: campo invisível para humanos
  if (body.website && body.website.trim() !== '') {
    log.warn(FN, 'honeypot_triggered')
    throw new AppError(400, 'bot_detected', 'Não foi possível concluir o agendamento.')
  }

  const phone = normalizeBrPhone(body.customer.phone)
  if (!phone) {
    throw new AppError(422, 'validation_error', 'Telefone inválido. Use DDD + número.', {
      fieldErrors: { 'customer.phone': ['Telefone inválido.'] },
    })
  }

  await enforceRateLimits(db, FN, [
    { scope: 'ip', subject: ip, windowSeconds: 600, max: 10 },
    { scope: 'phone', subject: phone, windowSeconds: 3600, max: 5 },
  ])
  await verifyTurnstile(body.turnstile_token, ip)

  let user = await optionalUser(req)
  let login: CustomerLogin | null = null
  if (!user && body.login) {
    try {
      login = await loginCustomer(db, FN, body.customer.name, phone)
      user = { id: login.userId }
    } catch (err) {
      // nome não confere / celular da equipe / falha: segue como visitante
      log.info(FN, 'login_skipped', { code: err instanceof AppError ? err.code : 'error' })
    }
  }

  // Revalida o horário com a mesma regra da listagem
  const startsAt = new Date(body.starts_at)
  const now = new Date()
  const settings = await loadSettings(db)

  const av = await loadAvailability(db, {
    barberId: body.barber_id,
    serviceIds: body.service_ids,
    date: dateInTz(startsAt, settings.timezone),
    now,
    settings,
  })

  const candidates = av.barbers
    .filter((b) => av.slots.get(b.id)?.some((s) => s.getTime() === startsAt.getTime()))
    .sort((a, b) => (av.load.get(a.id) ?? 0) - (av.load.get(b.id) ?? 0))

  if (candidates.length === 0) throw new AppError(409, 'slot_unavailable', SLOT_UNAVAILABLE)

  const { token, hash } = await newAppointmentToken()

  // "qualquer disponível": tenta o menos ocupado; se perder a corrida, o próximo
  for (const barber of candidates) {
    const { data, error } = await db
      .rpc('book_appointment', {
        p_barber_id: barber.id,
        p_starts_at: startsAt.toISOString(),
        p_service_ids: av.services.map((s) => s.id),
        p_cancel_token_hash: hash,
        p_customer_name: body.customer.name,
        p_customer_phone: phone,
        ...(user ? { p_auth_user_id: user.id } : {}),
      })
      .single()

    if (error) {
      // 23P01 = sobreposição; 40P01 = deadlock (defensivo, o advisory lock já evita)
      if (error.code === '23P01' || error.code === '40P01') {
        log.info(FN, 'slot_conflict', { barber_id: barber.id })
        continue
      }
      if (error.message.includes('invalid_services')) {
        throw new AppError(422, 'invalid_services', 'Algum serviço escolhido não está disponível.')
      }
      log.error(FN, 'book_failed', { code: error.code })
      throw new AppError(500, 'internal_error', 'Não foi possível concluir o agendamento.')
    }

    log.info(FN, 'appointment_created', {
      appointment_id: data.appointment_id,
      barber_id: barber.id,
      logged_in: user !== null,
    })

    await notifyBarberInBackground(db, FN, {
      type: 'appointment_created',
      appointmentId: data.appointment_id,
      barberId: barber.id,
    })

    const legacy = {
      id: data.appointment_id,
      starts_at: new Date(data.starts_at).toISOString(),
      ends_at: new Date(data.ends_at).toISOString(),
      timezone: av.settings.timezone,
      total_price_cents: data.total_price_cents,
      barber: { id: barber.id, display_name: barber.displayName },
      services: av.services.map((s) => ({
        id: s.id,
        name: s.name,
        duration_min: s.durationMin,
        price_cents: s.priceCents,
      })),
      customer_name: data.customer_name,
    }
    // detalhes completos para o comprovante abrir sem buscar de novo
    let full: Record<string, unknown> = {}
    try {
      full = (await loadAppointment(db, { id: data.appointment_id })).public
    } catch {
      log.warn(FN, 'load_created_failed', { appointment_id: data.appointment_id })
    }

    return json(
      req,
      {
        token,
        appointment: { ...full, ...legacy, loyalty_eligible: user !== null },
        ...(login ? { session: { token_hash: login.tokenHash } } : {}),
      },
      201,
    )
  }

  throw new AppError(409, 'slot_unavailable', SLOT_UNAVAILABLE)
})
