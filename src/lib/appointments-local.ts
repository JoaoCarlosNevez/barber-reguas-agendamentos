// Links dos agendamentos feitos neste aparelho (visitante não tem conta).
// Só conveniência: guardado no navegador, pode sumir.
const KEY = 'agendareguas:appointments'

export interface LocalAppointment {
  token: string
  starts_at: string
  summary: string
}

export function listLocalAppointments(): LocalAppointment[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as LocalAppointment[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveLocalAppointment(a: LocalAppointment): void {
  try {
    const cutoff = Date.now() - 7 * 86_400_000
    const list = [a, ...listLocalAppointments().filter((x) => x.token !== a.token)]
      .filter((x) => new Date(x.starts_at).getTime() > cutoff)
      .slice(0, 10)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // armazenamento indisponível (aba anônima etc.) — segue sem salvar
  }
}
