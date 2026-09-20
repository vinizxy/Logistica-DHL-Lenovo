-- Testes de: cadastro de caixas, pedido urgente, previsão de entrega e comentários
-- (migração 0004). Mesmo esquema de rules.sql: rollback proposital no fim,
-- relatório na mensagem de erro; sucesso = 0 falhas.
create temp table test_results (seq serial, line text) on commit drop;
create function pg_temp.ok(cond boolean, label text) returns void language sql as $$
  insert into test_results (line) values ((case when cond then 'ok     ' else 'FALHOU ' end) || label);
$$;
do $t$
declare o bigint; s text; n integer; msg text; r public.orders%rowtype; c bigint;
begin
  -- 1. cadastro
  s := public.create_box_model(null, 'Teste Máquina', 'v9', 50, 10);
  perform pg_temp.ok(s ~ '^[A-Z0-9]{10}$', '1a serial gerado: ' || s);
  begin perform public.create_box_model('abc', 'X', 'Y', 1, 1); perform pg_temp.ok(false, '1b serial curto');
  exception when others then perform pg_temp.ok(true, '1b serial curto recusado: ' || sqlerrm); end;
  begin perform public.create_box_model(s, 'X', 'Y', 1, 1); perform pg_temp.ok(false, '1c serial duplicado');
  exception when others then perform pg_temp.ok(true, '1c serial duplicado recusado: ' || sqlerrm); end;

  -- 2. urgente
  o := public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 5))::jsonb, true);
  select * into r from public.orders where id = o;
  perform pg_temp.ok(r.urgent, '2a pedido urgente gravado');
  o := public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb);
  select * into r from public.orders where id = o;
  perform pg_temp.ok(not r.urgent, '2b default não urgente');

  -- 3. descontinuar
  begin perform public.update_box_model(s, 'Teste Máquina', 'v9', 10, false); perform pg_temp.ok(false, '3a descontinuar com reserva');
  exception when others then perform pg_temp.ok(sqlerrm like '%reservadas%', '3a descontinuar com reserva recusado: ' || sqlerrm); end;
  perform public.cancel_order(o);
  perform public.cancel_order(o - 1);
  perform public.update_box_model(s, 'Teste Máquina 2', 'v10', 20, false);
  perform pg_temp.ok((select active = false and machine_name = 'Teste Máquina 2' and min_stock = 20 from public.box_models where serial = s), '3b editar e descontinuar');
  begin perform public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb); perform pg_temp.ok(false, '3c pedir descontinuada');
  exception when others then perform pg_temp.ok(sqlerrm like '%descontinuada%', '3c pedir descontinuada recusado: ' || sqlerrm); end;
  perform public.update_box_model(s, 'Teste Máquina 2', 'v10', 20, true);

  -- 4. previsão de entrega
  o := public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 3))::jsonb);
  perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'dhl');
  begin perform public.advance_order(o, 'dhl', now() - interval '2 days'); perform pg_temp.ok(false, '4a eta no passado');
  exception when others then perform pg_temp.ok(sqlerrm like '%passado%', '4a eta no passado recusada'); end;
  perform public.advance_order(o, 'dhl', now() + interval '3 hours');
  select * into r from public.orders where id = o;
  perform pg_temp.ok(r.status = 'em_transporte' and r.eta > now(), '4b despacho grava eta');
  perform pg_temp.ok((select stock_total = 47 from public.box_models where serial = s), '4c baixa real com eta');

  -- 5. comentários
  c := public.add_comment(o, 'dhl', 'Maria', '  Faltaram 2 caixas, enviamos 1.  ');
  perform pg_temp.ok((select body = 'Faltaram 2 caixas, enviamos 1.' and author = 'Maria' from public.order_comments where id = c), '5a comentário gravado e aparado');
  begin perform public.add_comment(o, 'dhl', 'Maria', '   '); perform pg_temp.ok(false, '5b comentário vazio');
  exception when others then perform pg_temp.ok(true, '5b comentário vazio recusado'); end;
  begin perform public.add_comment(999999, 'dhl', 'Maria', 'x'); perform pg_temp.ok(false, '5c pedido inexistente');
  exception when others then perform pg_temp.ok(true, '5c pedido inexistente recusado'); end;

  select string_agg(line, E'\n' order by seq), count(*) filter (where line like 'FALHOU%') into msg, n from test_results;
  raise exception E'\n=== RELATÓRIO (rollback proposital) ===\n%\n=== % falhas ===', msg, n;
end $t$;
