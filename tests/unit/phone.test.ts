import { describe, expect, it } from 'vitest'
import { formatBrPhone, normalizeBrPhone } from '../../supabase/functions/_shared/phone.ts'

describe('normalizeBrPhone', () => {
  it.each([
    ['(11) 98765-4321', '+5511987654321'],
    ['11987654321', '+5511987654321'],
    ['+55 11 98765-4321', '+5511987654321'],
    ['5511987654321', '+5511987654321'],
    ['011987654321', '+5511987654321'],
    ['(21) 3456-7890', '+552134567890'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBrPhone(input)).toBe(expected)
  })

  it.each([
    ['', 'vazio'],
    ['123', 'curto demais'],
    ['(11) 88765-4321', 'celular sem 9'],
    ['(01) 98765-4321', 'DDD inválido'],
    ['(11) 1234-5678', 'fixo começando com 1'],
    ['+1 415 555 0100', 'não brasileiro'],
  ])('%s é inválido (%s)', (input) => {
    expect(normalizeBrPhone(input)).toBeNull()
  })
})

describe('formatBrPhone', () => {
  it('formata celular e fixo', () => {
    expect(formatBrPhone('+5511987654321')).toBe('(11) 98765-4321')
    expect(formatBrPhone('+552134567890')).toBe('(21) 3456-7890')
  })
})
