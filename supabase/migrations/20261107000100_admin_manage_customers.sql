-- =============================================================================
-- Dono gerencia clientes pelo app (Gestão › Clientes): editar nome/celular e
-- excluir. Só admin/super_admin. Funções SECURITY DEFINER porque mexem em mais
-- de uma tabela (e, na exclusão, na conta de login do cliente).
-- =============================================================================

-- Edita nome e celular. Cliente com conta: o perfil acompanha, e o login
-- (celular + nome) passa a valer com os dados novos.
create function public.admin_update_customer(p_id uuid, p_name text, p_phone text)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.customers;
  v_name text := btrim(p_name);
begin
  if not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  update public.customers
     set name = v_name, phone = p_phone::public.phone_e164
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- só perfis de cliente (nunca mexe em conta da equipe)
  if v_row.auth_user_id is not null then
    update public.profiles
       set name = v_name, phone = p_phone::public.phone_e164, updated_at = now()
     where id = v_row.auth_user_id and role = 'customer';
  end if;

  return v_row;
end;
$$;

-- Exclui o cliente com todo o histórico (agendamentos, selos, resgates).
-- Se tiver conta de cliente, a conta de login também é apagada; assim o
-- celular fica livre para um cadastro novo. Conta da equipe nunca é apagada.
create function public.admin_delete_customer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth uuid;
begin
  if not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select auth_user_id into v_auth from public.customers where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- appointment_services e loyalty_stamps saem em cascata
  delete from public.appointments where customer_id = p_id;
  delete from public.customers where id = p_id;

  if v_auth is not null and exists (
    select 1 from public.profiles p where p.id = v_auth and p.role = 'customer'
  ) then
    delete from auth.users where id = v_auth;
  end if;
end;
$$;

revoke all on function public.admin_update_customer(uuid, text, text) from public, anon;
revoke all on function public.admin_delete_customer(uuid) from public, anon;
grant execute on function public.admin_update_customer(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_delete_customer(uuid) to authenticated, service_role;
