// Carrega do banco tudo que o cálculo de slots precisa e devolve os horários
// livres por barbeiro. Usado por get-availability e create-appointment (a
// criação revalida o horário com exatamente a mesma regra).
import { AppError } from './http.ts'
import {
  type BookingSettings,
  checkBookingDate,
  computeSlots,
  type Interval,
  type WorkingDay,
} from './slots.ts'
import type { AdminClient } from './supabase.ts'
import { addDays, weekdayOf, zonedToUtc } from './time.ts'

export interface AvailabilityQuery {
  barberId: string | 'any'
  serviceIds: string[]
  date: string
  now: Date
  /** já carregadas pelo chamador (evita consulta repetida) */
  settings?: BookingSettings
}

export interface ServiceInfo {
  id: string
  name: string
  durationMin: number
  priceCents: number
}

export interface BarberInfo {
  id: string
  displayName: string
}

export interface Availability {
  settings: BookingSettings
  services: ServiceInfo[]
  durationMin: number
  totalPriceCents: number
  barbers: BarberInfo[]
  /** barberId -> inícios livres (UTC) */
  slots: Map<string, Date[]>
  /** barberId -> qtd. de agendamentos no dia (para balancear "qualquer") */
  load: Map<string, number>
}

export async function loadSettings(db: AdminClient): Promise<BookingSettings> {
  const { data, error } = await db
    .from('app_settings')
    .select('timezone, min_booking_notice_min, max_booking_days, slot_step_min')
    .single()
  if (error) throw new AppError(500, 'internal_error', 'Falha ao carregar configurações.')
  return {
    timezone: data.timezone,
    minBookingNoticeMin: data.min_booking_notice_min,
    maxBookingDays: data.max_booking_days,
    slotStepMin: data.slot_step_min,
  }
}

export async function loadAvailability(db: AdminClient, q: AvailabilityQuery): Promise<Availability> {
  const settings = q.settings ?? (await loadSettings(db))
  const serviceIds = [...new Set(q.serviceIds)]

  const dateCheck = checkBookingDate(q.date, q.now, settings)
  if (dateCheck !== 'ok') {
    throw new AppError(
      422,
      'date_out_of_range',
      dateCheck === 'past'
        ? 'Escolha uma data a partir de hoje.'
        : `Agendamentos só até ${settings.maxBookingDays} dias à frente.`,
    )
  }

  // Serviços (ativos)
  const { data: svcRows, error: svcErr } = await db
    .from('services')
    .select('id, name, duration_min, price_cents')
    .in('id', serviceIds)
    .eq('active', true)
  if (svcErr) throw new AppError(500, 'internal_error', 'Falha ao carregar serviços.')
  if (svcRows.length !== serviceIds.length) {
    throw new AppError(422, 'invalid_services', 'Algum serviço escolhido não está disponível.')
  }
  const services: ServiceInfo[] = svcRows.map((s) => ({
    id: s.id,
    name: s.name,
    durationMin: s.duration_min,
    priceCents: s.price_cents,
  }))
  const durationMin = services.reduce((acc, s) => acc + s.durationMin, 0)
  const totalPriceCents = services.reduce((acc, s) => acc + s.priceCents, 0)

  // Barbeiros ativos que fazem TODOS os serviços
  let barberQuery = db
    .from('barbers')
    .select('id, display_name, barber_services(service_id)')
    .eq('active', true)
  if (q.barberId !== 'any') barberQuery = barberQuery.eq('id', q.barberId)
  const { data: barberRows, error: barberErr } = await barberQuery
  if (barberErr) throw new AppError(500, 'internal_error', 'Falha ao carregar barbeiros.')

  const barbers: BarberInfo[] = barberRows
    .filter((b) => {
      const offered = new Set(b.barber_services.map((bs) => bs.service_id))
      return serviceIds.every((id) => offered.has(id))
    })
    .map((b) => ({ id: b.id, displayName: b.display_name }))

  if (q.barberId !== 'any' && barbers.length === 0) {
    throw new AppError(422, 'invalid_services', 'Este barbeiro não faz todos os serviços escolhidos.')
  }

  const slots = new Map<string, Date[]>()
  const load = new Map<string, number>()
  if (barbers.length === 0) {
    return { settings, services, durationMin, totalPriceCents, barbers, slots, load }
  }

  const barberIds = barbers.map((b) => b.id)
  const tz = settings.timezone
  const dayStart = zonedToUtc(q.date, 0, tz).toISOString()
  const dayEnd = zonedToUtc(addDays(q.date, 1), 0, tz).toISOString()

  const [whRes, apptRes, offRes] = await Promise.all([
    db
      .from('working_hours')
      .select('barber_id, weekday, start_time, end_time, break_start, break_end')
      .in('barber_id', barberIds)
      .eq('weekday', weekdayOf(q.date)),
    db
      .from('appointments')
      .select('barber_id, starts_at, ends_at')
      .in('barber_id', barberIds)
      .eq('status', 'scheduled')
      .lt('starts_at', dayEnd)
      .gt('ends_at', dayStart),
    db
      .from('time_off')
      .select('barber_id, starts_at, ends_at')
      .in('barber_id', barberIds)
      .lt('starts_at', dayEnd)
      .gt('ends_at', dayStart),
  ])
  if (whRes.error || apptRes.error || offRes.error) {
    throw new AppError(500, 'internal_error', 'Falha ao carregar agenda.')
  }

  for (const barber of barbers) {
    const workingHours: WorkingDay[] = whRes.data
      .filter((w) => w.barber_id === barber.id)
      .map((w) => ({
        weekday: w.weekday,
        startTime: w.start_time,
        endTime: w.end_time,
        breakStart: w.break_start,
        breakEnd: w.break_end,
      }))
    const appts = apptRes.data.filter((a) => a.barber_id === barber.id)
    const busy: Interval[] = [...appts, ...offRes.data.filter((o) => o.barber_id === barber.id)].map(
      (i) => ({ start: new Date(i.starts_at), end: new Date(i.ends_at) }),
    )

    slots.set(
      barber.id,
      computeSlots({ date: q.date, now: q.now, settings, durationMin, workingHours, busy }),
    )
    load.set(barber.id, appts.length)
  }

  return { settings, services, durationMin, totalPriceCents, barbers, slots, load }
}
