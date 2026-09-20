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
import { ConnectionBanner, ErrorBox, Section, StatusBadge } from "@/components/ui";

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
  if (data === null) return <p className="text-sm text-gray-500">Carregando…</p>;
  if (!data.order) {
    return (
      <Section title="Pedido não encontrado">
        <p className="text-sm text-gray-600">
          Não existe pedido {Number.isFinite(id) ? fmtOrderId(id) : `"${params.id}"`}.{" "}
          <Link className="underline" href="/lenovo">
            Voltar
          </Link>
        </p>
      </Section>
    );
  }

  const { order, events } = data;
  const units = order.order_items.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <ConnectionBanner connection={connection} />

      <Section
        title={`Pedido ${fmtOrderId(order.id)}`}
        right={<StatusBadge status={order.status} />}
      >
        <div className="grid gap-1 text-sm sm:grid-cols-3">
          <div>
            <span className="text-gray-500">Solicitante:</span> {order.requested_by}
          </div>
          <div>
            <span className="text-gray-500">Criado em:</span> {fmtDate(order.created_at)}
          </div>
          <div>
            <span className="text-gray-500">Última atualização:</span> {fmtDate(order.updated_at)}
          </div>
          {order.notes && (
            <div className="sm:col-span-3">
              <span className="text-gray-500">Observação:</span> {order.notes}
            </div>
          )}
        </div>

        <Timeline order={order} events={events} />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title={`Itens · ${units} caixas`}>
          <table>
            <tbody>
              {order.order_items.map((i) => (
                <tr key={i.serial}>
                  <td className="num w-14 font-semibold">{i.quantity} ×</td>
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

        <Section title="Histórico">
          <table>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="w-28 whitespace-nowrap text-gray-500">{fmtDate(e.created_at)}</td>
                  <td className="w-16 font-medium">{ACTOR_LABEL[e.actor]}</td>
                  <td>{describeEvent(e.from_status, e.to_status)}</td>
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
  const when = (s: string) => events.find((e) => e.to_status === s)?.created_at;

  return (
    <ol className="mt-4 flex items-start">
      {STATUS_FLOW.map((s, idx) => {
        const reached = idx <= reachedIdx;
        const isCurrent = idx === reachedIdx;
        const dot = cancelled && isCurrent
          ? "bg-red-600 border-red-600"
          : reached
            ? "bg-gray-900 border-gray-900"
            : "bg-white border-gray-300";
        const line = idx < reachedIdx ? "bg-gray-900" : "bg-gray-300";
        const ts = when(s);
        return (
          <li key={s} className="relative flex-1">
            {idx > 0 && <div className={"absolute top-2 right-1/2 left-[-50%] h-0.5 " + line} />}
            <div className="relative flex flex-col items-center text-center">
              <div className={"h-4 w-4 rounded-full border-2 " + dot} />
              <div
                className={
                  "mt-1 text-xs " +
                  (isCurrent ? "font-semibold" : reached ? "text-gray-800" : "text-gray-400")
                }
              >
                {STATUS_LABEL[s]}
                {cancelled && isCurrent && (
                  <span className="block font-semibold text-red-600">Cancelado aqui</span>
                )}
              </div>
              {ts && <div className="text-[11px] text-gray-500">{fmtDate(ts)}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
