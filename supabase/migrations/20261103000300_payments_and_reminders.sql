-- =============================================================================
-- Pagamento na conclusão do atendimento + lembrete para concluir
--   * Ao marcar como "completed" o barbeiro informa a forma de pagamento
--     (obrigatória) e o valor (padrão: soma dos serviços).
--   * Depois de concluído, o pagamento só muda pelo dono/super admin.
--   * completion_reminded_at: controla o push "atendimento terminou, conclua".
-- =============================================================================

create type public.payment_method as enum ('pix', 'cash', 'debit', 'credit');

alter table public.appointments
  add column payment_method public.payment_method,
  add column paid_cents integer check (paid_cents >= 0 and paid_cents <= 10000000),
  add column completed_at timestamptz,
  add column completion_reminded_at timestamptz;

-- pagamento só existe em atendimento concluído
alter table public.appointments
  add constraint appointments_payment_only_when_completed
  check (status = 'completed' or (payment_method is null and paid_cents is null));

create index appointments_status_starts_idx on public.appointments (status, starts_at);
create index appointments_pending_reminder_idx on public.appointments (ends_at)
  where status = 'scheduled' and completion_reminded_at is null;

grant update (status, payment_method, paid_cents) on public.appointments to authenticated;

create or replace function private.appointments_before_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_is_user boolean := (select auth.uid()) is not null;
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
      if new.payment_method is null and v_is_user then
        raise exception 'payment_required' using errcode = 'P0001';
      end if;
      if new.payment_method is not null and new.paid_cents is null then
        select coalesce(sum(s.price_cents), 0)::integer into new.paid_cents
        from public.appointment_services s where s.appointment_id = new.id;
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
    -- correção de pagamento depois de concluído: só dono/super admin
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
-- Agendador do lembrete (pg_cron + pg_net). A URL das functions depende do
-- projeto, então o job é criado chamando esta função uma vez por ambiente:
--   select private.schedule_completion_reminders('https://<ref>.supabase.co/functions/v1');
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function private.schedule_completion_reminders(p_functions_url text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'completion-reminders';
  perform cron.schedule(
    'completion-reminders',
    '*/5 * * * *',
    format(
      $job$select net.http_post(url := %L, body := '{}'::jsonb, headers := '{"content-type":"application/json"}'::jsonb)$job$,
      rtrim(p_functions_url, '/') || '/completion-reminders'
    )
  );
end;
$$;

revoke all on function private.schedule_completion_reminders(text) from public, anon, authenticated;
