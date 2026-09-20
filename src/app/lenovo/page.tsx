"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { advanceOrder, cancelOrder, createOrder } from "@/lib/actions";
import { canCancel, fmtDate, fmtOrderId, nextAction } from "@/lib/format";
import { fetchLenovoData } from "@/lib/queries";
import type { BoxModel, Order } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import {
  btn,
  ConnectionBanner,
  ErrorBox,
  input,
  Section,
  StatusBadge,
  SuccessBox,
} from "@/components/ui";

type Cart = Record<string, number>; // serial → quantidade

const REQUESTER_KEY = "refurbish.requester";

export default function LenovoPage() {
  const { data, error, connection, refetch } = useLiveData(fetchLenovoData);
  const [cart, setCart] = useState<Cart>({});
  const [cartError, setCartError] = useState<string | null>(null);
  const [success, setSuccess] = useState<React.ReactNode>(null);

  const boxes = useMemo(() => data?.boxes ?? [], [data]);
  const boxBySerial = useMemo(() => new Map(boxes.map((b) => [b.serial, b])), [boxes]);

  function addToCart(box: BoxModel, qty: number) {
    setCartError(null);
    const current = cart[box.serial] ?? 0;
    const total = current + qty;
    if (total > box.stock_available) {
      setCartError(
        `${box.machine_name} ${box.machine_model}: só ${box.stock_available} disponíveis (você já tem ${current} no pedido).`,
      );
      return;
    }
    setCart({ ...cart, [box.serial]: total });
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
      <ConnectionBanner connection={connection} />
      <ErrorBox message={error} />
      <SuccessBox message={success} onClose={() => setSuccess(null)} />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <StockTable boxes={boxes} cart={cart} onAdd={addToCart} loading={data === null} />
        <CartPanel
          cart={cart}
          boxBySerial={boxBySerial}
          error={cartError}
          onQty={setQty}
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

      <MyOrders orders={data?.orders ?? []} loading={data === null} onChanged={refetch} />
    </>
  );
}

function StockTable({
  boxes,
  cart,
  onAdd,
  loading,
}: {
  boxes: BoxModel[];
  cart: Cart;
  onAdd: (box: BoxModel, qty: number) => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

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
      title="Estoque de caixas (DHL)"
      right={
        <input
          className={input + " w-56"}
          placeholder="Buscar serial ou máquina…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
    >
      {loading ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma caixa encontrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Máquina</th>
                <th>Modelo</th>
                <th className="num">Disponível</th>
                <th className="num">No pedido</th>
                <th>Pedir</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const inCart = cart[b.serial] ?? 0;
                const remaining = b.stock_available - inCart;
                const disabled = remaining <= 0;
                const value = qty[b.serial] ?? "";
                const parsed = Number.parseInt(value, 10);
                return (
                  <tr key={b.serial} className={disabled ? "text-gray-400" : ""}>
                    <td className="mono">{b.serial}</td>
                    <td>{b.machine_name}</td>
                    <td>{b.machine_model}</td>
                    <td className="num">
                      {b.stock_available}
                      {b.stock_available === 0 && (
                        <span className="ml-1 text-xs text-red-600">esgotado</span>
                      )}
                    </td>
                    <td className="num">{inCart || ""}</td>
                    <td>
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
                          onAdd(b, n);
                          setQty({ ...qty, [b.serial]: "" });
                        }}
                      >
                        <input
                          className={input + " w-16 num"}
                          type="number"
                          min={1}
                          max={remaining}
                          placeholder="1"
                          disabled={disabled}
                          value={value}
                          onChange={(e) => setQty({ ...qty, [b.serial]: e.target.value })}
                        />
                        <button className={btn.small} type="submit" disabled={disabled}>
                          + adicionar
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

function CartPanel({
  cart,
  boxBySerial,
  error,
  onQty,
  onClear,
  onSubmitted,
  onError,
}: {
  cart: Cart;
  boxBySerial: Map<string, BoxModel>;
  error: string | null;
  onQty: (serial: string, qty: number) => void;
  onClear: () => void;
  onSubmitted: (orderId: number) => void;
  onError: (msg: string) => void;
}) {
  const [requester, setRequester] = useState("");
  const [notes, setNotes] = useState("");
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
    );
    setSubmitting(false);
    if (result.ok) {
      setNotes("");
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
          <button className="text-xs text-gray-500 hover:underline" onClick={onClear} type="button">
            limpar
          </button>
        ) : undefined
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-500">
            Adicione caixas pela tabela ao lado. Um pedido pode ter vários tipos de caixa.
          </p>
        ) : (
          <table>
            <tbody>
              {entries.map(([serial, q]) => {
                const b = boxBySerial.get(serial);
                return (
                  <tr key={serial}>
                    <td>
                      <div className="font-medium">
                        {b ? `${b.machine_name} ${b.machine_model}` : serial}
                      </div>
                      <div className="mono text-xs text-gray-500">{serial}</div>
                    </td>
                    <td className="num w-20">
                      <input
                        className={input + " w-16 num"}
                        type="number"
                        min={0}
                        max={b?.stock_available}
                        value={q}
                        onChange={(e) => onQty(serial, Number.parseInt(e.target.value || "0", 10))}
                      />
                    </td>
                    <td className="w-8 text-right">
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => onQty(serial, 0)}
                      >
                        remover
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="text-xs text-gray-500">
                  {entries.length} {entries.length === 1 ? "tipo" : "tipos"} · {totalUnits} caixas
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}

        <label className="block text-sm">
          <span className="text-gray-600">Solicitante *</span>
          <input
            className={input + " mt-1 w-full"}
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
            placeholder="Seu nome"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">Observação</span>
          <input
            className={input + " mt-1 w-full"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional — ex.: lote da semana 38"
          />
        </label>

        <ErrorBox message={error} />

        <button className={btn.primary + " w-full"} type="submit" disabled={!canSubmit}>
          {submitting ? "Enviando…" : "Enviar pedido à DHL"}
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
    <Section title="Pedidos">
      {loading ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhum pedido ainda.</p>
      ) : (
        <div className="overflow-x-auto">
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
                      <Link className="font-medium underline" href={`/pedido/${o.id}`}>
                        {fmtOrderId(o.id)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(o.created_at)}</td>
                    <td>{o.requested_by}</td>
                    <td>
                      <span title={o.order_items
                        .map((i) => `${i.quantity} × ${i.box_models?.machine_name ?? i.serial}`)
                        .join("\n")}>
                        {o.order_items.length} {o.order_items.length === 1 ? "tipo" : "tipos"} · {units} caixas
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {action?.actor === "lenovo" && (
                          <button
                            className={btn.small}
                            disabled={busy === o.id}
                            onClick={() => run(o.id, () => advanceOrder(o.id, "lenovo"))}
                          >
                            {action.label}
                          </button>
                        )}
                        {canCancel(o.status) && (
                          <button
                            className={btn.small + " text-red-700"}
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
                        <div className="mt-1 text-right text-xs text-red-700">{rowError.msg}</div>
                      )}
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
