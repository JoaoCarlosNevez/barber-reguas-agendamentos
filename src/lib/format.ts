import { APP_TIMEZONE } from './env'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatPrice(cents: number): string {
  return brl.format(cents / 100)
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

function fmt(options: Intl.DateTimeFormatOptions, tz = APP_TIMEZONE) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, ...options })
}

const timeFmt = fmt({ hour: '2-digit', minute: '2-digit' })
const longDateFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' })
const shortDateFmt = fmt({ weekday: 'short', day: '2-digit', month: '2-digit' })

export function formatTime(iso: string | Date): string {
  return timeFmt.format(new Date(iso))
}

/** "terça-feira, 10 de novembro" */
export function formatLongDate(iso: string | Date): string {
  return longDateFmt.format(new Date(iso))
}

/** "ter., 10/11" */
export function formatShortDate(iso: string | Date): string {
  return shortDateFmt.format(new Date(iso))
}

/** Data de calendário "YYYY-MM-DD" -> meio-dia UTC (seguro para formatar dia/semana). */
export function calendarDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`)
}

const dayChipWeek = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
const dayChipMonth = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })

export function dayChipParts(date: string): { weekday: string; day: string; month: string } {
  const d = calendarDate(date)
  return {
    weekday: dayChipWeek.format(d).replace('.', ''),
    day: String(d.getUTCDate()),
    month: dayChipMonth.format(d).replace('.', ''),
  }
}

export const STATUS_LABEL = {
  scheduled: 'Agendado',
  cancelled: 'Cancelado',
  completed: 'Atendido',
  no_show: 'Não compareceu',
} as const

export const PAYMENT_LABEL = {
  pix: 'Pix',
  cash: 'Dinheiro',
  debit: 'Débito',
  credit: 'Crédito',
} as const

export const PAYMENT_METHODS = ['pix', 'cash', 'debit', 'credit'] as const

/** "45,00" / "45" / "R$ 45,5" -> 4550 centavos; null se inválido. */
export function parseBrlToCents(input: string): number | null {
  const clean = input.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (clean === '') return null
  const value = Number(clean)
  if (!Number.isFinite(value) || value < 0 || value > 100000) return null
  return Math.round(value * 100)
}

/** 4550 -> "45,50" (para preencher campo de valor) */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}
