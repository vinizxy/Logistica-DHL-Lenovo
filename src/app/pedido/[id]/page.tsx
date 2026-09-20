"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { ACTOR_LABEL, describeEvent, fmtDate, fmtOrderId } from "@/lib/format";
import { fetchOrder, fetchOrderComments, fetchOrderEvents } from "@/lib/queries";
import type { OrderComment, OrderEvent } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import { Comments } from "@/components/Comments";
import { Timeline } from "@/components/Timeline";
import { ConnectionBanner, Empty, ErrorBox, Section, StatusBadge, UrgentBadge } from "@/components/ui";

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const id = Number.parseInt(params.id, 10);

  const fetcher = useCallback(async () => {
    if (!Number.isFinite(id)) return { order: null, events: [] as OrderEvent[], comments: [] as OrderComment[] };
    const [order, events, comments] = await Promise.all([
      fetchOrder(id),
      fetchOrderEvents(id),
      fetchOrderComments(id),
    ]);
    return { order, events, comments };
  }, [id]);

  const { data, error, connection, refetch } = useLiveData(fetcher);

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

  const { order, events, comments } = data;
  const units = order.order_items.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
            Pedido {fmtOrderId(order.id)}
            {order.urgent && <UrgentBadge />}
          </h1>
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <Section title={`Itens — ${units} ${units === 1 ? "caixa" : "caixas"}`} flush>
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

      <Comments orderId={order.id} comments={comments} onChanged={refetch} />
    </>
  );
}
