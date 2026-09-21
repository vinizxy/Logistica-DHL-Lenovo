-- Login e perfis (spec docs/specs/2026-09-21-login-design.md).
-- Cada conta do Supabase Auth tem um perfil lenovo|dhl. Toda função de escrita lê
-- auth.uid() e recusa o perfil errado. Sem login, a API não lê nem escreve nada.

-- 1. Perfis ---------------------------------------------------------------------

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         public.actor_role not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "perfis visiveis a logados" on public.profiles for select to authenticated using (true);
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;

-- Cria o perfil quando a conta nasce. Papel vem do metadata ('role') ou do domínio
-- do e-mail; outro domínio sem papel explícito → a conta não é criada.
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
  if v_role is null or v_role not in ('lenovo', 'dhl') then
    raise exception 'Conta % sem perfil: informe role=lenovo|dhl ou use um e-mail @lenovo.com / @dhl.com.', new.email;
  end if;
  if v_name is null then
    v_name := split_part(new.email, '@', 1);
  end if;

  insert into public.profiles (user_id, role, display_name)
  values (new.id, v_role::public.actor_role, left(v_name, 80));
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quem está logado e com que papel. p_expected nulo = qualquer perfil serve.
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
  if p_expected is not null and v_profile.role <> p_expected then
    raise exception 'Só a % pode fazer isso.', upper(p_expected::text);
  end if;
  return v_profile;
end;
$$;
revoke all on function public.require_role(public.actor_role) from public, anon, authenticated;

-- 2. Colunas de auditoria e ocultação --------------------------------------------

alter table public.orders
  add column hidden_by_lenovo boolean not null default false,
  add column created_by uuid references auth.users (id) on delete set null;
alter table public.order_events
  add column user_id uuid references auth.users (id) on delete set null;
alter table public.order_comments
  add column user_id uuid references auth.users (id) on delete set null;

create index orders_lenovo_list_idx on public.orders (hidden_by_lenovo, created_at desc);

-- 3. Funções de escrita ---------------------------------------------------------------

-- Lenovo cria um pedido multi-item. Reserva estoque de TODOS os itens ou falha inteiro.
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
  values (v_order_id, null, 'enviado', 'lenovo', v_me.user_id);

  return v_order_id;
end;
$$;

-- Avança o pedido. O papel vem do perfil: enviado/recebido/em_separacao → DHL;
-- em_transporte → Lenovo (confirma entrega). Ao despachar, baixa real do estoque.
drop function public.advance_order(bigint, public.actor_role, timestamptz);

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

  if v_me.role <> v_expected then
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

-- Lenovo cancela enquanto a DHL não começou a separar; libera a reserva.
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
  values (p_order_id, v_order.status, 'cancelado', 'lenovo', v_me.user_id);
end;
$$;

-- Lenovo tira um pedido encerrado da lista dela. Nada é apagado: a DHL continua vendo.
drop function public.delete_order(bigint);

create or replace function public.hide_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  perform public.require_role('lenovo');

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;
  if v_order.status not in ('entregue', 'cancelado') then
    raise exception 'Pedido #% está "%". Só pedidos entregues ou cancelados podem ser excluídos — cancele antes.',
      p_order_id, public.status_label(v_order.status);
  end if;

  update public.orders set hidden_by_lenovo = true where id = p_order_id;
end;
$$;

-- DHL registra entrada de caixas novas no armazém.
create or replace function public.restock(p_serial text, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box   public.box_models%rowtype;
  v_total integer;
begin
  perform public.require_role('dhl');

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade de reposição precisa ser maior que zero.';
  end if;
  if p_quantity > 100000 then
    raise exception 'Reposição acima do limite (100.000 por vez).';
  end if;

  select * into v_box from public.box_models where serial = p_serial for update;
  if not found then
    raise exception 'Caixa % não existe no catálogo.', p_serial;
  end if;
  if v_box.stock_total + p_quantity > 1000000 then
    raise exception '% %: o estoque passaria do limite de 1.000.000 caixas.',
      v_box.machine_name, v_box.machine_model;
  end if;

  update public.box_models set stock_total = stock_total + p_quantity
   where serial = p_serial
  returning stock_total into v_total;
  return v_total;
end;
$$;

-- Comentário no pedido. Lado e nome vêm do perfil de quem está logado.
drop function public.add_comment(bigint, public.actor_role, text, text);

create or replace function public.add_comment(p_order_id bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_id bigint;
begin
  v_me := public.require_role();

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(btrim(p_body)) > 2000 then
    raise exception 'A mensagem é muito longa (máx. 2.000 caracteres).';
  end if;

  insert into public.order_comments (order_id, actor, author, body, user_id)
  values (p_order_id, v_me.role, v_me.display_name, btrim(p_body), v_me.user_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Cadastro de caixas: só DHL.
create or replace function public.create_box_model(
  p_serial text,
  p_machine_name text,
  p_machine_model text,
  p_stock_total integer default 0,
  p_min_stock integer default 0
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial text := upper(btrim(coalesce(p_serial, '')));
  v_name text;
  v_model text;
begin
  perform public.require_role('dhl');

  v_name := public.check_text(p_machine_name, 'Informe o nome da máquina.', 'Nome da máquina', 80);
  v_model := public.check_text(p_machine_model, 'Informe o modelo.', 'Modelo', 80);
  if coalesce(p_stock_total, 0) < 0 or coalesce(p_min_stock, 0) < 0 then
    raise exception 'Estoque e mínimo não podem ser negativos.';
  end if;
  if coalesce(p_stock_total, 0) > 1000000 or coalesce(p_min_stock, 0) > 1000000 then
    raise exception 'Estoque e mínimo não podem passar de 1.000.000.';
  end if;

  if v_serial = '' then
    v_serial := public.generate_serial();
  elsif v_serial !~ '^[A-Z0-9]{10}$' then
    raise exception 'O serial precisa ter exatamente 10 letras ou números.';
  elsif exists (select 1 from public.box_models where serial = v_serial) then
    raise exception 'Já existe uma caixa com o serial %.', v_serial;
  end if;

  insert into public.box_models (serial, machine_name, machine_model, stock_total, min_stock)
  values (v_serial, v_name, v_model, coalesce(p_stock_total, 0), coalesce(p_min_stock, 0));
  return v_serial;
end;
$$;

create or replace function public.update_box_model(
  p_serial text,
  p_machine_name text,
  p_machine_model text,
  p_min_stock integer,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box public.box_models%rowtype;
  v_name text;
  v_model text;
begin
  perform public.require_role('dhl');

  select * into v_box from public.box_models where serial = p_serial for update;
  if not found then
    raise exception 'Caixa % não existe no catálogo.', p_serial;
  end if;
  v_name := public.check_text(p_machine_name, 'Informe o nome da máquina.', 'Nome da máquina', 80);
  v_model := public.check_text(p_machine_model, 'Informe o modelo.', 'Modelo', 80);
  if coalesce(p_min_stock, 0) < 0 then
    raise exception 'O mínimo não pode ser negativo.';
  end if;
  if coalesce(p_min_stock, 0) > 1000000 then
    raise exception 'O mínimo não pode passar de 1.000.000.';
  end if;
  if p_active = false and v_box.stock_reserved > 0 then
    raise exception '% %: há % caixas reservadas em pedidos abertos; conclua ou cancele antes de descontinuar.',
      v_box.machine_name, v_box.machine_model, v_box.stock_reserved;
  end if;

  update public.box_models
     set machine_name = v_name, machine_model = v_model,
         min_stock = coalesce(p_min_stock, 0), active = coalesce(p_active, true)
   where serial = p_serial;
end;
$$;

-- 4. Acesso: só logados ---------------------------------------------------------------

drop policy "leitura publica" on public.box_models;
drop policy "leitura publica" on public.orders;
drop policy "leitura publica" on public.order_items;
drop policy "leitura publica" on public.order_events;
drop policy "leitura publica" on public.order_comments;
create policy "leitura de logados" on public.box_models     for select to authenticated using (true);
create policy "leitura de logados" on public.orders         for select to authenticated using (true);
create policy "leitura de logados" on public.order_items    for select to authenticated using (true);
create policy "leitura de logados" on public.order_events   for select to authenticated using (true);
create policy "leitura de logados" on public.order_comments for select to authenticated using (true);
revoke select on public.box_models, public.orders, public.order_items, public.order_events,
  public.order_comments, public.profiles from anon;

revoke all on function public.create_order(text, text, jsonb, boolean) from public, anon;
revoke all on function public.advance_order(bigint, timestamptz) from public, anon;
revoke all on function public.cancel_order(bigint) from public, anon;
revoke all on function public.hide_order(bigint) from public, anon;
revoke all on function public.restock(text, integer) from public, anon;
revoke all on function public.add_comment(bigint, text) from public, anon;
revoke all on function public.create_box_model(text, text, text, integer, integer) from public, anon;
revoke all on function public.update_box_model(text, text, text, integer, boolean) from public, anon;
revoke all on function public.status_label(public.order_status) from anon;

grant execute on function public.create_order(text, text, jsonb, boolean) to authenticated;
grant execute on function public.advance_order(bigint, timestamptz) to authenticated;
grant execute on function public.cancel_order(bigint) to authenticated;
grant execute on function public.hide_order(bigint) to authenticated;
grant execute on function public.restock(text, integer) to authenticated;
grant execute on function public.add_comment(bigint, text) to authenticated;
grant execute on function public.create_box_model(text, text, text, integer, integer) to authenticated;
grant execute on function public.update_box_model(text, text, text, integer, boolean) to authenticated;
grant execute on function public.status_label(public.order_status) to authenticated;
