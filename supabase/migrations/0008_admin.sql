-- Perfil admin: controla tudo (painéis Lenovo e DHL, catálogo) e gerencia contas.
-- Contas são criadas/apagadas por funções SQL security definer que escrevem em auth.users
-- (mesmo formato que o GoTrue usa), então não precisa de service role no frontend.

-- 1. Enum: o valor 'admin' é adicionado em 0007b_admin_role_enum.sql (precisa estar
--    commitado antes de ser usado aqui).

-- 2. require_role: admin passa em qualquer checagem ---------------------------------
create or replace function public.require_role(p_expected public.actor_role default null)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.';
  end if;
  select * into v_profile from public.profiles where user_id = v_uid;
  if not found then
    raise exception 'Conta sem perfil. Fale com o administrador.';
  end if;
  if p_expected is not null and v_profile.role <> p_expected and v_profile.role <> 'admin' then
    raise exception 'Só a % pode fazer isso.', upper(p_expected::text);
  end if;
  return v_profile;
end;
$$;

-- Trigger de perfil: aceita role=admin explícito no metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := new.raw_user_meta_data->>'role';
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
begin
  if v_role is null then
    v_role := case
      when new.email ilike '%@lenovo.com' then 'lenovo'
      when new.email ilike '%@dhl.com'    then 'dhl'
    end;
  end if;
  if v_role is null or v_role not in ('lenovo', 'dhl', 'admin') then
    raise exception 'Conta % sem perfil: informe role=lenovo|dhl|admin ou use um e-mail @lenovo.com / @dhl.com.', new.email;
  end if;
  if v_name is null then
    v_name := split_part(new.email, '@', 1);
  end if;

  insert into public.profiles (user_id, role, display_name)
  values (new.id, v_role::public.actor_role, left(v_name, 80));
  return new;
end;
$$;

-- advance_order compara o perfil direto (não passa por require_role com esperado): admin passa.
create or replace function public.advance_order(
  p_order_id bigint,
  p_eta timestamptz default null
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       public.profiles%rowtype;
  v_order    public.orders%rowtype;
  v_next     public.order_status;
  v_expected public.actor_role;
  v_item     record;
begin
  v_me := public.require_role();

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;

  case v_order.status
    when 'enviado'       then v_next := 'recebido';      v_expected := 'dhl';
    when 'recebido'      then v_next := 'em_separacao';  v_expected := 'dhl';
    when 'em_separacao'  then v_next := 'em_transporte'; v_expected := 'dhl';
    when 'em_transporte' then v_next := 'entregue';      v_expected := 'lenovo';
    else
      raise exception 'Pedido #% já está "%" e não pode avançar.',
        p_order_id, public.status_label(v_order.status);
  end case;

  -- admin passa em qualquer etapa
  if v_me.role <> v_expected and v_me.role <> 'admin' then
    raise exception 'Só a % pode mover o pedido #% de "%" para "%".',
      upper(v_expected::text), p_order_id,
      public.status_label(v_order.status), public.status_label(v_next);
  end if;

  if v_next = 'em_transporte' then
    if p_eta is not null and p_eta < now() - interval '1 hour' then
      raise exception 'A previsão de entrega não pode estar no passado.';
    end if;
    for v_item in
      select serial, quantity from public.order_items where order_id = p_order_id order by serial
    loop
      update public.box_models
         set stock_total = stock_total - v_item.quantity,
             stock_reserved = stock_reserved - v_item.quantity
       where serial = v_item.serial;
    end loop;
    update public.orders set status = v_next, eta = p_eta where id = p_order_id;
  else
    update public.orders set status = v_next where id = p_order_id;
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor, user_id)
  values (p_order_id, v_order.status, v_next, v_me.role, v_me.user_id);

  return v_next;
end;
$$;

-- create_order/cancel_order: o evento registra o perfil de quem fez (admin aparece como admin).
create or replace function public.create_order(
  p_requested_by text,
  p_notes text,
  p_items jsonb,
  p_urgent boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       public.profiles%rowtype;
  v_order_id bigint;
  v_item     record;
  v_box      public.box_models%rowtype;
  v_dupes    integer;
  v_by       text;
  v_notes    text;
begin
  v_me := public.require_role('lenovo');
  v_by := public.check_text(p_requested_by, 'Informe o nome do solicitante.', 'Nome do solicitante', 80);
  v_notes := nullif(btrim(p_notes), '');
  if length(v_notes) > 500 then
    raise exception 'A observação é muito longa (máx. 500 caracteres).';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Um pedido pode ter no máximo 100 tipos de caixa.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) <> 'object') then
    raise exception 'Item de pedido malformado.';
  end if;

  select count(*) - count(distinct i->>'serial')
    into v_dupes
    from jsonb_array_elements(p_items) i;
  if v_dupes > 0 then
    raise exception 'Há caixa repetida no pedido. Junte as quantidades em um item só.';
  end if;

  insert into public.orders (requested_by, notes, urgent, created_by)
  values (v_by, v_notes, coalesce(p_urgent, false), v_me.user_id)
  returning id into v_order_id;

  -- Trava as linhas em ordem de serial: dois pedidos simultâneos nunca entram em deadlock.
  for v_item in
    select i->>'serial' as serial,
           case when (i->>'quantity') ~ '^\d{1,9}$' then (i->>'quantity')::integer end as quantity
      from jsonb_array_elements(p_items) i
     order by 1
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Quantidade inválida para a caixa %.', coalesce(v_item.serial, '(sem serial)');
    end if;
    if v_item.quantity > 10000 then
      raise exception 'Quantidade acima do limite (10.000) para a caixa %.', v_item.serial;
    end if;

    select * into v_box from public.box_models where serial = v_item.serial for update;
    if not found then
      raise exception 'Caixa % não existe no catálogo.', v_item.serial;
    end if;
    if not v_box.active then
      raise exception '% %: caixa descontinuada, não pode ser pedida.', v_box.machine_name, v_box.machine_model;
    end if;
    if v_item.quantity > v_box.stock_available then
      raise exception '% %: só % disponíveis, você pediu %.',
        v_box.machine_name, v_box.machine_model, v_box.stock_available, v_item.quantity;
    end if;

    update public.box_models set stock_reserved = stock_reserved + v_item.quantity
     where serial = v_item.serial;
    insert into public.order_items (order_id, serial, quantity)
    values (v_order_id, v_item.serial, v_item.quantity);
  end loop;

  insert into public.order_events (order_id, from_status, to_status, actor, user_id)
  values (v_order_id, null, 'enviado', v_me.role, v_me.user_id);

  return v_order_id;
end;
$$;

create or replace function public.cancel_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    public.profiles%rowtype;
  v_order public.orders%rowtype;
  v_item  record;
begin
  v_me := public.require_role('lenovo');

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;
  if v_order.status not in ('enviado', 'recebido') then
    raise exception 'Pedido #% está "%" e não pode mais ser cancelado.',
      p_order_id, public.status_label(v_order.status);
  end if;

  for v_item in
    select serial, quantity from public.order_items where order_id = p_order_id order by serial
  loop
    update public.box_models set stock_reserved = stock_reserved - v_item.quantity
     where serial = v_item.serial;
  end loop;

  update public.orders set status = 'cancelado' where id = p_order_id;
  insert into public.order_events (order_id, from_status, to_status, actor, user_id)
  values (p_order_id, v_order.status, 'cancelado', v_me.role, v_me.user_id);
end;
$$;

-- 3. Gestão de contas (só admin) --------------------------------------------------------

-- Lista de contas com perfil e último acesso.
create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  role public.actor_role,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_role('admin');
  return query
    select u.id, u.email::text, p.role, p.display_name, u.created_at, u.last_sign_in_at
      from auth.users u
      join public.profiles p on p.user_id = u.id
     order by p.role, p.display_name;
end;
$$;

-- Cria a conta já confirmada. Senha mínima de 8 caracteres.
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
    '{"provider":"email","providers":["email"]}'::jsonb,
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

-- Apaga a conta (perfil, identidade, sessões caem em cascata; pedidos ficam, com created_by nulo).
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_role('admin');
  if p_user_id = v_me.user_id then
    raise exception 'Você não pode excluir a própria conta.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Conta não encontrada.';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;

-- Troca perfil e nome. O admin não rebaixa a si mesmo (evita ficar sem admin).
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
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('role', p_role::text, 'display_name', v_name),
         updated_at = now()
   where id = p_user_id;
end;
$$;

-- Define uma senha nova (o admin passa a senha para a pessoa; não há e-mail de recuperação).
create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_role('admin');
  if p_password is null or length(p_password) < 8 then
    raise exception 'A senha precisa ter pelo menos 8 caracteres.';
  end if;
  if length(p_password) > 72 then
    raise exception 'A senha é muito longa (máx. 72 caracteres).';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  if not found then
    raise exception 'Conta não encontrada.';
  end if;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_create_user(text, text, public.actor_role, text) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
revoke all on function public.admin_update_user(uuid, public.actor_role, text) from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_create_user(text, text, public.actor_role, text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_update_user(uuid, public.actor_role, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
