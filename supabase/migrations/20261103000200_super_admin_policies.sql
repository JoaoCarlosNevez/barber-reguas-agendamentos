-- =============================================================================
-- super_admin
--   * tem tudo o que o admin (dono da barbearia) tem;
--   * só ele cria/rebaixa admins e mexe em contas de admin/super_admin
--     (edge functions verificam isso);
--   * o admin não enxerga nem edita o profile de um super_admin.
-- =============================================================================

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role in ('admin', 'super_admin') from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function private.is_super_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'super_admin' from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

revoke all on function private.is_super_admin() from public;
grant execute on function private.is_super_admin() to anon, authenticated, service_role;

-- profiles: admin não vê/edita super_admin; super_admin vê/edita todos
drop policy profiles_select_own_or_admin on public.profiles;
drop policy profiles_update_own_or_admin on public.profiles;

create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'super_admin')
  );
create policy profiles_update_own_or_admin on public.profiles
  for update to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'super_admin')
  )
  with check (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or ((select private.is_admin()) and role <> 'super_admin')
  );

-- cancelamento feito pelo super_admin conta como "admin"
create or replace function private.appointments_before_update()
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
          when 'super_admin' then 'admin'::public.cancel_actor
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
