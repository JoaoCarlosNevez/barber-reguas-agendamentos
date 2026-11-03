-- =============================================================================
-- Funções auxiliares (schema private, SECURITY DEFINER) e triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers de autorização usados pelas policies.
-- SECURITY DEFINER evita recursão de RLS (customers <-> appointments) e
-- lê o role da tabela profiles (nunca de claims editáveis pelo usuário).
-- ---------------------------------------------------------------------------
create function private.app_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create function private.my_barber_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select b.id from public.barbers b where b.profile_id = (select auth.uid());
$$;

create function private.my_customer_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select c.id from public.customers c where c.auth_user_id = (select auth.uid());
$$;

create function private.barber_has_customer(p_customer_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.appointments a
    join public.barbers b on b.id = a.barber_id
    where a.customer_id = p_customer_id
      and b.profile_id = (select auth.uid())
  );
$$;

create function private.can_see_appointment(p_appointment_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.appointments a
    where a.id = p_appointment_id
      and (
        private.is_admin()
        or a.barber_id = private.my_barber_id()
        or a.customer_id = private.my_customer_id()
      )
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Signup: cria profile (+ customer, quando aplicável)
--   * role vem de raw_app_meta_data (só a service role consegue definir);
--     raw_user_meta_data é controlado pelo usuário e NUNCA define role.
--   * customer só é criado com telefone E.164 válido. O front exige telefone
--     no cadastro; se alguém chamar a API direto sem telefone, o profile fica
--     sem phone e o app pede para completar antes de agendar.
-- ---------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_name text;
  v_phone text;
begin
  v_role := case new.raw_app_meta_data ->> 'role'
    when 'barber' then 'barber'::public.user_role
    when 'admin' then 'admin'::public.user_role
    else 'customer'::public.user_role
  end;

  v_name := left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuário'
  ), 120);

  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    v_phone := null;
  end if;

  insert into public.profiles (id, role, name, phone)
  values (new.id, v_role, v_name, v_phone);

  if v_role = 'customer' and v_phone is not null then
    insert into public.customers (auth_user_id, is_guest, name, phone)
    values (new.id, false, v_name, v_phone);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Mantém o customer do usuário cadastrado sincronizado com o profile
-- ---------------------------------------------------------------------------
create function private.sync_customer_from_profile()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.role = 'customer' and new.phone is not null then
    insert into public.customers (auth_user_id, is_guest, name, phone)
    values (new.id, false, new.name, new.phone)
    on conflict (auth_user_id) do update
      set name = excluded.name, phone = excluded.phone;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_customer
  after update of name, phone on public.profiles
  for each row
  when (old.name is distinct from new.name or old.phone is distinct from new.phone)
  execute function private.sync_customer_from_profile();

-- ---------------------------------------------------------------------------
-- Agendamentos: transições de status
--   scheduled -> cancelled | completed | no_show  (nada mais é permitido)
--   completed/no_show só depois do horário de início.
--   cancelled_by é derivado do role do usuário logado (não confiável vindo
--   do cliente); quando a chamada é da service role (auth.uid() nulo) a
--   edge function informa o ator.
-- ---------------------------------------------------------------------------
create function private.appointments_before_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
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

    if new.status = 'cancelled' then
      new.cancelled_at := now();
      if (select auth.uid()) is not null then
        v_role := private.app_role();
        new.cancelled_by := case v_role
          when 'admin' then 'admin'::public.cancel_actor
          when 'barber' then 'barber'::public.cancel_actor
          else 'customer'::public.cancel_actor
        end;
      else
        new.cancelled_by := coalesce(new.cancelled_by, 'system'::public.cancel_actor);
      end if;
    end if;
  end if;

  if new.status <> 'cancelled' then
    new.cancelled_by := null;
    new.cancelled_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger appointments_before_update
  before update on public.appointments
  for each row execute function private.appointments_before_update();

-- ---------------------------------------------------------------------------
-- Fidelidade: selo gerado SOMENTE quando o agendamento vira 'completed' e
-- o customer é de um usuário cadastrado (agendou logado). Idempotente via
-- unique(appointment_id).
-- ---------------------------------------------------------------------------
create function private.grant_loyalty_stamp()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.loyalty_stamps (customer_id, appointment_id)
  select new.customer_id, new.id
  from public.customers c
  where c.id = new.customer_id
    and c.auth_user_id is not null
    and not c.is_guest
  on conflict (appointment_id) do nothing;
  return new;
end;
$$;

create trigger appointments_grant_stamp
  after update of status on public.appointments
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.grant_loyalty_stamp();

-- ---------------------------------------------------------------------------
-- Resgate de fidelidade (transacional). Só a service role executa
-- (edge function redeem-loyalty valida que quem chama é barbeiro/admin).
-- ---------------------------------------------------------------------------
create function public.redeem_loyalty(p_customer_id uuid, p_redeemed_by uuid)
returns public.loyalty_redemptions
language plpgsql
set search_path = ''
as $$
declare
  v_rule public.loyalty_rules;
  v_ids uuid[];
  v_redemption public.loyalty_redemptions;
begin
  select * into v_rule from public.loyalty_rules where active limit 1;
  if not found then
    raise exception 'no_active_rule' using errcode = 'P0001';
  end if;

  -- trava o cliente para serializar resgates concorrentes
  perform 1 from public.customers
  where id = p_customer_id and auth_user_id is not null and not is_guest
  for update;
  if not found then
    raise exception 'customer_not_eligible' using errcode = 'P0001';
  end if;

  select array_agg(s.id) into v_ids
  from (
    select ls.id
    from public.loyalty_stamps ls
    where ls.customer_id = p_customer_id and ls.redemption_id is null
    order by ls.created_at, ls.id
    limit v_rule.stamps_required
    for update
  ) s;

  if coalesce(array_length(v_ids, 1), 0) < v_rule.stamps_required then
    raise exception 'insufficient_stamps' using errcode = 'P0001';
  end if;

  insert into public.loyalty_redemptions (customer_id, redeemed_by, stamps_used, reward_description)
  values (p_customer_id, p_redeemed_by, v_rule.stamps_required, v_rule.reward_description)
  returning * into v_redemption;

  update public.loyalty_stamps set redemption_id = v_redemption.id where id = any (v_ids);

  return v_redemption;
end;
$$;

revoke all on function public.redeem_loyalty(uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_loyalty(uuid, uuid) to service_role;
