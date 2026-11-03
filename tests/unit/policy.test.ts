import { describe, expect, it } from 'vitest'
import { cancelDeadline, checkCustomerCancel } from '../../supabase/functions/_shared/policy.ts'

const starts = new Date('2026-11-10T15:00:00Z')

describe('checkCustomerCancel', () => {
  it('permite cancelar antes do prazo', () => {
    expect(checkCustomerCancel('scheduled', starts, new Date('2026-11-10T12:59:59Z'), 2)).toBe('ok')
  })
  it('permite exatamente no limite', () => {
    expect(checkCustomerCancel('scheduled', starts, new Date('2026-11-10T13:00:00Z'), 2)).toBe('ok')
  })
  it('bloqueia depois do prazo', () => {
    expect(checkCustomerCancel('scheduled', starts, new Date('2026-11-10T13:00:01Z'), 2)).toBe('too_late')
  })
  it('com 0h de antecedência, vale até o início', () => {
    expect(checkCustomerCancel('scheduled', starts, new Date('2026-11-10T15:00:00Z'), 0)).toBe('ok')
    expect(checkCustomerCancel('scheduled', starts, new Date('2026-11-10T15:00:01Z'), 0)).toBe('too_late')
  })
  it.each(['cancelled', 'completed', 'no_show'] as const)('status %s não pode ser cancelado', (status) => {
    expect(checkCustomerCancel(status, starts, new Date('2026-11-01T00:00:00Z'), 2)).toBe('not_scheduled')
  })
})

describe('cancelDeadline', () => {
  it('subtrai as horas do início', () => {
    expect(cancelDeadline(starts, 24).toISOString()).toBe('2026-11-09T15:00:00.000Z')
  })
})
