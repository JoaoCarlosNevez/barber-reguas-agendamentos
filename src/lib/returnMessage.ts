/** Preenche {nome}, {dias} e {link} da mensagem de "chamar de volta" (igual ao servidor). */
export function fillReturnMessage(template: string, customerName: string, days: number, origin: string): string {
  const first = customerName.trim().split(/\s+/)[0] ?? ''
  return template
    .replaceAll('{nome}', first)
    .replaceAll('{dias}', String(days))
    .replaceAll('{link}', `${origin}/`)
}
