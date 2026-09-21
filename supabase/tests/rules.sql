-- Testes das regras de negócio (funções de 0002_functions.sql).
-- Roda inteiro numa transação e termina com RAISE EXCEPTION contendo o relatório,
-- o que desfaz tudo: o banco fica exatamente como estava.
-- Sucesso = relatório sem nenhuma linha "FALHOU".

create temp table test_results (seq serial, line text) on commit drop;

create function pg_temp.ok(cond boolean, label text) returns void
language sql as $$
  insert into test_results (line)
  values ((case when cond then 'ok     ' else 'FALHOU ' end) || label);
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

do $test$
declare
  o1 bigint; o2 bigint; o3 bigint; o4 bigint;
  b1 public.box_models%rowtype;
  b2 public.box_models%rowtype;
  st public.order_status;
  n  integer;
  msg text;
begin
  perform pg_temp.as_lenovo();  -- padrão: Lenovo; troca pontualmente para DHL
  -- Caixas de teste (removidas pelo rollback)
  insert into public.box_models (serial, machine_name, machine_model, stock_total, min_stock)
  values ('TESTBOX001', 'Teste Caixa A', 'v1', 100, 10),
         ('TESTBOX002', 'Teste Caixa B', 'v1',  50, 10);

  -- 1. create_order reserva em todos os itens
  o1 := public.create_order('Tester', null,
          '[{"serial":"TESTBOX001","quantity":30},{"serial":"TESTBOX002","quantity":10}]');
  select * into b1 from public.box_models where serial = 'TESTBOX001';
  select * into b2 from public.box_models where serial = 'TESTBOX002';
  perform pg_temp.ok(b1.stock_reserved = 30 and b1.stock_available = 70, '1a reserva box1 30 → disponível 70');
  perform pg_temp.ok(b2.stock_reserved = 10 and b2.stock_available = 40, '1b reserva box2 10 → disponível 40');
  select count(*) into n from public.order_events where order_id = o1;
  perform pg_temp.ok(n = 1, '1c evento de criação gravado');

  -- 2. rejeição parcial: 1 item ok, 1 item acima do disponível → nada gravado
  select count(*) into n from public.orders;
  begin
    perform public.create_order('Tester', null,
      '[{"serial":"TESTBOX001","quantity":10},{"serial":"TESTBOX002","quantity":45}]');
    perform pg_temp.ok(false, '2a deveria rejeitar');
  exception when others then
    msg := sqlerrm;
    perform pg_temp.ok(msg like '%Teste Caixa B%' and msg like '%40 disponíveis%', '2a erro cita item e disponível: ' || msg);
  end;
  select * into b1 from public.box_models where serial = 'TESTBOX001';
  perform pg_temp.ok(b1.stock_reserved = 30, '2b reserva de box1 não mudou (rollback parcial)');
  perform pg_temp.ok((select count(*) from public.orders) = n, '2c nenhum pedido novo gravado');

  -- 3. fluxo completo
  perform pg_temp.as_dhl();
  st := public.advance_order(o1);  perform pg_temp.ok(st = 'recebido',      '3a enviado → recebido');
  st := public.advance_order(o1);  perform pg_temp.ok(st = 'em_separacao',  '3b recebido → em_separacao');
  st := public.advance_order(o1);  perform pg_temp.ok(st = 'em_transporte', '3c em_separacao → em_transporte');
  select * into b1 from public.box_models where serial = 'TESTBOX001';
  select * into b2 from public.box_models where serial = 'TESTBOX002';
  perform pg_temp.ok(b1.stock_total = 70 and b1.stock_reserved = 0, '3d baixa real box1: total 70, reservado 0');
  perform pg_temp.ok(b2.stock_total = 40 and b2.stock_reserved = 0, '3e baixa real box2: total 40, reservado 0');
  perform pg_temp.as_lenovo();
  st := public.advance_order(o1); perform pg_temp.ok(st = 'entregue',    '3f em_transporte → entregue (lenovo)');
  select count(*) into n from public.order_events where order_id = o1;
  perform pg_temp.ok(n = 5, '3g 5 eventos no histórico');

  -- 4. ator errado
  o2 := public.create_order('Tester', 'obs', '[{"serial":"TESTBOX001","quantity":5}]');
  begin
    perform public.advance_order(o2);
    perform pg_temp.ok(false, '4a lenovo não deveria avançar "enviado"');
  exception when others then
    perform pg_temp.ok(sqlerrm like '%DHL%', '4a lenovo barrado em enviado: ' || sqlerrm);
  end;
  perform pg_temp.as_dhl();
  perform public.advance_order(o2);
  perform public.advance_order(o2);
  perform public.advance_order(o2);   -- em_transporte
  begin
    perform public.advance_order(o2);
    perform pg_temp.ok(false, '4b dhl não deveria confirmar entrega');
  exception when others then
    perform pg_temp.ok(sqlerrm like '%LENOVO%', '4b dhl barrada em em_transporte: ' || sqlerrm);
  end;

  -- 5. avançar pedido finalizado
  perform pg_temp.as_lenovo();
  begin
    perform public.advance_order(o1);
    perform pg_temp.ok(false, '5a entregue não deveria avançar');
  exception when others then
    perform pg_temp.ok(sqlerrm like '%Entregue%', '5a pedido entregue não avança: ' || sqlerrm);
  end;

  -- 6. cancelamento
  o3 := public.create_order('Tester', null, '[{"serial":"TESTBOX001","quantity":7}]');
  select * into b1 from public.box_models where serial = 'TESTBOX001';
  perform pg_temp.ok(b1.stock_reserved = 7, '6a reserva 7 antes de cancelar');
  perform public.cancel_order(o3);
  select * into b1 from public.box_models where serial = 'TESTBOX001';
  perform pg_temp.ok(b1.stock_reserved = 0, '6b cancelar libera reserva');
  perform pg_temp.ok((select status from public.orders where id = o3) = 'cancelado', '6c status cancelado');
  begin
    perform public.cancel_order(o3);
    perform pg_temp.ok(false, '6d cancelar duas vezes deveria falhar');
  exception when others then
    perform pg_temp.ok(true, '6d cancelar de novo é recusado: ' || sqlerrm);
  end;
  o4 := public.create_order('Tester', null, '[{"serial":"TESTBOX002","quantity":3}]');
  perform pg_temp.as_dhl();
  perform public.advance_order(o4);
  perform public.advance_order(o4);   -- em_separacao
  perform pg_temp.as_lenovo();
  begin
    perform public.cancel_order(o4);
    perform pg_temp.ok(false, '6e cancelar em separação deveria falhar');
  exception when others then
    perform pg_temp.ok(sqlerrm like '%Em separação%', '6e cancelar em separação recusado: ' || sqlerrm);
  end;

  -- 7. reposição
  perform pg_temp.as_dhl();
  n := public.restock('TESTBOX001', 20);
  perform pg_temp.ok(n = 85, '7a restock +20 → total 85 (100 −30 o1 −5 o2 +20)');
  begin
    perform public.restock('TESTBOX001', 0);
    perform pg_temp.ok(false, '7b restock 0 deveria falhar');
  exception when others then
    perform pg_temp.ok(true, '7b restock 0 recusado: ' || sqlerrm);
  end;
  begin
    perform public.restock('NAOEXISTE1', 5);
    perform pg_temp.ok(false, '7c serial inexistente deveria falhar');
  exception when others then
    perform pg_temp.ok(true, '7c serial inexistente recusado: ' || sqlerrm);
  end;

  perform pg_temp.as_lenovo();

  -- 8. validações de entrada
  begin
    perform public.create_order('Tester', null,
      '[{"serial":"TESTBOX001","quantity":1},{"serial":"TESTBOX001","quantity":2}]');
    perform pg_temp.ok(false, '8a item duplicado deveria falhar');
  exception when others then
    perform pg_temp.ok(sqlerrm like '%repetida%', '8a item duplicado recusado');
  end;
  begin
    perform public.create_order('Tester', null, '[]');
    perform pg_temp.ok(false, '8b lista vazia deveria falhar');
  exception when others then
    perform pg_temp.ok(true, '8b lista vazia recusada');
  end;
  begin
    perform public.create_order('   ', null, '[{"serial":"TESTBOX001","quantity":1}]');
    perform pg_temp.ok(false, '8c solicitante em branco deveria falhar');
  exception when others then
    perform pg_temp.ok(true, '8c solicitante em branco recusado');
  end;
  begin
    perform public.create_order('Tester', null, '[{"serial":"TESTBOX001","quantity":0}]');
    perform pg_temp.ok(false, '8d quantidade 0 deveria falhar');
  exception when others then
    perform pg_temp.ok(true, '8d quantidade 0 recusada');
  end;
  begin
    perform public.create_order('Tester', null, '[{"serial":"NAOEXISTE1","quantity":1}]');
    perform pg_temp.ok(false, '8e serial inexistente deveria falhar');
  exception when others then
    perform pg_temp.ok(true, '8e serial inexistente recusado');
  end;

  select string_agg(line, E'\n' order by seq), count(*) filter (where line like 'FALHOU%')
    into msg, n
    from test_results;
  raise exception E'\n=== RELATÓRIO DE TESTES (rollback proposital) ===\n%\n=== % falhas ===', msg, n;
end
$test$;
