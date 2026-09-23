"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { KindTag } from "@/components/catalog";
import { advanceOrder } from "@/lib/actions";
import { itemName, orderLines, unitsSummary } from "@/lib/catalog";
import { ACTOR_LABEL, describeEvent, fmtDate, fmtEta, fmtOrderId } from "@/lib/format";
import { fetchOrder, fetchOrderComments, fetchOrderEvents } from "@/lib/queries";
import type { OrderComment, OrderEvent } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import { Comments } from "@/components/Comments";
import { Timeline } from "@/components/Timeline";
import { btn, ConnectionBanner, Empty, ErrorBox, Section, StatusBadge, UrgentBadge } from "@/components/ui";

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
  const { profile } = useAuth();

  if (error) return <ErrorBox message={error} />;
  if (data === null) return <Empty>Carregando…</Empty>;
  if (!data.order) {
    return (
      <Section title="Pedido não encontrado">
        <p className="text-sm text-ink-2">
          Não existe pedido {Number.isFinite(id) ? fmtOrderId(id) : `“${params.id}”`}.{" "}
          <Link className="underline hover:text-red" href="/">
            Voltar ao painel
          </Link>
        </p>
      </Section>
    );
  }

  const { order, events, comments } = data;

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

      {order.status === "em_transporte" && (profile?.role === "lenovo" || profile?.role === "admin") && (
        <ConfirmDelivery orderId={order.id} eta={order.eta} onChanged={refetch} />
      )}

      <Section title="Andamento">
        <Timeline order={order} events={events} />
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <Section title={`Itens — ${unitsSummary(orderLines(order.order_items))}`} flush>
          <table>
            <tbody>
              {order.order_items.map((i) => (
                <tr key={i.serial}>
                  <td className="num w-16 pl-4 font-semibold">{i.quantity} ×</td>
                  <td>
                    {i.box_models && <KindTag kind={i.box_models.kind} small />}
                    {!i.box_models ? (
                      <div>(item removido do catálogo)</div>
                    ) : (
                      i.box_models.kind === "caixa" && <div>{itemName(i.box_models)}</div>
                    )}
                  </td>
                  <td className="mono w-32 pr-4 text-right">{i.serial}</td>
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

/**
 * Único passo que cabe à Lenovo no rastreio: fechar o ciclo quando as caixas chegam.
 * Mesma função do painel (advance_order; o banco confere que é a Lenovo); o banco valida o status.
 */
function ConfirmDelivery({
  orderId,
  eta,
  onChanged,
}: {
  orderId: number;
  eta: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirmDelivery() {
    setBusy(true);
    setErr(null);
    const r = await advanceOrder(orderId);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    onChanged();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-red/40 bg-red-soft/40 px-4 py-3">
      <div>
        <div className="text-sm font-medium">O pedido está a caminho da Lenovo</div>
        <div className="text-xs text-muted">
          {eta ? <>Previsão de entrega: <span className="text-ink-2">{fmtEta(eta)}</span>. </> : null}
          Quando chegar, confirme aqui para encerrar o pedido.
        </div>
        {err && <div className="mt-1 text-xs text-red">{err}</div>}
      </div>
      <button className={btn.primary + " w-full sm:w-auto"} type="button" disabled={busy} onClick={() => void confirmDelivery()}>
        {busy ? "Confirmando…" : "Confirmar entrega"}
      </button>
    </div>
  );
}
