-- =============================================================================
-- Tabelas
-- Convenções:
--   * todos os instantes em UTC (timestamptz); conversão para America/Sao_Paulo
--     acontece na exibição e no cálculo de slots.
--   * working_hours usa horário local (time) da barbearia, weekday 0 = domingo
--     (mesma convenção do Date#getDay do JS).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configurações globais (linha única)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/Sao_Paulo',
  -- antecedência mínima para agendar (minutos)
  min_booking_notice_min integer not null default 60 check (min_booking_notice_min >= 0),
  -- janela máxima de agendamento (dias à frente)
  max_booking_days integer not null default 30 check (max_booking_days between 1 and 365),
  -- antecedência mínima para o cliente cancelar pelo link (horas)
  cancel_min_notice_hours integer not null default 2 check (cancel_min_notice_hours >= 0),
  -- granularidade da grade de horários (minutos)
  slot_step_min integer not null default 15 check (slot_step_min between 5 and 120),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  name text not null check (char_length(name) between 1 and 120),
  phone public.phone_e164,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Barbeiros
-- ---------------------------------------------------------------------------
create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  active boolean not null default true,
  photo_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Serviços
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  duration_min integer not null check (duration_min between 5 and 480),
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.barber_services (
  barber_id uuid not null references public.barbers (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (barber_id, service_id)
);
create index barber_services_service_idx on public.barber_services (service_id);

-- ---------------------------------------------------------------------------
-- Horários de trabalho (um turno por dia da semana, com intervalo opcional)
-- ---------------------------------------------------------------------------
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  break_start time,
  break_end time,
  unique (barber_id, weekday),
  check (start_time < end_time),
  check (
    (break_start is null and break_end is null)
    or (
      break_start is not null and break_end is not null
      and break_start < break_end
      and break_start >= start_time
      and break_end <= end_time
    )
  )
);

-- ---------------------------------------------------------------------------
-- Bloqueios / folgas
-- ---------------------------------------------------------------------------
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index time_off_barber_range_idx
  on public.time_off using gist (barber_id, tstzrange(starts_at, ends_at, '[)'));

-- ---------------------------------------------------------------------------
-- Clientes
--   * visitante: auth_user_id nulo, único por telefone entre visitantes
--   * cadastrado: exatamente 1 linha por auth_user_id
--   Visitantes e cadastrados NUNCA compartilham linha, mesmo com o mesmo
--   telefone: isso impede que alguém "reivindique" o histórico/selos de outra
--   pessoa só digitando o telefone dela.
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  -- true = criado por agendamento sem login. Linha de cliente cadastrado
  -- continua is_guest = false mesmo se a conta for excluída (auth_user_id -> null).
  is_guest boolean not null default true,
  name text not null check (char_length(name) between 1 and 120),
  phone public.phone_e164 not null,
  created_at timestamptz not null default now(),
  check (not is_guest or auth_user_id is null)
);
create unique index customers_guest_phone_uniq
  on public.customers (phone) where is_guest;

-- ---------------------------------------------------------------------------
-- Agendamentos
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'scheduled',
  cancelled_by public.cancel_actor,
  cancelled_at timestamptz,
  -- sha256 (hex) do token de 128 bits; o token em claro nunca é armazenado
  cancel_token_hash text not null unique check (cancel_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check ((status = 'cancelled') = (cancelled_by is not null and cancelled_at is not null)),
  -- ANTI-OVERBOOKING: um barbeiro não pode ter dois agendamentos
  -- 'scheduled' com intervalos sobrepostos.
  constraint appointments_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled')
);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_barber_starts_idx on public.appointments (barber_id, starts_at);

-- Snapshot dos serviços no momento do agendamento
create table public.appointment_services (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict,
  service_name text not null,
  price_cents integer not null check (price_cents >= 0),
  duration_min integer not null check (duration_min > 0),
  primary key (appointment_id, service_id)
);
create index appointment_services_service_idx on public.appointment_services (service_id);

-- ---------------------------------------------------------------------------
-- Fidelidade
-- ---------------------------------------------------------------------------
create table public.loyalty_rules (
  id uuid primary key default gen_random_uuid(),
  stamps_required integer not null check (stamps_required between 1 and 50),
  reward_description text not null check (char_length(reward_description) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- no máximo uma regra ativa
create unique index loyalty_rules_single_active on public.loyalty_rules ((true)) where active;

create table public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  redeemed_by uuid references public.profiles (id) on delete set null,
  stamps_used integer not null check (stamps_used > 0),
  reward_description text not null
);
create index loyalty_redemptions_customer_idx on public.loyalty_redemptions (customer_id);

create table public.loyalty_stamps (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  appointment_id uuid not null unique references public.appointments (id) on delete cascade,
  -- preenchido quando o selo é consumido por um resgate
  redemption_id uuid references public.loyalty_redemptions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index loyalty_stamps_customer_available_idx
  on public.loyalty_stamps (customer_id, created_at) where redemption_id is null;

-- ---------------------------------------------------------------------------
-- Web Push
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
