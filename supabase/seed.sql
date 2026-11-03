-- =============================================================================
-- Seed de desenvolvimento (rodado por `supabase db reset`)
-- Usuários (senha de todos: Senha@123):
--   super@barbearia.dev     -> super_admin (dono do sistema)
--   admin@barbearia.dev     -> admin (dono da barbearia, também atende)
--   rafael@barbearia.dev    -> barbeiro
--   lucas@barbearia.dev     -> barbeiro
--   cliente@barbearia.dev   -> cliente
-- NÃO usar em produção.
-- =============================================================================

-- helper local para criar usuário de e-mail/senha já confirmado
create or replace function pg_temp.seed_user(
  p_id uuid, p_email text, p_name text, p_phone text, p_role text
) returns void
language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('Senha@123', extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'))
      || case when p_role <> 'customer' then jsonb_build_object('role', p_role) else '{}'::jsonb end,
    jsonb_build_object('name', p_name, 'phone', p_phone),
    now(), now(), '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), p_id, p_id::text, 'email',
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    now(), now(), now()
  );
end;
$$;

select pg_temp.seed_user('a0000000-0000-4000-8000-000000000000', 'super@barbearia.dev',   'Super Admin',       '+5511900000000', 'super_admin');
select pg_temp.seed_user('a0000000-0000-4000-8000-000000000001', 'admin@barbearia.dev',   'Dono da Barbearia', '+5511900000001', 'admin');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000001', 'rafael@barbearia.dev',  'Rafael Souza',      '+5511900000002', 'barber');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000002', 'lucas@barbearia.dev',   'Lucas Almeida',     '+5511900000003', 'barber');
select pg_temp.seed_user('c0000000-0000-4000-8000-000000000001', 'cliente@barbearia.dev', 'João Cliente',      '+5511988887777', 'customer');

-- O trigger de signup só reconhece barber/admin; o super_admin é definido aqui.
update public.profiles set role = 'super_admin' where id = 'a0000000-0000-4000-8000-000000000000';

-- Barbeiros
insert into public.barbers (id, profile_id, display_name, active) values
  ('ba000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Rafael', true),
  ('ba000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Lucas',  true);

-- Serviços
insert into public.services (id, name, duration_min, price_cents) values
  ('5e000000-0000-4000-8000-000000000001', 'Corte',        30, 4500),
  ('5e000000-0000-4000-8000-000000000002', 'Barba',        30, 3500),
  ('5e000000-0000-4000-8000-000000000003', 'Sobrancelha',  15, 1500),
  ('5e000000-0000-4000-8000-000000000004', 'Pigmentação',  45, 6000);

-- Rafael faz tudo; Lucas não faz pigmentação
insert into public.barber_services (barber_id, service_id)
select 'ba000000-0000-4000-8000-000000000001'::uuid, id from public.services;
insert into public.barber_services (barber_id, service_id) values
  ('ba000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000001'),
  ('ba000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000002'),
  ('ba000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000003');

-- Horários seg–sex 09:00–19:00 (almoço 12:00–13:00), sáb 09:00–14:00
insert into public.working_hours (barber_id, weekday, start_time, end_time, break_start, break_end)
select b.id, d.weekday,
  '09:00'::time,
  case when d.weekday = 6 then '14:00'::time else '19:00'::time end,
  case when d.weekday = 6 then null else '12:00'::time end,
  case when d.weekday = 6 then null else '13:00'::time end
from public.barbers b
cross join generate_series(1, 6) as d(weekday);

-- Fidelidade: 10 selos
insert into public.loyalty_rules (stamps_required, reward_description, active)
values (10, 'Um corte grátis', true);
