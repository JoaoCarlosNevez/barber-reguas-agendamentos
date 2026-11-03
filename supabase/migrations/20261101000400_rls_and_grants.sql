-- =============================================================================
-- Grants + Row Level Security
-- Princípios:
--   * anon NÃO acessa tabelas de clientes/agendamentos. Fluxos públicos passam
--     pelas Edge Functions (service role).
--   * Defesa em profundidade: GRANT restrito por tabela/coluna + RLS em TODAS
--     as tabelas.
--   * Role do usuário vem de public.profiles (só a service role altera).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Grants: começa do zero e libera só o necessário
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- leitura pública (catálogo)
grant select on public.services, public.barber_services, public.loyalty_rules, public.app_settings
  to anon, authenticated;
-- anon vê só colunas públicas de barbeiros
grant select (id, display_name, photo_url, active) on public.barbers to anon;
grant select on public.barbers to authenticated;

-- autenticado: leitura (linhas filtradas por RLS)
grant select on
  public.profiles,
  public.working_hours,
  public.time_off,
  public.customers,
  public.appointments,
  public.appointment_services,
  public.loyalty_stamps,
  public.loyalty_redemptions,
  public.push_subscriptions
  to authenticated;

-- profile: usuário só edita nome/telefone (role fica de fora)
grant update (name, phone) on public.profiles to authenticated;

-- catálogo/agenda: escrita só para admin (RLS abaixo)
grant insert, update, delete on
  public.barbers,
  public.services,
  public.barber_services,
  public.working_hours,
  public.time_off,
  public.loyalty_rules
  to authenticated;
grant update on public.app_settings to authenticated;

-- agendamento: barbeiro/admin só mudam status (trigger valida a transição)
grant update (status) on public.appointments to authenticated;

-- push: inserção via edge function; usuário pode listar/remover as suas
grant delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- Habilita RLS em todas as tabelas
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.barber_services enable row level security;
alter table public.working_hours enable row level security;
alter table public.time_off enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;
alter table public.loyalty_rules enable row level security;
alter table public.loyalty_stamps enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.push_subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
create policy app_settings_read on public.app_settings
  for select to anon, authenticated using (true);
create policy app_settings_admin_update on public.app_settings
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update_own_or_admin on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- barbers
-- ---------------------------------------------------------------------------
create policy barbers_public_read on public.barbers
  for select to anon using (active);
create policy barbers_auth_read on public.barbers
  for select to authenticated
  using (active or profile_id = (select auth.uid()) or (select private.is_admin()));
create policy barbers_admin_insert on public.barbers
  for insert to authenticated with check ((select private.is_admin()));
create policy barbers_admin_update on public.barbers
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy barbers_admin_delete on public.barbers
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
create policy services_public_read on public.services
  for select to anon using (active);
create policy services_auth_read on public.services
  for select to authenticated using (active or (select private.is_admin()));
create policy services_admin_insert on public.services
  for insert to authenticated with check ((select private.is_admin()));
create policy services_admin_update on public.services
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy services_admin_delete on public.services
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- barber_services
-- ---------------------------------------------------------------------------
create policy barber_services_public_read on public.barber_services
  for select to anon, authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.barbers b join public.services s on s.id = barber_services.service_id
      where b.id = barber_services.barber_id and b.active and s.active
    )
  );
create policy barber_services_admin_insert on public.barber_services
  for insert to authenticated with check ((select private.is_admin()));
create policy barber_services_admin_update on public.barber_services
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy barber_services_admin_delete on public.barber_services
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- working_hours / time_off: barbeiro lê os seus, admin gerencia
-- ---------------------------------------------------------------------------
create policy working_hours_read on public.working_hours
  for select to authenticated
  using (barber_id = (select private.my_barber_id()) or (select private.is_admin()));
create policy working_hours_admin_insert on public.working_hours
  for insert to authenticated with check ((select private.is_admin()));
create policy working_hours_admin_update on public.working_hours
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy working_hours_admin_delete on public.working_hours
  for delete to authenticated using ((select private.is_admin()));

create policy time_off_read on public.time_off
  for select to authenticated
  using (barber_id = (select private.my_barber_id()) or (select private.is_admin()));
create policy time_off_admin_insert on public.time_off
  for insert to authenticated with check ((select private.is_admin()));
create policy time_off_admin_update on public.time_off
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy time_off_admin_delete on public.time_off
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- customers: o próprio cliente, barbeiros que o atenderam, admin
-- ---------------------------------------------------------------------------
create policy customers_read on public.customers
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or (select private.is_admin())
    or private.barber_has_customer(id)
  );

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
create policy appointments_read on public.appointments
  for select to authenticated
  using (
    (select private.is_admin())
    or barber_id = (select private.my_barber_id())
    or customer_id = (select private.my_customer_id())
  );
create policy appointments_staff_update on public.appointments
  for update to authenticated
  using ((select private.is_admin()) or barber_id = (select private.my_barber_id()))
  with check ((select private.is_admin()) or barber_id = (select private.my_barber_id()));

create policy appointment_services_read on public.appointment_services
  for select to authenticated
  using (private.can_see_appointment(appointment_id));

-- ---------------------------------------------------------------------------
-- loyalty
-- ---------------------------------------------------------------------------
create policy loyalty_rules_public_read on public.loyalty_rules
  for select to anon using (active);
create policy loyalty_rules_auth_read on public.loyalty_rules
  for select to authenticated using (active or (select private.is_admin()));
create policy loyalty_rules_admin_insert on public.loyalty_rules
  for insert to authenticated with check ((select private.is_admin()));
create policy loyalty_rules_admin_update on public.loyalty_rules
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy loyalty_rules_admin_delete on public.loyalty_rules
  for delete to authenticated using ((select private.is_admin()));

create policy loyalty_stamps_read on public.loyalty_stamps
  for select to authenticated
  using (
    customer_id = (select private.my_customer_id())
    or (select private.is_admin())
    or private.barber_has_customer(customer_id)
  );

create policy loyalty_redemptions_read on public.loyalty_redemptions
  for select to authenticated
  using (
    customer_id = (select private.my_customer_id())
    or (select private.is_admin())
    or private.barber_has_customer(customer_id)
  );

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
create policy push_subscriptions_read_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Tabelas futuras não herdam acesso automático de anon/authenticated
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
