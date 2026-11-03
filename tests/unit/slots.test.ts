import { describe, expect, it } from 'vitest'
import {
  type BookingSettings,
  checkBookingDate,
  computeSlots,
  type ComputeSlotsInput,
  type Interval,
  mergeSlots,
  type WorkingDay,
} from '../../supabase/functions/_shared/slots.ts'
import { timeInTz } from '../../supabase/functions/_shared/time.ts'

const SP = 'America/Sao_Paulo'

const settings: BookingSettings = {
  timezone: SP,
  minBookingNoticeMin: 60,
  maxBookingDays: 30,
  slotStepMin: 15,
}

// seg–sex 09–19 com almoço 12–13; sáb 09–14
const week: WorkingDay[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startTime: '09:00:00',
    endTime: '19:00:00',
    breakStart: '12:00:00',
    breakEnd: '13:00:00',
  })),
  { weekday: 6, startTime: '09:00:00', endTime: '14:00:00', breakStart: null, breakEnd: null },
]

// segunda 02/11/2026 07:00 em SP
const NOW = new Date('2026-11-02T10:00:00Z')
const TUESDAY = '2026-11-03'

function slots(over: Partial<ComputeSlotsInput> = {}): string[] {
  return computeSlots({
    date: TUESDAY,
    now: NOW,
    settings,
    durationMin: 30,
    workingHours: week,
    busy: [],
    ...over,
  }).map((d) => timeInTz(d, SP))
}

const at = (iso: string) => new Date(iso)
const busy = (start: string, end: string): Interval => ({ start: at(start), end: at(end) })

describe('computeSlots', () => {
  it('dia livre: grade de 15 em 15 min do início ao fim do expediente, sem o almoço', () => {
    const s = slots()
    expect(s[0]).toBe('09:00')
    expect(s.at(-1)).toBe('18:30')
    expect(s).toHaveLength(11 + 23) // 09:00–11:30 e 13:00–18:30
  })

  it('devolve instantes UTC corretos (SP = UTC-3)', () => {
    const [first] = computeSlots({
      date: TUESDAY,
      now: NOW,
      settings,
      durationMin: 30,
      workingHours: week,
      busy: [],
    })
    expect(first?.toISOString()).toBe('2026-11-03T12:00:00.000Z')
  })

  it('intervalo: horário que invadiria o almoço não aparece', () => {
    const s = slots()
    expect(s).toContain('11:30') // termina 12:00, encosta no intervalo
    expect(s).not.toContain('11:45') // 11:45–12:15 invade
    expect(s).not.toContain('12:00')
    expect(s).not.toContain('12:45')
    expect(s).toContain('13:00')
  })

  it('fim do expediente: o serviço precisa terminar até o fechamento', () => {
    const s = slots({ durationMin: 60 })
    expect(s.at(-1)).toBe('18:00')
    expect(s).not.toContain('18:15')
  })

  it('serviços somados: 30 + 30 + 15 = 75 min', () => {
    const s = slots({ durationMin: 75 })
    expect(s).toContain('10:45') // termina 12:00
    expect(s).not.toContain('11:00') // terminaria 12:15
    expect(s.at(-1)).toBe('17:45') // termina 19:00
  })

  it('serviço maior que o expediente não gera horário', () => {
    expect(slots({ date: '2026-11-07', durationMin: 6 * 60 })).toEqual([])
  })

  it('agendamento existente bloqueia sobreposição, mas permite encostar', () => {
    // 14:00–14:30 local = 17:00–17:30Z
    const s = slots({ busy: [busy('2026-11-03T17:00:00Z', '2026-11-03T17:30:00Z')] })
    expect(s).toContain('13:30') // termina 14:00
    expect(s).not.toContain('13:45')
    expect(s).not.toContain('14:00')
    expect(s).not.toContain('14:15')
    expect(s).toContain('14:30') // começa quando o outro termina
  })

  it('bloqueio (time_off) vindo do dia anterior libera só depois do fim', () => {
    // folga até 10:00 local
    const s = slots({ busy: [busy('2026-11-02T20:00:00Z', '2026-11-03T13:00:00Z')] })
    expect(s[0]).toBe('10:00')
  })

  it('bloqueio do dia inteiro zera a agenda', () => {
    expect(slots({ busy: [busy('2026-11-03T03:00:00Z', '2026-11-04T03:00:00Z')] })).toEqual([])
  })

  it('domingo sem expediente não tem horários', () => {
    expect(slots({ date: '2026-11-08' })).toEqual([])
  })

  it('sábado: expediente curto e sem intervalo', () => {
    const s = slots({ date: '2026-11-07' })
    expect(s).toContain('12:00')
    expect(s.at(-1)).toBe('13:30')
  })

  it('antecedência mínima: hoje só a partir de agora + 60 min, alinhado à grade', () => {
    // 09:20 local -> mínimo 10:20 -> primeiro horário 10:30
    const s = slots({ date: '2026-11-02', now: at('2026-11-02T12:20:00Z') })
    expect(s[0]).toBe('10:30')
  })

  it('antecedência mínima caindo no almoço pula para depois do intervalo', () => {
    // 11:05 local -> mínimo 12:05
    const s = slots({ date: '2026-11-02', now: at('2026-11-02T14:05:00Z') })
    expect(s[0]).toBe('13:00')
  })

  it('depois do expediente de hoje não sobra horário', () => {
    expect(slots({ date: '2026-11-02', now: at('2026-11-02T22:30:00Z') })).toEqual([])
  })

  it('data no passado não tem horários', () => {
    expect(slots({ date: '2026-11-01' })).toEqual([])
  })

  it('janela máxima: até hoje + 30 dias', () => {
    expect(checkBookingDate('2026-12-02', NOW, settings)).toBe('ok')
    expect(checkBookingDate('2026-12-03', NOW, settings)).toBe('too_far')
    expect(slots({ date: '2026-12-03' })).toEqual([])
  })

  it('fuso: às 22:30 de SP (01:30Z do dia seguinte) "hoje" ainda é o dia local', () => {
    const lateNight = at('2026-11-03T01:30:00Z')
    expect(checkBookingDate('2026-11-02', lateNight, settings)).toBe('ok')
    expect(checkBookingDate('2026-11-01', lateNight, settings)).toBe('past')
    // e o dia seguinte local já tem a grade inteira
    expect(slots({ date: TUESDAY, now: lateNight })[0]).toBe('09:00')
  })

  it('passo da grade configurável', () => {
    const s = slots({ settings: { ...settings, slotStepMin: 30 } })
    expect(s.slice(0, 3)).toEqual(['09:00', '09:30', '10:00'])
  })

  it('fuso com horário de verão: grade continua em hora local', () => {
    const ny: BookingSettings = { ...settings, timezone: 'America/New_York', slotStepMin: 60 }
    const result = computeSlots({
      date: '2026-03-08', // DST começa às 02:00
      now: at('2026-03-01T00:00:00Z'),
      settings: ny,
      durationMin: 60,
      workingHours: [{ weekday: 0, startTime: '09:00', endTime: '12:00', breakStart: null, breakEnd: null }],
      busy: [],
    }).map((d) => d.toISOString())
    expect(result).toEqual([
      '2026-03-08T13:00:00.000Z',
      '2026-03-08T14:00:00.000Z',
      '2026-03-08T15:00:00.000Z',
    ])
  })
})

describe('mergeSlots ("qualquer disponível")', () => {
  it('une horários de vários barbeiros em ordem, com quem atende cada um', () => {
    const a = [at('2026-11-03T12:00:00Z'), at('2026-11-03T12:30:00Z')]
    const b = [at('2026-11-03T12:15:00Z'), at('2026-11-03T12:30:00Z')]
    const merged = mergeSlots(new Map([['A', a], ['B', b]]))
    expect(merged.map((m) => [m.startsAt.toISOString(), m.barberIds])).toEqual([
      ['2026-11-03T12:00:00.000Z', ['A']],
      ['2026-11-03T12:15:00.000Z', ['B']],
      ['2026-11-03T12:30:00.000Z', ['A', 'B']],
    ])
  })
})
