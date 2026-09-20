import type { Actor, OrderStatus } from "./types";

// Fluxo principal, na ordem. "cancelado" fica fora porque é um desvio.
export const STATUS_FLOW: OrderStatus[] = [
  "enviado",
  "recebido",
  "em_separacao",
  "em_transporte",
  "entregue",
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  enviado: "Enviado",
  recebido: "Recebido",
  em_separacao: "Em separação",
  em_transporte: "Em transporte",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const STATUS_CLASS: Record<OrderStatus, string> = {
  enviado: "bg-blue-100 text-blue-800",
  recebido: "bg-sky-100 text-sky-800",
  em_separacao: "bg-amber-100 text-amber-800",
  em_transporte: "bg-violet-100 text-violet-800",
  entregue: "bg-green-100 text-green-800",
  cancelado: "bg-red-100 text-red-800",
};

export const ACTOR_LABEL: Record<Actor, string> = { lenovo: "Lenovo", dhl: "DHL" };

// Espelha a regra de advance_order no banco: qual é a única próxima ação e de quem é.
// O banco continua sendo a autoridade; isto só decide qual botão mostrar.
export function nextAction(
  status: OrderStatus,
): { actor: Actor; next: OrderStatus; label: string } | null {
  switch (status) {
    case "enviado":
      return { actor: "dhl", next: "recebido", label: "Marcar como recebido" };
    case "recebido":
      return { actor: "dhl", next: "em_separacao", label: "Iniciar separação" };
    case "em_separacao":
      return { actor: "dhl", next: "em_transporte", label: "Despachar (em transporte)" };
    case "em_transporte":
      return { actor: "lenovo", next: "entregue", label: "Confirmar entrega" };
    default:
      return null;
  }
}

export function canCancel(status: OrderStatus): boolean {
  return status === "enviado" || status === "recebido";
}

export function isClosed(status: OrderStatus): boolean {
  return status === "entregue" || status === "cancelado";
}

export function fmtOrderId(id: number): string {
  return "#" + String(id).padStart(4, "0");
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

export function describeEvent(from: OrderStatus | null, to: OrderStatus): string {
  if (from === null) return "criou o pedido";
  if (to === "cancelado") return "cancelou o pedido";
  return `moveu para "${STATUS_LABEL[to]}"`;
}
