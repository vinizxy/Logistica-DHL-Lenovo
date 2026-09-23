"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FitsLine, ItemTitle, KindTabs, KindTag } from "@/components/catalog";
import { advanceOrder, restock } from "@/lib/actions";
import {
  buildFitsIndex,
  countByKind,
  itemName,
  matchItem,
  orderLines,
  sortCatalog,
  unitsSummary,
  type KindFilter,
} from "@/lib/catalog";
import { fmtDate, fmtEta, fmtOrderId, isClosed, localDateTimeValue, nextAction, timeAgo } from "@/lib/format";
import { commentCount, fetchDhlData } from "@/lib/queries";
import type { BoxModel, Order, OrderStatus } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import {
  btn,
  CommentCount,
  ConnectionBanner,
  Empty,
  ErrorBox,
  input,
  Section,
  Stats,
  StatusBadge,
  UrgentBadge,
} from "@/components/ui";

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
  const boxes = useMemo(() => data?.boxes ?? [], [data]);
  const bySerial = useMemo(() => new Map(boxes.map((b) => [b.serial, b])), [boxes]);
  const fitsOf = useMemo(() => buildFitsIndex(data?.fits ?? []), [data]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((t) => [t.key, orders.filter((o) => t.match(o.status)).length]),
      ) as Record<Tab, number>,
    [orders],
  );
  const current = TABS.find((t) => t.key === tab)!;
  const visible = orders.filter((o) => current.match(o.status));
  // Fila: urgentes no topo; depois quem espera há mais tempo. Histórico: mais recente primeiro.
  if (tab !== "historico") {
    visible.sort((a, b) =>
      a.urgent !== b.urgent ? (a.urgent ? -1 : 1) : a.created_at.localeCompare(b.created_at),
    );
  }

  const inProgress = counts.recebido + counts.em_separacao;
  const urgentOpen = orders.filter((o) => o.urgent && !isClosed(o.status)).length;
  const low = boxes.filter((b) => b.stock_available < b.min_stock).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Painel DHL</h1>
          <p className="text-sm text-muted">Armazém — separar, despachar e repor caixas e cushions</p>
        </div>
        {data && (
          <Stats
            items={[
              { value: counts.enviado, label: "novos", tone: counts.enviado ? "red" : undefined },
              { value: urgentOpen, label: "urgentes", tone: urgentOpen ? "red" : undefined },
              { value: inProgress, label: "em andamento" },
              { value: low, label: "abaixo do mínimo", tone: low ? "amber" : undefined },
            ]}
          />
        )}
      </div>

      <ConnectionBanner connection={connection} />
      <ErrorBox message={error} />

      <Section
        title="Fila de pedidos"
        flush
        right={
          <div className="-mb-2.5 flex flex-wrap gap-1">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={
                    "relative px-2.5 pb-2.5 pt-1 text-xs font-medium transition-colors " +
                    (active ? "text-ink" : "text-muted hover:text-ink-2")
                  }
                >
                  {t.label}
                  {counts[t.key] > 0 && (
                    <span
                      className={
                        "num ml-1.5 inline-block min-w-[1.25rem] px-1 text-center " +
                        (t.key === "enviado" ? "bg-red text-white" : "bg-surface-3 text-ink-2")
                      }
                    >
                      {counts[t.key]}
                    </span>
                  )}
                  {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-red" />}
                </button>
              );
            })}
          </div>
        }
      >
        {data === null ? (
          <Empty>Carregando…</Empty>
        ) : visible.length === 0 ? (
          <Empty>
            {tab === "enviado"
              ? "Nenhum pedido novo. Pedidos enviados pela Lenovo aparecem aqui na hora."
              : "Nenhum pedido nesta etapa."}
          </Empty>
        ) : (
          <div className="divide-y divide-line">
            {visible.map((o) => (
              <OrderCard key={o.id} order={o} onChanged={refetch} />
            ))}
          </div>
        )}
      </Section>

      <StockTable boxes={boxes} fitsOf={fitsOf} bySerial={bySerial} loading={data === null} onChanged={refetch} />
    </>
  );
}

function OrderCard({ order: o, onChanged }: { order: Order; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Ao despachar, a DHL informa a previsão de entrega antes de confirmar.
  const [dispatching, setDispatching] = useState(false);
  const [eta, setEta] = useState("");
  const action = nextAction(o.status);
  const isNew = o.status === "enviado";
  const isDispatch = action?.next === "em_transporte";

  async function advance(etaIso?: string | null) {
    setBusy(true);
    setErr(null);
    const r = await advanceOrder(o.id, etaIso);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else setDispatching(false);
    onChanged();
  }

  function startDispatch() {
    setEta(localDateTimeValue(2));
    setDispatching(true);
  }

  return (
    <div
      className={
        "px-4 py-3 border-l-2 " +
        (o.urgent ? "border-red bg-red-soft/40" : isNew ? "border-red" : "border-transparent")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Link className="text-base font-semibold hover:text-red" href={`/pedido/${o.id}`}>
              {fmtOrderId(o.id)}
            </Link>
            {o.urgent && <UrgentBadge />}
            <StatusBadge status={o.status} />
            <span className="text-xs text-muted" title={fmtDate(o.created_at)}>
              {timeAgo(o.created_at)}
            </span>
            <CommentCount n={commentCount(o)} />
          </div>
          <div className="mt-0.5 text-sm text-ink-2">
            {o.requested_by}
            {o.notes && <span className="text-muted"> — {o.notes}</span>}
          </div>
          {o.status === "em_transporte" && (
            <div className="mt-0.5 text-sm text-ink-2">
              Previsão de entrega:{" "}
              <span className="font-medium text-ink">{o.eta ? fmtEta(o.eta) : "não informada"}</span>
            </div>
          )}
        </div>
        {action?.actor === "dhl" && !isDispatch && (
          <button className={btn.primary + " w-full sm:w-auto"} disabled={busy} onClick={() => advance()} type="button">
            {busy ? "Salvando…" : action.label}
          </button>
        )}
        {action?.actor === "dhl" && isDispatch && !dispatching && (
          <button className={btn.primary + " w-full sm:w-auto"} disabled={busy} onClick={startDispatch} type="button">
            {action.label}
          </button>
        )}
        {action?.actor === "lenovo" && (
          <span className="text-xs text-muted">Aguardando a Lenovo confirmar a entrega</span>
        )}
      </div>

      {dispatching && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border border-line bg-surface-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void advance(eta ? new Date(eta).toISOString() : null);
          }}
        >
          <label className="block text-sm">
            <span className="text-ink-2">Previsão de entrega na Lenovo</span>
            <input
              className={input + " mt-1 block"}
              type="datetime-local"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              required
            />
          </label>
          <button className={btn.primary} type="submit" disabled={busy}>
            {busy ? "Despachando…" : "Confirmar despacho"}
          </button>
          <button className={btn.secondary} type="button" disabled={busy} onClick={() => setDispatching(false)}>
            Voltar
          </button>
          <span className="basis-full text-xs text-muted">
            A Lenovo vê a previsão no painel e na linha do tempo do pedido. O estoque é baixado agora.
          </span>
        </form>
      )}

      <table className="mt-2 max-w-xl">
        <tbody>
          {o.order_items.map((i) => (
            <tr key={i.serial}>
              <td className="num w-14 py-1 font-semibold">{i.quantity} ×</td>
              <td className="w-20 py-1">{i.box_models && <KindTag kind={i.box_models.kind} small />}</td>
              <td className="mono w-32 py-1">{i.serial}</td>
              <td className="py-1">
                {!i.box_models
                  ? "(item removido do catálogo)"
                  : i.box_models.kind === "caixa" && itemName(i.box_models)}
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={4} className="py-1 text-xs text-muted">
              {unitsSummary(orderLines(o.order_items))} no total
            </td>
          </tr>
        </tbody>
      </table>

      {err && (
        <div className="mt-2">
          <ErrorBox message={err} onClose={() => setErr(null)} />
        </div>
      )}
    </div>
  );
}

function StockTable({
  boxes,
  fitsOf,
  bySerial,
  loading,
  onChanged,
}: {
  boxes: BoxModel[];
  fitsOf: Map<string, string[]>;
  bySerial: Map<string, BoxModel>;
  loading: boolean;
  onChanged: () => void;
}) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("tudo");

  const matches = useMemo(
    () =>
      sortCatalog(boxes)
        .map((b) => ({ item: b, ...matchItem(b, search, fitsOf, bySerial) }))
        .filter((r) => r.match),
    [boxes, search, fitsOf, bySerial],
  );
  const counts = useMemo(() => countByKind(matches.map((r) => r.item)), [matches]);
  const filtered = kind === "tudo" ? matches : matches.filter((r) => r.item.kind === kind);
  const machinesOf = (serial: string) =>
    (fitsOf.get(serial) ?? []).map((s) => bySerial.get(s)).filter((m): m is BoxModel => !!m);

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
      flush
      right={
        <input
          className={input + " w-full sm:w-64"}
          placeholder="Buscar máquina, serial ou cushion"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar no estoque"
        />
      }
    >
      <div className="border-b border-line px-2 pt-1">
        <KindTabs value={kind} onChange={setKind} counts={counts} />
      </div>
      {err && (
        <div className="p-4 pb-0">
          <ErrorBox message={err} onClose={() => setErr(null)} />
        </div>
      )}
      {loading ? (
        <Empty>Carregando…</Empty>
      ) : filtered.length === 0 ? (
        <Empty>
          {search.trim()
            ? `Nada encontrado para “${search}”.`
            : kind === "cushion"
              ? "Nenhum cushion no catálogo ainda. Cadastre em Cadastro."
              : "Nenhum item no catálogo."}
        </Empty>
      ) : (
        <>
        {/* Celular: lista com os quatro números e a reposição à mão. */}
        <ul className="divide-y divide-line md:hidden">
          {filtered.map(({ item: b, hits }) => {
            const isLow = b.stock_available < b.min_stock;
            return (
              <li key={b.serial} className={"px-4 py-3 " + (b.active ? "" : "opacity-60")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <KindTag kind={b.kind} small />
                    {!b.active && <span className="ml-2 text-xs text-muted">descontinuado</span>}
                    <ItemTitle item={b} />
                    {b.kind === "cushion" ? (
                      <FitsLine machines={machinesOf(b.serial)} hits={hits} />
                    ) : (
                      <div className="mono">{b.serial}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={"num text-xl font-semibold leading-none " + (isLow ? "text-amber" : "")}>
                      {b.stock_available}
                    </div>
                    <div className="text-[11px] text-muted">
                      {isLow ? <span className="text-amber">abaixo do mínimo</span> : "disponíveis"}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-4 text-xs text-muted">
                  <span>total <span className="num text-ink-2">{b.stock_total}</span></span>
                  <span>reservado <span className="num text-ink-2">{b.stock_reserved}</span></span>
                  <span>mínimo <span className="num text-ink-2">{b.min_stock}</span></span>
                </div>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void doRestock(b.serial);
                  }}
                >
                  <input
                    className={input + " w-20 num"}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="0"
                    value={qty[b.serial] ?? ""}
                    onChange={(e) => setQty({ ...qty, [b.serial]: e.target.value })}
                    aria-label={`Repor ${itemName(b)}`}
                  />
                  <button className={btn.secondary + " flex-1"} type="submit" disabled={busy === b.serial}>
                    Registrar reposição
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Tipo</th>
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
              {filtered.map(({ item: b, hits }) => {
                const isLow = b.stock_available < b.min_stock;
                return (
                  <tr key={b.serial} className={b.active ? "" : "opacity-60"}>
                    <td className="mono">{b.serial}</td>
                    <td><KindTag kind={b.kind} /></td>
                    <td>
                      {b.kind === "cushion" ? (
                        <FitsLine machines={machinesOf(b.serial)} hits={hits} />
                      ) : (
                        <div className="whitespace-nowrap font-medium">{b.machine_name}</div>
                      )}
                      {!b.active && <span className="text-xs text-muted">descontinuado</span>}
                    </td>
                    <td className="text-ink-2">{b.kind === "cushion" ? <span className="text-muted">—</span> : b.machine_model}</td>
                    <td className="num text-ink-2">{b.stock_total}</td>
                    <td className="num text-muted">{b.stock_reserved}</td>
                    <td className={"num text-base font-semibold " + (isLow ? "text-amber" : "")}>
                      {b.stock_available}
                      {isLow && (
                        <span className="ml-1.5 text-xs font-normal text-amber" title="Abaixo do estoque mínimo">
                          baixo
                        </span>
                      )}
                    </td>
                    <td className="num text-muted">{b.min_stock}</td>
                    <td>
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void doRestock(b.serial);
                        }}
                      >
                        <input
                          className={input + " w-14 num"}
                          type="number"
                          min={1}
                          placeholder="0"
                          value={qty[b.serial] ?? ""}
                          onChange={(e) => setQty({ ...qty, [b.serial]: e.target.value })}
                          aria-label={`Repor ${itemName(b)}`}
                        />
                        <button className={btn.small} type="submit" disabled={busy === b.serial}>
                          Repor
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Section>
  );
}
