import { z } from './deps.ts'
import { parseDate } from './time.ts'

export const barberIdSchema = z.union([z.literal('any'), z.uuid()])

export const serviceIdsSchema = z
  .array(z.uuid())
  .min(1, 'Escolha ao menos um serviço.')
  .max(6, 'Máximo de 6 serviços por agendamento.')
  .refine((ids) => new Set(ids).size === ids.length, 'Serviço repetido.')

export const dateSchema = z.string().refine((v) => {
  try {
    parseDate(v)
    return true
  } catch {
    return false
  }
}, 'Data inválida (use AAAA-MM-DD).')

/** Token do link do agendamento: 128 bits em base64url (22 caracteres). */
export const appointmentTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/, 'Link de agendamento inválido.')
