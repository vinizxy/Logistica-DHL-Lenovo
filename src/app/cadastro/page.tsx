"use client";

import { useMemo, useState } from "react";
import { createBoxModel, updateBoxModel } from "@/lib/actions";
import { fetchBoxes } from "@/lib/queries";
import type { BoxModel } from "@/lib/types";
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

export default function CadastroPage() {
  const { data, error, connection, refetch } = useLiveData(fetchBoxes);
  const boxes = useMemo(() => data ?? [], [data]);
  const active = boxes.filter((b) => b.active).length;
  const inactive = boxes.length - active;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cadastro de caixas</h1>
          <p className="text-sm text-muted">
            Catálogo de tipos de caixa — incluir modelo novo, ajustar mínimo, descontinuar
          </p>
        </div>
        {data && (
          <Stats
            items={[
              { value: active, label: "ativas" },
              { value: inactive, label: "descontinuadas" },
            ]}
          />
        )}
      </div>

      <ConnectionBanner connection={connection} />
      <ErrorBox message={error} />

      <NewBoxForm onCreated={refetch} />

      <Catalog boxes={boxes} loading={data === null} onChanged={refetch} />
    </>
  );
}

function NewBoxForm({ onCreated }: { onCreated: () => void }) {
  const [machineName, setMachineName] = useState("");
  const [machineModel, setMachineModel] = useState("");
  const [serial, setSerial] = useState("");
  const [stockTotal, setStockTotal] = useState("0");
  const [minStock, setMinStock] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<React.ReactNode>(null);

  const canSubmit = machineName.trim() && machineModel.trim() && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    const r = await createBoxModel({
      serial: serial.trim().toUpperCase(),
      machineName: machineName.trim(),
      machineModel: machineModel.trim(),
      stockTotal: Number.parseInt(stockTotal || "0", 10),
      minStock: Number.parseInt(minStock || "0", 10),
    });
    setBusy(false);
    if (r.ok) {
      setOk(
        <>
          {machineName.trim()} {machineModel.trim()} incluída no catálogo com o serial{" "}
          <span className="mono text-ink">{r.data}</span>.
        </>,
      );
      setMachineName("");
      setMachineModel("");
      setSerial("");
      setStockTotal("0");
      setMinStock("0");
      onCreated();
    } else {
      setErr(r.error);
    }
  }

  return (
    <Section title="Novo tipo de caixa">
      <form className="space-y-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_110px_110px]">
          <label className="block text-sm">
            <span className="text-ink-2">Máquina</span>
            <input
              className={input + " mt-1 w-full"}
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
              placeholder="Ex.: ThinkPad T16"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Modelo</span>
            <input
              className={input + " mt-1 w-full"}
              value={machineModel}
              onChange={(e) => setMachineModel(e.target.value)}
              placeholder="Ex.: Gen 3"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Serial (opcional)</span>
            <input
              className={input + " mono mt-1 w-full uppercase placeholder:normal-case"}
              value={serial}
              onChange={(e) => setSerial(e.target.value.toUpperCase())}
              placeholder="gerado se vazio"
              maxLength={10}
              pattern="[A-Za-z0-9]{10}"
              title="10 letras ou números"
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
        <ErrorBox message={err} onClose={() => setErr(null)} />
        <SuccessBox message={ok} onClose={() => setOk(null)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">
            O serial identifica o tipo de caixa (10 caracteres). Deixe em branco para gerar um automaticamente.
          </span>
          <button className={btn.primary} type="submit" disabled={!canSubmit}>
            {busy ? "Incluindo…" : "Incluir no catálogo"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function Catalog({
  boxes,
  loading,
  onChanged,
}: {
  boxes: BoxModel[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      {err && (
        <div className="p-4 pb-0">
          <ErrorBox message={err} onClose={() => setErr(null)} />
        </div>
      )}
      {loading ? (
        <Empty>Carregando…</Empty>
      ) : boxes.length === 0 ? (
        <Empty>Nenhuma caixa cadastrada. Inclua a primeira acima.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Serial</th>
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
              {boxes.map((b) =>
                editing === b.serial ? (
                  <EditRow
                    key={b.serial}
                    box={b}
                    busy={busy === b.serial}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => save(b, patch)}
                  />
                ) : (
                  <tr key={b.serial} className={b.active ? "" : "opacity-60"}>
                    <td className="mono">{b.serial}</td>
                    <td className="whitespace-nowrap font-medium">{b.machine_name}</td>
                    <td className="text-ink-2">{b.machine_model}</td>
                    <td className="num text-ink-2">{b.stock_total}</td>
                    <td className="num font-semibold">{b.stock_available}</td>
                    <td className="num text-muted">{b.min_stock}</td>
                    <td>
                      {b.active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-green" /> Ativa
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted" /> Descontinuada
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <button className={btn.small} type="button" onClick={() => setEditing(b.serial)}>
                          Editar
                        </button>
                        {b.active ? (
                          <button
                            className={btn.smallDanger}
                            type="button"
                            disabled={busy === b.serial}
                            onClick={() => {
                              if (confirm(`Descontinuar ${b.machine_name} ${b.machine_model}? A Lenovo deixa de poder pedir esta caixa.`))
                                void save(b, { active: false });
                            }}
                          >
                            Descontinuar
                          </button>
                        ) : (
                          <button
                            className={btn.small}
                            type="button"
                            disabled={busy === b.serial}
                            onClick={() => save(b, { active: true })}
                          >
                            Reativar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Section>
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
      <td>
        <input className={input + " w-44"} value={name} onChange={(e) => setName(e.target.value)} aria-label="Máquina" />
      </td>
      <td>
        <input className={input + " w-28"} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Modelo" />
      </td>
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
