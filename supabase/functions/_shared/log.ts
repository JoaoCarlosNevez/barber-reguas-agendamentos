// Logs estruturados. Regra: NUNCA logar nome, telefone, e-mail, IP, token ou
// corpo da requisição. Apenas ids internos, códigos e contagens.
type Fields = Record<string, string | number | boolean | null | undefined>

function write(level: 'info' | 'warn' | 'error', fn: string, event: string, fields?: Fields) {
  const line = JSON.stringify({ level, fn, event, ...fields, at: new Date().toISOString() })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (fn: string, event: string, fields?: Fields) => write('info', fn, event, fields),
  warn: (fn: string, event: string, fields?: Fields) => write('warn', fn, event, fields),
  error: (fn: string, event: string, fields?: Fields) => write('error', fn, event, fields),
}
