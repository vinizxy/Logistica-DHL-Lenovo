// Espelho dos tipos do banco (supabase/migrations/0001_schema.sql).

export type OrderStatus =
  | "enviado"
  | "recebido"
  | "em_separacao"
  | "em_transporte"
  | "entregue"
  | "cancelado";

export type Actor = "lenovo" | "dhl";

export interface BoxModel {
  serial: string;
  machine_name: string;
  machine_model: string;
  stock_total: number;
  stock_reserved: number;
  stock_available: number;
  min_stock: number;
  active: boolean;
  updated_at: string;
}

export interface OrderItem {
  order_id: number;
  serial: string;
  quantity: number;
  box_models: Pick<BoxModel, "machine_name" | "machine_model"> | null;
}

export interface Order {
  id: number;
  status: OrderStatus;
  requested_by: string;
  notes: string | null;
  urgent: boolean;
  eta: string | null; // previsão de entrega informada pela DHL ao despachar
  created_at: string;
  updated_at: string;
  order_items: OrderItem[];
  order_comments?: { count: number }[]; // só a contagem, nas listas
}

export interface OrderComment {
  id: number;
  order_id: number;
  actor: Actor;
  author: string;
  body: string;
  created_at: string;
}

export interface OrderEvent {
  id: number;
  order_id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor: Actor;
  created_at: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
