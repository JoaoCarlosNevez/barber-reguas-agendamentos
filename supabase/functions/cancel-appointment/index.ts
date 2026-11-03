// POST /functions/v1/cancel-appointment
//   { token }            -> visitante, pelo link da confirmação
//   { appointment_id }   -> cliente logado, dono do agendamento
// Respeita app_settings.cancel_min_notice_hours. Barbeiro/admin cancelam pelo
// painel (UPDATE direto, protegido por RLS + trigger).
import { loadAppointment } from '../_shared/appointment.ts'
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { notifyBarberInBackground } from '../_shared/notify.ts'
import { checkCustomerCancel } from '../_shared/policy.ts'
import { appointmentTokenSchema } from '../_shared/schemas.ts'
import { clientIp, enforceRateLimits, sha256Hex } from '../_shared/security.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

const FN = 'cancel-appointment'

const bodySchema = z.union([
  z.object({ token: appointmentTokenSchema }),
  z.object({ appointment_id: z.uuid() }),
])

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const db = adminClient()

  await enforceRateLimits(db, FN, [
    { scope: 'ip', subject: clientIp(req), windowSeconds: 600, max: 20 },
  ])

  let appt
  if ('token' in body) {
    appt = await loadAppointment(db, { tokenHash: await sha256Hex(body.token) })
  } else {
    const user = await requireUser(req)
    appt = await loadAppointment(db, { id: body.appointment_id })
    // não revela se o id existe para quem não é dono
    if (appt.customerAuthUserId !== user.id) {
      throw new AppError(404, 'not_found', 'Agendamento não encontrado.')
    }
  }

  const hours = Number(appt.public.cancel_min_notice_hours)
  const check = checkCustomerCancel(appt.status, appt.startsAt, new Date(), hours)
  if (check === 'not_scheduled') {
    throw new AppError(409, 'invalid_state', 'Este agendamento não pode mais ser cancelado.')
  }
  if (check === 'too_late') {
    throw new AppError(
      409,
      'cancel_too_late',
      `Cancelamento pelo app só até ${hours}h antes. Fale com a barbearia.`,
    )
  }

  const { error } = await db
    .from('appointments')
    .update({ status: 'cancelled', cancelled_by: 'customer' })
    .eq('id', appt.id)
    .eq('status', 'scheduled')
  if (error) {
    log.error(FN, 'cancel_failed', { code: error.code })
    throw new AppError(500, 'internal_error', 'Não foi possível cancelar agora. Tente de novo.')
  }

  log.info(FN, 'appointment_cancelled', { appointment_id: appt.id })
  await notifyBarberInBackground(db, FN, {
    type: 'appointment_cancelled',
    appointmentId: appt.id,
    barberId: appt.barberId,
  })

  const fresh = await loadAppointment(db, { id: appt.id })
  return json(req, { appointment: fresh.public })
})
