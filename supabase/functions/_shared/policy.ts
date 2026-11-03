// Regras puras (sem I/O), compartilhadas com o frontend e testadas no Vitest.

export type AppointmentStatus = 'scheduled' | 'cancelled' | 'completed' | 'no_show'

/** Último instante em que o cliente ainda pode cancelar sozinho. */
export function cancelDeadline(startsAt: Date, cancelMinNoticeHours: number): Date {
  return new Date(startsAt.getTime() - cancelMinNoticeHours * 3_600_000)
}

export type CancelCheck = 'ok' | 'not_scheduled' | 'too_late'

export function checkCustomerCancel(
  status: AppointmentStatus,
  startsAt: Date,
  now: Date,
  cancelMinNoticeHours: number,
): CancelCheck {
  if (status !== 'scheduled') return 'not_scheduled'
  if (now.getTime() > cancelDeadline(startsAt, cancelMinNoticeHours).getTime()) return 'too_late'
  return 'ok'
}
