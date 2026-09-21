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
  urgent = false,
): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("create_order", {
    p_requested_by: requestedBy,
    p_notes: notes,
    p_items: items,
    p_urgent: urgent,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as number };
}

export async function advanceOrder(
  orderId: number,
  actor: Actor,
  eta?: string | null, // ISO; só faz sentido ao despachar (em_separacao → em_transporte)
): Promise<Result<OrderStatus>> {
  const { data, error } = await supabase.rpc("advance_order", {
    p_order_id: orderId,
    p_actor: actor,
    p_eta: eta ?? null,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as OrderStatus };
}

export async function cancelOrder(orderId: number): Promise<Result<null>> {
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: null };
}

// Só pedidos encerrados (entregue/cancelado); o banco recusa os demais.
export async function deleteOrder(orderId: number): Promise<Result<null>> {
  const { error } = await supabase.rpc("delete_order", { p_order_id: orderId });
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

export async function addComment(
  orderId: number,
  actor: Actor,
  author: string,
  body: string,
): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("add_comment", {
    p_order_id: orderId,
    p_actor: actor,
    p_author: author,
    p_body: body,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as number };
}

export async function createBoxModel(input: {
  serial: string;
  machineName: string;
  machineModel: string;
  stockTotal: number;
  minStock: number;
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("create_box_model", {
    p_serial: input.serial,
    p_machine_name: input.machineName,
    p_machine_model: input.machineModel,
    p_stock_total: input.stockTotal,
    p_min_stock: input.minStock,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as string };
}

export async function updateBoxModel(input: {
  serial: string;
  machineName: string;
  machineModel: string;
  minStock: number;
  active: boolean;
}): Promise<Result<null>> {
  const { error } = await supabase.rpc("update_box_model", {
    p_serial: input.serial,
    p_machine_name: input.machineName,
    p_machine_model: input.machineModel,
    p_min_stock: input.minStock,
    p_active: input.active,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: null };
}

// PostgREST às vezes prefixa com o código; a mensagem em si já vem legível do banco.
function cleanMessage(msg: string): string {
  return msg.replace(/^(P0001|ERROR):?\s*/i, "").trim();
}
