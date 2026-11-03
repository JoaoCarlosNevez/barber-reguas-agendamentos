-- =============================================================================
-- Testes de RLS / grants / regras de integridade
-- Rodar: npx supabase test db
-- Fixtures próprias (não depende do seed). Tudo roda numa transação com rollback.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- clientes cadastrados A e B (trigger cria profile + customer)
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'a@test.dev', '{"name":"Cliente A","phone":"+5511911110001"}', '{}'),
  ('22222222-2222-4222-8222-222222222222', 'b@test.dev', '{"name":"Cliente B","phone":"+5511911110002"}', '{}'),
  -- barbeiros R e L (role via app_metadata = só service role define)
  ('33333333-3333-4333-8333-333333333333', 'r@test.dev', '{"name":"Barbeiro R"}', '{"role":"barber"}'),
  ('44444444-4444-4444-8444-444444444444', 'l@test.dev', '{"name":"Barbeiro L"}', '{"role":"barber"}'),
  -- tentativa de escalar privilégio pelo user_metadata
  ('55555555-5555-4555-8555-555555555555', 'evil@test.dev', '{"name":"Evil","phone":"+5511911110005","role":"admin"}', '{}');

insert into public.barbers (id, profile_id, display_name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'R'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'L');

insert into public.customers (id, name, phone) values
  ('99999999-0000-4000-8000-000000000001', 'Visitante', '+5511911110003');

insert into public.services (id, name, duration_min, price_cents, active) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'Serviço Ativo', 30, 1000, true),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Serviço Inativo', 30, 1000, false);

insert into public.appointments (id, barber_id, customer_id, starts_at, ends_at, cancel_token_hash) values
  -- A com R, no passado (pode ser concluído)
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   (select id from public.customers where auth_user_id = '11111111-1111-4111-8111-111111111111'),
   now() - interval '2 hours', now() - interval '90 minutes', encode(digest('t1', 'sha256'), 'hex')),
  -- B com L, no futuro
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002',
   (select id from public.customers where auth_user_id = '22222222-2222-4222-8222-222222222222'),
   now() + interval '1 day', now() + interval '1 day 30 minutes', encode(digest('t2', 'sha256'), 'hex')),
  -- visitante com R, no passado
  ('a1000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
   '99999999-0000-4000-8000-000000000001',
   now() - interval '4 hours', now() - interval '210 minutes', encode(digest('t3', 'sha256'), 'hex')),
  -- A com R, no futuro
  ('a1000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001',
   (select id from public.customers where auth_user_id = '11111111-1111-4111-8111-111111111111'),
   date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 30 minutes',
   encode(digest('t4', 'sha256'), 'hex'));

insert into public.appointment_services (appointment_id, service_id, service_name, price_cents, duration_min) values
  ('a1000000-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'Serviço Ativo', 1000, 30),
  ('a1000000-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001', 'Serviço Ativo', 1000, 30);

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('22222222-2222-4222-8222-222222222222', 'https://push.example/b', 'k', 'a');

-- ---------------------------------------------------------------------------
-- Signup
-- ---------------------------------------------------------------------------
select is(
  (select role from public.profiles where id = '55555555-5555-4555-8555-555555555555'),
  'customer'::public.user_role,
  'role em user_metadata é ignorado no signup (sem escalada de privilégio)'
);
select is(
  (select role from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  'barber'::public.user_role,
  'role em app_metadata (service role) é respeitado'
);
select is(
  (select count(*)::int from public.customers where auth_user_id = '11111111-1111-4111-8111-111111111111' and not is_guest),
  1,
  'signup de cliente cria customer vinculado'
);

-- ---------------------------------------------------------------------------
-- ANON
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok('select * from public.customers', '42501', null, 'anon não lê customers');
select throws_ok('select * from public.appointments', '42501', null, 'anon não lê appointments');
select throws_ok('select * from public.appointment_services', '42501', null, 'anon não lê appointment_services');
select throws_ok('select * from public.profiles', '42501', null, 'anon não lê profiles');
select throws_ok('select * from public.loyalty_stamps', '42501', null, 'anon não lê loyalty_stamps');
select throws_ok('select * from public.push_subscriptions', '42501', null, 'anon não lê push_subscriptions');
select throws_ok('select * from public.working_hours', '42501', null, 'anon não lê working_hours');
select throws_ok(
  $$insert into public.customers (name, phone) values ('x', '+5511900000000')$$,
  '42501', null, 'anon não insere customers'
);
select throws_ok(
  $$insert into public.appointments (barber_id, customer_id, starts_at, ends_at, cancel_token_hash)
    values ('aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001',
            now(), now() + interval '30 minutes', repeat('a', 64))$$,
  '42501', null, 'anon não insere appointments'
);
select throws_ok('select profile_id from public.barbers', '42501', null, 'anon não vê profile_id dos barbeiros');
select ok(
  exists (select 1 from public.services where id = 'eeeeeeee-0000-4000-8000-000000000001'),
  'anon vê serviço ativo'
);
select ok(
  not exists (select 1 from public.services where id = 'eeeeeeee-0000-4000-8000-000000000002'),
  'anon não vê serviço inativo'
);
select throws_ok(
  $$select public.redeem_loyalty('99999999-0000-4000-8000-000000000001', null)$$,
  '42501', null, 'anon não executa redeem_loyalty'
);

reset role;

-- ---------------------------------------------------------------------------
-- CLIENTE A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select results_eq(
  'select auth_user_id from public.customers',
  $$values ('11111111-1111-4111-8111-111111111111'::uuid)$$,
  'cliente A só vê o próprio customer'
);
select results_eq(
  'select id from public.appointments order by id',
  $$values ('a1000000-0000-4000-8000-000000000001'::uuid), ('a1000000-0000-4000-8000-000000000004'::uuid)$$,
  'cliente A só vê os próprios agendamentos'
);
select is_empty(
  $$select 1 from public.appointment_services where appointment_id = 'a1000000-0000-4000-8000-000000000002'$$,
  'cliente A não vê serviços do agendamento de B'
);
select results_eq(
  'select id from public.profiles',
  $$values ('11111111-1111-4111-8111-111111111111'::uuid)$$,
  'cliente A só vê o próprio profile'
);
select is_empty('select 1 from public.push_subscriptions', 'cliente A não vê push subscriptions de B');
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'cliente não altera o próprio role'
);
select lives_ok(
  $$update public.profiles set name = 'Cliente A2' where id = '11111111-1111-4111-8111-111111111111'$$,
  'cliente altera o próprio nome'
);
select is_empty(
  $$update public.profiles set name = 'hack' where id = '22222222-2222-4222-8222-222222222222' returning 1$$,
  'cliente A não altera profile de B'
);
select is_empty(
  $$update public.appointments set status = 'cancelled' where id = 'a1000000-0000-4000-8000-000000000004' returning 1$$,
  'cliente não altera agendamento direto (só via edge function por token)'
);
select throws_ok(
  $$insert into public.services (name, duration_min, price_cents) values ('x', 30, 0)$$,
  '42501', null, 'cliente não cria serviço'
);
select throws_ok(
  $$select public.redeem_loyalty('99999999-0000-4000-8000-000000000001', null)$$,
  '42501', null, 'cliente não executa redeem_loyalty'
);

reset role;

select is(
  (select name from public.customers where auth_user_id = '11111111-1111-4111-8111-111111111111'),
  'Cliente A2',
  'alterar nome no profile sincroniza customer'
);

-- ---------------------------------------------------------------------------
-- CLIENTE B
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select results_eq(
  'select id from public.appointments',
  $$values ('a1000000-0000-4000-8000-000000000002'::uuid)$$,
  'cliente B só vê o próprio agendamento'
);
select results_eq(
  'select count(*)::int from public.customers',
  $$values (1)$$,
  'cliente B só vê o próprio customer'
);

reset role;

-- ---------------------------------------------------------------------------
-- BARBEIRO R
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select results_eq(
  'select id from public.appointments order by id',
  $$values ('a1000000-0000-4000-8000-000000000001'::uuid),
           ('a1000000-0000-4000-8000-000000000003'::uuid),
           ('a1000000-0000-4000-8000-000000000004'::uuid)$$,
  'barbeiro R só vê os agendamentos dele'
);
select is(
  (select count(*)::int from public.customers),
  2,
  'barbeiro R vê só clientes que atendeu (A e visitante), não B'
);
select is_empty(
  $$update public.appointments set status = 'cancelled' where id = 'a1000000-0000-4000-8000-000000000002' returning 1$$,
  'barbeiro R não altera agendamento de L'
);
select throws_ok(
  $$update public.appointments set starts_at = now() where id = 'a1000000-0000-4000-8000-000000000004'$$,
  '42501', null, 'barbeiro não altera horário (só status)'
);
select throws_ok(
  $$update public.appointments set status = 'completed' where id = 'a1000000-0000-4000-8000-000000000004'$$,
  'P0001', 'appointment_not_started', 'não conclui agendamento futuro'
);
select throws_ok(
  $$update public.appointments set status = 'completed' where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'P0001', 'payment_required', 'concluir exige a forma de pagamento'
);
select lives_ok(
  $$update public.appointments set status = 'completed', payment_method = 'pix'
    where id in ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003')$$,
  'barbeiro conclui os próprios agendamentos passados'
);
select ok(
  (select paid_cents is not null and completed_at is not null
     from public.appointments where id = 'a1000000-0000-4000-8000-000000000001'),
  'valor pago assume o total dos serviços quando não informado'
);
select throws_ok(
  $$update public.appointments set paid_cents = 1 where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'P0001', 'payment_locked', 'barbeiro não altera o pagamento depois de concluído'
);
select throws_ok(
  $$update public.appointments set status = 'scheduled' where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'transição completed -> scheduled é bloqueada'
);
select lives_ok(
  $$update public.appointments set status = 'cancelled' where id = 'a1000000-0000-4000-8000-000000000004'$$,
  'barbeiro cancela agendamento futuro dele'
);

reset role;

-- ---------------------------------------------------------------------------
-- Efeitos (como postgres)
-- ---------------------------------------------------------------------------
select is(
  (select cancelled_by from public.appointments where id = 'a1000000-0000-4000-8000-000000000004'),
  'barber'::public.cancel_actor,
  'cancelled_by é derivado do role de quem cancelou'
);
select results_eq(
  'select appointment_id from public.loyalty_stamps',
  $$values ('a1000000-0000-4000-8000-000000000001'::uuid)$$,
  'selo gerado só para cliente cadastrado (visitante não ganha)'
);

-- ---------------------------------------------------------------------------
-- ANTI-OVERBOOKING
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.appointments (barber_id, customer_id, starts_at, ends_at, cancel_token_hash)
    values ('aaaaaaaa-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001',
            now() + interval '1 day 15 minutes', now() + interval '1 day 45 minutes', repeat('b', 64))$$,
  '23P01', null, 'sobreposição com agendamento scheduled do mesmo barbeiro é rejeitada'
);
select lives_ok(
  $$insert into public.appointments (barber_id, customer_id, starts_at, ends_at, cancel_token_hash)
    values ('aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001',
            date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 30 minutes',
            repeat('c', 64))$$,
  'mesmo horário de um agendamento cancelado fica livre'
);

-- ---------------------------------------------------------------------------
-- RESGATE DE FIDELIDADE (service role / postgres)
-- ---------------------------------------------------------------------------
update public.loyalty_rules set active = false;
insert into public.loyalty_rules (stamps_required, reward_description) values (1, 'Teste');

select lives_ok(
  $$select public.redeem_loyalty(
      (select id from public.customers where auth_user_id = '11111111-1111-4111-8111-111111111111'), null)$$,
  'resgate consome selos quando há o suficiente'
);
select throws_ok(
  $$select public.redeem_loyalty(
      (select id from public.customers where auth_user_id = '11111111-1111-4111-8111-111111111111'), null)$$,
  'P0001', 'insufficient_stamps', 'selo já consumido não é reutilizado'
);

select * from finish();
rollback;
