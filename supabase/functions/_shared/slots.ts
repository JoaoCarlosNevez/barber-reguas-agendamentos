// Cálculo puro de horários livres. Sem I/O: recebe tudo pronto e devolve
// instantes UTC. Testado em tests/unit/slots.test.ts.
import { dateInTz, daysBetween, timeToMinutes, weekdayOf, zonedToUtc } from './time.ts'

const MINUTE_MS = 60_000

export interface BookingSettings {
  timezone: string
  minBookingNoticeMin: number
  maxBookingDays: number
  slotStepMin: number
}

export interface WorkingDay {
  weekday: number
  startTime: string
  endTime: string
  breakStart: string | null
  breakEnd: string | null
}

export interface Interval {
  start: Date
  end: Date
}

export interface ComputeSlotsInput {
  /** Data de calendário no fuso da barbearia (YYYY-MM-DD). */
  date: string
  now: Date
  settings: BookingSettings
  /** Duração somada dos serviços escolhidos (minutos). */
  durationMin: number
  /** Expediente do barbeiro; pode conter todos os dias, filtramos pelo weekday. */
  workingHours: readonly WorkingDay[]
  /** Agendamentos 'scheduled' e bloqueios (time_off) do barbeiro. */
  busy: readonly Interval[]
}

export type DateCheck = 'ok' | 'past' | 'too_far'

/** A data está dentro da janela [hoje, hoje + maxBookingDays] no fuso da barbearia? */
export function checkBookingDate(date: string, now: Date, settings: BookingSettings): DateCheck {
  const today = dateInTz(now, settings.timezone)
  const diff = daysBetween(today, date)
  if (diff < 0) return 'past'
  if (diff > settings.maxBookingDays) return 'too_far'
  return 'ok'
}

function overlaps(aStart: number, aEnd: number, b: Interval): boolean {
  return aStart < b.end.getTime() && b.start.getTime() < aEnd
}

/** Retorna os inícios de horário livres (UTC), em ordem crescente. */
export function computeSlots(input: ComputeSlotsInput): Date[] {
  const { date, now, settings, durationMin, workingHours, busy } = input

  if (durationMin <= 0 || settings.slotStepMin <= 0) return []
  if (checkBookingDate(date, now, settings) !== 'ok') return []

  const weekday = weekdayOf(date)
  const wh = workingHours.find((w) => w.weekday === weekday)
  if (!wh) return []

  const tz = settings.timezone
  const dayStart = zonedToUtc(date, timeToMinutes(wh.startTime), tz).getTime()
  const dayEnd = zonedToUtc(date, timeToMinutes(wh.endTime), tz).getTime()

  const blocked: Interval[] = [...busy]
  if (wh.breakStart && wh.breakEnd) {
    blocked.push({
      start: zonedToUtc(date, timeToMinutes(wh.breakStart), tz),
      end: zonedToUtc(date, timeToMinutes(wh.breakEnd), tz),
    })
  }

  const earliest = now.getTime() + settings.minBookingNoticeMin * MINUTE_MS
  const durationMs = durationMin * MINUTE_MS
  const stepMs = settings.slotStepMin * MINUTE_MS

  const slots: Date[] = []
  for (let t = dayStart; t + durationMs <= dayEnd; t += stepMs) {
    if (t < earliest) continue
    const end = t + durationMs
    if (blocked.some((b) => overlaps(t, end, b))) continue
    slots.push(new Date(t))
  }
  return slots
}

export interface MergedSlot {
  startsAt: Date
  barberIds: string[]
}

/** Une os horários de vários barbeiros ("qualquer disponível"). */
export function mergeSlots(perBarber: ReadonlyMap<string, readonly Date[]>): MergedSlot[] {
  const byTime = new Map<number, string[]>()
  for (const [barberId, slots] of perBarber) {
    for (const s of slots) {
      const key = s.getTime()
      const list = byTime.get(key)
      if (list) list.push(barberId)
      else byTime.set(key, [barberId])
    }
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, barberIds]) => ({ startsAt: new Date(t), barberIds }))
}
