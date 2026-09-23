-- Cushion identificado só pelo serial: sem nome nem modelo próprios. As colunas
-- machine_name/machine_model (obrigatórias no catálogo) ficam derivadas: 'Cushion' e o
-- próprio serial, para as mensagens das funções de pedido lerem "Cushion 5M11C12345: ...".

drop function public.create_cushion(text, text, text, integer, integer, text[]);

-- Cadastra cushion pelo serial (obrigatório, 10 letras ou números), já com as máquinas. Só DHL.
create or replace function public.create_cushion(
  p_serial text,
  p_stock_total integer default 0,
  p_min_stock integer default 0,
  p_box_serials text[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial text := upper(btrim(coalesce(p_serial, '')));
begin
  perform public.require_role('dhl');
  if v_serial = '' then
    raise exception 'Informe o serial do cushion.';
  end if;
  if cardinality(coalesce(p_box_serials, '{}')) = 0 then
    raise exception 'Marque pelo menos uma máquina em que o cushion serve.';
  end if;

  -- create_box_model valida o formato do serial, a duplicidade e os limites de estoque.
  v_serial := public.create_box_model(v_serial, 'Cushion', v_serial, p_stock_total, p_min_stock);
  update public.box_models set kind = 'cushion' where serial = v_serial;
  perform public.set_cushion_fits(v_serial, p_box_serials);
  return v_serial;
end;
$$;

-- Editar cushion muda só mínimo e situação; nome e modelo continuam derivados do serial.
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
    raise exception 'Item % não existe no catálogo.', p_serial;
  end if;
  if v_box.kind = 'cushion' then
    v_name := 'Cushion';
    v_model := v_box.serial;
  else
    v_name := public.check_text(p_machine_name, 'Informe o nome.', 'Nome', 80);
    v_model := public.check_text(p_machine_model, 'Informe o modelo.', 'Modelo', 80);
  end if;
  if coalesce(p_min_stock, 0) < 0 then
    raise exception 'O mínimo não pode ser negativo.';
  end if;
  if coalesce(p_min_stock, 0) > 1000000 then
    raise exception 'O mínimo não pode passar de 1.000.000.';
  end if;
  if p_active = false and v_box.stock_reserved > 0 then
    raise exception '% %: há % unidades reservadas em pedidos abertos; conclua ou cancele antes de descontinuar.',
      v_box.machine_name, v_box.machine_model, v_box.stock_reserved;
  end if;

  update public.box_models
     set machine_name = v_name, machine_model = v_model,
         min_stock = coalesce(p_min_stock, 0), active = coalesce(p_active, true)
   where serial = p_serial;
end;
$$;

-- Cushions já cadastrados passam ao formato novo.
update public.box_models set machine_name = 'Cushion', machine_model = serial where kind = 'cushion';

revoke all on function public.create_cushion(text, integer, integer, text[]) from public, anon;
grant execute on function public.create_cushion(text, integer, integer, text[]) to authenticated;
