// Espelho dos tipos do banco (supabase/migrations/0001_schema.sql).

export type OrderStatus =
  | "enviado"
  | "recebido"
  | "em_separacao"
  | "em_transporte"
  | "entregue"
  | "cancelado";

// Quem age: os dois lados e o admin (que controla tudo).
export type Actor = "lenovo" | "dhl" | "admin";
// Os dois lados do processo (a tela de login e os botões só falam deles).
export type Side = Exclude<Actor, "admin">;

// Item do catálogo: caixa ou cushion (acessório que protege a máquina dentro da caixa).
export type ItemKind = "caixa" | "cushion";

// Uma linha do catálogo. Para cushion, machine_name é o nome do cushion e
// machine_model o modelo dele; as máquinas em que serve ficam em CushionFit.
export interface BoxModel {
  serial: string;
  kind: ItemKind;
  machine_name: string;
  machine_model: string;
  stock_total: number;
  stock_reserved: number;
  stock_available: number;
  min_stock: number;
  active: boolean;
  updated_at: string;
}

// Cushion ↔ máquina (representada pela caixa dela no catálogo).
export interface CushionFit {
  cushion_serial: string;
  box_serial: string;
}

export interface OrderItem {
  order_id: number;
  serial: string;
  quantity: number;
  box_models: Pick<BoxModel, "machine_name" | "machine_model" | "kind"> | null;
}

export interface Order {
  id: number;
  status: OrderStatus;
  requested_by: string;
  notes: string | null;
  urgent: boolean;
  eta: string | null; // previsão de entrega informada pela DHL ao despachar
  hidden_by_lenovo: boolean; // "excluído" pela Lenovo; a DHL continua vendo
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
