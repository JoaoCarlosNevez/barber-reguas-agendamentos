// Comparação de nomes para o login do cliente (telefone + nome).
// Compara só o primeiro nome, sem acento e sem diferenciar maiúsculas:
// "joão" confere com "João Carlos".

export function firstNameKey(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .split(/\s+/)[0] ?? ''
  )
}

export function sameFirstName(a: string, b: string): boolean {
  const ka = firstNameKey(a)
  return ka !== '' && ka === firstNameKey(b)
}
