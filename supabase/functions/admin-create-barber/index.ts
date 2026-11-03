// POST /functions/v1/admin-create-barber  (admin)
// { name, email, password, service_ids? }
// Cria o usuário com role "barber" (app_metadata, só a service role define),
// a linha em barbers e um expediente padrão (seg–sex 9–19, almoço 12–13; sáb 9–14).
import { z } from '../_shared/deps.ts'
import { AppError, json, readJson, serve } from '../_shared/http.ts'
import { log } from '../_shared/log.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

const FN = 'admin-create-barber'

const bodySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(80),
  email: z.email('E-mail inválido.').max(200),
  password: z.string().min(8, 'Senha com pelo menos 8 caracteres.').max(72),
  service_ids: z.array(z.uuid()).max(50).default([]),
})

serve(FN, async (req) => {
  const body = await readJson(req, bodySchema)
  await requireUser(req, ['admin'])
  const db = adminClient()

  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    app_metadata: { role: 'barber' },
    user_metadata: { name: body.name },
  })
  if (authErr || !created.user) {
    if (authErr?.code === 'email_exists' || authErr?.status === 422) {
      throw new AppError(409, 'conflict', 'Já existe uma conta com esse e-mail.')
    }
    log.error(FN, 'create_user_failed', { status: authErr?.status ?? null })
    throw new AppError(500, 'internal_error', 'Não foi possível criar o usuário.')
  }

  const userId = created.user.id

  // O GoTrue grava app_metadata depois do INSERT em auth.users, então o trigger
  // de signup ainda vê o usuário como "customer". Define o role explicitamente.
  const { error: roleErr } = await db.from('profiles').update({ role: 'barber' }).eq('id', userId)
  if (roleErr) {
    await db.auth.admin.deleteUser(userId)
    log.error(FN, 'set_role_failed', { code: roleErr.code })
    throw new AppError(500, 'internal_error', 'Não foi possível criar o barbeiro.')
  }

  const { data: barber, error: barberErr } = await db
    .from('barbers')
    .insert({ profile_id: userId, display_name: body.name })
    .select('id')
    .single()
  if (barberErr) {
    await db.auth.admin.deleteUser(userId)
    log.error(FN, 'create_barber_failed', { code: barberErr.code })
    throw new AppError(500, 'internal_error', 'Não foi possível criar o barbeiro.')
  }

  const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    barber_id: barber.id,
    weekday,
    start_time: '09:00',
    end_time: weekday === 6 ? '14:00' : '19:00',
    break_start: weekday === 6 ? null : '12:00',
    break_end: weekday === 6 ? null : '13:00',
  }))
  const services = body.service_ids.map((service_id) => ({ barber_id: barber.id, service_id }))

  const [whRes, bsRes] = await Promise.all([
    db.from('working_hours').insert(hours),
    services.length ? db.from('barber_services').insert(services) : Promise.resolve({ error: null }),
  ])
  if (whRes.error || bsRes.error) log.warn(FN, 'barber_defaults_partial', { barber_id: barber.id })

  log.info(FN, 'barber_created', { barber_id: barber.id })
  return json(req, { barber_id: barber.id }, 201)
})
