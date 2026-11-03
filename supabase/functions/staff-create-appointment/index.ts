// POST /functions/v1/staff-create-appointment  (barbeiro / dono / super admin)
// { barber_id, service_ids, starts_at, customer: { name, phone } }
// Agendamento feito pela equipe no app (cliente pediu no balcão/WhatsApp).
// Sem anti-robô nem rate limit; aceita horários "de agora" (até 30 min atrás).
// Barbeiro só agenda na própria agenda; dono/super admin em qualquer uma.
// O agendamento vai para a conta do celular (ou visitante), como no site.
import { loadAvailability, loadSettings } from '../_shared/availability.ts'
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { notifyBarberInBackground } from '../_shared/notify.ts'
import { normalizeBrPhone } from '../_shared/phone.ts'
import { serviceIdsSchema } from '../_shared/schemas.ts'
import { newAppointmentToken } from '../_shared/security.ts'
import { adminClient, requireUser, STAFF_NOTICE_MIN, STAFF_ROLES } from '../_shared/supabase.ts'
import { dateInTz } from '../_shared/time.ts'

const FN = 'staff-create-appointment'

const bodySchema = z.object({
  barber_id: z.uuid(),
  service_ids: serviceIdsSchema,
  starts_at: z.iso.datetime({ offset: true }),
  customer: z.object({
    name: z.string().trim().min(2, 'Informe o nome do cliente.').max(80, 'Nome muito longo.'),
    phone: z.string().trim().min(8, 'Informe o celular do cliente.').max(30),
  }),
})

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const user = await requireUser(req, STAFF_ROLES)
  const db = adminClient()

  if (user.role === 'barber') {
    const { data: mine } = await db.from('barbers').select('id').eq('profile_id', user.id).maybeSingle()
    if (mine?.id !== body.barber_id) throw new AppError(403, 'forbidden', 'Você só pode agendar na sua agenda.')
  }

  const phone = normalizeBrPhone(body.customer.phone)
  if (!phone) {
    throw new AppError(422, 'validation_error', 'Celular inválido. Use DDD + número.', {
      fieldErrors: { 'customer.phone': ['Celular inválido.'] },
    })
  }

  const startsAt = new Date(body.starts_at)
  const settings = { ...(await loadSettings(db)), minBookingNoticeMin: STAFF_NOTICE_MIN }
  const av = await loadAvailability(db, {
    barberId: body.barber_id,
    serviceIds: body.service_ids,
    date: dateInTz(startsAt, settings.timezone),
    now: new Date(),
    settings,
  })
  const free = av.slots.get(body.barber_id)?.some((s) => s.getTime() === startsAt.getTime())
  if (!free) throw new AppError(409, 'slot_unavailable', 'Esse horário não está livre. Escolha outro.')

  const { token, hash } = await newAppointmentToken()
  const { data, error } = await db
    .rpc('book_appointment', {
      p_barber_id: body.barber_id,
      p_starts_at: startsAt.toISOString(),
      p_service_ids: av.services.map((s) => s.id),
      p_cancel_token_hash: hash,
      p_customer_name: body.customer.name,
      p_customer_phone: phone,
    })
    .single()
  if (error) {
    if (error.code === '23P01' || error.code === '40P01') {
      throw new AppError(409, 'slot_unavailable', 'Esse horário acabou de ser ocupado. Escolha outro.')
    }
    log.error(FN, 'book_failed', { code: error.code })
    throw new AppError(500, 'internal_error', 'Não foi possível criar o agendamento.')
  }

  // avisa o barbeiro só quando foi outra pessoa (ex.: o dono) que marcou
  const { data: target } = await db.from('barbers').select('profile_id').eq('id', body.barber_id).single()
  if (target && target.profile_id !== user.id) {
    await notifyBarberInBackground(db, FN, { type: 'appointment_created', appointmentId: data.appointment_id, barberId: body.barber_id })
  }

  log.info(FN, 'appointment_created', { appointment_id: data.appointment_id, barber_id: body.barber_id })
  return json(req, { appointment_id: data.appointment_id, token, starts_at: startsAt.toISOString() }, 201)
})
