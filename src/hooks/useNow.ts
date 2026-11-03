import { useEffect, useState } from 'react'

/** Relógio que atualiza sozinho (padrão: a cada minuto). Mantém o render puro. */
export function useNow(refreshMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])
  return now
}
