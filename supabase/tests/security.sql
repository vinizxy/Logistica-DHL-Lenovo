-- Testes de segurança e estabilidade. Mesmo esquema dos outros: tudo numa transação,
-- rollback proposital no fim, relatório na mensagem de erro; sucesso = 0 falhas.
--
-- Cobre: (A) papel anon não escreve direto em tabela nenhuma, só lê;
--        (B) toda função exposta é security definer com search_path vazio e só as
--            funções públicas têm EXECUTE para anon;
--        (C) entradas hostis/absurdas são recusadas com mensagem legível (nunca
--            erro interno do Postgres);
--        (D) invariantes de estoque nunca quebram, mesmo por caminhos tortos.
create temp table test_results (seq serial, line text) on commit drop;
-- a seção A roda como anon; ele precisa gravar no relatório
grant insert on test_results to anon;
grant usage on sequence test_results_seq_seq to anon;
create function pg_temp.ok(cond boolean, label text) returns void language sql as $$
  insert into test_results (line) values ((case when cond then 'ok     ' else 'FALHOU ' end) || label);
$$;
do $t$
declare s text; o bigint; n integer; msg text; big text; r record;
begin
  s := public.create_box_model(null, 'Sec Máquina', 'v1', 100, 10);

  -- A. papel anon: leitura sim, escrita direta não ----------------------------
  set local role anon;
  perform pg_temp.ok((select count(*) >= 1 from public.box_models), 'A1 anon lê box_models');
  perform pg_temp.ok((select count(*) >= 0 from public.orders), 'A2 anon lê orders');
  begin insert into public.orders (requested_by) values ('hacker'); perform pg_temp.ok(false, 'A3 anon insert orders');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A3 anon insert orders negado');
           when others then perform pg_temp.ok(false, 'A3 erro inesperado: ' || sqlerrm); end;
  begin update public.box_models set stock_total = 999999 where serial = s; perform pg_temp.ok(false, 'A4 anon update estoque');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A4 anon update estoque negado');
           when others then perform pg_temp.ok(false, 'A4 erro inesperado: ' || sqlerrm); end;
  begin delete from public.orders; perform pg_temp.ok(false, 'A5 anon delete orders');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A5 anon delete orders negado');
           when others then perform pg_temp.ok(false, 'A5 erro inesperado: ' || sqlerrm); end;
  begin insert into public.order_comments (order_id, actor, author, body) values (1, 'dhl', 'x', 'y'); perform pg_temp.ok(false, 'A6 anon insert comentário');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A6 anon insert comentário negado');
           when others then perform pg_temp.ok(false, 'A6 erro inesperado: ' || sqlerrm); end;
  begin insert into public.order_events (order_id, to_status, actor) values (1, 'entregue', 'lenovo'); perform pg_temp.ok(false, 'A7 anon insert evento');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A7 anon insert evento negado');
           when others then perform pg_temp.ok(false, 'A7 erro inesperado: ' || sqlerrm); end;
  begin update public.orders set status = 'entregue'; perform pg_temp.ok(false, 'A8 anon update status');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A8 anon update status negado');
           when others then perform pg_temp.ok(false, 'A8 erro inesperado: ' || sqlerrm); end;
  begin perform public.generate_serial(); perform pg_temp.ok(false, 'A9 anon chama função interna');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A9 anon não executa generate_serial (interna)');
           when others then perform pg_temp.ok(false, 'A9 erro inesperado: ' || sqlerrm); end;
  -- pelas funções, anon consegue operar normalmente
  o := public.create_order('Anon Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 5))::jsonb);
  perform pg_temp.ok(o > 0, 'A10 anon cria pedido via função');
  perform pg_temp.ok((select stock_reserved = 5 from public.box_models where serial = s), 'A11 reserva feita via função');
  reset role;

  -- B. configuração das funções -------------------------------------------------
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and not (coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%');
  perform pg_temp.ok(n = 0, 'B1 toda função security definer tem search_path fixo (faltando: ' || n || ')');
  select string_agg(p.proname, ', ') into msg from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('create_order','advance_order','cancel_order','delete_order','restock',
                           'add_comment','create_box_model','update_box_model','status_label');
  perform pg_temp.ok(msg is null, 'B2 anon só executa as funções públicas' || coalesce(' (extras: ' || msg || ')', ''));
  select count(*) into n from pg_tables where schemaname = 'public' and not rowsecurity;
  perform pg_temp.ok(n = 0, 'B3 RLS ligado em todas as tabelas (sem: ' || n || ')');
  select count(*) into n from pg_policies where schemaname = 'public' and cmd <> 'SELECT';
  perform pg_temp.ok(n = 0, 'B4 nenhuma policy de escrita (' || n || ')');

  -- C. entradas hostis ------------------------------------------------------------
  big := repeat('x', 20000);
  begin perform public.create_order(big, null, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb); perform pg_temp.ok(false, 'C1 solicitante de 20k chars aceito');
  exception when others then perform pg_temp.ok(sqlerrm like '%longo%' or sqlerrm like '%caracteres%', 'C1 solicitante gigante recusado: ' || left(sqlerrm, 80)); end;
  begin perform public.create_order('T', big, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb); perform pg_temp.ok(false, 'C2 observação de 20k chars aceita');
  exception when others then perform pg_temp.ok(sqlerrm like '%longo%' or sqlerrm like '%caracteres%', 'C2 observação gigante recusada: ' || left(sqlerrm, 80)); end;
  begin perform public.create_order('T', null, json_build_array(json_build_object('serial', s, 'quantity', '99999999999'))::jsonb); perform pg_temp.ok(false, 'C3 quantidade 99999999999 aceita');
  exception when others then perform pg_temp.ok(sqlerrm not like '%out of range%', 'C3 quantidade absurda recusada com msg legível: ' || left(sqlerrm, 80)); end;
  begin perform public.create_order('T', null, json_build_array(json_build_object('serial', s, 'quantity', -5))::jsonb); perform pg_temp.ok(false, 'C4 quantidade negativa aceita');
  exception when others then perform pg_temp.ok(sqlerrm like '%inválida%', 'C4 quantidade negativa recusada'); end;
  begin perform public.create_order('T', null, json_build_array(json_build_object('serial', s, 'quantity', '1e3'))::jsonb); perform pg_temp.ok(false, 'C5 quantidade 1e3 aceita');
  exception when others then perform pg_temp.ok(sqlerrm like '%inválida%', 'C5 quantidade "1e3" recusada'); end;
  begin perform public.create_order('T', null, json_build_array(json_build_object('serial', s, 'quantity', 2.5))::jsonb); perform pg_temp.ok(false, 'C6 quantidade 2.5 aceita');
  exception when others then perform pg_temp.ok(sqlerrm like '%inválida%', 'C6 quantidade 2.5 recusada'); end;
  begin perform public.create_order('T', null, json_build_array(json_build_object('serial', lower(s), 'quantity', 1))::jsonb); perform pg_temp.ok(false, 'C7 serial minúsculo aceito');
  exception when others then perform pg_temp.ok(sqlerrm like '%não existe%', 'C7 serial minúsculo tratado como inexistente'); end;
  begin perform public.create_order('T', null, '{"serial":"x"}'::jsonb); perform pg_temp.ok(false, 'C8 items objeto em vez de array');
  exception when others then perform pg_temp.ok(sqlerrm like '%pelo menos um item%', 'C8 items não-array recusado'); end;
  begin perform public.create_order('T', null, json_build_array('oi', 3)::jsonb); perform pg_temp.ok(false, 'C9 items com elementos não-objeto');
  exception when others then perform pg_temp.ok(sqlerrm not like '%cannot%' and sqlerrm not like '%invalid%', 'C9 items malformado recusado com msg legível: ' || left(sqlerrm, 80)); end;
  o := public.create_order('<script>alert(1)</script>', $$'; drop table public.orders; --$$, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb);
  perform pg_temp.ok((select requested_by = '<script>alert(1)</script>' from public.orders where id = o), 'C10 HTML/SQL no texto é só texto');
  perform pg_temp.ok((select count(*) > 0 from public.orders), 'C10b tabela orders continua existindo');
  begin perform public.restock(s, 2147483647); perform pg_temp.ok(false, 'C11 restock 2^31 aceito');
  exception when others then perform pg_temp.ok(sqlerrm not like '%out of range%', 'C11 restock absurdo recusado com msg legível: ' || left(sqlerrm, 80)); end;
  begin perform public.restock(s, -10); perform pg_temp.ok(false, 'C12 restock negativo aceito');
  exception when others then perform pg_temp.ok(sqlerrm not like '%violates%', 'C12 restock negativo recusado com msg legível: ' || left(sqlerrm, 80)); end;
  begin perform public.advance_order(o, 'hacker'::public.actor_role); perform pg_temp.ok(false, 'C13 ator inválido');
  exception when invalid_text_representation then perform pg_temp.ok(true, 'C13 ator inválido recusado pelo enum');
           when others then perform pg_temp.ok(true, 'C13 ator inválido recusado: ' || left(sqlerrm, 60)); end;
  begin perform public.add_comment(o, 'dhl', 'M', big || big); perform pg_temp.ok(false, 'C14 comentário de 40k chars aceito');
  exception when others then perform pg_temp.ok(sqlerrm like '%longo%' or sqlerrm like '%caracteres%', 'C14 comentário gigante recusado: ' || left(sqlerrm, 80)); end;
  begin perform public.create_box_model(null, big, 'v', 1, 1); perform pg_temp.ok(false, 'C15 nome de máquina gigante aceito');
  exception when others then perform pg_temp.ok(sqlerrm like '%longo%' or sqlerrm like '%caracteres%', 'C15 nome de máquina gigante recusado: ' || left(sqlerrm, 80)); end;
  begin perform public.create_box_model(null, 'M', 'v', 2147483647, 1); perform public.restock((select serial from public.box_models where machine_name = 'M' limit 1), 10); perform pg_temp.ok(false, 'C16 estoque estoura integer');
  exception when others then perform pg_temp.ok(sqlerrm not like '%out of range%', 'C16 estoque absurdo recusado com msg legível: ' || left(sqlerrm, 80)); end;
  begin perform public.advance_order(null, 'dhl'); perform pg_temp.ok(false, 'C17 id nulo');
  exception when others then perform pg_temp.ok(true, 'C17 id nulo recusado: ' || left(sqlerrm, 60)); end;
  begin perform public.delete_order(-1); perform pg_temp.ok(false, 'C18 id negativo');
  exception when others then perform pg_temp.ok(sqlerrm like '%não encontrado%', 'C18 id negativo: não encontrado'); end;

  -- D. invariantes de estoque ------------------------------------------------------
  -- reserva nunca passa do total, mesmo tentando pelo caminho da função
  begin perform public.create_order('T', null, json_build_array(json_build_object('serial', s, 'quantity', 95))::jsonb); perform pg_temp.ok(false, 'D1 reserva acima do disponível');
  exception when others then perform pg_temp.ok(true, 'D1 reserva acima do disponível recusada'); end;
  select * into r from public.box_models where serial = s;
  perform pg_temp.ok(r.stock_reserved = 6 and r.stock_available = 94, 'D2 reserva = 6 (5 + 1), disponível 94');
  -- ciclo completo devolve consistência: total cai, reserva zera
  perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'dhl', now() + interval '1 day');
  select * into r from public.box_models where serial = s;
  perform pg_temp.ok(r.stock_total = 99 and r.stock_reserved = 5, 'D3 despacho baixa 1 do total e da reserva');
  -- cancelar depois de despachado não pode devolver estoque
  begin perform public.cancel_order(o); perform pg_temp.ok(false, 'D4 cancelar em transporte');
  exception when others then perform pg_temp.ok(true, 'D4 cancelar em transporte recusado'); end;
  -- descontinuar com reserva é bloqueado; sem reserva não
  begin perform public.update_box_model(s, 'Sec Máquina', 'v1', 10, false); perform pg_temp.ok(false, 'D5 descontinuar com reserva');
  exception when others then perform pg_temp.ok(true, 'D5 descontinuar com reserva recusado'); end;
  -- consistência global: soma das reservas == soma dos itens de pedidos abertos (enviado/recebido/em_separacao)
  perform pg_temp.ok(
    (select coalesce(sum(stock_reserved), 0) from public.box_models) =
    (select coalesce(sum(i.quantity), 0) from public.order_items i join public.orders od on od.id = i.order_id
      where od.status in ('enviado', 'recebido', 'em_separacao')),
    'D6 soma das reservas bate com itens de pedidos abertos (banco inteiro)');
  perform pg_temp.ok(not exists (select 1 from public.box_models where stock_reserved > stock_total or stock_reserved < 0 or stock_total < 0),
    'D7 nenhuma caixa com estoque inconsistente (banco inteiro)');
  perform pg_temp.ok(not exists (select 1 from public.orders od where not exists (select 1 from public.order_items where order_id = od.id)),
    'D8 nenhum pedido sem itens (banco inteiro)');
  perform pg_temp.ok(not exists (select 1 from public.orders od where not exists (select 1 from public.order_events where order_id = od.id and from_status is null)),
    'D9 todo pedido tem evento de criação (banco inteiro)');

  select string_agg(line, E'\n' order by seq), count(*) filter (where line like 'FALHOU%') into msg, n from test_results;
  raise exception E'\n=== RELATÓRIO (rollback proposital) ===\n%\n=== % falhas ===', msg, n;
end $t$;
