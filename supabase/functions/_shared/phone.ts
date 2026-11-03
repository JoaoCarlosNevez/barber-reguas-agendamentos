// Normalização de telefone brasileiro para E.164 (+55DDDNUMERO).
// Aceita entradas com máscara, com/sem +55, com/sem 0 de operadora/DDD.
// Compartilhado entre Edge Functions e frontend.

export function normalizeBrPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '')

  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1)

  if (digits.length !== 10 && digits.length !== 11) return null

  const ddd = Number(digits.slice(0, 2))
  if (ddd < 11 || ddd > 99 || digits[1] === '0') return null

  const number = digits.slice(2)
  if (number.length === 9 && number[0] !== '9') return null // celular começa com 9
  if (number.length === 8 && !/^[2-5]/.test(number)) return null // fixo começa com 2-5

  return `+55${digits}`
}

/** Formata E.164 (+55...) para exibição: (11) 98765-4321 */
export function formatBrPhone(e164: string): string {
  const d = e164.replace(/^\+55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return e164
}
