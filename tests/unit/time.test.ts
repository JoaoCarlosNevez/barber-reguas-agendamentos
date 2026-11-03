import { afterEach, describe, expect, it } from 'vitest'
import {
  addDays,
  dateInTz,
  daysBetween,
  timeInTz,
  timeToMinutes,
  weekdayOf,
  zonedToUtc,
} from '../../supabase/functions/_shared/time.ts'

const SP = 'America/Sao_Paulo'
const originalTz = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTz
})

describe('zonedToUtc', () => {
  it('converte horário de São Paulo (UTC-3) para UTC', () => {
    expect(zonedToUtc('2026-11-03', 9 * 60, SP).toISOString()).toBe('2026-11-03T12:00:00.000Z')
    expect(zonedToUtc('2026-11-03', 23 * 60 + 30, SP).toISOString()).toBe('2026-11-04T02:30:00.000Z')
  })

  it('não depende do fuso do processo/servidor', () => {
    process.env.TZ = 'Asia/Tokyo'
    expect(zonedToUtc('2026-11-03', 9 * 60, SP).toISOString()).toBe('2026-11-03T12:00:00.000Z')
    process.env.TZ = 'UTC'
    expect(zonedToUtc('2026-11-03', 9 * 60, SP).toISOString()).toBe('2026-11-03T12:00:00.000Z')
  })

  it('respeita o horário de verão histórico de SP (2018, UTC-2) via Intl', () => {
    expect(zonedToUtc('2018-11-05', 9 * 60, SP).toISOString()).toBe('2018-11-05T11:00:00.000Z')
  })

  it('funciona em fuso com horário de verão (Nova York)', () => {
    const NY = 'America/New_York'
    expect(zonedToUtc('2026-03-07', 9 * 60, NY).toISOString()).toBe('2026-03-07T14:00:00.000Z')
    expect(zonedToUtc('2026-03-08', 9 * 60, NY).toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })
})

describe('helpers de calendário', () => {
  it('dateInTz usa o dia local, não o dia UTC', () => {
    // 01:30Z do dia 3 ainda é 22:30 do dia 2 em SP
    const instant = new Date('2026-11-03T01:30:00Z')
    expect(dateInTz(instant, SP)).toBe('2026-11-02')
    expect(timeInTz(instant, SP)).toBe('22:30')
  })

  it('weekdayOf segue a convenção 0 = domingo', () => {
    expect(weekdayOf('2026-11-01')).toBe(0)
    expect(weekdayOf('2026-11-02')).toBe(1)
    expect(weekdayOf('2026-11-07')).toBe(6)
  })

  it('addDays/daysBetween atravessam mês e ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-11-02', '2026-12-02')).toBe(30)
  })

  it('timeToMinutes aceita HH:MM e HH:MM:SS (Postgres)', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('19:00:00')).toBe(1140)
    expect(() => timeToMinutes('25:00')).toThrow()
  })

  it('rejeita datas inexistentes', () => {
    expect(() => weekdayOf('2026-02-30')).toThrow()
  })
})
