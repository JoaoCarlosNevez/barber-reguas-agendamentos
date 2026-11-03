// POST /functions/v1/get-appointment  (pública)
// { token } -> detalhes do agendamento do link recebido na confirmação.
import { loadAppointment } from '../_shared/appointment.ts'
import { z } from '../_shared/deps.ts'
import { json, readJson, serve } from '../_shared/http.ts'
import { appointmentTokenSchema } from '../_shared/schemas.ts'
import { clientIp, enforceRateLimits, sha256Hex } from '../_shared/security.ts'
import { adminClient } from '../_shared/supabase.ts'

const FN = 'get-appointment'

const bodySchema = z.object({ token: appointmentTokenSchema })

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const db = adminClient()

  await enforceRateLimits(db, FN, [
    { scope: 'ip', subject: clientIp(req), windowSeconds: 300, max: 60 },
  ])

  const appt = await loadAppointment(db, { tokenHash: await sha256Hex(body.token) })
  return json(req, { appointment: appt.public })
})
