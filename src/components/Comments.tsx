"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { addComment } from "@/lib/actions";
import { ACTOR_LABEL, fmtDate } from "@/lib/format";
import type { OrderComment } from "@/lib/types";
import { btn, ErrorBox, input, Section } from "@/components/ui";

/**
 * Conversa do pedido entre Lenovo e DHL. Lado e nome vêm do perfil logado
 * (o banco grava; a tela só mostra quem vai assinar).
 */
export function Comments({
  orderId,
  comments,
  onChanged,
}: {
  orderId: number;
  comments: OrderComment[];
  onChanged: () => void;
}) {
  const { profile, handleActionError } = useAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const r = await addComment(orderId, body.trim());
    setBusy(false);
    if (r.ok) {
      setBody("");
      onChanged();
    } else {
      setErr(r.error);
      handleActionError(r.error);
    }
  }

  return (
    <Section title={`Comentários${comments.length ? ` — ${comments.length}` : ""}`}>
      {comments.length === 0 ? (
        <p className="pb-3 text-sm text-muted">
          Nenhum comentário. Use este espaço para avisos sobre o pedido (faltas, ajustes,
          combinados) — fica registrado aqui, em vez de espalhado em mensagens.
        </p>
      ) : (
        <ol className="space-y-3 pb-3">
          {comments.map((c) => (
            <li key={c.id} className={"flex gap-3 " + (c.actor === "dhl" ? "flex-row-reverse" : "")}>
              <div
                className={
                  "max-w-[85%] border px-3 py-2 text-sm " +
                  (c.actor === "dhl" ? "border-line bg-surface-2" : "border-red/40 bg-red-soft/40")
                }
              >
                <div className="mb-0.5 flex items-baseline gap-2 text-xs">
                  <span className="font-semibold text-ink">{c.author}</span>
                  <span className="text-muted">{ACTOR_LABEL[c.actor]}</span>
                  <span className="ml-auto text-muted tabular-nums">{fmtDate(c.created_at)}</span>
                </div>
                <div className="whitespace-pre-wrap text-ink-2">{c.body}</div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form className="space-y-2 border-t border-line pt-3" onSubmit={submit}>
        <textarea
          className={input + " block w-full resize-y"}
          rows={2}
          placeholder="Escreva um aviso para o outro lado…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          required
        />
        <ErrorBox message={err} onClose={() => setErr(null)} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {profile ? (
              <>
                Assinando como <span className="text-ink-2">{profile.display_name}</span> ·{" "}
                {ACTOR_LABEL[profile.role]}
              </>
            ) : null}
          </span>
          <button className={btn.primary} type="submit" disabled={busy || !body.trim()}>
            {busy ? "Enviando…" : "Enviar comentário"}
          </button>
        </div>
      </form>
    </Section>
  );
}
