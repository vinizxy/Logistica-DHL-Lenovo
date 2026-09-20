"use client";

import { ACTOR_LABEL, fmtDate, fmtEta, STATUS_FLOW, STATUS_LABEL, timeAgo } from "@/lib/format";
import type { Order, OrderEvent, OrderStatus } from "@/lib/types";

// Frase de situação por status: onde o pedido está e quem faz a próxima etapa.
const SITUATION: Record<OrderStatus, { now: string; next?: { label: string; who: "lenovo" | "dhl" } }> = {
  enviado: { now: "Enviado, aguardando a DHL receber", next: { label: "Recebido", who: "dhl" } },
  recebido: { now: "Recebido pela DHL", next: { label: "Em separação", who: "dhl" } },
  em_separacao: { now: "Em separação no armazém da DHL", next: { label: "Em transporte", who: "dhl" } },
  em_transporte: { now: "Em transporte para a Lenovo", next: { label: "Entregue", who: "lenovo" } },
  entregue: { now: "Entregue e confirmado pela Lenovo" },
  cancelado: { now: "Pedido cancelado" },
};

export function Timeline({ order, events }: { order: Order; events: OrderEvent[] }) {
  const cancelled = order.status === "cancelado";
  const done = order.status === "entregue";
  const moving = !cancelled && !done;
  // Se cancelado, o último status do fluxo principal é onde parou.
  const lastMain = cancelled
    ? (events.filter((e) => e.to_status !== "cancelado").at(-1)?.to_status ?? "enviado")
    : order.status;
  const reachedIdx = STATUS_FLOW.indexOf(lastMain);
  const when = (s: OrderStatus) => events.find((e) => e.to_status === s)?.created_at;
  const lastEvent = events.at(-1);
  const situation = SITUATION[order.status];
  const steps = STATUS_FLOW.length;

  // Nós ficam no centro de 5 colunas iguais: o trilho vai do centro da 1ª ao centro da última.
  const railInset = `${100 / steps / 2}%`;
  const progressPct = (reachedIdx / (steps - 1)) * 100;
  const segmentPct = 100 / (steps - 1);

  return (
    <div>
      {/* Situação atual */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={"text-base font-semibold " + (cancelled ? "text-muted" : "text-ink")}>
          {situation.now}
          {lastEvent && (
            <span className="ml-2 text-sm font-normal text-muted">{timeAgo(lastEvent.created_at)}</span>
          )}
        </p>
        {order.status === "em_transporte" ? (
          <p className="text-sm text-muted">
            Previsão de entrega:{" "}
            <span className={order.eta ? "font-semibold text-ink" : "text-ink-2"}>
              {order.eta ? fmtEta(order.eta) : "não informada"}
            </span>
          </p>
        ) : situation.next ? (
          <p className="text-sm text-muted">
            Próxima etapa: <span className="text-ink-2">{situation.next.label}</span>{" "}
            <span className="text-muted">({ACTOR_LABEL[situation.next.who]})</span>
          </p>
        ) : null}
      </div>

      {/* Desktop: horizontal */}
      <div className="relative mt-6 hidden sm:block">
        <div className="absolute top-[13px] h-0.5 bg-line-strong" style={{ left: railInset, right: railInset }} />
        <div
          className="tl-grow absolute top-[13px] h-0.5 origin-left bg-red"
          style={{ left: railInset, width: `calc((100% - 2 * ${railInset}) * ${progressPct / 100})` }}
        />
        {moving && reachedIdx < steps - 1 && (
          <div
            className="tl-march absolute top-[13px] h-0.5"
            style={{
              left: `calc(${railInset} + (100% - 2 * ${railInset}) * ${progressPct / 100})`,
              width: `calc((100% - 2 * ${railInset}) * ${segmentPct / 100})`,
            }}
          />
        )}
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}>
          {STATUS_FLOW.map((s, idx) => (
            <li key={s} className="flex flex-col items-center text-center">
              <Node idx={idx} reachedIdx={reachedIdx} cancelled={cancelled} done={done} />
              <div
                className={
                  "mt-2 text-xs " +
                  (idx === reachedIdx ? "font-semibold text-ink" : idx < reachedIdx ? "text-ink-2" : "text-muted")
                }
              >
                {STATUS_LABEL[s]}
                {cancelled && idx === reachedIdx && (
                  <span className="block font-semibold text-red">Cancelado aqui</span>
                )}
              </div>
              <Stamp iso={when(s)} eta={s === "entregue" && !done && !cancelled ? order.eta : null} />
            </li>
          ))}
        </ol>
      </div>

      {/* Celular: vertical */}
      <ol className="relative mt-5 sm:hidden">
        <div className="absolute top-3 bottom-3 left-[13px] w-0.5 bg-line-strong" />
        <div
          className="tl-grow-y absolute top-3 left-[13px] w-0.5 origin-top bg-red"
          style={{ height: `calc((100% - 1.5rem) * ${progressPct / 100})` }}
        />
        {STATUS_FLOW.map((s, idx) => (
          <li key={s} className="relative flex gap-3 pb-5 last:pb-0">
            <Node idx={idx} reachedIdx={reachedIdx} cancelled={cancelled} done={done} />
            <div className="min-w-0 pt-1">
              <div
                className={
                  "text-sm " +
                  (idx === reachedIdx ? "font-semibold text-ink" : idx < reachedIdx ? "text-ink-2" : "text-muted")
                }
              >
                {STATUS_LABEL[s]}
                {cancelled && idx === reachedIdx && (
                  <span className="ml-2 font-semibold text-red">Cancelado aqui</span>
                )}
              </div>
              <Stamp iso={when(s)} eta={s === "entregue" && !done && !cancelled ? order.eta : null} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Node({
  idx,
  reachedIdx,
  cancelled,
  done,
}: {
  idx: number;
  reachedIdx: number;
  cancelled: boolean;
  done: boolean;
}) {
  const isCurrent = idx === reachedIdx;
  const reached = idx <= reachedIdx;
  const complete = idx < reachedIdx || (done && reached);
  const stopped = cancelled && isCurrent;
  const pulsing = isCurrent && !done && !cancelled;

  const ring = stopped
    ? "border-line-strong bg-surface-3 text-muted"
    : reached
      ? "border-red bg-red text-white"
      : "border-line-strong bg-surface text-muted";

  return (
    <div
      className={
        "tl-pop relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold " +
        ring +
        (pulsing ? " tl-pulse" : "")
      }
      // O pulso só começa depois do trilho terminar de crescer (900ms).
      style={{ animationDelay: pulsing ? `${idx * 110}ms, ${900 + idx * 110}ms` : `${idx * 110}ms` }}
      aria-current={isCurrent ? "step" : undefined}
    >
      {stopped ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : complete ? (
        <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 6.5l2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        idx + 1
      )}
    </div>
  );
}

function Stamp({ iso, eta }: { iso?: string; eta?: string | null }) {
  if (iso) return <div className="mt-0.5 text-[11px] text-muted tabular-nums">{fmtDate(iso)}</div>;
  if (eta) return <div className="mt-0.5 text-[11px] text-ink-2 tabular-nums">previsto {fmtEta(eta)}</div>;
  return <div className="mt-0.5 text-[11px] text-transparent tabular-nums select-none">—</div>;
}
