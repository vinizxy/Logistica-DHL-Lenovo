-- Cushion: acessório que protege a máquina dentro da caixa. Fica no mesmo catálogo das
-- caixas (kind = 'cushion'): machine_name = nome do cushion, machine_model = modelo.
-- Reserva, baixa, cancelamento, reposição e mínimo continuam nas funções existentes,
-- que operam por serial.

alter table public.box_models
  add column kind text not null default 'caixa'
  constraint box_models_kind_check check (kind in ('caixa', 'cushion'));

-- Em quais máquinas cada cushion serve; cada máquina é representada pela sua caixa.
create table public.cushion_fits (
  cushion_serial text not null references public.box_models (serial) on delete cascade,
  box_serial     text not null references public.box_models (serial) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (cushion_serial, box_serial),
  constraint cushion_fits_not_self check (cushion_serial <> box_serial)
);
create index cushion_fits_box_idx on public.cushion_fits (box_serial);

alter table public.cushion_fits enable row level security;
create policy "leitura de logados" on public.cushion_fits for select to authenticated using (true);
revoke all on public.cushion_fits from anon;
revoke insert, update, delete, truncate on public.cushion_fits from authenticated;
alter publication supabase_realtime add table public.cushion_fits;

-- Troca a lista inteira de máquinas de um cushion. Só DHL.
create or replace function public.set_cushion_fits(p_serial text, p_box_serials text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.box_models%rowtype;
  v_serials text[];
  v_missing text;
begin
  perform public.require_role('dhl');

  select * into v_item from public.box_models
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if not found then
    raise exception 'Cushion % não existe no catálogo.', coalesce(nullif(left(btrim(p_serial), 20), ''), '(sem serial)');
  end if;
  if v_item.kind <> 'cushion' then
    raise exception '% % é uma caixa, não um cushion.', v_item.machine_name, v_item.machine_model;
  end if;

  select coalesce(array_agg(distinct upper(btrim(s))), '{}') into v_serials
    from unnest(coalesce(p_box_serials, '{}')) s
   where btrim(coalesce(s, '')) <> '';
  if cardinality(v_serials) = 0 then
    raise exception 'Marque pelo menos uma máquina em que o cushion serve.';
  end if;
  if cardinality(v_serials) > 500 then
    raise exception 'Um cushion pode servir em no máximo 500 máquinas.';
  end if;

  select string_agg(left(s, 20), ', ' order by s) into v_missing
    from unnest(v_serials) s
   where not exists (select 1 from public.box_models b where b.serial = s and b.kind = 'caixa');
  if v_missing is not null then
    raise exception 'Máquina não encontrada no catálogo de caixas: %.', left(v_missing, 200);
  end if;

  delete from public.cushion_fits where cushion_serial = v_item.serial;
  insert into public.cushion_fits (cushion_serial, box_serial)
  select v_item.serial, s from unnest(v_serials) s;
  return cardinality(v_serials);
end;
$$;

-- Cadastra cushion já com as máquinas, numa transação só. Só DHL.
create or replace function public.create_cushion(
  p_serial text,
  p_name text,
  p_model text,
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
  v_serial text;
begin
  perform public.require_role('dhl');
  perform public.check_text(p_name, 'Informe o nome do cushion.', 'Nome do cushion', 80);
  if cardinality(coalesce(p_box_serials, '{}')) = 0 then
    raise exception 'Marque pelo menos uma máquina em que o cushion serve.';
  end if;

  v_serial := public.create_box_model(p_serial, p_name, p_model, p_stock_total, p_min_stock);
  update public.box_models set kind = 'cushion' where serial = v_serial;
  perform public.set_cushion_fits(v_serial, p_box_serials);
  return v_serial;
end;
$$;

-- Mesma regra de 0007; só as mensagens passam a servir para caixa e cushion.
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
  v_name := public.check_text(p_machine_name, 'Informe o nome.', 'Nome', 80);
  v_model := public.check_text(p_machine_model, 'Informe o modelo.', 'Modelo', 80);
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

revoke all on function public.set_cushion_fits(text, text[]) from public, anon;
revoke all on function public.create_cushion(text, text, text, integer, integer, text[]) from public, anon;
grant execute on function public.set_cushion_fits(text, text[]) to authenticated;
grant execute on function public.create_cushion(text, text, text, integer, integer, text[]) to authenticated;
