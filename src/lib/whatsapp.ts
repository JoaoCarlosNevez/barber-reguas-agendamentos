import { formatLongDate, formatTime } from './format'

/** Link do WhatsApp com a mensagem de cancelamento pronta (dia, hora, serviços e link para remarcar). */
export function cancelWhatsappUrl(a: {
  starts_at: string
  customer: { name: string; phone: string } | null
  appointment_services: { service_name: string }[]
}): string | null {
  if (!a.customer?.phone) return null
  const first = a.customer.name.trim().split(/\s+/)[0] ?? ''
  const services = a.appointment_services.map((s) => s.service_name).join(' + ')
  const text = `Oi, ${first}! Aqui é do Studio Réguas. Infelizmente precisamos cancelar seu horário de ${formatLongDate(a.starts_at)} às ${formatTime(a.starts_at)} (${services}). Desculpe o transtorno! Quer remarcar? É só escolher outro horário: ${window.location.origin}/`
  return `https://wa.me/${a.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}
