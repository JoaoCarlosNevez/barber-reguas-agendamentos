import { describe, expect, it } from 'vitest'
import { buildIcs } from '../../src/lib/ics.ts'
import { maskBrPhone } from '../../src/lib/phoneMask.ts'

describe('maskBrPhone', () => {
  it.each([
    ['', ''],
    ['1', '(1'],
    ['11', '(11'],
    ['119', '(11) 9'],
    ['1198765', '(11) 9876-5'],
    ['1134567890', '(11) 3456-7890'],
    ['11987654321', '(11) 98765-4321'],
    ['(11) 98765-43210', '(11) 98765-4321'],
  ])('%s -> %s', (input, expected) => {
    expect(maskBrPhone(input)).toBe(expected)
  })
})

describe('buildIcs', () => {
  const ics = buildIcs({
    uid: 'abc',
    title: 'Corte; Barba, etc',
    description: 'linha 1\nlinha 2',
    start: '2026-11-10T15:00:00.000Z',
    end: '2026-11-10T15:30:00.000Z',
  })
  it('usa horários UTC no formato iCalendar', () => {
    expect(ics).toContain('DTSTART:20261110T150000Z')
    expect(ics).toContain('DTEND:20261110T153000Z')
  })
  it('escapa caracteres especiais', () => {
    expect(ics).toContain('SUMMARY:Corte\\; Barba\\, etc')
    expect(ics).toContain('DESCRIPTION:linha 1\\nlinha 2')
  })
  it('usa CRLF', () => {
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR')
  })
})
