import { supabase } from "./supabase";
import type { BoxModel, Order, OrderComment, OrderEvent } from "./types";

const ORDER_SELECT =
  "id, status, requested_by, notes, urgent, eta, created_at, updated_at, order_items(order_id, serial, quantity, box_models(machine_name, machine_model)), order_comments(count)";

export async function fetchBoxes(): Promise<BoxModel[]> {
  const { data, error } = await supabase
    .from("box_models")
    .select("*")
    .order("machine_name")
    .order("machine_model");
  if (error) throw new Error(error.message);
  return data as BoxModel[];
}

export async function fetchOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return sortItems(data as unknown as Order[]);
}

export async function fetchOrder(id: number): Promise<Order | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? sortItems([data as unknown as Order])[0] : null;
}

export async function fetchOrderComments(orderId: number): Promise<OrderComment[]> {
  const { data, error } = await supabase
    .from("order_comments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at")
    .order("id");
  if (error) throw new Error(error.message);
  return data as OrderComment[];
}

export async function fetchOrderEvents(orderId: number): Promise<OrderEvent[]> {
  const { data, error } = await supabase
    .from("order_events")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at")
    .order("id");
  if (error) throw new Error(error.message);
  return data as OrderEvent[];
}

// Fetchers compostos por página. Definidos no módulo para terem identidade estável
// (o hook useLiveData depende disso para não reassinar o canal a cada render).
export async function fetchLenovoData() {
  const [boxes, orders] = await Promise.all([fetchBoxes(), fetchOrders()]);
  return { boxes, orders };
}

export const fetchDhlData = fetchLenovoData;

export function commentCount(o: Order): number {
  return o.order_comments?.[0]?.count ?? 0;
}

function sortItems(orders: Order[]): Order[] {
  for (const o of orders) {
    o.order_items.sort((a, b) =>
      (a.box_models?.machine_name ?? a.serial).localeCompare(
        b.box_models?.machine_name ?? b.serial,
      ),
    );
  }
  return orders;
}
