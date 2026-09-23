-- Autocadastro fechado no banco: conta nova só ganha perfil se o servidor informou o papel em
-- raw_app_meta_data (admin_create_user, service role ou Add user no painel com app metadata).
-- Antes, sem papel, valia o domínio do e-mail: qualquer pessoa com um e-mail @lenovo.com ou
-- @dhl.com conseguia se cadastrar sozinha com "Enable sign ups" ligado.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := new.raw_app_meta_data->>'role';
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
begin
  if v_role is null or v_role not in ('lenovo', 'dhl', 'admin') then
    raise exception 'Conta % sem perfil: contas são criadas pelo administrador.', new.email;
  end if;
  if v_name is null then
    v_name := split_part(new.email, '@', 1);
  end if;

  insert into public.profiles (user_id, role, display_name)
  values (new.id, v_role::public.actor_role, left(v_name, 80));
  return new;
end;
$$;
