"use client";

import { useMemo, useState } from "react";
import { FitsLine, KindTabs, KindTag, MachinePicker } from "@/components/catalog";
import { createBoxModel, createCushion, setCushionFits, updateBoxModel } from "@/lib/actions";
import { buildFitsIndex, countByKind, itemName, sortCatalog, type KindFilter } from "@/lib/catalog";
import { fetchCatalog } from "@/lib/queries";
import type { BoxModel, ItemKind } from "@/lib/types";
import { useLiveData } from "@/lib/useLiveData";
import {
  btn,
  ConnectionBanner,
  Empty,
  ErrorBox,
  input,
  Section,
  Stats,
  SuccessBox,
} from "@/components/ui";

// "Ativa"/"Ativo": caixa é feminino, cushion masculino.
const STATE_LABEL: Record<ItemKind, { on: string; off: string }> = {
  caixa: { on: "Ativa", off: "Descontinuada" },
  cushion: { on: "Ativo", off: "Descontinuado" },
};

export default function CadastroPage() {
  const { data, error, connection, refetch } = useLiveData(fetchCatalog);
  const boxes = useMemo(() => sortCatalog(data?.boxes ?? []), [data]);
  const bySerial = useMemo(() => new Map(boxes.map((b) => [b.serial, b])), [boxes]);
  const fitsOf = useMemo(() => buildFitsIndex(data?.fits ?? []), [data]);
  // Cada máquina entra no catálogo pela caixa dela; é essa a lista de máquinas do cushion.
  const machines = useMemo(() => boxes.filter((b) => b.kind === "caixa"), [boxes]);

  const activeBoxes = boxes.filter((b) => b.active && b.kind === "caixa").length;
  const activeCushions = boxes.filter((b) => b.active && b.kind === "cushion").length;
  const inactive = boxes.filter((b) => !b.active).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cadastro de materiais</h1>
          <p className="text-sm text-muted">
            Catálogo de caixas e cushions — incluir item novo, ajustar mínimo, descontinuar
          </p>
        </div>
        {data && (
          <Stats
            items={[
              { value: activeBoxes, label: "caixas" },
              { value: activeCushions, label: "cushions" },
              { value: inactive, label: "descontinuados" },
            ]}
          />
        )}
      </div>

      <ConnectionBanner connection={connection} />
      <ErrorBox message={error} />

      <NewItemForm machines={machines} onCreated={refetch} />

      <Catalog
        boxes={boxes}
        fitsOf={fitsOf}
        bySerial={bySerial}
        machines={machines}
        loading={data === null}
        onChanged={refetch}
      />
    </>
  );
}

function NewItemForm({ machines, onCreated }: { machines: BoxModel[]; onCreated: () => void }) {
  const [kind, setKind] = useState<ItemKind>("caixa");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [stockTotal, setStockTotal] = useState("0");
  const [minStock, setMinStock] = useState("0");
  const [fits, setFits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<React.ReactNode>(null);

  const isCushion = kind === "cushion";
  // Cushion é identificado só pelo serial (obrigatório); caixa pelo nome e modelo da máquina.
  const serialOk = /^[A-Za-z0-9]{10}$/.test(serial.trim());
  const canSubmit = (isCushion ? serialOk && fits.length > 0 : name.trim() && model.trim()) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    const base = {
      serial: serial.trim().toUpperCase(),
      stockTotal: Number.parseInt(stockTotal || "0", 10),
      minStock: Number.parseInt(minStock || "0", 10),
    };
    const r = isCushion
      ? await createCushion({ ...base, machines: fits })
      : await createBoxModel({ ...base, machineName: name.trim(), machineModel: model.trim() });
    setBusy(false);
    if (r.ok) {
      setOk(
        isCushion ? (
          <>
            Cushion <span className="mono text-ink">{r.data}</span> incluído no catálogo, servindo em {fits.length}{" "}
            {fits.length === 1 ? "máquina" : "máquinas"}.
          </>
        ) : (
          <>
            Caixa {name.trim()} {model.trim()} incluída no catálogo com o serial{" "}
            <span className="mono text-ink">{r.data}</span>.
          </>
        ),
      );
      setName("");
      setModel("");
      setSerial("");
      setStockTotal("0");
      setMinStock("0");
      setFits([]);
      onCreated();
    } else {
      setErr(r.error);
    }
  }

  return (
    <Section title="Novo item no catálogo">
      <form className="space-y-3" onSubmit={submit}>
        <div className="inline-flex border border-line-strong" role="group" aria-label="Tipo do item">
          {(["caixa", "cushion"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={
                "flex items-center px-3 py-1.5 text-sm transition-colors " +
                (kind === k ? "bg-surface-3 text-ink" : "text-muted hover:text-ink-2")
              }
            >
              <KindTag kind={k} />
            </button>
          ))}
        </div>

        <div
          className={
            "grid gap-3 sm:grid-cols-2 " +
            (isCushion ? "lg:grid-cols-[200px_110px_110px]" : "lg:grid-cols-[1fr_1fr_160px_110px_110px]")
          }
        >
          {!isCushion && (
            <>
              <label className="block text-sm">
                <span className="text-ink-2">Máquina</span>
                <input
                  className={input + " mt-1 w-full"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: ThinkPad T16"
                  maxLength={80}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-2">Modelo</span>
                <input
                  className={input + " mt-1 w-full"}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Ex.: Gen 3"
                  maxLength={80}
                  required
                />
              </label>
            </>
          )}
          <label className="block text-sm">
            <span className="text-ink-2">{isCushion ? "Serial do cushion" : "Serial (opcional)"}</span>
            <input
              className={input + " mono mt-1 w-full uppercase placeholder:normal-case"}
              value={serial}
              onChange={(e) => setSerial(e.target.value.toUpperCase())}
              placeholder={isCushion ? "10 letras ou números" : "gerado se vazio"}
              maxLength={10}
              pattern="[A-Za-z0-9]{10}"
              title="10 letras ou números"
              required={isCushion}
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Estoque inicial</span>
            <input
              className={input + " mt-1 w-full num"}
              type="number"
              min={0}
              value={stockTotal}
              onChange={(e) => setStockTotal(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Mínimo</span>
            <input
              className={input + " mt-1 w-full num"}
              type="number"
              min={0}
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
            />
          </label>
        </div>

        {isCushion && (
          <div className="text-sm">
            <div className="mb-1 text-ink-2">Serve nas máquinas</div>
            <MachinePicker machines={machines} value={fits} onChange={setFits} />
          </div>
        )}

        <ErrorBox message={err} onClose={() => setErr(null)} />
        <SuccessBox message={ok} onClose={() => setOk(null)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {isCushion
              ? "O cushion é identificado só pelo serial. Marque todas as máquinas em que ele serve: a Lenovo acha o cushion buscando pela máquina."
              : "O serial identifica o tipo de caixa (10 caracteres). Deixe em branco para gerar um automaticamente."}
          </span>
          <button className={btn.primary} type="submit" disabled={!canSubmit}>
            {busy ? "Incluindo…" : isCushion ? "Incluir cushion" : "Incluir caixa"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function Catalog({
  boxes,
  fitsOf,
  bySerial,
  machines,
  loading,
  onChanged,
}: {
  boxes: BoxModel[];
  fitsOf: Map<string, string[]>;
  bySerial: Map<string, BoxModel>;
  machines: BoxModel[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<KindFilter>("tudo");
  const [editing, setEditing] = useState<string | null>(null);
  const [editingFits, setEditingFits] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const counts = useMemo(() => countByKind(boxes), [boxes]);
  const visible = kind === "tudo" ? boxes : boxes.filter((b) => b.kind === kind);
  const machinesOf = (serial: string) =>
    (fitsOf.get(serial) ?? []).map((s) => bySerial.get(s)).filter((m): m is BoxModel => !!m);

  async function save(b: BoxModel, patch: Partial<Pick<BoxModel, "machine_name" | "machine_model" | "min_stock" | "active">>) {
    setBusy(b.serial);
    setErr(null);
    const r = await updateBoxModel({
      serial: b.serial,
      machineName: patch.machine_name ?? b.machine_name,
      machineModel: patch.machine_model ?? b.machine_model,
      minStock: patch.min_stock ?? b.min_stock,
      active: patch.active ?? b.active,
    });
    setBusy(null);
    if (r.ok) setEditing(null);
    else setErr(r.error);
    onChanged();
  }

  return (
    <Section title="Catálogo" flush>
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
      ) : visible.length === 0 ? (
        <Empty>
          {kind === "cushion"
            ? "Nenhum cushion cadastrado. Escolha Cushion no formulário acima para incluir o primeiro."
            : "Nenhum item cadastrado. Inclua o primeiro acima."}
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Tipo</th>
                <th>Máquina</th>
                <th>Modelo</th>
                <th className="num">Total</th>
                <th className="num">Disponível</th>
                <th className="num">Mínimo</th>
                <th>Situação</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) =>
                editing === b.serial ? (
                  <EditRow
                    key={b.serial}
                    box={b}
                    busy={busy === b.serial}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => save(b, patch)}
                  />
                ) : (
                  <CatalogRow
                    key={b.serial}
                    box={b}
                    fits={machinesOf(b.serial)}
                    busy={busy === b.serial}
                    fitsOpen={editingFits === b.serial}
                    onEdit={() => {
                      setEditingFits(null);
                      setEditing(b.serial);
                    }}
                    onToggleFits={() => setEditingFits(editingFits === b.serial ? null : b.serial)}
                    onActive={(active) => save(b, { active })}
                    fitsEditor={
                      <FitsEditor
                        cushion={b}
                        initial={fitsOf.get(b.serial) ?? []}
                        machines={machines}
                        onDone={(saved) => {
                          setEditingFits(null);
                          if (saved) onChanged();
                        }}
                      />
                    }
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function CatalogRow({
  box: b,
  fits,
  busy,
  fitsOpen,
  onEdit,
  onToggleFits,
  onActive,
  fitsEditor,
}: {
  box: BoxModel;
  fits: BoxModel[];
  busy: boolean;
  fitsOpen: boolean;
  onEdit: () => void;
  onToggleFits: () => void;
  onActive: (active: boolean) => void;
  fitsEditor: React.ReactNode;
}) {
  const state = STATE_LABEL[b.kind];
  return (
    <>
      <tr className={b.active ? "" : "opacity-60"}>
        <td className="mono">{b.serial}</td>
        <td><KindTag kind={b.kind} /></td>
        {b.kind === "cushion" ? (
          <>
            <td><FitsLine machines={fits} hits={new Set()} /></td>
            <td className="text-muted">—</td>
          </>
        ) : (
          <>
            <td className="whitespace-nowrap font-medium">{b.machine_name}</td>
            <td className="text-ink-2">{b.machine_model}</td>
          </>
        )}
        <td className="num text-ink-2">{b.stock_total}</td>
        <td className="num font-semibold">{b.stock_available}</td>
        <td className="num text-muted">{b.min_stock}</td>
        <td>
          {b.active ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-green" /> {state.on}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-muted" /> {state.off}
            </span>
          )}
        </td>
        <td>
          <div className="flex justify-end gap-2">
            <button className={btn.small} type="button" onClick={onEdit}>
              Editar
            </button>
            {b.kind === "cushion" && (
              <button className={btn.small} type="button" aria-expanded={fitsOpen} onClick={onToggleFits}>
                Máquinas
              </button>
            )}
            {b.active ? (
              <button
                className={btn.smallDanger}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Descontinuar ${itemName(b)}? A Lenovo deixa de poder pedir este item.`)) onActive(false);
                }}
              >
                Descontinuar
              </button>
            ) : (
              <button className={btn.small} type="button" disabled={busy} onClick={() => onActive(true)}>
                Reativar
              </button>
            )}
          </div>
        </td>
      </tr>
      {fitsOpen && (
        <tr className="bg-surface-2">
          <td colSpan={9}>{fitsEditor}</td>
        </tr>
      )}
    </>
  );
}

function FitsEditor({
  cushion,
  initial,
  machines,
  onDone,
}: {
  cushion: BoxModel;
  initial: string[];
  machines: BoxModel[];
  onDone: (saved: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const r = await setCushionFits(cushion.serial, value);
    setBusy(false);
    if (r.ok) onDone(true);
    else setErr(r.error);
  }

  return (
    <div className="max-w-2xl space-y-2 py-1">
      <div className="text-sm text-ink-2">
        Máquinas em que <span className="font-medium text-ink">{itemName(cushion)}</span> serve
      </div>
      <MachinePicker machines={machines} value={value} onChange={setValue} />
      <ErrorBox message={err} onClose={() => setErr(null)} />
      <div className="flex gap-2">
        <button className={btn.primary + " px-2.5 py-1 text-xs"} type="button" disabled={busy || value.length === 0} onClick={() => void save()}>
          {busy ? "Salvando…" : "Salvar máquinas"}
        </button>
        <button className={btn.small} type="button" disabled={busy} onClick={() => onDone(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function EditRow({
  box: b,
  busy,
  onCancel,
  onSave,
}: {
  box: BoxModel;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { machine_name: string; machine_model: string; min_stock: number }) => void;
}) {
  const [name, setName] = useState(b.machine_name);
  const [model, setModel] = useState(b.machine_model);
  const [min, setMin] = useState(String(b.min_stock));

  return (
    <tr className="bg-surface-2">
      <td className="mono">{b.serial}</td>
      <td><KindTag kind={b.kind} /></td>
      {b.kind === "cushion" ? (
        <td colSpan={2} className="text-xs text-muted">
          Cushion é identificado pelo serial; para mudar as máquinas, use o botão Máquinas.
        </td>
      ) : (
        <>
          <td>
            <input className={input + " w-44"} value={name} onChange={(e) => setName(e.target.value)} aria-label="Máquina" />
          </td>
          <td>
            <input className={input + " w-28"} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Modelo" />
          </td>
        </>
      )}
      <td className="num text-ink-2">{b.stock_total}</td>
      <td className="num font-semibold">{b.stock_available}</td>
      <td className="num">
        <input
          className={input + " w-16 num"}
          type="number"
          min={0}
          value={min}
          onChange={(e) => setMin(e.target.value)}
          aria-label="Mínimo"
        />
      </td>
      <td className="text-xs text-muted">editando</td>
      <td>
        <div className="flex justify-end gap-2">
          <button
            className={btn.primary + " px-2.5 py-1 text-xs"}
            type="button"
            disabled={busy || !name.trim() || !model.trim()}
            onClick={() =>
              onSave({
                machine_name: name.trim(),
                machine_model: model.trim(),
                min_stock: Number.parseInt(min || "0", 10),
              })
            }
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
          <button className={btn.small} type="button" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}
