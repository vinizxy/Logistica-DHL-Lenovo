"use client";

import { useEffect, useState } from "react";
import { addComment } from "@/lib/actions";
import { ACTOR_LABEL, fmtDate } from "@/lib/format";
import type { Actor, OrderComment } from "@/lib/types";
import { btn, ErrorBox, input, Section } from "@/components/ui";

const AUTHOR_KEY = "refurbish.commentAuthor";
const ACTOR_KEY = "refurbish.commentActor";

/**
 * Conversa do pedido entre Lenovo e DHL. Sem login, quem escreve escolhe o lado
 * e assina com o nome; o navegador lembra a escolha.
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
  const [actor, setActor] = useState<Actor>("lenovo");
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let a = "";
    let side: Actor | null = null;
    try {
      a = localStorage.getItem(AUTHOR_KEY) ?? "";
      const s = localStorage.getItem(ACTOR_KEY);
      if (s === "lenovo" || s === "dhl") side = s;
    } catch {}
    void Promise.resolve().then(() => {
      if (a) setAuthor(a);
      if (side) setActor(side);
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!author.trim() || !body.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      localStorage.setItem(AUTHOR_KEY, author.trim());
      localStorage.setItem(ACTOR_KEY, actor);
    } catch {}
    const r = await addComment(orderId, actor, author.trim(), body.trim());
    setBusy(false);
    if (r.ok) {
      setBody("");
      onChanged();
    } else {
      setErr(r.error);
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex" role="radiogroup" aria-label="Quem está escrevendo">
            {(["lenovo", "dhl"] as Actor[]).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={actor === a}
                onClick={() => setActor(a)}
                className={
                  "border px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-sm last:rounded-r-sm " +
                  (actor === a
                    ? "border-red bg-red text-white"
                    : "border-line-strong text-ink-2 hover:text-ink")
                }
              >
                {ACTOR_LABEL[a]}
              </button>
            ))}
          </div>
          <input
            className={input + " min-w-0 flex-1"}
            placeholder="Seu nome"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            required
          />
        </div>
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
        <div className="flex justify-end">
          <button className={btn.primary} type="submit" disabled={busy || !author.trim() || !body.trim()}>
            {busy ? "Enviando…" : "Enviar comentário"}
          </button>
        </div>
      </form>
    </Section>
  );
}

