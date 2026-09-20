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
  created_at: string;
  updated_at: string;
  order_items: OrderItem[];
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
