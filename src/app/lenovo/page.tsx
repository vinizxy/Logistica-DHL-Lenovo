"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { advanceOrder, cancelOrder, createOrder } from "@/lib/actions";
import { canCancel, fmtDate, fmtEta, fmtOrderId, isClosed, nextAction } from "@/lib/format";
import { commentCount, fetchLenovoData } from "@/lib/queries";
import type { BoxModel, Order } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import {
  btn,
  checkbox,
  CommentCount,
  ConnectionBanner,
  Empty,
  ErrorBox,
  input,
  Section,
  Stats,
  StatusBadge,
  SuccessBox,
  UrgentBadge,
} from "@/components/ui";

type Cart = Record<string, number>; // serial → quantidade

const REQUESTER_KEY = "refurbish.requester";

export default function LenovoPage() {
  const { data, error, connection, refetch } = useLiveData(fetchLenovoData);
  const [cart, setCart] = useState<Cart>({});
  const [cartError, setCartError] = useState<string | null>(null);
  const [success, setSuccess] = useState<React.ReactNode>(null);

  // Caixas descontinuadas não aparecem para pedir (o banco também recusa).
  const boxes = useMemo(() => (data?.boxes ?? []).filter((b) => b.active), [data]);
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const boxBySerial = useMemo(() => new Map(boxes.map((b) => [b.serial, b])), [boxes]);

  const available = boxes.reduce((s, b) => s + b.stock_available, 0);
  const open = orders.filter((o) => !isClosed(o.status)).length;
  const awaiting = orders.filter((o) => o.status === "em_transporte").length;

  // Define a quantidade de uma caixa no pedido (absoluta), limitada ao disponível.
  function setCartQty(box: BoxModel, qty: number) {
    setCartError(null);
    const n = Number.isFinite(qty) ? Math.max(0, Math.floor(qty)) : 0;
    if (n > box.stock_available) {
      setCartError(`${box.machine_name} ${box.machine_model}: só ${box.stock_available} disponíveis.`);
    }
    setQty(box.serial, Math.min(n, box.stock_available));
  }

  // Botões − / +: usa o estado anterior, então cliques rápidos nunca se perdem.
  function stepCartQty(box: BoxModel, delta: number) {
    setCartError(null);
    setCart((prev) => {
      const cur = prev[box.serial] ?? 0;
      const n = Math.min(Math.max(0, cur + delta), box.stock_available);
      const next = { ...prev };
      if (n <= 0) delete next[box.serial];
      else next[box.serial] = n;
      return next;
    });
  }

  function setQty(serial: string, qty: number) {
    if (qty <= 0) {
      const next = { ...cart };
      delete next[serial];
      setCart(next);
    } else {
      setCart({ ...cart, [serial]: qty });
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Painel Lenovo</h1>
          <p className="text-sm text-muted">Linha de refurbish — pedir caixas ao armazém da DHL</p>
        </div>
        {data && (
          <Stats
            items={[
              { value: available.toLocaleString("pt-BR"), label: "caixas disponíveis" },
              { value: open, label: "pedidos em andamento" },
              { value: awaiting, label: "aguardando sua confirmação", tone: awaiting ? "red" : undefined },
            ]}
          />
        )}
      </div>

      <ConnectionBanner connection={connection} />
      <ErrorBox message={error} />
      <SuccessBox message={success} onClose={() => setSuccess(null)} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <StockTable boxes={boxes} cart={cart} onSet={setCartQty} onStep={stepCartQty} loading={data === null} />
        <CartPanel
          cart={cart}
          boxBySerial={boxBySerial}
          error={cartError}
          onQty={(serial, q) => {
            const b = boxBySerial.get(serial);
            if (b) setCartQty(b, q);
            else setQty(serial, q);
          }}
          onStep={(serial, d) => {
            const b = boxBySerial.get(serial);
            if (b) stepCartQty(b, d);
          }}
          onClear={() => setCart({})}
          onSubmitted={(id) => {
            setCart({});
            setCartError(null);
            setSuccess(
              <>
                Pedido {fmtOrderId(id)} enviado à DHL.{" "}
                <Link className="underline" href={`/pedido/${id}`}>
                  Acompanhar
                </Link>
              </>,
            );
            void refetch();
          }}
          onError={setCartError}
        />
      </div>

      <MyOrders orders={orders} loading={data === null} onChanged={refetch} />
    </>
  );
}

function StockTable({
  boxes,
  cart,
  onSet,
  onStep,
  loading,
}: {
  boxes: BoxModel[];
  cart: Cart;
  onSet: (box: BoxModel, qty: number) => void;
  onStep: (box: BoxModel, delta: number) => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boxes;
    return boxes.filter(
      (b) =>
        b.serial.toLowerCase().includes(q) ||
        b.machine_name.toLowerCase().includes(q) ||
        b.machine_model.toLowerCase().includes(q),
    );
  }, [boxes, search]);

  return (
    <Section
      title="Estoque de caixas na DHL"
      flush
      right={
        <input
          className={input + " w-56"}
          placeholder="Buscar serial ou máquina"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
    >
      {loading ? (
        <Empty>Carregando…</Empty>
      ) : filtered.length === 0 ? (
        <Empty>Nenhuma caixa encontrada para “{search}”.</Empty>
      ) : (
        <>
        {/* Celular: lista de cartões com o que importa à mão (disponível + quantidade no pedido). */}
        <ul className="divide-y divide-line md:hidden">
          {filtered.map((b) => {
            const inCart = cart[b.serial] ?? 0;
            const soldOut = b.stock_available <= 0;
            return (
              <li key={b.serial} className={"px-4 py-3 " + (soldOut ? "opacity-50" : "")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {b.machine_name} <span className="font-normal text-ink-2">{b.machine_model}</span>
                    </div>
                    <div className="mono">{b.serial}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-xl font-semibold leading-none">{b.stock_available}</div>
                    <div className="text-[11px] text-muted">
                      {soldOut ? <span className="text-red">esgotado</span> : "disponíveis"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <QtyStepper
                    value={inCart}
                    max={b.stock_available}
                    onChange={(n) => onSet(b, n)}
                    onStep={(d) => onStep(b, d)}
                    label={`${b.machine_name} ${b.machine_model}`}
                    size="lg"
                  />
                  <span className="text-xs text-muted">{inCart > 0 ? "no pedido" : "Toque em + para pedir"}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Máquina</th>
                <th>Modelo</th>
                <th className="num">Disponível</th>
                <th className="text-center">No pedido</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const inCart = cart[b.serial] ?? 0;
                const soldOut = b.stock_available <= 0;
                return (
                  <tr key={b.serial} className={soldOut ? "opacity-50" : inCart > 0 ? "bg-red-soft/30" : ""}>
                    <td className="mono">{b.serial}</td>
                    <td className="whitespace-nowrap font-medium">{b.machine_name}</td>
                    <td className="text-ink-2">{b.machine_model}</td>
                    <td className="num text-base font-semibold">
                      {b.stock_available}
                      {soldOut && <span className="ml-1.5 text-xs font-normal text-red">esgotado</span>}
                    </td>
                    <td>
                      <div className="flex justify-center">
                        <QtyStepper
                          value={inCart}
                          max={b.stock_available}
                          onChange={(n) => onSet(b, n)}
                          onStep={(d) => onStep(b, d)}
                          label={`${b.machine_name} ${b.machine_model}`}
                        />
                      </div>
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

/**
 * Controle − / quantidade / + ligado direto à quantidade no pedido.
 * Digitar também funciona; zero tira a caixa do pedido; nunca passa do disponível.
 */
function QtyStepper({
  value,
  max,
  onChange,
  onStep,
  label,
  size = "md",
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  onStep?: (delta: number) => void;
  label: string;
  size?: "md" | "lg";
}) {
  const step = (d: number) => (onStep ? onStep(d) : onChange(value + d));
  const [draft, setDraft] = useState<string | null>(null);
  const h = size === "lg" ? "h-10" : "h-8";
  const w = size === "lg" ? "w-12" : "w-9";
  const btnCls =
    h + " " + w +
    " grid place-items-center border border-line-strong text-base leading-none text-ink-2 transition-colors hover:border-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30";
  const filled = value > 0;

  return (
    <div className="inline-flex items-stretch" role="group" aria-label={`Quantidade de ${label} no pedido`}>
      <button
        type="button"
        className={btnCls + " rounded-l-sm border-r-0"}
        disabled={value <= 0}
        onClick={() => step(-1)}
        aria-label="Diminuir"
      >
        −
      </button>
      <input
        className={
          h + " w-14 border border-line-strong bg-bg text-center text-sm tabular-nums focus:border-red focus:outline-none " +
          (filled ? "font-semibold text-ink" : "text-muted")
        }
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={draft ?? (value || "")}
        placeholder="0"
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value === "") return;
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => {
          if (draft === "") onChange(0);
          setDraft(null);
        }}
        aria-label={`Quantidade de ${label}`}
      />
      <button
        type="button"
        className={btnCls + " rounded-r-sm border-l-0"}
        disabled={value >= max}
        onClick={() => step(1)}
        aria-label="Aumentar"
      >
        +
      </button>
    </div>
  );
}

function CartPanel({
  cart,
  boxBySerial,
  error,
  onQty,
  onStep,
  onClear,
  onSubmitted,
  onError,
}: {
  cart: Cart;
  boxBySerial: Map<string, BoxModel>;
  error: string | null;
  onQty: (serial: string, qty: number) => void;
  onStep: (serial: string, delta: number) => void;
  onClear: () => void;
  onSubmitted: (orderId: number) => void;
  onError: (msg: string) => void;
}) {
  const [requester, setRequester] = useState("");
  const [notes, setNotes] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Lembra o nome de quem pediu da última vez (só neste navegador). Lido após a
  // hidratação para não divergir do HTML renderizado no servidor.
  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(REQUESTER_KEY) ?? "";
    } catch {}
    if (saved) void Promise.resolve().then(() => setRequester(saved));
  }, []);

  const entries = Object.entries(cart);
  const totalUnits = entries.reduce((s, [, q]) => s + q, 0);
  const canSubmit = entries.length > 0 && requester.trim().length > 0 && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      localStorage.setItem(REQUESTER_KEY, requester.trim());
    } catch {}
    const result = await createOrder(
      requester.trim(),
      notes,
      entries.map(([serial, quantity]) => ({ serial, quantity })),
      urgent,
    );
    setSubmitting(false);
    if (result.ok) {
      setNotes("");
      setUrgent(false);
      onSubmitted(result.data);
    } else {
      onError(result.error);
    }
  }

  return (
    <Section
      title="Novo pedido"
      right={
        entries.length > 0 ? (
          <button className="text-xs text-muted hover:text-ink" onClick={onClear} type="button">
            Limpar
          </button>
        ) : undefined
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">
            Use o + na lista de estoque para montar o pedido. Pode ter vários tipos de caixa.
          </p>
        ) : (
          <div className="-mx-4 border-y border-line bg-bg/40">
            <table>
              <tbody>
                {entries.map(([serial, q]) => {
                  const b = boxBySerial.get(serial);
                  return (
                    <tr key={serial}>
                      <td className="pl-4">
                        <div className="font-medium">
                          {b ? `${b.machine_name} ${b.machine_model}` : serial}
                        </div>
                        <div className="mono text-xs">{serial}</div>
                      </td>
                      <td className="w-32">
                        <QtyStepper
                          value={q}
                          max={b?.stock_available ?? q}
                          onChange={(n) => onQty(serial, n)}
                          onStep={(d) => onStep(serial, d)}
                          label={b ? `${b.machine_name} ${b.machine_model}` : serial}
                        />
                      </td>
                      <td className="w-8 pr-4 text-right">
                        <button
                          type="button"
                          className="text-xs text-muted hover:text-red"
                          onClick={() => onQty(serial, 0)}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={3} className="pl-4 text-xs text-muted">
                    {entries.length} {entries.length === 1 ? "tipo" : "tipos"} ·{" "}
                    <span className="num font-medium text-ink-2">{totalUnits}</span> caixas
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <label className="block text-sm">
          <span className="text-ink-2">Solicitante</span>
          <input
            className={input + " mt-1 w-full"}
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
            placeholder="Seu nome"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Observação (opcional)</span>
          <input
            className={input + " mt-1 w-full"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: lote da semana 38"
          />
        </label>
        <label
          className={
            "flex cursor-pointer items-start gap-2.5 border px-3 py-2 text-sm transition-colors " +
            (urgent ? "border-red bg-red-soft" : "border-line hover:border-line-strong")
          }
        >
          <input
            type="checkbox"
            className={checkbox + " mt-0.5"}
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
          />
          <span>
            <span className="font-medium">Urgente</span>
            <span className="block text-xs text-muted">
              Linha parada esperando caixa. Vai pro topo da fila da DHL.
            </span>
          </span>
        </label>

        <ErrorBox message={error} />

        <button className={btn.primary + " w-full"} type="submit" disabled={!canSubmit}>
          {submitting ? "Enviando…" : urgent ? "Enviar pedido urgente à DHL" : "Enviar pedido à DHL"}
        </button>
      </form>
    </Section>
  );
}

function MyOrders({
  orders,
  loading,
  onChanged,
}: {
  orders: Order[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; msg: string } | null>(null);

  async function run(id: number, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    setRowError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setRowError({ id, msg: r.error ?? "Erro desconhecido" });
    onChanged();
  }

  return (
    <Section title="Pedidos" flush>
      {loading ? (
        <Empty>Carregando…</Empty>
      ) : orders.length === 0 ? (
        <Empty>Nenhum pedido ainda. O primeiro que você enviar aparece aqui.</Empty>
      ) : (
        <>
        <ul className="divide-y divide-line md:hidden">
          {orders.map((o) => {
            const action = nextAction(o.status);
            const units = o.order_items.reduce((s, i) => s + i.quantity, 0);
            return (
              <li key={o.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Link className="font-semibold hover:text-red" href={`/pedido/${o.id}`}>
                      {fmtOrderId(o.id)}
                    </Link>
                    {o.urgent && <UrgentBadge small />}
                    <CommentCount n={commentCount(o)} />
                  </span>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-0.5 text-sm text-ink-2">
                  {o.requested_by} · {o.order_items.length} {o.order_items.length === 1 ? "tipo" : "tipos"} ·{" "}
                  <span className="num">{units}</span> caixas
                </div>
                <div className="text-xs text-muted">
                  {fmtDate(o.created_at)}
                  {o.status === "em_transporte" && o.eta && (
                    <span className="ml-2 text-ink-2">· chega {fmtEta(o.eta)}</span>
                  )}
                </div>
                {(action?.actor === "lenovo" || canCancel(o.status)) && (
                  <div className="mt-2 flex gap-2">
                    {action?.actor === "lenovo" && (
                      <button
                        className={btn.primary + " flex-1"}
                        disabled={busy === o.id}
                        onClick={() => run(o.id, () => advanceOrder(o.id, "lenovo"))}
                      >
                        {action.label}
                      </button>
                    )}
                    {canCancel(o.status) && (
                      <button
                        className={btn.smallDanger + " px-3 py-1.5 text-sm"}
                        disabled={busy === o.id}
                        onClick={() => {
                          if (confirm(`Cancelar o pedido ${fmtOrderId(o.id)}?`))
                            void run(o.id, () => cancelOrder(o.id));
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
                {rowError?.id === o.id && (
                  <div className="mt-1 text-xs text-red">{rowError.msg}</div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Data</th>
                <th>Solicitante</th>
                <th>Itens</th>
                <th>Status</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const action = nextAction(o.status);
                const units = o.order_items.reduce((s, i) => s + i.quantity, 0);
                return (
                  <tr key={o.id}>
                    <td>
                      <span className="flex items-center gap-2">
                        <Link className="font-semibold hover:text-red" href={`/pedido/${o.id}`}>
                          {fmtOrderId(o.id)}
                        </Link>
                        {o.urgent && <UrgentBadge small />}
                        <CommentCount n={commentCount(o)} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-ink-2">{fmtDate(o.created_at)}</td>
                    <td>{o.requested_by}</td>
                    <td className="text-ink-2">
                      <span
                        title={o.order_items
                          .map((i) => `${i.quantity} × ${i.box_models?.machine_name ?? i.serial}`)
                          .join("\n")}
                      >
                        {o.order_items.length} {o.order_items.length === 1 ? "tipo" : "tipos"} ·{" "}
                        <span className="num">{units}</span> caixas
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                      {o.status === "em_transporte" && o.eta && (
                        <div className="text-xs text-muted">chega {fmtEta(o.eta)}</div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {action?.actor === "lenovo" && (
                          <button
                            className={btn.primary + " px-2.5 py-1 text-xs"}
                            disabled={busy === o.id}
                            onClick={() => run(o.id, () => advanceOrder(o.id, "lenovo"))}
                          >
                            {action.label}
                          </button>
                        )}
                        {canCancel(o.status) && (
                          <button
                            className={btn.smallDanger}
                            disabled={busy === o.id}
                            onClick={() => {
                              if (confirm(`Cancelar o pedido ${fmtOrderId(o.id)}?`))
                                void run(o.id, () => cancelOrder(o.id));
                            }}
                          >
                            Cancelar
                          </button>
                        )}
                      </div>
                      {rowError?.id === o.id && (
                        <div className="mt-1 text-right text-xs text-red">{rowError.msg}</div>
                      )}
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
