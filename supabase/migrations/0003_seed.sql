-- Dados de exemplo para a demonstração.
-- Caixas: insert direto (catálogo). Pedidos: SEMPRE via funções, para reservas,
-- baixas e histórico ficarem coerentes com as regras reais.
-- Seriais: 10 caracteres alfanuméricos gerados aleatoriamente e fixados aqui.

-- Os testes consomem números da sequência; reinicia para a demo começar em #1.
alter table public.orders alter column id restart with 1;
alter table public.order_events alter column id restart with 1;

insert into public.box_models (serial, machine_name, machine_model, stock_total, min_stock) values
  ('JAUQ2UKFBL', 'ThinkPad X1 Carbon', 'Gen 12',        150, 50),
  ('K8YBSJ8KNH', 'ThinkPad T14',       'Gen 5',         210, 60),
  ('BV6XSTB7PL', 'ThinkPad L14',       'Gen 5',         180, 60),
  ('KEE348YPXK', 'ThinkBook 14',       'G6 IRL',         95, 40),
  ('HMYBZNWA8L', 'IdeaPad Slim 5',     '14IMH9',         18, 40),   -- abaixo do mínimo
  ('P3R6WQFE6W', 'IdeaPad Flex 5',     '14IRU8',         72, 30),
  ('E6RDA2ZBGP', 'Yoga 7i 2-in-1',     '14IML9',         64, 30),
  ('KAY5H6G35B', 'Yoga Slim 7',        '14IMH9',         40, 30),
  ('E5A8N99V99', 'Legion 5',           '15IAH7',        120, 40),
  ('TR6X37MJJB', 'Legion Pro 7i',      '16IRX9',         12, 25),   -- abaixo do mínimo
  ('PQHRRMJDN3', 'LOQ 15',             '15IRX9',         88, 30),
  ('QFPKNP4ZM5', 'ThinkCentre M70q',   'Gen 5',          55, 20),
  ('P8YEY9T4NE', 'Tab P12',            'TB370FU',        30, 15);

do $seed$
declare
  o bigint;
begin
  -- #1 entregue (ciclo completo) — 4 dias atrás
  o := public.create_order('Vinicius Alencar', 'Lote refurbish semana 37',
        '[{"serial":"JAUQ2UKFBL","quantity":40},{"serial":"K8YBSJ8KNH","quantity":25}]');
  perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'dhl');
  perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'lenovo');
  update public.orders set created_at = now() - interval '4 days 3 hours' where id = o;
  update public.order_events e set created_at = now() - interval '4 days 3 hours' + (x.rn - 1) * interval '5 hours'
    from (select id, row_number() over (order by id) rn from public.order_events where order_id = o) x where e.id = x.id;

  -- #2 cancelado — 3 dias atrás
  o := public.create_order('Ana Souza', 'Pedido duplicado, cancelar',
        '[{"serial":"E5A8N99V99","quantity":20}]');
  perform public.cancel_order(o);
  update public.orders set created_at = now() - interval '3 days 2 hours' where id = o;
  update public.order_events set created_at = now() - interval '3 days 2 hours' where order_id = o and from_status is null;
  update public.order_events set created_at = now() - interval '3 days 1 hour'  where order_id = o and to_status = 'cancelado';

  -- #3 em transporte — Lenovo precisa confirmar entrega
  o := public.create_order('Vinicius Alencar', null,
        '[{"serial":"BV6XSTB7PL","quantity":30},{"serial":"KEE348YPXK","quantity":15},{"serial":"QFPKNP4ZM5","quantity":10}]');
  perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'dhl');
  update public.orders set created_at = now() - interval '1 day 6 hours' where id = o;
  update public.order_events e set created_at = now() - interval '1 day 6 hours' + (x.rn - 1) * interval '4 hours'
    from (select id, row_number() over (order by id) rn from public.order_events where order_id = o) x where e.id = x.id;

  -- #4 em separação
  o := public.create_order('Carlos Lima', 'Urgente: linha parada aguardando caixas',
        '[{"serial":"E6RDA2ZBGP","quantity":12},{"serial":"KAY5H6G35B","quantity":8}]');
  perform public.advance_order(o, 'dhl'); perform public.advance_order(o, 'dhl');
  update public.orders set created_at = now() - interval '5 hours' where id = o;
  update public.order_events e set created_at = now() - interval '5 hours' + (x.rn - 1) * interval '90 minutes'
    from (select id, row_number() over (order by id) rn from public.order_events where order_id = o) x where e.id = x.id;

  -- #5 enviado — recém-chegado, aparece em "Novos" na DHL
  o := public.create_order('Vinicius Alencar', null,
        '[{"serial":"JAUQ2UKFBL","quantity":25},{"serial":"E5A8N99V99","quantity":15},{"serial":"P8YEY9T4NE","quantity":6}]');
  update public.orders set created_at = now() - interval '12 minutes' where id = o;
  update public.order_events set created_at = now() - interval '12 minutes' where order_id = o;
end
$seed$;
