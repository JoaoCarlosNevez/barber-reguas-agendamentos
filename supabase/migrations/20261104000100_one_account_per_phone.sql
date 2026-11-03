-- =============================================================================
-- Um celular = uma conta de cliente
--   * Agendamento sem login com um celular que já tem conta entra na conta
--     (não cria mais "visitante" paralelo), mesmo se o nome vier diferente.
--   * Visitantes existentes com celular de uma conta são incorporados a ela.
--   * Contas da equipe (barbeiro/dono/super admin) nunca são "a conta do
--     celular" de um cliente.
-- =============================================================================

-- Conta de cliente dona do celular (a mais antiga, só perfis 'customer').
create function private.customer_account_for_phone(p_phone text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select c.id
  from public.customers c
  join public.profiles p on p.id = c.auth_user_id and p.role = 'customer'
  where c.phone = p_phone and not c.is_guest
  order by c.created_at
  limit 1;
$$;
revoke all on function private.customer_account_for_phone(text) from public, anon, authenticated;
grant execute on function private.customer_account_for_phone(text) to service_role;

-- Incorpora visitantes com o mesmo celular de uma conta
with pairs as (
  select g.id as guest_id, private.customer_account_for_phone(g.phone) as account_id
  from public.customers g
  where g.is_guest
)
update public.appointments a
set customer_id = p.account_id
from pairs p
where a.customer_id = p.guest_id and p.account_id is not null;

delete from public.customers g
where g.is_guest
  and private.customer_account_for_phone(g.phone) is not null
  and not exists (select 1 from public.appointments a where a.customer_id = g.id);

-- Reserva: visitante com celular de uma conta => agendamento vai para a conta.
-- O nome devolvido é o digitado (não revela o nome do dono da conta).
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

  -- equipe logada agendando pelo site (ex.: para um cliente no balcão) conta
  -- como agendamento sem login: vai para a conta do celular digitado
  if p_auth_user_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_auth_user_id and p.role = 'customer'
  ) then
    p_auth_user_id := null;
  end if;

  if p_auth_user_id is not null then
    -- logado: a própria linha
    select c.id, c.name into v_customer_id, v_customer_name
    from public.customers c where c.auth_user_id = p_auth_user_id;

    if not found then
      insert into public.customers (auth_user_id, is_guest, name, phone)
      values (p_auth_user_id, false, p_customer_name, p_customer_phone)
      returning id, name into v_customer_id, v_customer_name;
    end if;
  else
    -- sem login: a conta dona do celular, se houver; senão, visitante
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

  return query select v_appointment_id, v_customer_id, v_customer_name, p_starts_at, v_ends_at, v_price;
end;
$$;

-- Impede uma segunda conta de cliente com o mesmo celular (cadastro ou troca
-- de celular no perfil). Só cria o índice se os dados atuais já obedecem.
do $$
begin
  if not exists (
    select 1 from public.customers c
    where not c.is_guest and c.auth_user_id is not null
    group by c.phone having count(*) > 1
  ) then
    create unique index customers_account_phone_uniq on public.customers (phone)
      where not is_guest and auth_user_id is not null;
  else
    raise notice 'customers_account_phone_uniq NÃO criado: há celulares com mais de uma conta';
  end if;
end;
$$;
