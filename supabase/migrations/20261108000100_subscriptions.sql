-- =============================================================================
-- Assinatura mensal (ex.: "4 cortes por mês")
--   * Dono cadastra planos (valor, cortes por mês, serviços cobertos).
--   * Dono ativa/renova a assinatura do cliente (um mês do plano) e marca se
--     foi pago. Só o que está pago entra no faturamento, no dia do pagamento.
--     Pendente continua valendo para agendar (o dono liberou).
--   * Agendamento (site ou app) de um assinante, dentro do período e com corte
--     sobrando: os serviços cobertos saem sem custo e o horário conta 1 uso.
--     Cancelado devolve o uso; falta conta. Sobra não acumula.
--   * Dono pode corrigir quantos cortes já foram usados (ajuste manual).
-- =============================================================================

alter type public.payment_method add value if not exists 'subscription';

-- ---------------------------------------------------------------------------
-- Planos
-- ---------------------------------------------------------------------------
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  price_cents integer not null check (price_cents between 0 and 10000000),
  cuts_per_month integer not null check (cuts_per_month between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subscription_plan_services (
  plan_id uuid not null references public.subscription_plans (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (plan_id, service_id)
);

-- ---------------------------------------------------------------------------
-- Assinatura do cliente: uma linha por mês pago (renovar = nova linha)
-- ---------------------------------------------------------------------------
create table public.customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  plan_id uuid references public.subscription_plans (id) on delete set null,
  -- retrato do plano no momento do pagamento
  plan_name text not null,
  cuts_included integer not null check (cuts_included between 1 and 60),
  covered_service_ids uuid[] not null,
  -- período [starts_on, ends_on) em datas locais da barbearia
  starts_on date not null,
  ends_on date not null,
  price_cents integer not null check (price_cents between 0 and 10000000),
  -- pendente: os dois nulos
  payment_method public.payment_method,
  paid_at timestamptz,
  -- correção manual do dono: usados = agendamentos ligados + ajuste
  cuts_adjustment integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on > starts_on),
  check ((payment_method is null) = (paid_at is null)),
  -- um período por vez para cada cliente
  constraint customer_subscriptions_no_overlap exclude using gist (
    customer_id with =,
    daterange(starts_on, ends_on, '[)') with &&
  )
);
create index customer_subscriptions_paid_idx on public.customer_subscriptions (paid_at);

alter table public.appointments
  add column subscription_id uuid references public.customer_subscriptions (id) on delete set null;
create index appointments_subscription_idx on public.appointments (subscription_id) where subscription_id is not null;

alter table public.appointment_services
  add column covered boolean not null default false;

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------
grant select on public.subscription_plans, public.subscription_plan_services to authenticated;
grant insert, update, delete on public.subscription_plans, public.subscription_plan_services to authenticated;
grant select on public.customer_subscriptions to authenticated;

alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_services enable row level security;
alter table public.customer_subscriptions enable row level security;

create policy subscription_plans_read on public.subscription_plans
  for select to authenticated using (true);
create policy subscription_plans_admin_write on public.subscription_plans
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy subscription_plan_services_read on public.subscription_plan_services
  for select to authenticated using (true);
create policy subscription_plan_services_admin_write on public.subscription_plan_services
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- o próprio cliente, barbeiros que o atendem e o dono
create policy customer_subscriptions_read on public.customer_subscriptions
  for select to authenticated
  using (
    (select private.is_admin())
    or customer_id = (select private.my_customer_id())
    or private.barber_has_customer(customer_id)
  );

-- ---------------------------------------------------------------------------
-- Uso: agendamentos ligados (menos cancelados) + ajuste manual
-- ---------------------------------------------------------------------------
create function private.subscription_used(p_subscription_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.appointments a
      where a.subscription_id = p_subscription_id and a.status <> 'cancelled')
    + coalesce((select s.cuts_adjustment from public.customer_subscriptions s where s.id = p_subscription_id), 0)
  )::integer;
$$;

-- Para a tela: usos de várias assinaturas que quem chama pode ver (RLS)
create function public.subscription_usage(p_ids uuid[])
returns table (subscription_id uuid, used integer)
language sql stable
set search_path = ''
as $$
  select s.id, private.subscription_used(s.id)
  from public.customer_subscriptions s
  where s.id = any (p_ids);
$$;
revoke all on function public.subscription_usage(uuid[]) from public, anon;
grant execute on function public.subscription_usage(uuid[]) to authenticated, service_role;
grant execute on function private.subscription_used(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Aplica a assinatura a um agendamento 'scheduled' ainda sem assinatura.
-- Devolve true se cobriu.
-- ---------------------------------------------------------------------------
create function private.apply_subscription(p_appointment_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
  v_sub public.customer_subscriptions;
  v_day date;
begin
  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found or v_appt.status <> 'scheduled' or v_appt.subscription_id is not null then
    return false;
  end if;

  select (v_appt.starts_at at time zone st.timezone)::date into v_day from public.app_settings st limit 1;

  select * into v_sub from public.customer_subscriptions s
  where s.customer_id = v_appt.customer_id and v_day >= s.starts_on and v_day < s.ends_on
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.appointment_services x
    where x.appointment_id = p_appointment_id and x.service_id = any (v_sub.covered_service_ids)
  ) then
    return false;
  end if;

  if private.subscription_used(v_sub.id) >= v_sub.cuts_included then
    return false;
  end if;

  update public.appointments set subscription_id = v_sub.id where id = p_appointment_id;
  update public.appointment_services set covered = true
  where appointment_id = p_appointment_id and service_id = any (v_sub.covered_service_ids);
  return true;
end;
$$;
revoke all on function private.apply_subscription(uuid) from public, anon, authenticated;
-- book_appointment roda como service role (edge functions)
grant execute on function private.apply_subscription(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Reserva: igual à anterior + aplica a assinatura no fim
-- ---------------------------------------------------------------------------
create or replace function public.book_appointment(
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_cancel_token_hash text,
  p_customer_name text,
  p_customer_phone text,
  p_auth_user_id uuid default null
)
returns table (
  appointment_id uuid,
  customer_id uuid,
  customer_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  total_price_cents integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_found integer;
  v_duration integer;
  v_price integer;
  v_customer_id uuid;
  v_customer_name text;
  v_appointment_id uuid;
  v_ends_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('book_appointment:' || p_barber_id::text, 0));

  select array_agg(distinct x) into v_ids from unnest(p_service_ids) as x;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'invalid_services' using errcode = 'P0001';
  end if;

  select count(*), sum(s.duration_min), sum(s.price_cents)
    into v_found, v_duration, v_price
  from public.services s
  join public.barber_services bs on bs.service_id = s.id and bs.barber_id = p_barber_id
  join public.barbers b on b.id = bs.barber_id and b.active
  where s.id = any (v_ids) and s.active;

  if v_found <> array_length(v_ids, 1) then
    raise exception 'invalid_services' using errcode = 'P0001';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  if p_auth_user_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_auth_user_id and p.role = 'customer'
  ) then
    p_auth_user_id := null;
  end if;

  if p_auth_user_id is not null then
    select c.id, c.name into v_customer_id, v_customer_name
    from public.customers c where c.auth_user_id = p_auth_user_id;

    if not found then
      insert into public.customers (auth_user_id, is_guest, name, phone)
      values (p_auth_user_id, false, p_customer_name, p_customer_phone)
      returning id, name into v_customer_id, v_customer_name;
    end if;
  else
    v_customer_id := private.customer_account_for_phone(p_customer_phone);
    if v_customer_id is not null then
      v_customer_name := p_customer_name;
    else
      insert into public.customers as c (name, phone, is_guest)
      values (p_customer_name, p_customer_phone, true)
      on conflict (phone) where is_guest do update set name = excluded.name
      returning c.id, c.name into v_customer_id, v_customer_name;
    end if;
  end if;

  insert into public.appointments (barber_id, customer_id, starts_at, ends_at, cancel_token_hash)
  values (p_barber_id, v_customer_id, p_starts_at, v_ends_at, p_cancel_token_hash)
  returning id into v_appointment_id;

  insert into public.appointment_services (appointment_id, service_id, service_name, price_cents, duration_min)
  select v_appointment_id, s.id, s.name, s.price_cents, s.duration_min
  from public.services s
  where s.id = any (v_ids);

  perform private.apply_subscription(v_appointment_id);

  return query select v_appointment_id, v_customer_id, v_customer_name, p_starts_at, v_ends_at, v_price;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conclusão: o que a assinatura cobre não é cobrado. Totalmente coberto =>
-- forma "Assinatura", R$ 0, sem o barbeiro precisar informar nada.
-- ---------------------------------------------------------------------------
create or replace function private.appointments_before_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_is_user boolean := (select auth.uid()) is not null;
  v_due integer;
begin
  if new.status is distinct from old.status then
    if old.status <> 'scheduled' then
      raise exception 'invalid_status_transition: % -> %', old.status, new.status
        using errcode = 'P0001';
    end if;

    if new.status in ('completed', 'no_show') and now() < old.starts_at then
      raise exception 'appointment_not_started'
        using errcode = 'P0001';
    end if;

    if new.status = 'completed' then
      select coalesce(sum(s.price_cents) filter (where not s.covered), 0)::integer into v_due
      from public.appointment_services s where s.appointment_id = new.id;

      if new.payment_method is null and new.subscription_id is not null and v_due = 0 then
        new.payment_method := 'subscription';
        new.paid_cents := 0;
      end if;
      if new.payment_method is null and v_is_user then
        raise exception 'payment_required' using errcode = 'P0001';
      end if;
      if new.payment_method is not null and new.paid_cents is null then
        new.paid_cents := v_due;
      end if;
      new.completed_at := now();
    end if;

    if new.status = 'cancelled' then
      new.cancelled_at := now();
      if v_is_user then
        v_role := private.app_role();
        new.cancelled_by := case v_role
          when 'admin' then 'admin'::public.cancel_actor
          when 'super_admin' then 'admin'::public.cancel_actor
          when 'barber' then 'barber'::public.cancel_actor
          else 'customer'::public.cancel_actor
        end;
      else
        new.cancelled_by := coalesce(new.cancelled_by, 'system'::public.cancel_actor);
      end if;
    end if;
  elsif (new.payment_method is distinct from old.payment_method or new.paid_cents is distinct from old.paid_cents)
        and v_is_user and not private.is_admin() then
    raise exception 'payment_locked' using errcode = 'P0001';
  end if;

  if new.status <> 'cancelled' then
    new.cancelled_by := null;
    new.cancelled_at := null;
  end if;
  if new.status <> 'completed' then
    new.payment_method := null;
    new.paid_cents := null;
    new.completed_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ações do dono
-- ---------------------------------------------------------------------------

-- Ativa ou renova um mês do plano (pago ou pendente). Horários já
-- marcados dentro do período passam a ser cobertos (até o limite).
create function public.admin_add_subscription(
  p_customer_id uuid,
  p_plan_id uuid,
  p_starts_on date,
  p_price_cents integer,
  p_payment_method public.payment_method default null
)
returns public.customer_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.subscription_plans;
  v_covered uuid[];
  v_row public.customer_subscriptions;
  v_appt record;
begin
  if not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payment_method = 'subscription' then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(ps.service_id), '{}') into v_covered
  from public.subscription_plan_services ps where ps.plan_id = p_plan_id;
  if cardinality(v_covered) = 0 then
    raise exception 'plan_without_services' using errcode = '22023';
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.customer_subscriptions (
    customer_id, plan_id, plan_name, cuts_included, covered_service_ids,
    starts_on, ends_on, price_cents, payment_method, paid_at, created_by
  )
  values (
    p_customer_id, v_plan.id, v_plan.name, v_plan.cuts_per_month, v_covered,
    p_starts_on, (p_starts_on + interval '1 month')::date, p_price_cents, p_payment_method,
    case when p_payment_method is null then null else now() end, (select auth.uid())
  )
  returning * into v_row;

  for v_appt in
    select a.id from public.appointments a, public.app_settings st
    where a.customer_id = p_customer_id
      and a.status = 'scheduled'
      and a.subscription_id is null
      and (a.starts_at at time zone st.timezone)::date >= v_row.starts_on
      and (a.starts_at at time zone st.timezone)::date < v_row.ends_on
    order by a.starts_at
  loop
    perform private.apply_subscription(v_appt.id);
  end loop;

  return v_row;
end;
$$;

-- Corrige quantos cortes já foram usados no período.
create function public.admin_set_subscription_used(p_id uuid, p_used integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linked integer;
begin
  if not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_used < 0 or p_used > 60 then
    raise exception 'invalid_used' using errcode = '22023';
  end if;
  perform 1 from public.customer_subscriptions where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select count(*) into v_linked from public.appointments
  where subscription_id = p_id and status <> 'cancelled';
  update public.customer_subscriptions set cuts_adjustment = p_used - v_linked where id = p_id;
end;
$$;

-- Marca como pago (forma + valor) ou volta para pendente (forma nula).
create function public.admin_set_subscription_payment(
  p_id uuid,
  p_payment_method public.payment_method,
  p_price_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payment_method = 'subscription' then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  update public.customer_subscriptions
     set payment_method = p_payment_method,
         price_cents = p_price_cents,
         paid_at = case
           when p_payment_method is null then null
           else coalesce(paid_at, now())
         end
   where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Remove um lançamento de assinatura (ex.: lançado errado). O valor sai do
-- faturamento; horários futuros voltam a ter preço normal.
create function public.admin_delete_subscription(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.appointment_services x set covered = false
  from public.appointments a
  where a.id = x.appointment_id and a.subscription_id = p_id and a.status = 'scheduled';
  update public.appointments set subscription_id = null
  where subscription_id = p_id and status = 'scheduled';
  delete from public.customer_subscriptions where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_add_subscription(uuid, uuid, date, integer, public.payment_method) from public, anon;
revoke all on function public.admin_set_subscription_used(uuid, integer) from public, anon;
revoke all on function public.admin_delete_subscription(uuid) from public, anon;
revoke all on function public.admin_set_subscription_payment(uuid, public.payment_method, integer) from public, anon;
grant execute on function public.admin_set_subscription_payment(uuid, public.payment_method, integer) to authenticated, service_role;
grant execute on function public.admin_add_subscription(uuid, uuid, date, integer, public.payment_method) to authenticated, service_role;
grant execute on function public.admin_set_subscription_used(uuid, integer) to authenticated, service_role;
grant execute on function public.admin_delete_subscription(uuid) to authenticated, service_role;
