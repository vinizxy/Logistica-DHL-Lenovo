-- Pedido urgente, previsão de entrega, comentários e cadastro de caixas.

-- 1. Colunas novas ---------------------------------------------------------

alter table public.orders
  add column urgent boolean not null default false,
  add column eta    timestamptz;                       -- previsão de entrega, informada pela DHL ao despachar

alter table public.box_models
  add column active boolean not null default true;     -- false = descontinuada (não pode ser pedida)

-- Fila da DHL: urgentes primeiro, depois os mais antigos.
create index orders_queue_idx on public.orders (status, urgent desc, created_at);

-- 2. Comentários -----------------------------------------------------------

create table public.order_comments (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.orders (id) on delete cascade,
  actor       public.actor_role not null,
  author      text not null check (length(btrim(author)) > 0),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);

create index order_comments_order_idx on public.order_comments (order_id, created_at);

alter table public.order_comments enable row level security;
create policy "leitura publica" on public.order_comments for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.order_comments from anon, authenticated;
alter publication supabase_realtime add table public.order_comments;

create or replace function public.add_comment(
  p_order_id bigint,
  p_actor public.actor_role,
  p_author text,
  p_body text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;
  if p_author is null or length(btrim(p_author)) = 0 then
    raise exception 'Informe seu nome.';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'Escreva a mensagem.';
  end if;

  insert into public.order_comments (order_id, actor, author, body)
  values (p_order_id, p_actor, btrim(p_author), btrim(p_body))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_comment(bigint, public.actor_role, text, text) from public;
grant execute on function public.add_comment(bigint, public.actor_role, text, text) to anon, authenticated;

-- 3. create_order com urgente e recusa de caixa descontinuada ----------------

drop function public.create_order(text, text, jsonb);

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
  v_order_id bigint;
  v_item     record;
  v_box      public.box_models%rowtype;
  v_dupes    integer;
begin
  if p_requested_by is null or length(btrim(p_requested_by)) = 0 then
    raise exception 'Informe o nome do solicitante.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  select count(*) - count(distinct i->>'serial')
    into v_dupes
    from jsonb_array_elements(p_items) i;
  if v_dupes > 0 then
    raise exception 'Há caixa repetida no pedido. Junte as quantidades em um item só.';
  end if;

  insert into public.orders (requested_by, notes, urgent)
  values (btrim(p_requested_by), nullif(btrim(p_notes), ''), coalesce(p_urgent, false))
  returning id into v_order_id;

  for v_item in
    select i->>'serial' as serial,
           case when (i->>'quantity') ~ '^\d+$' then (i->>'quantity')::integer end as quantity
      from jsonb_array_elements(p_items) i
     order by 1
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Quantidade inválida para a caixa %.', coalesce(v_item.serial, '(sem serial)');
    end if;

    select * into v_box
      from public.box_models
     where serial = v_item.serial
       for update;

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

    update public.box_models
       set stock_reserved = stock_reserved + v_item.quantity
     where serial = v_item.serial;

    insert into public.order_items (order_id, serial, quantity)
    values (v_order_id, v_item.serial, v_item.quantity);
  end loop;

  insert into public.order_events (order_id, from_status, to_status, actor)
  values (v_order_id, null, 'enviado', 'lenovo');

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, boolean) from public;
grant execute on function public.create_order(text, text, jsonb, boolean) to anon, authenticated;

-- 4. advance_order com previsão de entrega ao despachar ---------------------

drop function public.advance_order(bigint, public.actor_role);

create or replace function public.advance_order(
  p_order_id bigint,
  p_actor public.actor_role,
  p_eta timestamptz default null
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.orders%rowtype;
  v_next     public.order_status;
  v_expected public.actor_role;
  v_item     record;
begin
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

  if p_actor <> v_expected then
    raise exception 'Só a % pode mover o pedido #% de "%" para "%".',
      upper(v_expected::text), p_order_id,
      public.status_label(v_order.status), public.status_label(v_next);
  end if;

  if v_next = 'em_transporte' then
    if p_eta is not null and p_eta < now() - interval '1 hour' then
      raise exception 'A previsão de entrega não pode estar no passado.';
    end if;

    for v_item in
      select serial, quantity from public.order_items
       where order_id = p_order_id
       order by serial
    loop
      update public.box_models
         set stock_total    = stock_total    - v_item.quantity,
             stock_reserved = stock_reserved - v_item.quantity
       where serial = v_item.serial;
    end loop;

    update public.orders set status = v_next, eta = p_eta where id = p_order_id;
  else
    update public.orders set status = v_next where id = p_order_id;
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor)
  values (p_order_id, v_order.status, v_next, p_actor);

  return v_next;
end;
$$;

revoke all on function public.advance_order(bigint, public.actor_role, timestamptz) from public;
grant execute on function public.advance_order(bigint, public.actor_role, timestamptz) to anon, authenticated;

-- 5. Cadastro de caixas --------------------------------------------------------

-- Serial aleatório de 10 caracteres (sem 0/O/1/I para não confundir na leitura).
create or replace function public.generate_serial()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_serial text;
  v_i integer;
begin
  loop
    v_serial := '';
    for v_i in 1..10 loop
      v_serial := v_serial || substr(v_chars, 1 + floor(random() * length(v_chars))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.box_models where serial = v_serial);
  end loop;
  return v_serial;
end;
$$;

-- Inclui um tipo de caixa novo. Serial em branco = gerado automaticamente.
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
begin
  if p_machine_name is null or length(btrim(p_machine_name)) = 0 then
    raise exception 'Informe o nome da máquina.';
  end if;
  if p_machine_model is null or length(btrim(p_machine_model)) = 0 then
    raise exception 'Informe o modelo.';
  end if;
  if coalesce(p_stock_total, 0) < 0 or coalesce(p_min_stock, 0) < 0 then
    raise exception 'Estoque e mínimo não podem ser negativos.';
  end if;

  if v_serial = '' then
    v_serial := public.generate_serial();
  elsif v_serial !~ '^[A-Z0-9]{10}$' then
    raise exception 'O serial precisa ter exatamente 10 letras ou números.';
  elsif exists (select 1 from public.box_models where serial = v_serial) then
    raise exception 'Já existe uma caixa com o serial %.', v_serial;
  end if;

  insert into public.box_models (serial, machine_name, machine_model, stock_total, min_stock)
  values (v_serial, btrim(p_machine_name), btrim(p_machine_model),
          coalesce(p_stock_total, 0), coalesce(p_min_stock, 0));

  return v_serial;
end;
$$;

-- Edita nome, modelo, mínimo e ativo/descontinuada. Estoque muda só por reposição/pedidos.
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
begin
  select * into v_box from public.box_models where serial = p_serial for update;
  if not found then
    raise exception 'Caixa % não existe no catálogo.', p_serial;
  end if;
  if p_machine_name is null or length(btrim(p_machine_name)) = 0 then
    raise exception 'Informe o nome da máquina.';
  end if;
  if p_machine_model is null or length(btrim(p_machine_model)) = 0 then
    raise exception 'Informe o modelo.';
  end if;
  if coalesce(p_min_stock, 0) < 0 then
    raise exception 'O mínimo não pode ser negativo.';
  end if;
  if p_active = false and v_box.stock_reserved > 0 then
    raise exception '% %: há % caixas reservadas em pedidos abertos; conclua ou cancele antes de descontinuar.',
      v_box.machine_name, v_box.machine_model, v_box.stock_reserved;
  end if;

  update public.box_models
     set machine_name  = btrim(p_machine_name),
         machine_model = btrim(p_machine_model),
         min_stock     = coalesce(p_min_stock, 0),
         active        = coalesce(p_active, true)
   where serial = p_serial;
end;
$$;

revoke all on function public.generate_serial() from public;
revoke all on function public.create_box_model(text, text, text, integer, integer) from public;
revoke all on function public.update_box_model(text, text, text, integer, boolean) from public;
grant execute on function public.create_box_model(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.update_box_model(text, text, text, integer, boolean) to anon, authenticated;
