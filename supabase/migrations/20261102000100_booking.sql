-- =============================================================================
-- Fase 2: criação atômica de agendamento + rate limit
-- Ambas as funções são executáveis SOMENTE pela service role (Edge Functions).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rate limit (janela fixa). Chaves já chegam com hash (sem IP/telefone em claro).
-- ---------------------------------------------------------------------------
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table private.rate_limits enable row level security;
-- sem policies: só acessível via função SECURITY DEFINER abaixo
revoke all on private.rate_limits from public, anon, authenticated;

-- retorna true se a requisição está dentro do limite
create function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_window_seconds <= 0 or p_max <= 0 then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into private.rate_limits as rl (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  -- limpeza oportunista de janelas antigas
  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- book_appointment: resolve o customer, recalcula duração/preço a partir do
-- banco (nada vem do cliente), cria o agendamento + snapshot dos serviços na
-- mesma transação. Sobreposição => erro 23P01 da constraint
-- appointments_no_overlap (tratado na edge function).
-- ---------------------------------------------------------------------------
create function public.book_appointment(
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
  -- Serializa reservas do MESMO barbeiro. Sem isso, inserts concorrentes na
  -- constraint EXCLUDE podem gerar deadlock (40P01) e ninguém fica com o
  -- horário. A constraint continua sendo a garantia final contra overbooking.
  perform pg_advisory_xact_lock(hashtextextended('book_appointment:' || p_barber_id::text, 0));

  select array_agg(distinct x) into v_ids from unnest(p_service_ids) as x;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'invalid_services' using errcode = 'P0001';
  end if;

  -- serviços ativos E oferecidos por este barbeiro (ativo)
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

  -- customer: logado => linha própria (nunca reaproveita visitante);
  --           visitante => upsert por telefone entre visitantes
  if p_auth_user_id is not null then
    select c.id, c.name into v_customer_id, v_customer_name
    from public.customers c where c.auth_user_id = p_auth_user_id;

    if not found then
      insert into public.customers (auth_user_id, is_guest, name, phone)
      values (p_auth_user_id, false, p_customer_name, p_customer_phone)
      returning id, name into v_customer_id, v_customer_name;
    end if;
  else
    insert into public.customers as c (name, phone, is_guest)
    values (p_customer_name, p_customer_phone, true)
    on conflict (phone) where is_guest do update set name = excluded.name
    returning c.id, c.name into v_customer_id, v_customer_name;
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

revoke all on function public.book_appointment(uuid, timestamptz, uuid[], text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.book_appointment(uuid, timestamptz, uuid[], text, text, text, uuid)
  to service_role;
