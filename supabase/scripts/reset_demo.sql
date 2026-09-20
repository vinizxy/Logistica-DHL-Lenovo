-- Limpa todos os pedidos e devolve o estoque aos valores iniciais do catálogo.
-- Uso: colar no SQL Editor do Supabase antes de uma apresentação.
-- Não mexe no catálogo de caixas (seriais, nomes, mínimos).

begin;

delete from public.order_comments;
delete from public.order_events;
delete from public.order_items;
delete from public.orders;

alter table public.orders alter column id restart with 1;
alter table public.order_events alter column id restart with 1;
alter table public.order_comments alter column id restart with 1;

update public.box_models b
   set stock_total = v.total,
       stock_reserved = 0
  from (values
    ('JAUQ2UKFBL', 150), ('K8YBSJ8KNH', 210), ('BV6XSTB7PL', 180), ('KEE348YPXK',  95),
    ('HMYBZNWA8L',  18), ('P3R6WQFE6W',  72), ('E6RDA2ZBGP',  64), ('KAY5H6G35B',  40),
    ('E5A8N99V99', 120), ('TR6X37MJJB',  12), ('PQHRRMJDN3',  88), ('QFPKNP4ZM5',  55),
    ('P8YEY9T4NE',  30)
  ) as v(serial, total)
 where b.serial = v.serial;

commit;
