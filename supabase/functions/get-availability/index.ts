// POST /functions/v1/get-availability  (pública)
// { barber_id: uuid | "any", service_ids: uuid[], date: "YYYY-MM-DD" }
import { loadAvailability } from '../_shared/availability.ts'
import { z } from '../_shared/deps.ts'
import { json, readJson, serve } from '../_shared/http.ts'
import { barberIdSchema, dateSchema, serviceIdsSchema } from '../_shared/schemas.ts'
import { clientIp, enforceRateLimits } from '../_shared/security.ts'
import { mergeSlots } from '../_shared/slots.ts'
import { adminClient } from '../_shared/supabase.ts'
import { timeInTz } from '../_shared/time.ts'

const FN = 'get-availability'

const bodySchema = z.object({
  barber_id: barberIdSchema,
  service_ids: serviceIdsSchema,
  date: dateSchema,
})

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  const db = adminClient()

  await enforceRateLimits(db, FN, [
    { scope: 'ip', subject: clientIp(req), windowSeconds: 300, max: 120 },
  ])

  const av = await loadAvailability(db, {
    barberId: body.barber_id,
    serviceIds: body.service_ids,
    date: body.date,
    now: new Date(),
  })

  const tz = av.settings.timezone
  const slots = mergeSlots(av.slots).map((s) => ({
    starts_at: s.startsAt.toISOString(),
    time: timeInTz(s.startsAt, tz),
    barber_ids: s.barberIds,
  }))

  return json(req, {
    date: body.date,
    timezone: tz,
    duration_min: av.durationMin,
    total_price_cents: av.totalPriceCents,
    services: av.services.map((s) => ({
      id: s.id,
      name: s.name,
      duration_min: s.durationMin,
      price_cents: s.priceCents,
    })),
    barbers: av.barbers.map((b) => ({ id: b.id, display_name: b.displayName })),
    slots,
  })
})
