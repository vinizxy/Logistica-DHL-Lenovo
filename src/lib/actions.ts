// Toda escrita passa pelas funções SQL (supabase/migrations/0002_functions.sql).
// O banco valida e devolve mensagens em PT-BR prontas para a tela.

import { supabase } from "./supabase";
import type { Actor, OrderStatus, Result } from "./types";

export interface CartItem {
  serial: string;
  quantity: number;
}

export async function createOrder(
  requestedBy: string,
  notes: string,
  items: CartItem[],
): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("create_order", {
    p_requested_by: requestedBy,
    p_notes: notes,
    p_items: items,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as number };
}

export async function advanceOrder(
  orderId: number,
  actor: Actor,
): Promise<Result<OrderStatus>> {
  const { data, error } = await supabase.rpc("advance_order", {
    p_order_id: orderId,
    p_actor: actor,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as OrderStatus };
}

export async function cancelOrder(orderId: number): Promise<Result<null>> {
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: null };
}

export async function restock(serial: string, quantity: number): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("restock", {
    p_serial: serial,
    p_quantity: quantity,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as number };
}

// PostgREST às vezes prefixa com o código; a mensagem em si já vem legível do banco.
function cleanMessage(msg: string): string {
  return msg.replace(/^(P0001|ERROR):?\s*/i, "").trim();
}
