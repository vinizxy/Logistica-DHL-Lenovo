-- Testes do perfil admin e da gestão de contas (migração 0008). Mesmo esquema dos outros:
-- rollback proposital no fim, relatório na mensagem de erro; sucesso = 0 falhas.
-- Precisa das contas de teste e de uma conta admin (admin@lenovo.com).
create temp table test_results (seq serial, line text) on commit drop;
create function pg_temp.ok(cond boolean, label text) returns void language sql as $$
  insert into test_results (line) values ((case when cond then 'ok     ' else 'FALHOU ' end) || label);
$$;
create function pg_temp.as_user(p_email text) returns void language plpgsql security definer as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'conta de teste % não existe', p_email; end if;
  perform set_config('request.jwt.claim.sub', v::text, true);
end $$;
create function pg_temp.as_lenovo() returns void language sql as $$ select pg_temp.as_user('teste123@lenovo.com') $$;
create function pg_temp.as_dhl()    returns void language sql as $$ select pg_temp.as_user('teste123@dhl.com') $$;
create function pg_temp.as_admin()  returns void language sql as $$ select pg_temp.as_user('admin@lenovo.com') $$;
do $t$
declare u uuid; n integer; msg text; o bigint; s text; me uuid;
begin
  -- A. só admin gerencia contas
  perform pg_temp.as_lenovo();
  begin perform public.admin_list_users(); perform pg_temp.ok(false, 'A1 lenovo lista contas');
  exception when others then perform pg_temp.ok(sqlerrm like '%ADMIN%', 'A1 lenovo não lista contas: ' || sqlerrm); end;
  begin perform public.admin_create_user('x@lenovo.com', 'senha12345', 'lenovo', 'X'); perform pg_temp.ok(false, 'A2 lenovo cria conta');
  exception when others then perform pg_temp.ok(sqlerrm like '%ADMIN%', 'A2 lenovo não cria conta'); end;
  perform pg_temp.as_dhl();
  begin perform public.admin_delete_user(gen_random_uuid()); perform pg_temp.ok(false, 'A3 dhl exclui conta');
  exception when others then perform pg_temp.ok(sqlerrm like '%ADMIN%', 'A3 dhl não exclui conta'); end;

  -- B. ciclo de vida de uma conta
  perform pg_temp.as_admin();
  select count(*) into n from public.admin_list_users();
  perform pg_temp.ok(n >= 3, 'B1 admin lista contas (' || n || ')');
  u := public.admin_create_user('  Nova@DHL.com ', 'senha12345', 'dhl', '  Nova Pessoa ');
  perform pg_temp.ok((select email = 'nova@dhl.com' and email_confirmed_at is not null from auth.users where id = u), 'B2 conta criada, e-mail normalizado e confirmado');
  perform pg_temp.ok((select role = 'dhl' and display_name = 'Nova Pessoa' from public.profiles where user_id = u), 'B3 perfil criado pelo trigger');
  perform pg_temp.ok((select count(*) = 1 from auth.identities where user_id = u and provider = 'email'), 'B4 identidade email criada');
  perform pg_temp.ok((select encrypted_password = extensions.crypt('senha12345', encrypted_password) from auth.users where id = u), 'B5 senha bate (bcrypt)');
  begin perform public.admin_create_user('nova@dhl.com', 'senha12345', 'dhl', 'Dup'); perform pg_temp.ok(false, 'B6 e-mail duplicado');
  exception when others then perform pg_temp.ok(sqlerrm like '%Já existe%', 'B6 e-mail duplicado recusado'); end;
  begin perform public.admin_create_user('sem-arroba', 'senha12345', 'dhl', 'X'); perform pg_temp.ok(false, 'B7 e-mail inválido');
  exception when others then perform pg_temp.ok(sqlerrm like '%inválido%', 'B7 e-mail inválido recusado'); end;
  begin perform public.admin_create_user('curta@dhl.com', '1234567', 'dhl', 'X'); perform pg_temp.ok(false, 'B8 senha curta');
  exception when others then perform pg_temp.ok(sqlerrm like '%8 caracteres%', 'B8 senha curta recusada'); end;
  begin perform public.admin_create_user('semnome@dhl.com', 'senha12345', 'dhl', '  '); perform pg_temp.ok(false, 'B9 sem nome');
  exception when others then perform pg_temp.ok(sqlerrm like 'Informe%', 'B9 sem nome recusado'); end;

  perform public.admin_set_password(u, 'outra12345');
  perform pg_temp.ok((select encrypted_password = extensions.crypt('outra12345', encrypted_password) from auth.users where id = u), 'B10 senha trocada');
  perform public.admin_update_user(u, 'lenovo', 'Nova Lenovo');
  perform pg_temp.ok((select role = 'lenovo' and display_name = 'Nova Lenovo' from public.profiles where user_id = u)
                 and (select raw_user_meta_data->>'role' = 'lenovo' from auth.users where id = u), 'B11 perfil e metadata atualizados');

  -- a conta nova age conforme o perfil atual
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin perform public.restock('E5A8N99V99', 1); perform pg_temp.ok(false, 'B12 conta virou lenovo mas repôs');
  exception when others then perform pg_temp.ok(sqlerrm like '%DHL%', 'B12 conta agora lenovo não repõe'); end;
  o := public.create_order('Nova', null, '[{"serial":"E5A8N99V99","quantity":1}]');
  perform pg_temp.ok((select created_by = u from public.orders where id = o), 'B13 conta nova cria pedido como lenovo');

  -- C. proteções do próprio admin
  perform pg_temp.as_admin();
  select user_id into me from public.profiles where role = 'admin' limit 1;
  begin perform public.admin_delete_user(me); perform pg_temp.ok(false, 'C1 admin apaga a si mesmo');
  exception when others then perform pg_temp.ok(sqlerrm like '%própria conta%', 'C1 admin não apaga a própria conta'); end;
  begin perform public.admin_update_user(me, 'dhl', 'Adm'); perform pg_temp.ok(false, 'C2 admin se rebaixa');
  exception when others then perform pg_temp.ok(sqlerrm like '%próprio perfil%', 'C2 admin não se rebaixa'); end;
  begin perform public.admin_delete_user(gen_random_uuid()); perform pg_temp.ok(false, 'C3 apagar inexistente');
  exception when others then perform pg_temp.ok(sqlerrm like '%não encontrada%', 'C3 apagar inexistente recusado'); end;

  -- D. admin controla tudo: age nos dois lados
  s := public.create_box_model(null, 'Admin Caixa', 'v1', 10, 0);
  perform pg_temp.ok(s ~ '^[A-Z0-9]{10}$', 'D1 admin cadastra caixa');
  perform public.advance_order(o); perform public.advance_order(o); perform public.advance_order(o); perform public.advance_order(o);
  perform pg_temp.ok((select status = 'entregue' from public.orders where id = o), 'D2 admin leva o pedido do início ao fim');
  perform pg_temp.ok((select count(*) filter (where actor = 'admin') = 4 and count(*) filter (where user_id = me) = 4 from public.order_events where order_id = o), 'D3 eventos do admin gravados como admin, com user_id');
  perform public.hide_order(o);
  perform pg_temp.ok((select hidden_by_lenovo from public.orders where id = o), 'D4 admin oculta pedido');
  n := public.restock(s, 5);
  perform pg_temp.ok(n = 15, 'D5 admin repõe estoque');

  -- E. exclusão: acesso some, pedidos ficam
  perform public.admin_delete_user(u);
  perform pg_temp.ok(not exists (select 1 from auth.users where id = u) and not exists (select 1 from public.profiles where user_id = u), 'E1 conta e perfil apagados');
  perform pg_temp.ok((select created_by is null from public.orders where id = o), 'E2 pedido continua, created_by nulo');
  perform pg_temp.ok((select count(*) = 5 from public.order_events where order_id = o), 'E3 histórico do pedido intacto');

  select string_agg(line, E'\n' order by seq), count(*) filter (where line like 'FALHOU%') into msg, n from test_results;
  raise exception E'\n=== RELATÓRIO (rollback proposital) ===\n%\n=== % falhas ===', msg, n;
end $t$;
