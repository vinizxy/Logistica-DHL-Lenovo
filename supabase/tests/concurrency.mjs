// Teste de concorrência pela API pública (o que não dá para simular dentro de uma
// transação SQL): N pedidos simultâneos brigando pelo mesmo estoque.
// Cria uma caixa de teste, dispara os pedidos em paralelo, confere que a reserva nunca
// passa do disponível, e limpa tudo pelas próprias funções do sistema.
//
// Uso:  node --dns-result-order=ipv4first supabase/tests/concurrency.mjs   (lê .env.local)
// (a flag evita timeout de conexão IPv6 em algumas redes Windows)

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim())),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// Falha de rede (antes de qualquer resposta) → tenta de novo; nunca repete uma chamada respondida.
async function fetchRetry(url, init, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await fetch(url, init); }
    catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 500 * i)); }
  }
}
async function rpc(fn, body) {
  const r = await fetchRetry(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}
async function select(table, query) {
  const r = await fetchRetry(`${URL_}/rest/v1/${table}?${query}`, { headers });
  return r.json();
}

let fails = 0;
const ok = (cond, label) => { console.log((cond ? "ok     " : "FALHOU ") + label); if (!cond) fails++; };

const STOCK = 50, N = 12, QTY = 7; // 12 × 7 = 84 pedidos para 50 caixas → só 7 cabem
const created = [];
try {
  const box = await rpc("create_box_model", { p_serial: null, p_machine_name: "Concorrência Teste", p_machine_model: "zz", p_stock_total: STOCK, p_min_stock: 0 });
  if (!box.ok) throw new Error("create_box_model: " + JSON.stringify(box.data));
  const serial = box.data;
  console.log(`caixa de teste ${serial}, estoque ${STOCK}; ${N} pedidos de ${QTY} em paralelo`);

  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      rpc("create_order", { p_requested_by: `Paralelo ${i + 1}`, p_notes: null, p_items: [{ serial, quantity: QTY }], p_urgent: false }),
    ),
  );
  const ms = Date.now() - t0;
  const okOnes = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  for (const r of okOnes) created.push(r.data);

  ok(okOnes.length === Math.floor(STOCK / QTY), `1 exatamente ${Math.floor(STOCK / QTY)} pedidos aceitos (aceitos: ${okOnes.length}, recusados: ${rejected.length}, ${ms} ms)`);
  ok(rejected.every((r) => r.status === 400 && /disponíveis/.test(r.data?.message ?? "")), "2 recusados com a mensagem de estoque, não erro interno");
  const [b] = await select("box_models", `serial=eq.${serial}&select=stock_total,stock_reserved,stock_available`);
  ok(b.stock_reserved === okOnes.length * QTY && b.stock_reserved <= b.stock_total, `3 reserva = ${b.stock_reserved} ≤ total ${b.stock_total} (nunca furou)`);

  // avanços simultâneos do mesmo pedido: só um deve passar por etapa
  const id = created[0];
  const adv = await Promise.all(Array.from({ length: 5 }, () => rpc("advance_order", { p_order_id: id, p_actor: "dhl", p_eta: null })));
  const advOk = adv.filter((r) => r.ok).length;
  const [o] = await select("orders", `id=eq.${id}&select=status`);
  // 5 cliques em paralelo no mesmo pedido: cada um pega o lock e avança a partir do estado atual,
  // então no máximo 3 passam (enviado→recebido→em_separacao→em_transporte) e nunca "pula" etapa.
  ok(advOk <= 3 && ["recebido", "em_separacao", "em_transporte"].includes(o.status), `4 avanços paralelos serializados (passaram ${advOk}, status final ${o.status})`);
  const ev = await select("order_events", `order_id=eq.${id}&select=from_status,to_status&order=id`);
  const chain = ev.every((e, i) => i === 0 || e.from_status === ev[i - 1].to_status);
  ok(chain, "5 histórico do pedido é uma cadeia contínua (sem etapa pulada ou repetida)");

  // cancelamentos simultâneos: a reserva só volta uma vez
  const id2 = created[1];
  const canc = await Promise.all(Array.from({ length: 5 }, () => rpc("cancel_order", { p_order_id: id2 })));
  const [b2] = await select("box_models", `serial=eq.${serial}&select=stock_reserved`);
  ok(canc.filter((r) => r.ok).length === 1 && b2.stock_reserved === (okOnes.length - 2) * QTY, // −1 despachado no teste 4, −1 cancelado aqui
      `6 cancelar 5× em paralelo libera a reserva uma vez só (reserva ${b2.stock_reserved})`);
} catch (e) {
  console.error("erro:", e.message, e.cause ?? "");
  fails++;
} finally {
  // limpeza pelas funções do sistema: leva cada pedido a um estado final e exclui
  for (const id of created) {
    const [o] = await select("orders", `id=eq.${id}&select=status`);
    if (!o) continue;
    if (o.status === "enviado" || o.status === "recebido") await rpc("cancel_order", { p_order_id: id });
    else if (o.status === "em_separacao") { await rpc("advance_order", { p_order_id: id, p_actor: "dhl", p_eta: null }); await rpc("advance_order", { p_order_id: id, p_actor: "lenovo", p_eta: null }); }
    else if (o.status === "em_transporte") await rpc("advance_order", { p_order_id: id, p_actor: "lenovo", p_eta: null });
    await rpc("delete_order", { p_order_id: id });
  }
  const boxes = await select("box_models", `machine_name=eq.${encodeURIComponent("Concorrência Teste")}&select=serial,stock_reserved`);
  for (const b of boxes) await rpc("update_box_model", { p_serial: b.serial, p_machine_name: "Concorrência Teste", p_machine_model: "zz", p_min_stock: 0, p_active: false });
  const left = await select("orders", `requested_by=like.Paralelo*&select=id`);
  ok(left.length === 0, `7 limpeza: nenhum pedido de teste sobrou (${left.length})`);
  console.log(boxes.length ? `caixa de teste ${boxes.map((b) => b.serial).join(", ")} descontinuada (o catálogo não tem exclusão; remova em /cadastro ou via SQL se quiser)` : "");
  console.log(`=== ${fails} falhas ===`);
  process.exit(fails ? 1 : 0);
}
