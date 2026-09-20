"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { advanceOrder, restock } from "@/lib/actions";
import { fmtDate, fmtOrderId, isClosed, nextAction, timeAgo } from "@/lib/format";
import { fetchDhlData } from "@/lib/queries";
import type { BoxModel, Order, OrderStatus } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import { btn, ConnectionBanner, ErrorBox, input, Section, StatusBadge } from "@/components/ui";

type Tab = "enviado" | "recebido" | "em_separacao" | "em_transporte" | "historico";

const TABS: { key: Tab; label: string; match: (s: OrderStatus) => boolean }[] = [
  { key: "enviado", label: "Novos", match: (s) => s === "enviado" },
  { key: "recebido", label: "Recebidos", match: (s) => s === "recebido" },
  { key: "em_separacao", label: "Em separação", match: (s) => s === "em_separacao" },
  { key: "em_transporte", label: "Em transporte", match: (s) => s === "em_transporte" },
  { key: "historico", label: "Histórico", match: isClosed },
];

export default function DhlPage() {
  const { data, error, connection, refetch } = useLiveData(fetchDhlData);
  const [tab, setTab] = useState<Tab>("enviado");

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((t) => [t.key, orders.filter((o) => t.match(o.status)).length]),
      ) as Record<Tab, number>,
    [orders],
  );
  const current = TABS.find((t) => t.key === tab)!;
  const visible = orders.filter((o) => current.match(o.status));
  // Fila: mais antigo primeiro (quem espera há mais tempo aparece no topo). Histórico: mais recente primeiro.
  if (tab !== "historico") visible.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <>
      <ConnectionBanner connection={connection} />
      <ErrorBox message={error} />

      <Section
        title="Fila de pedidos"
        right={
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={
                  "rounded px-2.5 py-1 text-xs font-medium " +
                  (tab === t.key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")
                }
              >
                {t.label}
                {counts[t.key] > 0 && (
                  <span
                    className={
                      "ml-1.5 rounded-full px-1.5 " +
                      (tab === t.key ? "bg-white text-gray-900" : "bg-gray-300 text-gray-800")
                    }
                  >
                    {counts[t.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      >
        {data === null ? (
          <p className="text-sm text-gray-500">Carregando…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-500">
            {tab === "enviado" ? "Nenhum pedido novo." : "Nenhum pedido nesta etapa."}
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((o) => (
              <OrderCard key={o.id} order={o} onChanged={refetch} />
            ))}
          </div>
        )}
      </Section>

      <StockTable boxes={data?.boxes ?? []} loading={data === null} onChanged={refetch} />
    </>
  );
}

function OrderCard({ order: o, onChanged }: { order: Order; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const action = nextAction(o.status);
  const units = o.order_items.reduce((s, i) => s + i.quantity, 0);

  async function advance() {
    setBusy(true);
    setErr(null);
    const r = await advanceOrder(o.id, "dhl");
    setBusy(false);
    if (!r.ok) setErr(r.error);
    onChanged();
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Link className="font-semibold underline" href={`/pedido/${o.id}`}>
              {fmtOrderId(o.id)}
            </Link>
            <StatusBadge status={o.status} />
            <span className="text-xs text-gray-500" title={fmtDate(o.created_at)}>
              {timeAgo(o.created_at)}
            </span>
          </div>
          <div className="mt-0.5 text-sm text-gray-700">
            Solicitante: <span className="font-medium">{o.requested_by}</span>
            {o.notes && <span className="text-gray-500"> · {o.notes}</span>}
          </div>
        </div>
        {action?.actor === "dhl" && (
          <button className={btn.primary} disabled={busy} onClick={advance} type="button">
            {busy ? "Salvando…" : action.label}
          </button>
        )}
        {action?.actor === "lenovo" && (
          <span className="text-xs text-gray-500">Aguardando a Lenovo confirmar a entrega</span>
        )}
      </div>

      <table className="mt-2">
        <tbody>
          {o.order_items.map((i) => (
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
          <tr>
            <td colSpan={3} className="text-xs text-gray-500">
              {units} caixas no total
            </td>
          </tr>
        </tbody>
      </table>

      <ErrorBox message={err} onClose={() => setErr(null)} />
    </div>
  );
}

function StockTable({
  boxes,
  loading,
  onChanged,
}: {
  boxes: BoxModel[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const low = boxes.filter((b) => b.stock_available < b.min_stock).length;

  async function doRestock(serial: string) {
    const n = Number.parseInt(qty[serial] ?? "", 10);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Informe uma quantidade maior que zero para repor.");
      return;
    }
    setBusy(serial);
    setErr(null);
    const r = await restock(serial, n);
    setBusy(null);
    if (r.ok) setQty({ ...qty, [serial]: "" });
    else setErr(r.error);
    onChanged();
  }

  return (
    <Section
      title="Estoque do armazém"
      right={
        low > 0 ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            ⚠ {low} {low === 1 ? "modelo abaixo" : "modelos abaixo"} do mínimo
          </span>
        ) : undefined
      }
    >
      <ErrorBox message={err} onClose={() => setErr(null)} />
      {loading ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={err ? "mt-3" : ""}>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Máquina</th>
                <th>Modelo</th>
                <th className="num">Total</th>
                <th className="num">Reservado</th>
                <th className="num">Disponível</th>
                <th className="num">Mínimo</th>
                <th>Repor</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => {
                const isLow = b.stock_available < b.min_stock;
                return (
                  <tr key={b.serial} className={isLow ? "bg-amber-50" : ""}>
                    <td className="mono">{b.serial}</td>
                    <td>{b.machine_name}</td>
                    <td>{b.machine_model}</td>
                    <td className="num">{b.stock_total}</td>
                    <td className="num text-gray-500">{b.stock_reserved}</td>
                    <td className={"num font-semibold " + (isLow ? "text-amber-800" : "")}>
                      {b.stock_available}
                      {isLow && <span title="Abaixo do estoque mínimo"> ⚠</span>}
                    </td>
                    <td className="num text-gray-500">{b.min_stock}</td>
                    <td>
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void doRestock(b.serial);
                        }}
                      >
                        <input
                          className={input + " w-16 num"}
                          type="number"
                          min={1}
                          placeholder="0"
                          value={qty[b.serial] ?? ""}
                          onChange={(e) => setQty({ ...qty, [b.serial]: e.target.value })}
                        />
                        <button className={btn.small} type="submit" disabled={busy === b.serial}>
                          + repor
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
