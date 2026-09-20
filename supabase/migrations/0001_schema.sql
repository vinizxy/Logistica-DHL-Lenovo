-- Schema: catálogo de caixas, pedidos, itens e histórico.
-- Regras de negócio ficam em 0002_functions.sql; aqui só estrutura, integridade e RLS.

create type public.order_status as enum (
  'enviado', 'recebido', 'em_separacao', 'em_transporte', 'entregue', 'cancelado'
);

create type public.actor_role as enum ('lenovo', 'dhl');

-- Atualiza updated_at em qualquer update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Catálogo: um registro por TIPO de caixa (não por unidade física).
create table public.box_models (
  serial          text primary key check (serial ~ '^[A-Z0-9]{10}$'),
  machine_name    text not null check (length(btrim(machine_name)) > 0),
  machine_model   text not null check (length(btrim(machine_model)) > 0),
  stock_total     integer not null default 0 check (stock_total >= 0),
  stock_reserved  integer not null default 0
                  check (stock_reserved >= 0 and stock_reserved <= stock_total),
  stock_available integer generated always as (stock_total - stock_reserved) stored,
  min_stock       integer not null default 0 check (min_stock >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger box_models_updated_at
  before update on public.box_models
  for each row execute function public.set_updated_at();

create table public.orders (
  id            bigint generated always as identity primary key,
  status        public.order_status not null default 'enviado',
  requested_by  text not null check (length(btrim(requested_by)) > 0),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index orders_status_created_idx on public.orders (status, created_at desc);

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  order_id  bigint not null references public.orders (id) on delete cascade,
  serial    text not null references public.box_models (serial),
  quantity  integer not null check (quantity > 0),
  primary key (order_id, serial)
);

create index order_items_serial_idx on public.order_items (serial);

create table public.order_events (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references public.orders (id) on delete cascade,
  from_status  public.order_status,          -- null no evento de criação
  to_status    public.order_status not null,
  actor        public.actor_role not null,
  created_at   timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

-- RLS: leitura pública; NENHUMA escrita direta. Toda escrita passa pelas funções
-- security definer de 0002_functions.sql.
alter table public.box_models   enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.order_events enable row level security;

create policy "leitura publica" on public.box_models   for select to anon, authenticated using (true);
create policy "leitura publica" on public.orders       for select to anon, authenticated using (true);
create policy "leitura publica" on public.order_items  for select to anon, authenticated using (true);
create policy "leitura publica" on public.order_events for select to anon, authenticated using (true);

-- Defesa em profundidade: além de não haver policy, remove o privilégio de escrita.
revoke insert, update, delete, truncate on public.box_models, public.orders,
  public.order_items, public.order_events from anon, authenticated;

-- Realtime: telas assinam mudanças nessas tabelas.
alter publication supabase_realtime add table
  public.box_models, public.orders, public.order_items, public.order_events;
