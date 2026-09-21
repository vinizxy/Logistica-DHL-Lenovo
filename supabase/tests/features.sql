-- Testes de: cadastro de caixas, pedido urgente, previsão de entrega e comentários
-- (migração 0004) e ocultação de pedidos pela Lenovo (0007). Mesmo esquema de rules.sql: rollback proposital no fim,
-- relatório na mensagem de erro; sucesso = 0 falhas.
create temp table test_results (seq serial, line text) on commit drop;
create function pg_temp.ok(cond boolean, label text) returns void language sql as $$
  insert into test_results (line) values ((case when cond then 'ok     ' else 'FALHOU ' end) || label);
$$;
-- Sessão simulada: auth.uid() lê request.jwt.claim.sub. As contas de teste precisam
-- existir (supabase/scripts/create_test_users.mjs).
create function pg_temp.as_user(p_email text) returns void language plpgsql security definer as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'conta de teste % não existe (rode supabase/scripts/create_test_users.mjs)', p_email; end if;
  perform set_config('request.jwt.claim.sub', v::text, true);
end $$;
create function pg_temp.as_lenovo() returns void language sql as $$ select pg_temp.as_user('teste123@lenovo.com') $$;
create function pg_temp.as_dhl()    returns void language sql as $$ select pg_temp.as_user('teste123@dhl.com') $$;
create function pg_temp.as_nobody() returns void language sql as $$ select set_config('request.jwt.claim.sub', '', true) $$;
do $t$
declare o bigint; s text; n integer; msg text; r public.orders%rowtype; c bigint; canc bigint;
begin
  -- 1. cadastro
  perform pg_temp.as_dhl();
  s := public.create_box_model(null, 'Teste Máquina', 'v9', 50, 10);
  perform pg_temp.ok(s ~ '^[A-Z0-9]{10}$', '1a serial gerado: ' || s);
  begin perform public.create_box_model('abc', 'X', 'Y', 1, 1); perform pg_temp.ok(false, '1b serial curto');
  exception when others then perform pg_temp.ok(true, '1b serial curto recusado: ' || sqlerrm); end;
  begin perform public.create_box_model(s, 'X', 'Y', 1, 1); perform pg_temp.ok(false, '1c serial duplicado');
  exception when others then perform pg_temp.ok(true, '1c serial duplicado recusado: ' || sqlerrm); end;

  -- 2. urgente
  perform pg_temp.as_lenovo();
  o := public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 5))::jsonb, true);
  select * into r from public.orders where id = o;
  perform pg_temp.ok(r.urgent, '2a pedido urgente gravado');
  o := public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb);
  select * into r from public.orders where id = o;
  perform pg_temp.ok(not r.urgent, '2b default não urgente');

  -- 3. descontinuar
  perform pg_temp.as_dhl();
  begin perform public.update_box_model(s, 'Teste Máquina', 'v9', 10, false); perform pg_temp.ok(false, '3a descontinuar com reserva');
  exception when others then perform pg_temp.ok(sqlerrm like '%reservadas%', '3a descontinuar com reserva recusado: ' || sqlerrm); end;
  perform pg_temp.as_lenovo();
  perform public.cancel_order(o);
  perform public.cancel_order(o - 1);
  canc := o;
  perform pg_temp.as_dhl();
  perform public.update_box_model(s, 'Teste Máquina 2', 'v10', 20, false);
  perform pg_temp.ok((select active = false and machine_name = 'Teste Máquina 2' and min_stock = 20 from public.box_models where serial = s), '3b editar e descontinuar');
  perform pg_temp.as_lenovo();
  begin perform public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb); perform pg_temp.ok(false, '3c pedir descontinuada');
  exception when others then perform pg_temp.ok(sqlerrm like '%descontinuada%', '3c pedir descontinuada recusado: ' || sqlerrm); end;
  perform pg_temp.as_dhl();
  perform public.update_box_model(s, 'Teste Máquina 2', 'v10', 20, true);

  -- 4. previsão de entrega
  perform pg_temp.as_lenovo();
  o := public.create_order('Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 3))::jsonb);
  perform pg_temp.as_dhl();
  perform public.advance_order(o); perform public.advance_order(o);
  begin perform public.advance_order(o, now() - interval '2 days'); perform pg_temp.ok(false, '4a eta no passado');
  exception when others then perform pg_temp.ok(sqlerrm like '%passado%', '4a eta no passado recusada'); end;
  perform public.advance_order(o, now() + interval '3 hours');
  select * into r from public.orders where id = o;
  perform pg_temp.ok(r.status = 'em_transporte' and r.eta > now(), '4b despacho grava eta');
  perform pg_temp.ok((select stock_total = 47 from public.box_models where serial = s), '4c baixa real com eta');

  -- 5. comentários
  perform pg_temp.as_dhl();
  c := public.add_comment(o, '  Faltaram 2 caixas, enviamos 1.  ');
  perform pg_temp.ok((select body = 'Faltaram 2 caixas, enviamos 1.' and author = 'DHL Teste' and actor = 'dhl' and user_id = auth.uid() from public.order_comments where id = c), '5a comentário gravado, aparado, assinado pelo perfil');
  begin perform public.add_comment(o, '   '); perform pg_temp.ok(false, '5b comentário vazio');
  exception when others then perform pg_temp.ok(true, '5b comentário vazio recusado'); end;
  begin perform public.add_comment(999999, 'x'); perform pg_temp.ok(false, '5c pedido inexistente');
  exception when others then perform pg_temp.ok(true, '5c pedido inexistente recusado'); end;
  -- 6. ocultar (migração 0007: Lenovo "exclui" só da lista dela; nada é apagado)
  perform pg_temp.as_lenovo();
  begin perform public.hide_order(o); perform pg_temp.ok(false, '6a ocultar em transporte');
  exception when others then perform pg_temp.ok(sqlerrm like '%cancele antes%', '6a ocultar em andamento recusado: ' || sqlerrm); end;
  perform public.advance_order(o);
  perform public.hide_order(o);
  perform pg_temp.ok((select hidden_by_lenovo from public.orders where id = o), '6b pedido entregue marcado como oculto');
  perform pg_temp.ok(exists (select 1 from public.order_items where order_id = o)
                 and exists (select 1 from public.order_events where order_id = o)
                 and exists (select 1 from public.order_comments where order_id = o), '6c itens, eventos e comentários continuam existindo');
  perform pg_temp.ok((select stock_total = 47 from public.box_models where serial = s), '6d estoque intocado');
  perform public.hide_order(canc);
  perform pg_temp.ok((select hidden_by_lenovo from public.orders where id = canc), '6e pedido cancelado oculto');
  perform public.hide_order(canc);
  perform pg_temp.ok(true, '6f ocultar duas vezes não dá erro');
  begin perform public.hide_order(999999); perform pg_temp.ok(false, '6g inexistente');
  exception when others then perform pg_temp.ok(true, '6g inexistente recusado'); end;
  perform pg_temp.as_dhl();
  begin perform public.hide_order(o); perform pg_temp.ok(false, '6h DHL oculta');
  exception when others then perform pg_temp.ok(sqlerrm like '%LENOVO%', '6h DHL não oculta: ' || sqlerrm); end;

  select string_agg(line, E'\n' order by seq), count(*) filter (where line like 'FALHOU%') into msg, n from test_results;
  raise exception E'\n=== RELATÓRIO (rollback proposital) ===\n%\n=== % falhas ===', msg, n;
end $t$;
