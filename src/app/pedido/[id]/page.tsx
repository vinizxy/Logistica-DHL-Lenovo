"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import {
  ACTOR_LABEL,
  describeEvent,
  fmtDate,
  fmtOrderId,
  STATUS_FLOW,
  STATUS_LABEL,
} from "@/lib/format";
import { fetchOrder, fetchOrderEvents } from "@/lib/queries";
import type { Order, OrderEvent } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import { ConnectionBanner, Empty, ErrorBox, Section, StatusBadge } from "@/components/ui";

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const id = Number.parseInt(params.id, 10);

  const fetcher = useCallback(async () => {
    if (!Number.isFinite(id)) return { order: null, events: [] as OrderEvent[] };
    const [order, events] = await Promise.all([fetchOrder(id), fetchOrderEvents(id)]);
    return { order, events };
  }, [id]);

  const { data, error, connection } = useLiveData(fetcher);

  if (error) return <ErrorBox message={error} />;
  if (data === null) return <Empty>Carregando…</Empty>;
  if (!data.order) {
    return (
      <Section title="Pedido não encontrado">
        <p className="text-sm text-ink-2">
          Não existe pedido {Number.isFinite(id) ? fmtOrderId(id) : `“${params.id}”`}.{" "}
          <Link className="underline hover:text-red" href="/lenovo">
            Voltar ao painel
          </Link>
        </p>
      </Section>
    );
  }

  const { order, events } = data;
  const units = order.order_items.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pedido {fmtOrderId(order.id)}</h1>
          <p className="text-sm text-muted">
            {order.requested_by} · criado em {fmtDate(order.created_at)}
            {order.notes && <> · {order.notes}</>}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <ConnectionBanner connection={connection} />

      <Section title="Andamento">
        <Timeline order={order} events={events} />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title={`Itens — ${units} caixas`} flush>
          <table>
            <tbody>
              {order.order_items.map((i) => (
                <tr key={i.serial}>
                  <td className="num w-16 pl-4 font-semibold">{i.quantity} ×</td>
                  <td className="mono w-32">{i.serial}</td>
                  <td>
                    {i.box_models
                      ? `${i.box_models.machine_name} ${i.box_models.machine_model}`
                      : "(caixa removida do catálogo)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Histórico" flush>
          <table>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="w-28 whitespace-nowrap pl-4 text-muted">{fmtDate(e.created_at)}</td>
                  <td className="w-16 font-medium">{ACTOR_LABEL[e.actor]}</td>
                  <td className="text-ink-2">{describeEvent(e.from_status, e.to_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </>
  );
}

function Timeline({ order, events }: { order: Order; events: OrderEvent[] }) {
  const cancelled = order.status === "cancelado";
  // Se cancelado, o último status do fluxo principal é onde parou.
  const lastMain = cancelled
    ? (events.filter((e) => e.to_status !== "cancelado").at(-1)?.to_status ?? "enviado")
    : order.status;
  const reachedIdx = STATUS_FLOW.indexOf(lastMain);
  const done = order.status === "entregue";
  const when = (s: string) => events.find((e) => e.to_status === s)?.created_at;

  return (
    <ol className="flex items-start">
      {STATUS_FLOW.map((s, idx) => {
        const reached = idx <= reachedIdx;
        const isCurrent = idx === reachedIdx;
        const ts = when(s);
        const dot = cancelled && isCurrent
          ? "border-muted bg-muted"
          : isCurrent && !done
            ? "border-red bg-red shadow-[0_0_0_4px_var(--color-red-soft)]"
            : reached
              ? "border-red bg-red"
              : "border-line-strong bg-surface";
        const line = idx < reachedIdx ? "bg-red" : "bg-line-strong";
        return (
          <li key={s} className="relative flex-1">
            {idx > 0 && <div className={"absolute top-[7px] right-1/2 left-[-50%] h-0.5 " + line} />}
            <div className="relative flex flex-col items-center text-center">
              <div className={"h-4 w-4 rounded-full border-2 " + dot} />
              <div
                className={
                  "mt-2 text-xs " +
                  (isCurrent ? "font-semibold text-ink" : reached ? "text-ink-2" : "text-muted")
                }
              >
                {STATUS_LABEL[s]}
                {cancelled && isCurrent && (
                  <span className="block font-semibold text-red">Cancelado aqui</span>
                )}
              </div>
              {ts && <div className="num mt-0.5 text-[11px] text-muted">{fmtDate(ts)}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
