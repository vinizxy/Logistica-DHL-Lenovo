-- Correção de segurança: o perfil de uma conta nova vinha de raw_user_meta_data, que qualquer
-- pessoa preenche no cadastro público (supabase.auth.signUp({ options: { data: { role: 'admin' } } })).
-- Com "Enable sign ups" ligado, isso dava admin a qualquer e-mail. Agora o perfil só vem de
-- raw_app_meta_data (gravável apenas pelo servidor: service role ou funções admin_*); sem ele,
-- vale o domínio do e-mail, que nunca dá admin.

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
  if v_role is null then
    v_role := case
      when new.email ilike '%@lenovo.com' then 'lenovo'
      when new.email ilike '%@dhl.com'    then 'dhl'
    end;
  end if;
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

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_role public.actor_role,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text;
begin
  perform public.require_role('admin');

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Já existe uma conta com o e-mail %.', v_email;
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'A senha precisa ter pelo menos 8 caracteres.';
  end if;
  if length(p_password) > 72 then
    raise exception 'A senha é muito longa (máx. 72 caracteres).';
  end if;
  if p_role is null then
    raise exception 'Informe o perfil (Lenovo, DHL ou Admin).';
  end if;
  v_name := public.check_text(p_display_name, 'Informe o nome de exibição.', 'Nome', 80);

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', p_role::text),
    jsonb_build_object('role', p_role::text, 'display_name', v_name),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          null, now(), now());

  return v_id;
end;
$$;

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_role public.actor_role,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_name text;
begin
  v_me := public.require_role('admin');
  v_name := public.check_text(p_display_name, 'Informe o nome de exibição.', 'Nome', 80);
  if p_role is null then
    raise exception 'Informe o perfil.';
  end if;
  if p_user_id = v_me.user_id and p_role <> 'admin' then
    raise exception 'Você não pode tirar o próprio perfil de admin.';
  end if;
  update public.profiles set role = p_role, display_name = v_name where user_id = p_user_id;
  if not found then
    raise exception 'Conta não encontrada.';
  end if;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', p_role::text),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('role', p_role::text, 'display_name', v_name),
         updated_at = now()
   where id = p_user_id;
end;
$$;

-- Espelha o perfil atual de cada conta em raw_app_meta_data (profiles continua sendo a fonte).
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p.role::text)
  from public.profiles p
 where p.user_id = u.id;
