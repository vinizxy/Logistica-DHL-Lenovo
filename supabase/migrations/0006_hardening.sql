-- Hardening: limites de tamanho e de quantidade com mensagens legíveis, e revogação
-- do EXECUTE que o Supabase concede por padrão a funções internas.
-- Motivado pela suíte supabase/tests/security.sql (seções B e C).

-- 1. Limites -----------------------------------------------------------------------
-- Uma função só de leitura, sem privilégios, usada pelas outras para validar texto.
-- Os limites também viram CHECK nas tabelas (defesa em profundidade).

create or replace function public.check_text(p_value text, p_empty_msg text, p_label text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text := btrim(p_value);
begin
  if v is null or length(v) = 0 then
    raise exception '%', p_empty_msg;
  end if;
  if length(v) > p_max then
    raise exception '% muito longo (máx. % caracteres).', p_label, p_max;
  end if;
  return v;
end;
$$;
revoke all on function public.check_text(text, text, text, integer) from public, anon, authenticated;

-- Limites por tabela. Os dados existentes já cabem (nomes curtos, comentários ≤ 2000).
alter table public.orders
  add constraint orders_requested_by_len check (length(requested_by) <= 80),
  add constraint orders_notes_len check (notes is null or length(notes) <= 500);
alter table public.order_items
  add constraint order_items_quantity_max check (quantity <= 10000);
alter table public.order_comments
  add constraint order_comments_author_len check (length(author) <= 80);
alter table public.box_models
  add constraint box_models_machine_name_len check (length(machine_name) <= 80),
  add constraint box_models_machine_model_len check (length(machine_model) <= 80),
  add constraint box_models_stock_total_max check (stock_total <= 1000000),
  add constraint box_models_min_stock_max check (min_stock <= 1000000);

-- 2. Funções internas: o Supabase dá EXECUTE a anon/authenticated por default ---------
-- (também de PUBLIC: funções de trigger nascem com EXECUTE para todos)
revoke all on function public.generate_serial() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- 3. create_order: limites de texto e teto de quantidade antes de converter --------------
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
  v_by       text;
  v_notes    text;
begin
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

  insert into public.orders (requested_by, notes, urgent)
  values (v_by, v_notes, coalesce(p_urgent, false))
  returning id into v_order_id;

  for v_item in
    -- só converte para integer o que cabe com folga (até 9 dígitos); o resto é inválido
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

-- 4. restock: teto por reposição e teto de estoque -----------------------------------
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

  update public.box_models
     set stock_total = stock_total + p_quantity
   where serial = p_serial
  returning stock_total into v_total;

  return v_total;
end;
$$;

-- 5. add_comment: limites de texto ----------------------------------------------------
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
  v_author text;
  v_body text;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;
  v_author := public.check_text(p_author, 'Informe seu nome.', 'Nome', 80);
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(btrim(p_body)) > 2000 then
    raise exception 'A mensagem é muito longa (máx. 2.000 caracteres).';
  end if;
  v_body := btrim(p_body);

  insert into public.order_comments (order_id, actor, author, body)
  values (p_order_id, p_actor, v_author, v_body)
  returning id into v_id;

  return v_id;
end;
$$;

-- 6. Cadastro: limites de texto e de estoque ------------------------------------------
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
     set machine_name  = v_name,
         machine_model = v_model,
         min_stock     = coalesce(p_min_stock, 0),
         active        = coalesce(p_active, true)
   where serial = p_serial;
end;
$$;
