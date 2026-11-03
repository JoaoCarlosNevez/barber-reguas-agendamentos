-- =============================================================================
-- Extensões, schema privado e tipos
-- =============================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Schema para funções auxiliares usadas pelas policies de RLS.
-- NÃO é exposto pela API (config.toml -> api.schemas só tem public/graphql_public).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create type public.user_role as enum ('customer', 'barber', 'admin');

create type public.appointment_status as enum ('scheduled', 'cancelled', 'completed', 'no_show');

create type public.cancel_actor as enum ('customer', 'barber', 'admin', 'system');

-- Domínio para telefone em E.164 (ex.: +5511987654321)
create domain public.phone_e164 as text
  check (value ~ '^\+[1-9][0-9]{7,14}$');
