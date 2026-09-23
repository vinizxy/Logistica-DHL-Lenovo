// Regras de tela do catálogo (caixas e cushions): nomes, busca por máquina, ordenação e
// resumo de quantidades. Sem React; as telas e os componentes de catalog.tsx usam daqui.
import type { BoxModel, CushionFit, ItemKind } from "./types";

export type KindFilter = "tudo" | ItemKind;

export const KIND_LABEL: Record<ItemKind, { one: string; many: string; tab: string }> = {
  caixa: { one: "caixa", many: "caixas", tab: "Caixas" },
  cushion: { one: "cushion", many: "cushions", tab: "Cushions" },
};

type Named = Pick<BoxModel, "machine_name" | "machine_model">;

export function itemName(b: Named): string {
  return `${b.machine_name} ${b.machine_model}`;
}

/** cushion serial → seriais das caixas (máquinas) em que ele serve. */
export function buildFitsIndex(fits: CushionFit[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const f of fits) {
    const list = idx.get(f.cushion_serial);
    if (list) list.push(f.box_serial);
    else idx.set(f.cushion_serial, [f.box_serial]);
  }
  return idx;
}

/**
 * Casa um item com a busca. Caixa: serial, máquina ou modelo. Cushion: o mesmo, e também
 * o nome das máquinas em que serve; `hits` diz quais máquinas casaram, para a tela mostrar
 * por que o cushion apareceu.
 */
export function matchItem(
  item: BoxModel,
  query: string,
  fitsOf: Map<string, string[]>,
  bySerial: Map<string, BoxModel>,
): { match: boolean; hits: Set<string> } {
  const hits = new Set<string>();
  const q = query.trim().toLowerCase();
  if (!q) return { match: true, hits };
  const own =
    item.serial.toLowerCase().includes(q) ||
    item.machine_name.toLowerCase().includes(q) ||
    item.machine_model.toLowerCase().includes(q) ||
    itemName(item).toLowerCase().includes(q);
  if (item.kind === "cushion") {
    for (const s of fitsOf.get(item.serial) ?? []) {
      const m = bySerial.get(s);
      if (m && (itemName(m).toLowerCase().includes(q) || s.toLowerCase().includes(q))) hits.add(s);
    }
  }
  return { match: own || hits.size > 0, hits };
}

/** Caixas antes de cushions; dentro de cada tipo, por nome e modelo. */
export function sortCatalog<T extends BoxModel>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "caixa" ? -1 : 1) ||
      a.machine_name.localeCompare(b.machine_name, "pt-BR") ||
      a.machine_model.localeCompare(b.machine_model, "pt-BR"),
  );
}

export function countByKind(items: { kind: ItemKind }[]): Record<KindFilter, number> {
  const caixa = items.filter((i) => i.kind === "caixa").length;
  return { tudo: items.length, caixa, cushion: items.length - caixa };
}

/** "3 caixas e 20 cushions", "1 caixa", "5 cushions"; vazio quando não há nada. */
export function unitsSummary(lines: { kind: ItemKind; quantity: number }[]): string {
  const total = (k: ItemKind) => lines.filter((l) => l.kind === k).reduce((s, l) => s + l.quantity, 0);
  const parts = (["caixa", "cushion"] as const)
    .map((k) => ({ k, n: total(k) }))
    .filter((p) => p.n > 0)
    .map((p) => `${p.n} ${p.n === 1 ? KIND_LABEL[p.k].one : KIND_LABEL[p.k].many}`);
  return parts.join(" e ");
}

/** Linhas de um pedido com o tipo de cada item (item fora do catálogo conta como caixa). */
export function orderLines(items: { quantity: number; box_models: { kind: ItemKind } | null }[]) {
  return items.map((i) => ({ kind: i.box_models?.kind ?? ("caixa" as ItemKind), quantity: i.quantity }));
}
