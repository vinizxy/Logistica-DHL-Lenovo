-- Testes de cushion (migração 0010): cadastro com máquinas, troca da lista, recusas,
-- perfis e pedido misto caixa + cushion. Mesmo esquema dos outros: tudo numa transação,
-- rollback proposital no fim, relatório na mensagem de erro; sucesso = 0 falhas.
create temp table test_results (seq serial, line text) on commit drop;
create function pg_temp.ok(cond boolean, label text) returns void language sql as $$
  insert into test_results (line) values ((case when cond then 'ok     ' else 'FALHOU ' end) || label);
$$;
create function pg_temp.as_user(p_email text) returns void language plpgsql security definer as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'conta de teste % não existe (rode supabase/scripts/create_test_users.mjs)', p_email; end if;
  perform set_config('request.jwt.claim.sub', v::text, true);
end $$;
create function pg_temp.as_lenovo() returns void language sql as $$ select pg_temp.as_user('teste123@lenovo.com') $$;
create function pg_temp.as_dhl()    returns void language sql as $$ select pg_temp.as_user('teste123@dhl.com') $$;
do $t$
declare
  b1 text; b2 text; b3 text; c text; c2 text; o bigint; o2 bigint; n integer; msg text;
  bm public.box_models%rowtype; cm public.box_models%rowtype;
begin
  -- Cadastro -------------------------------------------------------------------------
  perform pg_temp.as_dhl();
  b1 := public.create_box_model(null, 'Cush Máquina A', 'g1', 100, 0);
  b2 := public.create_box_model(null, 'Cush Máquina B', 'g1', 100, 0);
  b3 := public.create_box_model(null, 'Cush Máquina C', 'g1', 100, 0);
  -- Cushion é identificado só pelo serial (sem nome nem modelo próprios).
  c := public.create_cushion(' cushtest01 ', 60, 5, array[b1, b2]);
  select * into cm from public.box_models where serial = c;
  perform pg_temp.ok(c = 'CUSHTEST01' and cm.kind = 'cushion' and cm.stock_total = 60 and cm.min_stock = 5,
    'C1 cushion cadastrado pelo serial (' || coalesce(c, 'null') || ')');
  perform pg_temp.ok(cm.machine_name = 'Cushion' and cm.machine_model = c, 'C1c nome/modelo derivados: ' || cm.machine_name || ' ' || cm.machine_model);
  perform pg_temp.ok((select count(*) = 2 from public.cushion_fits where cushion_serial = c), 'C1b serve em 2 máquinas');
  perform pg_temp.ok((select kind = 'caixa' from public.box_models where serial = b1), 'C2 caixa nova nasce kind=caixa');

  begin perform public.create_cushion('CUSHTEST02', 1, 0, '{}'); perform pg_temp.ok(false, 'C3 cushion sem máquina criado');
  exception when others then perform pg_temp.ok(sqlerrm like 'Marque pelo menos uma máquina%', 'C3 sem máquina recusado: ' || sqlerrm); end;
  perform pg_temp.ok((select count(*) = 0 from public.box_models where serial = 'CUSHTEST02'), 'C3b nada gravado');
  begin perform public.create_cushion('  ', 1, 0, array[b1]); perform pg_temp.ok(false, 'C4 serial vazio aceito');
  exception when others then perform pg_temp.ok(sqlerrm = 'Informe o serial do cushion.', 'C4 serial vazio recusado: ' || sqlerrm); end;
  begin perform public.create_cushion(null, 1, 0, array[b1]); perform pg_temp.ok(false, 'C4b serial nulo aceito');
  exception when others then perform pg_temp.ok(sqlerrm = 'Informe o serial do cushion.', 'C4b serial nulo recusado'); end;
  begin perform public.create_cushion('ABC', 1, 0, array[b1]); perform pg_temp.ok(false, 'C4c serial curto aceito');
  exception when others then perform pg_temp.ok(sqlerrm like 'O serial precisa ter exatamente 10%', 'C4c serial curto recusado: ' || sqlerrm); end;
  begin perform public.create_cushion(c, 1, 0, array[b1]); perform pg_temp.ok(false, 'C4d serial repetido aceito');
  exception when others then perform pg_temp.ok(sqlerrm like 'Já existe%' || c || '%', 'C4d serial repetido recusado: ' || sqlerrm); end;
  begin perform public.create_cushion(b1, 1, 0, array[b2]); perform pg_temp.ok(false, 'C4e serial de caixa reaproveitado');
  exception when others then perform pg_temp.ok(sqlerrm like 'Já existe%', 'C4e serial de uma caixa recusado'); end;

  -- Troca da lista ---------------------------------------------------------------------
  n := public.set_cushion_fits(c, array[b1, b2, b3]);
  perform pg_temp.ok(n = 3 and (select count(*) = 3 from public.cushion_fits where cushion_serial = c), 'C5a lista trocada para 3');
  n := public.set_cushion_fits(c, array[b3]);
  perform pg_temp.ok(n = 1 and (select array_agg(box_serial) = array[b3] from public.cushion_fits where cushion_serial = c), 'C5b lista trocada para 1');

  begin perform public.set_cushion_fits(c, '{}'); perform pg_temp.ok(false, 'C6 lista vazia aceita');
  exception when others then perform pg_temp.ok(sqlerrm like 'Marque pelo menos uma máquina%', 'C6 lista vazia recusada'); end;
  perform pg_temp.ok((select count(*) = 1 from public.cushion_fits where cushion_serial = c), 'C6b lista anterior preservada');
  begin perform public.set_cushion_fits(c, array['NAOEXISTE1']); perform pg_temp.ok(false, 'C7 serial inexistente aceito');
  exception when others then perform pg_temp.ok(sqlerrm like 'Máquina não encontrada%NAOEXISTE1%', 'C7 serial inexistente recusado: ' || sqlerrm); end;
  c2 := public.create_cushion('CUSHTEST04', 10, 0, array[b1]);
  begin perform public.set_cushion_fits(c, array[c2]); perform pg_temp.ok(false, 'C8 ligado a outro cushion');
  exception when others then perform pg_temp.ok(sqlerrm like 'Máquina não encontrada%', 'C8 ligar a outro cushion recusado'); end;
  begin perform public.set_cushion_fits(b1, array[b2]); perform pg_temp.ok(false, 'C9 caixa virou cushion');
  exception when others then perform pg_temp.ok(sqlerrm like '%é uma caixa, não um cushion.', 'C9 set_cushion_fits em caixa recusado: ' || sqlerrm); end;
  n := public.set_cushion_fits(lower(c), array[lower(b1), b1, ' ' || b2 || ' ', '']);
  perform pg_temp.ok(n = 2, 'C10 minúsculas, espaços e duplicados normalizados (' || n || ')');
  begin perform public.set_cushion_fits('NAOEXISTE1', array[b1]); perform pg_temp.ok(false, 'C10b cushion inexistente');
  exception when others then perform pg_temp.ok(sqlerrm like 'Cushion NAOEXISTE1 não existe%', 'C10b cushion inexistente recusado'); end;

  -- Perfis -----------------------------------------------------------------------------
  perform pg_temp.as_lenovo();
  begin perform public.create_cushion('CUSHLENOV1', 1, 0, array[b1]); perform pg_temp.ok(false, 'C11 Lenovo cadastrou cushion');
  exception when others then perform pg_temp.ok(sqlerrm like '%DHL%', 'C11 Lenovo não cadastra cushion: ' || sqlerrm); end;
  begin perform public.set_cushion_fits(c, array[b1]); perform pg_temp.ok(false, 'C12 Lenovo trocou máquinas');
  exception when others then perform pg_temp.ok(sqlerrm like '%DHL%', 'C12 Lenovo não troca máquinas'); end;

  -- Pedido misto -----------------------------------------------------------------------
  o := public.create_order('Tester', null, jsonb_build_array(
         jsonb_build_object('serial', b1, 'quantity', 4),
         jsonb_build_object('serial', c, 'quantity', 8)));
  select * into bm from public.box_models where serial = b1;
  select * into cm from public.box_models where serial = c;
  perform pg_temp.ok(bm.stock_reserved = 4 and cm.stock_reserved = 8 and cm.stock_available = 52,
    'C13 pedido misto reserva caixa e cushion');
  perform pg_temp.as_dhl();
  perform public.advance_order(o); perform public.advance_order(o);
  perform public.advance_order(o, now() + interval '2 hours');
  select * into bm from public.box_models where serial = b1;
  select * into cm from public.box_models where serial = c;
  perform pg_temp.ok(bm.stock_total = 96 and bm.stock_reserved = 0 and cm.stock_total = 52 and cm.stock_reserved = 0,
    'C14 despacho baixa caixa e cushion');

  perform pg_temp.as_lenovo();
  o2 := public.create_order('Tester', null, jsonb_build_array(
          jsonb_build_object('serial', b2, 'quantity', 3),
          jsonb_build_object('serial', c, 'quantity', 2)));
  perform public.cancel_order(o2);
  select * into bm from public.box_models where serial = b2;
  select * into cm from public.box_models where serial = c;
  perform pg_temp.ok(bm.stock_reserved = 0 and cm.stock_reserved = 0, 'C15 cancelamento libera caixa e cushion');

  perform pg_temp.as_dhl();
  n := public.restock(c, 30);
  perform pg_temp.ok(n = 82, 'C16 reposição de cushion soma (' || n || ')');

  -- Editar cushion só muda mínimo/situação: nome e modelo continuam derivados do serial.
  perform public.update_box_model(c, 'Outro nome', 'Outro modelo', 7, true);
  select * into cm from public.box_models where serial = c;
  perform pg_temp.ok(cm.machine_name = 'Cushion' and cm.machine_model = c and cm.min_stock = 7,
    'C18 editar cushion mantém nome/modelo e muda o mínimo (' || cm.machine_name || ' ' || cm.machine_model || ')');
  perform public.update_box_model(b1, 'Cush Máquina A2', 'g2', 3, true);
  perform pg_temp.ok((select machine_name = 'Cush Máquina A2' and machine_model = 'g2' from public.box_models where serial = b1),
    'C18b editar caixa continua mudando nome/modelo');

  perform public.update_box_model(c2, 'Cushion', c2, 0, false);
  perform pg_temp.as_lenovo();
  begin
    perform public.create_order('Tester', null, jsonb_build_array(jsonb_build_object('serial', c2, 'quantity', 1)));
    perform pg_temp.ok(false, 'C17 cushion descontinuado entrou em pedido');
  exception when others then perform pg_temp.ok(true, 'C17 cushion descontinuado recusado: ' || sqlerrm); end;

  select string_agg(line, E'\n' order by seq), count(*) filter (where line like 'FALHOU%')
    into msg, n
    from test_results;
  raise exception E'\n=== RELATÓRIO (rollback proposital) ===\n%\n=== % falhas ===', msg, n;
end
$t$;
