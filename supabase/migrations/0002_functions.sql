-- Regras de negócio. Toda escrita no sistema passa por aqui.
-- security definer + search_path vazio: a função roda com privilégio do dono e
-- todos os objetos são qualificados com "public." para não haver ambiguidade.
-- Mensagens de erro em PT-BR: o frontend exibe o texto literalmente.

-- Rótulo legível de cada status, usado nas mensagens de erro.
create or replace function public.status_label(p public.order_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p
    when 'enviado'       then 'Enviado'
    when 'recebido'      then 'Recebido'
    when 'em_separacao'  then 'Em separação'
    when 'em_transporte' then 'Em transporte'
    when 'entregue'      then 'Entregue'
    when 'cancelado'     then 'Cancelado'
  end;
$$;

-- Lenovo cria um pedido multi-item. Reserva estoque de TODOS os itens ou falha inteiro.
-- p_items: [{"serial": "7KQ2M9XA4T", "quantity": 30}, ...]
create or replace function public.create_order(
  p_requested_by text,
  p_notes text,
  p_items jsonb
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

  insert into public.orders (requested_by, notes)
  values (btrim(p_requested_by), nullif(btrim(p_notes), ''))
  returning id into v_order_id;

  -- Trava as linhas em ordem de serial: dois pedidos simultâneos nunca entram em deadlock.
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

-- Avança o pedido para o próximo status do fluxo principal.
-- enviado → recebido → em_separacao → em_transporte (DHL)
-- em_transporte → entregue (Lenovo)
-- Ao entrar em em_transporte, faz a baixa real do estoque.
create or replace function public.advance_order(
  p_order_id bigint,
  p_actor public.actor_role
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
  end if;

  update public.orders set status = v_next where id = p_order_id;

  insert into public.order_events (order_id, from_status, to_status, actor)
  values (p_order_id, v_order.status, v_next, p_actor);

  return v_next;
end;
$$;

-- Lenovo cancela. Só antes da separação começar; libera a reserva.
create or replace function public.cancel_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item  record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;

  if v_order.status not in ('enviado', 'recebido') then
    raise exception 'Pedido #% está "%" e não pode mais ser cancelado.',
      p_order_id, public.status_label(v_order.status);
  end if;

  for v_item in
    select serial, quantity from public.order_items
     where order_id = p_order_id
     order by serial
  loop
    update public.box_models
       set stock_reserved = stock_reserved - v_item.quantity
     where serial = v_item.serial;
  end loop;

  update public.orders set status = 'cancelado' where id = p_order_id;

  insert into public.order_events (order_id, from_status, to_status, actor)
  values (p_order_id, v_order.status, 'cancelado', 'lenovo');
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
  v_total integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade de reposição precisa ser maior que zero.';
  end if;

  update public.box_models
     set stock_total = stock_total + p_quantity
   where serial = p_serial
  returning stock_total into v_total;

  if not found then
    raise exception 'Caixa % não existe no catálogo.', p_serial;
  end if;

  return v_total;
end;
$$;

-- Só anon/authenticated chamam as funções; ninguém mais (defesa em profundidade).
revoke all on function public.create_order(text, text, jsonb) from public;
revoke all on function public.advance_order(bigint, public.actor_role) from public;
revoke all on function public.cancel_order(bigint) from public;
revoke all on function public.restock(text, integer) from public;
revoke all on function public.status_label(public.order_status) from public;

grant execute on function public.create_order(text, text, jsonb) to anon, authenticated;
grant execute on function public.advance_order(bigint, public.actor_role) to anon, authenticated;
grant execute on function public.cancel_order(bigint) to anon, authenticated;
grant execute on function public.restock(text, integer) to anon, authenticated;
grant execute on function public.status_label(public.order_status) to anon, authenticated;
