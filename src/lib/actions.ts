// Toda escrita passa pelas funções SQL (supabase/migrations/). O banco valida, lê o
// perfil de quem está logado (auth.uid()) e devolve mensagens em PT-BR prontas para a tela.

import { supabase } from "./supabase";
import type { Actor, OrderStatus, Result } from "./types";

// Mensagem que o banco devolve quando a sessão não existe/expirou; o AuthProvider
// escuta isso para mandar para /login.
export const LOGIN_REQUIRED = "Faça login para continuar.";

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

// Quem avança é o perfil logado: DHL até "em transporte", Lenovo confirma a entrega.
export async function advanceOrder(
  orderId: number,
  eta?: string | null, // ISO; só faz sentido ao despachar (em_separacao → em_transporte)
): Promise<Result<OrderStatus>> {
  const { data, error } = await supabase.rpc("advance_order", {
    p_order_id: orderId,
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

// "Excluir" da Lenovo: só oculta da lista dela (entregue/cancelado); a DHL continua vendo.
export async function hideOrder(orderId: number): Promise<Result<null>> {
  const { error } = await supabase.rpc("hide_order", { p_order_id: orderId });
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

// Lado e nome vêm do perfil logado.
export async function addComment(orderId: number, body: string): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("add_comment", {
    p_order_id: orderId,
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

// ---- Admin: gestão de contas (funções admin_* exigem perfil admin) -------------------

export interface AdminUser {
  user_id: string;
  email: string;
  role: Actor;
  display_name: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function adminListUsers(): Promise<Result<AdminUser[]>> {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: (data ?? []) as AdminUser[] };
}

export async function adminCreateUser(input: {
  email: string;
  password: string;
  role: Actor;
  displayName: string;
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("admin_create_user", {
    p_email: input.email,
    p_password: input.password,
    p_role: input.role,
    p_display_name: input.displayName,
  });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: data as string };
}

export async function adminUpdateUser(userId: string, role: Actor, displayName: string): Promise<Result<null>> {
  const { error } = await supabase.rpc("admin_update_user", { p_user_id: userId, p_role: role, p_display_name: displayName });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: null };
}

export async function adminSetPassword(userId: string, password: string): Promise<Result<null>> {
  const { error } = await supabase.rpc("admin_set_password", { p_user_id: userId, p_password: password });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: null };
}

export async function adminDeleteUser(userId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc("admin_delete_user", { p_user_id: userId });
  if (error) return { ok: false, error: cleanMessage(error.message) };
  return { ok: true, data: null };
}
