// Toda escrita passa pelas funções SQL (supabase/migrations/). O banco valida, lê o
// perfil de quem está logado (auth.uid()) e devolve mensagens em PT-BR prontas para a tela.

import { supabase } from "./supabase";
import type { Actor, OrderStatus, Result } from "./types";

// Mensagem que require_role() devolve sem sessão; cleanMessage também a usa para token
// expirado. O AuthProvider compara com ela (igualdade exata) para mandar para /login.
// Se mudar o texto no banco, mude aqui também.
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
  if (error) return { ok: false, error: cleanMessage(error) };
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
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: data as OrderStatus };
}

export async function cancelOrder(orderId: number): Promise<Result<null>> {
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: null };
}

// "Excluir" da Lenovo: só oculta da lista dela (entregue/cancelado); a DHL continua vendo.
export async function hideOrder(orderId: number): Promise<Result<null>> {
  const { error } = await supabase.rpc("hide_order", { p_order_id: orderId });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: null };
}

export async function restock(serial: string, quantity: number): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("restock", {
    p_serial: serial,
    p_quantity: quantity,
  });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: data as number };
}

// Lado e nome vêm do perfil logado.
export async function addComment(orderId: number, body: string): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("add_comment", {
    p_order_id: orderId,
    p_body: body,
  });
  if (error) return { ok: false, error: cleanMessage(error) };
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
  if (error) return { ok: false, error: cleanMessage(error) };
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
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: null };
}

// Cushion nasce já com as máquinas em que serve (seriais das caixas delas).
export async function createCushion(input: {
  serial: string;
  name: string;
  model: string;
  stockTotal: number;
  minStock: number;
  machines: string[];
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("create_cushion", {
    p_serial: input.serial,
    p_name: input.name,
    p_model: input.model,
    p_stock_total: input.stockTotal,
    p_min_stock: input.minStock,
    p_box_serials: input.machines,
  });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: data as string };
}

// Troca a lista inteira de máquinas do cushion.
export async function setCushionFits(serial: string, machines: string[]): Promise<Result<number>> {
  const { data, error } = await supabase.rpc("set_cushion_fits", { p_serial: serial, p_box_serials: machines });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: data as number };
}

// Só mostra na tela as mensagens que as funções levantam de propósito (RAISE EXCEPTION =
// SQLSTATE P0001). Qualquer outro erro do banco fica no console, não na tela.
function cleanMessage(error: { code?: string; message: string }): string {
  if (error.code === "PGRST301" || error.code === "PGRST303") return LOGIN_REQUIRED;
  if (error.code === "P0001") return error.message.replace(/^(P0001|ERROR):?\s*/i, "").trim();
  console.error("Erro inesperado do banco:", error);
  if (/fetch|network/i.test(error.message)) return "Sem conexão. Tente de novo.";
  return "Não foi possível concluir a ação. Tente de novo ou fale com o administrador.";
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
  if (error) return { ok: false, error: cleanMessage(error) };
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
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: data as string };
}

export async function adminUpdateUser(userId: string, role: Actor, displayName: string): Promise<Result<null>> {
  const { error } = await supabase.rpc("admin_update_user", { p_user_id: userId, p_role: role, p_display_name: displayName });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: null };
}

export async function adminSetPassword(userId: string, password: string): Promise<Result<null>> {
  const { error } = await supabase.rpc("admin_set_password", { p_user_id: userId, p_password: password });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: null };
}

export async function adminDeleteUser(userId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc("admin_delete_user", { p_user_id: userId });
  if (error) return { ok: false, error: cleanMessage(error) };
  return { ok: true, data: null };
}
