"use client";

import { useMemo, useState } from "react";
import { itemName, KIND_LABEL, type KindFilter } from "@/lib/catalog";
import type { BoxModel, ItemKind } from "@/lib/types";
import { checkbox, input } from "@/components/ui";

/**
 * Tipo do item: símbolo + nome, no padrão do StatusBadge. Caixa é um quadrado vazado,
 * cushion um bloco macio e arredondado; a forma distingue mesmo sem cor.
 */
export function KindTag({ kind, small }: { kind: ItemKind; small?: boolean }) {
  const size = small ? 9 : 10;
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium " +
        (small ? "text-[11px] " : "text-xs ") +
        (kind === "cushion" ? "text-sky" : "text-ink-2")
      }
    >
      <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden>
        {kind === "cushion" ? (
          <rect x="0.5" y="1.5" width="9" height="7" rx="3.5" fill="currentColor" opacity="0.85" />
        ) : (
          <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
      </svg>
      {kind === "cushion" ? "Cushion" : "Caixa"}
    </span>
  );
}

const TABS: { key: KindFilter; label: string }[] = [
  { key: "tudo", label: "Tudo" },
  { key: "caixa", label: KIND_LABEL.caixa.tab },
  { key: "cushion", label: KIND_LABEL.cushion.tab },
];

/** Filtro por tipo, no mesmo desenho das abas da fila da DHL. */
export function KindTabs({
  value,
  onChange,
  counts,
}: {
  value: KindFilter;
  onChange: (k: KindFilter) => void;
  counts: Record<KindFilter, number>;
}) {
  return (
    <div className="flex gap-1" role="tablist" aria-label="Filtrar por tipo">
      {TABS.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={
              "relative px-2 pb-1.5 pt-1 text-xs font-medium transition-colors " +
              (active ? "text-ink" : "text-muted hover:text-ink-2")
            }
          >
            {t.label}
            <span className="num ml-1 text-muted">{counts[t.key]}</span>
            {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-red" />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Serve em …" sob um cushion. Máquinas que casaram com a busca vêm primeiro e em
 * destaque: é o que explica por que o cushion apareceu. Sem busca, mostra até 3.
 */
export function FitsLine({ machines, hits }: { machines: BoxModel[]; hits: Set<string> }) {
  if (machines.length === 0) {
    return <div className="text-xs text-amber">Sem máquina cadastrada</div>;
  }
  const ordered = [...machines].sort(
    (a, b) => Number(hits.has(b.serial)) - Number(hits.has(a.serial)) || itemName(a).localeCompare(itemName(b), "pt-BR"),
  );
  const limit = hits.size > 0 ? Math.max(hits.size, 3) : 3;
  const shown = ordered.slice(0, limit);
  const rest = ordered.length - shown.length;
  return (
    <div className="text-xs text-muted" title={ordered.map(itemName).join("\n")}>
      Serve em{" "}
      {shown.map((m, i) => (
        <span key={m.serial}>
          {i > 0 && (i === shown.length - 1 && rest === 0 ? " e " : ", ")}
          <span className={hits.has(m.serial) ? "font-medium text-ink" : "text-ink-2"}>{itemName(m)}</span>
        </span>
      ))}
      {rest > 0 && <> e mais {rest}</>}
    </div>
  );
}

/**
 * Lista de máquinas (caixas do catálogo) com busca e caixa de seleção. As marcadas
 * sobem para o topo, para a pessoa conferir o que já escolheu.
 */
export function MachinePicker({
  machines,
  value,
  onChange,
}: {
  machines: BoxModel[];
  value: string[];
  onChange: (serials: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return machines
      .filter((m) => !q || itemName(m).toLowerCase().includes(q) || m.serial.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(selected.has(b.serial)) - Number(selected.has(a.serial)) ||
          itemName(a).localeCompare(itemName(b), "pt-BR"),
      );
  }, [machines, search, selected]);

  function toggle(serial: string) {
    onChange(selected.has(serial) ? value.filter((s) => s !== serial) : [...value, serial]);
  }

  return (
    <div className="border border-line-strong bg-bg">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <input
          className={input + " min-w-0 flex-1 py-1"}
          placeholder="Buscar máquina"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar máquina"
        />
        <span className="shrink-0 text-xs text-muted" aria-live="polite">
          <span className="num font-medium text-ink-2">{value.length}</span>{" "}
          {value.length === 1 ? "marcada" : "marcadas"}
        </span>
        {value.length > 0 && (
          <button type="button" className="shrink-0 text-xs text-muted hover:text-ink" onClick={() => onChange([])}>
            Limpar
          </button>
        )}
      </div>
      <ul className="max-h-56 overflow-y-auto py-1" aria-label="Máquinas em que o cushion serve">
        {list.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted">
            {machines.length === 0 ? "Cadastre uma caixa primeiro: cada máquina entra no catálogo pela caixa dela." : `Nenhuma máquina encontrada para “${search}”.`}
          </li>
        ) : (
          list.map((m) => (
            <li key={m.serial}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-surface-2">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={selected.has(m.serial)}
                  onChange={() => toggle(m.serial)}
                  aria-label={itemName(m)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {m.machine_name} <span className="text-ink-2">{m.machine_model}</span>
                  {!m.active && <span className="ml-1.5 text-xs text-muted">descontinuada</span>}
                </span>
                <span className="mono shrink-0 text-xs">{m.serial}</span>
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
