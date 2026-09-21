-- Exclusão de pedidos encerrados (entregue/cancelado) pelos painéis Lenovo e DHL.
-- Pedidos em andamento têm reserva de estoque: o caminho é cancelar (que libera a
-- reserva), nunca apagar. Itens, eventos e comentários caem em cascata (FKs on delete cascade).

create or replace function public.delete_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido #% não encontrado.', p_order_id;
  end if;

  if v_order.status not in ('entregue', 'cancelado') then
    raise exception 'Pedido #% está "%". Só pedidos entregues ou cancelados podem ser excluídos — cancele antes.',
      p_order_id, public.status_label(v_order.status);
  end if;

  delete from public.orders where id = p_order_id;
end;
$$;

revoke all on function public.delete_order(bigint) from public;
grant execute on function public.delete_order(bigint) to anon, authenticated;
