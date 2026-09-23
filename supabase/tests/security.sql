-- Testes de segurança e estabilidade. Mesmo esquema dos outros: tudo numa transação,
-- rollback proposital no fim, relatório na mensagem de erro; sucesso = 0 falhas.
--
-- Cobre: (A) papel anon (sem login) não lê nem escreve; logado não escreve direto em tabela;
--        (P) cada perfil só executa o que é dele; sem sessão nada roda;
--        (B) toda função exposta é security definer com search_path vazio e só as
--            funções públicas têm EXECUTE para anon;
--        (C) entradas hostis/absurdas são recusadas com mensagem legível (nunca
--            erro interno do Postgres);
--        (D) invariantes de estoque nunca quebram, mesmo por caminhos tortos.
create temp table test_results (seq serial, line text) on commit drop;
-- a seção A roda como anon; ele precisa gravar no relatório
grant insert on test_results to anon, authenticated;
grant usage on sequence test_results_seq_seq to anon, authenticated;
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
create function pg_temp.as_nobody() returns void language sql as $$ select set_config('request.jwt.claim.sub', '', true) $$;
do $t$
declare s text; o bigint; c bigint; n integer; msg text; big text; r record;
begin
  perform pg_temp.as_dhl();
  s := public.create_box_model(null, 'Sec Máquina', 'v1', 100, 10);

  -- A. sem login (anon): nada. Logado (authenticated): lê, mas não escreve direto ----------
  set local role anon;
  begin perform count(*) from public.box_models; perform pg_temp.ok(false, 'A1 anon lê box_models');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A1 anon não lê box_models');
           when others then perform pg_temp.ok(false, 'A1 erro inesperado: ' || sqlerrm); end;
  begin perform count(*) from public.orders; perform pg_temp.ok(false, 'A2 anon lê orders');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A2 anon não lê orders');
           when others then perform pg_temp.ok(false, 'A2 erro inesperado: ' || sqlerrm); end;
  begin perform public.restock(s, 1); perform pg_temp.ok(false, 'A3 anon executa restock');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A3 anon não executa restock');
           when others then perform pg_temp.ok(false, 'A3 erro inesperado: ' || sqlerrm); end;
  reset role;
  set local role authenticated;
  perform pg_temp.ok((select count(*) >= 1 from public.box_models), 'A4 logado lê box_models');
  perform pg_temp.ok((select count(*) >= 2 from public.profiles), 'A5 logado lê perfis');
  begin insert into public.orders (requested_by) values ('hacker'); perform pg_temp.ok(false, 'A6 logado insert orders');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A6 logado não insere em orders direto');
           when others then perform pg_temp.ok(false, 'A6 erro inesperado: ' || sqlerrm); end;
  begin update public.box_models set stock_total = 999999 where serial = s; perform pg_temp.ok(false, 'A7 logado update estoque');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A7 logado não altera estoque direto');
           when others then perform pg_temp.ok(false, 'A7 erro inesperado: ' || sqlerrm); end;
  begin delete from public.orders; perform pg_temp.ok(false, 'A8 logado delete orders');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A8 logado não apaga orders direto');
           when others then perform pg_temp.ok(false, 'A8 erro inesperado: ' || sqlerrm); end;
  begin update public.profiles set role = 'dhl'; perform pg_temp.ok(false, 'A9 logado muda o próprio perfil');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A9 logado não muda perfil direto');
           when others then perform pg_temp.ok(false, 'A9 erro inesperado: ' || sqlerrm); end;
  begin perform public.require_role(); perform pg_temp.ok(false, 'A10 logado chama require_role');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'A10 require_role é interna');
           when others then perform pg_temp.ok(false, 'A10 erro inesperado: ' || sqlerrm); end;
  perform pg_temp.as_lenovo();
  o := public.create_order('Anon Tester', null, json_build_array(json_build_object('serial', s, 'quantity', 5))::jsonb);
  perform pg_temp.ok(o > 0, 'A11 Lenovo logada cria pedido via função (como authenticated)');
  perform pg_temp.ok((select b.stock_reserved = 5 and od.created_by = auth.uid() from public.box_models b, public.orders od where b.serial = s and od.id = o), 'A12 reserva feita e created_by gravado');
  reset role;

  -- P. perfis ----------------------------------------------------------------------
  perform pg_temp.as_nobody();
  begin perform public.create_order('x', null, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb); perform pg_temp.ok(false, 'P1 sem sessão cria pedido');
  exception when others then perform pg_temp.ok(sqlerrm like 'Faça login%', 'P1 sem sessão: ' || sqlerrm); end;
  begin perform public.restock(s, 1); perform pg_temp.ok(false, 'P2 sem sessão repõe');
  exception when others then perform pg_temp.ok(sqlerrm like 'Faça login%', 'P2 sem sessão: ' || sqlerrm); end;
  begin perform public.add_comment(o, 'oi'); perform pg_temp.ok(false, 'P3 sem sessão comenta');
  exception when others then perform pg_temp.ok(sqlerrm like 'Faça login%', 'P3 sem sessão: ' || sqlerrm); end;
  perform pg_temp.as_lenovo();
  begin perform public.restock(s, 1); perform pg_temp.ok(false, 'P4 Lenovo repõe');
  exception when others then perform pg_temp.ok(sqlerrm like '%DHL%', 'P4 Lenovo não repõe: ' || sqlerrm); end;
  begin perform public.create_box_model(null, 'x', 'y', 1, 1); perform pg_temp.ok(false, 'P5 Lenovo cadastra');
  exception when others then perform pg_temp.ok(sqlerrm like '%DHL%', 'P5 Lenovo não cadastra caixa'); end;
  begin perform public.update_box_model(s, 'x', 'y', 1, true); perform pg_temp.ok(false, 'P6 Lenovo edita catálogo');
  exception when others then perform pg_temp.ok(sqlerrm like '%DHL%', 'P6 Lenovo não edita catálogo'); end;
  begin perform public.advance_order(o); perform pg_temp.ok(false, 'P7 Lenovo recebe pedido');
  exception when others then perform pg_temp.ok(sqlerrm like '%DHL%', 'P7 Lenovo não recebe pedido: ' || sqlerrm); end;
  perform pg_temp.as_dhl();
  begin perform public.create_order('x', null, json_build_array(json_build_object('serial', s, 'quantity', 1))::jsonb); perform pg_temp.ok(false, 'P8 DHL pede');
  exception when others then perform pg_temp.ok(sqlerrm like '%LENOVO%', 'P8 DHL não pede: ' || sqlerrm); end;
  begin perform public.cancel_order(o); perform pg_temp.ok(false, 'P9 DHL cancela');
  exception when others then perform pg_temp.ok(sqlerrm like '%LENOVO%', 'P9 DHL não cancela'); end;
  begin perform public.hide_order(o); perform pg_temp.ok(false, 'P10 DHL oculta');
  exception when others then perform pg_temp.ok(sqlerrm like '%LENOVO%', 'P10 DHL não oculta'); end;
  perform public.advance_order(o); perform public.advance_order(o); perform public.advance_order(o);
  begin perform public.advance_order(o); perform pg_temp.ok(false, 'P11 DHL confirma entrega');
  exception when others then perform pg_temp.ok(sqlerrm like '%LENOVO%', 'P11 DHL não confirma entrega: ' || sqlerrm); end;
  c := public.add_comment(o, 'da DHL');
  perform pg_temp.ok((select actor = 'dhl' and author = 'DHL Teste' from public.order_comments where id = c), 'P12 comentário assinado pelo perfil DHL');
  perform pg_temp.as_lenovo();
  c := public.add_comment(o, 'da Lenovo');
  perform pg_temp.ok((select actor = 'lenovo' and author = 'Lenovo Teste' from public.order_comments where id = c), 'P13 comentário assinado pelo perfil Lenovo');
  perform public.advance_order(o);
  perform pg_temp.ok((select status = 'entregue' from public.orders where id = o), 'P14 Lenovo confirma entrega');
  perform pg_temp.ok((select count(*) = 5 and count(*) filter (where user_id is not null) = 5 from public.order_events where order_id = o), 'P15 5 eventos, todos com user_id');
  -- trigger de perfil: e-mail de outro domínio sem role → conta recusada
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@gmail.com', 'x', now(), '{}', '{}', now(), now());
    perform pg_temp.ok(false, 'P16 conta @gmail sem role criada');
  exception when others then perform pg_temp.ok(sqlerrm like '%sem perfil%', 'P16 conta de outro domínio sem role recusada: ' || left(sqlerrm, 60)); end;
  -- cadastro público pedindo admin no user metadata (campo que o cliente controla)
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'intruso@gmail.com', 'x', now(), '{"provider":"email"}', '{"role":"admin"}', now(), now());
    perform pg_temp.ok(false, 'P17 cadastro @gmail com role=admin no user metadata criado');
  exception when others then perform pg_temp.ok(sqlerrm like '%sem perfil%', 'P17 cadastro @gmail pedindo admin recusado'); end;
  -- autocadastro fechado: nem o domínio da empresa dá perfil; só conta criada pelo servidor
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'intruso@dhl.com', 'x', now(), '{"provider":"email"}', '{"role":"admin"}', now(), now());
    perform pg_temp.ok(false, 'P18 autocadastro @dhl pedindo admin criado');
  exception when others then perform pg_temp.ok(sqlerrm like '%sem perfil%', 'P18 autocadastro @dhl pedindo admin recusado'); end;
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qualquer@lenovo.com', 'x', now(), '{"provider":"email"}', '{}', now(), now());
    perform pg_temp.ok(false, 'P18b autocadastro @lenovo.com criado');
  exception when others then perform pg_temp.ok(sqlerrm like '%sem perfil%', 'P18b autocadastro @lenovo.com recusado'); end;
  declare v_u uuid := gen_random_uuid();
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'servidor@exemplo.com', 'x', now(), '{"provider":"email","role":"admin"}', '{}', now(), now());
    perform pg_temp.ok((select role = 'admin' from public.profiles where user_id = v_u), 'P19 role no app metadata (servidor) é respeitado');
  end;

  -- B. configuração das funções -------------------------------------------------
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and not (coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%');
  perform pg_temp.ok(n = 0, 'B1 toda função security definer tem search_path fixo (faltando: ' || n || ')');
  select string_agg(p.proname, ', ') into msg from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok(msg is null, 'B2 anon não executa função nenhuma' || coalesce(' (extras: ' || msg || ')', ''));
  select string_agg(p.proname, ', ') into msg from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('create_order','advance_order','cancel_order','hide_order','restock',
                           'add_comment','create_box_model','update_box_model','status_label',
                           'create_cushion','set_cushion_fits',
                           'admin_list_users','admin_create_user','admin_update_user',
                           'admin_set_password','admin_delete_user');
  perform pg_temp.ok(msg is null, 'B2b logado só executa as funções públicas' || coalesce(' (extras: ' || msg || ')', ''));
  select count(*) into n from pg_tables where schemaname = 'public' and not rowsecurity;
  perform pg_temp.ok(n = 0, 'B3 RLS ligado em todas as tabelas (sem: ' || n || ')');
  select count(*) into n from pg_policies where schemaname = 'public' and cmd <> 'SELECT';
  perform pg_temp.ok(n = 0, 'B4 nenhuma policy de escrita (' || n || ')');
  select count(*) into n from pg_policies where schemaname = 'public' and 'anon' = any(roles);
  perform pg_temp.ok(n = 0, 'B5 nenhuma policy para anon (' || n || ')');

  -- C. entradas hostis (Lenovo para pedidos, DHL para estoque/catálogo) ----------------
  perform pg_temp.as_lenovo();
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
  perform pg_temp.as_dhl();
  begin perform public.restock(s, 2147483647); perform pg_temp.ok(false, 'C11 restock 2^31 aceito');
  exception when others then perform pg_temp.ok(sqlerrm not like '%out of range%', 'C11 restock absurdo recusado com msg legível: ' || left(sqlerrm, 80)); end;
  begin perform public.restock(s, -10); perform pg_temp.ok(false, 'C12 restock negativo aceito');
  exception when others then perform pg_temp.ok(sqlerrm not like '%violates%', 'C12 restock negativo recusado com msg legível: ' || left(sqlerrm, 80)); end;
  begin perform public.add_comment(o, big || big); perform pg_temp.ok(false, 'C14 comentário de 40k chars aceito');
  exception when others then perform pg_temp.ok(sqlerrm like '%longo%' or sqlerrm like '%caracteres%', 'C14 comentário gigante recusado: ' || left(sqlerrm, 80)); end;
  begin perform public.create_box_model(null, big, 'v', 1, 1); perform pg_temp.ok(false, 'C15 nome de máquina gigante aceito');
  exception when others then perform pg_temp.ok(sqlerrm like '%longo%' or sqlerrm like '%caracteres%', 'C15 nome de máquina gigante recusado: ' || left(sqlerrm, 80)); end;
  begin perform public.create_box_model(null, 'M', 'v', 2147483647, 1); perform public.restock((select serial from public.box_models where machine_name = 'M' limit 1), 10); perform pg_temp.ok(false, 'C16 estoque estoura integer');
  exception when others then perform pg_temp.ok(sqlerrm not like '%out of range%', 'C16 estoque absurdo recusado com msg legível: ' || left(sqlerrm, 80)); end;
  begin perform public.advance_order(null); perform pg_temp.ok(false, 'C17 id nulo');
  exception when others then perform pg_temp.ok(true, 'C17 id nulo recusado: ' || left(sqlerrm, 60)); end;
  perform pg_temp.as_lenovo();
  begin perform public.hide_order(-1); perform pg_temp.ok(false, 'C18 id negativo');
  exception when others then perform pg_temp.ok(sqlerrm like '%não encontrado%', 'C18 id negativo: não encontrado'); end;

  -- D. invariantes de estoque ------------------------------------------------------
  -- reserva nunca passa do total, mesmo tentando pelo caminho da função
  begin perform public.create_order('T', null, json_build_array(json_build_object('serial', s, 'quantity', 95))::jsonb); perform pg_temp.ok(false, 'D1 reserva acima do disponível');
  exception when others then perform pg_temp.ok(true, 'D1 reserva acima do disponível recusada'); end;
  select * into r from public.box_models where serial = s;
  perform pg_temp.ok(r.stock_reserved = 1 and r.stock_available = 94, 'D2 reserva = 1, disponível 94 (total 95 após a entrega da seção P)');
  -- ciclo completo devolve consistência: total cai, reserva zera
  perform pg_temp.as_dhl();
  perform public.advance_order(o); perform public.advance_order(o); perform public.advance_order(o, now() + interval '1 day');
  select * into r from public.box_models where serial = s;
  perform pg_temp.ok(r.stock_total = 94 and r.stock_reserved = 0, 'D3 despacho baixa 1 do total e da reserva');
  perform pg_temp.as_lenovo();
  -- cancelar depois de despachado não pode devolver estoque
  begin perform public.cancel_order(o); perform pg_temp.ok(false, 'D4 cancelar em transporte');
  exception when others then perform pg_temp.ok(true, 'D4 cancelar em transporte recusado'); end;
  -- descontinuar com reserva é bloqueado; sem reserva não
  perform public.create_order('T', null, json_build_array(json_build_object('serial', s, 'quantity', 2))::jsonb);
  perform pg_temp.as_dhl();
  begin perform public.update_box_model(s, 'Sec Máquina', 'v1', 10, false); perform pg_temp.ok(false, 'D5 descontinuar com reserva');
  exception when others then perform pg_temp.ok(sqlerrm like '%reservadas%', 'D5 descontinuar com reserva recusado'); end;
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
