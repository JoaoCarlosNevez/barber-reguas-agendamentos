// Código puro compartilhado com as Edge Functions (mesmas regras dos dois lados).
export { formatBrPhone, normalizeBrPhone } from '../../supabase/functions/_shared/phone.ts'
export { addDays, dateInTz, timeInTz, weekdayOf, zonedToUtc } from '../../supabase/functions/_shared/time.ts'
export { cancelDeadline, checkCustomerCancel } from '../../supabase/functions/_shared/policy.ts'
