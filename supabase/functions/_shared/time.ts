// Utilitários de fuso horário sem dependências (Intl), usados no Deno e no Vitest.
// Independem do TZ do processo: toda conversão é explícita para o fuso informado.

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    if (p.type in out) out[p.type as keyof ZonedParts] = Number(p.value)
  }
  return out
}

/** Diferença (ms) entre o relógio local do fuso e UTC no instante dado. */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date)
  if (!m) throw new RangeError(`data inválida: ${date}`)
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`data inválida: ${date}`)
  }
  return { year, month, day }
}

/** Minutos desde 00:00 para "HH:MM" ou "HH:MM:SS" (formato do Postgres `time`). */
export function timeToMinutes(time: string): number {
  const m = TIME_RE.exec(time)
  if (!m) throw new RangeError(`horário inválido: ${time}`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new RangeError(`horário inválido: ${time}`)
  return h * 60 + min
}

/** Converte data + minutos do dia no fuso informado para o instante UTC. */
export function zonedToUtc(date: string, minutesOfDay: number, timeZone: string): Date {
  const { year, month, day } = parseDate(date)
  const naive = Date.UTC(year, month - 1, day) + minutesOfDay * MINUTE_MS
  const first = naive - tzOffsetMs(new Date(naive), timeZone)
  const second = naive - tzOffsetMs(new Date(first), timeZone)
  return new Date(second)
}

/** "YYYY-MM-DD" do instante no fuso informado. */
export function dateInTz(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** "HH:MM" do instante no fuso informado. */
export function timeInTz(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** Dia da semana (0 = domingo) de uma data de calendário. */
export function weekdayOf(date: string): number {
  const { year, month, day } = parseDate(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date)
  const d = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Diferença em dias de calendário (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a)
  const pb = parseDate(b)
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY_MS,
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
