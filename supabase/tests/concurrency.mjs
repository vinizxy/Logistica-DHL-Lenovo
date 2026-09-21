// Testes pela API pública, com login (o que não dá para simular numa transação SQL):
//   A) acesso: sem sessão nada lê nem escreve; cada perfil só faz o que é dele
//   B) concorrência: N pedidos simultâneos brigando pelo mesmo estoque; cliques paralelos
// Cria uma caixa de teste (como DHL), pedidos (como Lenovo) e limpa pelas funções do sistema.
// Nada é apagado: os pedidos de teste ficam encerrados e ocultos da Lenovo
// (requested_by 'Paralelo N'); o reset_demo.sql limpa de vez.
//
// Uso:  node --dns-result-order=ipv4first supabase/tests/concurrency.mjs   (lê .env.local)

import { login, rpc, select } from "./_api.mjs";

let fails = 0;
const ok = (cond, label) => { console.log((cond ? "ok     " : "FALHOU ") + label); if (!cond) fails++; };

const STOCK = 50, N = 12, QTY = 7; // 12 × 7 = 84 pedidos para 50 caixas → só 7 cabem
const created = [];
let dhl, lenovo, serial;
try {
  dhl = await login("dhl");
  lenovo = await login("lenovo");

  // A. acesso -------------------------------------------------------------------------
  let r = await select(null, "orders", "select=id&limit=1");
  ok(!r.ok || (Array.isArray(r.data) && r.data.length === 0), `A1 sem sessão não lê pedidos (${r.status})`);
  r = await select(null, "box_models", "select=serial&limit=1");
  ok(!r.ok || (Array.isArray(r.data) && r.data.length === 0), `A2 sem sessão não lê estoque (${r.status})`);
  r = await rpc(null, "restock", { p_serial: "E5A8N99V99", p_quantity: 1 });
  ok(!r.ok, `A3 sem sessão não repõe (${r.status}: ${String(r.data?.message ?? r.data).slice(0, 60)})`);
  r = await rpc(lenovo, "restock", { p_serial: "E5A8N99V99", p_quantity: 1 });
  ok(!r.ok && /DHL/.test(r.data?.message ?? ""), `A4 Lenovo não repõe: ${r.data?.message}`);
  r = await rpc(dhl, "create_order", { p_requested_by: "x", p_notes: null, p_items: [{ serial: "E5A8N99V99", quantity: 1 }] });
  ok(!r.ok && /LENOVO/.test(r.data?.message ?? ""), `A5 DHL não pede: ${r.data?.message}`);
  r = await rpc(lenovo, "create_box_model", { p_serial: null, p_machine_name: "x", p_machine_model: "y", p_stock_total: 1, p_min_stock: 0 });
  ok(!r.ok && /DHL/.test(r.data?.message ?? ""), `A6 Lenovo não cadastra caixa: ${r.data?.message}`);
  r = await select(lenovo, "orders", "select=id&limit=1");
  ok(r.ok, `A7 logado lê pedidos (${r.status})`);
  r = await select(lenovo, "profiles", "select=role,display_name&order=role");
  ok(r.ok && r.data.length >= 2, `A8 logado lê perfis (${r.data?.map?.((p) => p.role).join(",")})`);

  // B. concorrência ---------------------------------------------------------------------
  const box = await rpc(dhl, "create_box_model", { p_serial: null, p_machine_name: "Concorrência Teste", p_machine_model: "zz", p_stock_total: STOCK, p_min_stock: 0 });
  if (!box.ok) throw new Error("create_box_model: " + JSON.stringify(box.data));
  serial = box.data;
  console.log(`caixa de teste ${serial}, estoque ${STOCK}; ${N} pedidos de ${QTY} em paralelo`);

  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      rpc(lenovo, "create_order", { p_requested_by: `Paralelo ${i + 1}`, p_notes: null, p_items: [{ serial, quantity: QTY }], p_urgent: false }),
    ),
  );
  const ms = Date.now() - t0;
  const okOnes = results.filter((x) => x.ok);
  const rejected = results.filter((x) => !x.ok);
  for (const x of okOnes) created.push(x.data);

  ok(okOnes.length === Math.floor(STOCK / QTY), `B1 exatamente ${Math.floor(STOCK / QTY)} pedidos aceitos (aceitos: ${okOnes.length}, recusados: ${rejected.length}, ${ms} ms)`);
  ok(rejected.every((x) => x.status === 400 && /disponíveis/.test(x.data?.message ?? "")), "B2 recusados com a mensagem de estoque, não erro interno");
  let b = (await select(dhl, "box_models", `serial=eq.${serial}&select=stock_total,stock_reserved`)).data[0];
  ok(b.stock_reserved === okOnes.length * QTY && b.stock_reserved <= b.stock_total, `B3 reserva = ${b.stock_reserved} ≤ total ${b.stock_total} (nunca furou)`);

  // 5 cliques em paralelo no mesmo pedido: cada um pega o lock e avança a partir do estado
  // atual; no máximo 3 passam (enviado→recebido→em_separacao→em_transporte), sem pular etapa.
  const id = created[0];
  const adv = await Promise.all(Array.from({ length: 5 }, () => rpc(dhl, "advance_order", { p_order_id: id, p_eta: null })));
  const advOk = adv.filter((x) => x.ok).length;
  const o = (await select(dhl, "orders", `id=eq.${id}&select=status`)).data[0];
  ok(advOk <= 3 && ["recebido", "em_separacao", "em_transporte"].includes(o.status), `B4 avanços paralelos serializados (passaram ${advOk}, status final ${o.status})`);
  const ev = (await select(dhl, "order_events", `order_id=eq.${id}&select=from_status,to_status,actor,user_id&order=id`)).data;
  ok(ev.every((e, i) => i === 0 || e.from_status === ev[i - 1].to_status), "B5 histórico do pedido é uma cadeia contínua (sem etapa pulada ou repetida)");
  ok(ev.every((e) => e.user_id) && ev[0].actor === "lenovo" && ev.slice(1).every((e) => e.actor === "dhl"), "B6 eventos gravam quem fez (user_id) e o ator vem do perfil");

  // perfil errado para a etapa atual: em transporte só a Lenovo confirma; antes disso só a DHL move
  const wrong = o.status === "em_transporte" ? dhl : lenovo;
  r = await rpc(wrong, "advance_order", { p_order_id: id, p_eta: null });
  ok(!r.ok && /Só a (DHL|LENOVO)/.test(r.data?.message ?? ""), `B7 avanço pelo perfil errado recusado: ${r.data?.message}`);

  // cancelamentos simultâneos: a reserva só volta uma vez
  const id2 = created[1];
  const canc = await Promise.all(Array.from({ length: 5 }, () => rpc(lenovo, "cancel_order", { p_order_id: id2 })));
  b = (await select(dhl, "box_models", `serial=eq.${serial}&select=stock_reserved`)).data[0];
  // −1 pedido despachado em B4 (se chegou a em_transporte), −1 cancelado aqui
  const dispatched = o.status === "em_transporte" ? 1 : 0;
  ok(canc.filter((x) => x.ok).length === 1 && b.stock_reserved === (okOnes.length - 1 - dispatched) * QTY, `B8 cancelar 5× em paralelo libera a reserva uma vez só (reserva ${b.stock_reserved})`);

  // hide_order: some da Lenovo, fica para a DHL
  r = await rpc(lenovo, "hide_order", { p_order_id: id2 });
  const stillThere = (await select(dhl, "orders", `id=eq.${id2}&select=id,hidden_by_lenovo`)).data[0];
  ok(r.ok && stillThere?.hidden_by_lenovo === true, "B9 hide_order marca hidden_by_lenovo e a linha continua existindo");
  r = await rpc(dhl, "hide_order", { p_order_id: id2 });
  ok(!r.ok && /LENOVO/.test(r.data?.message ?? ""), `B10 DHL não oculta pedido: ${r.data?.message}`);
} catch (e) {
  console.error("erro:", e.message, e.cause ?? "");
  fails++;
} finally {
  // limpeza pelas funções do sistema: leva cada pedido a um estado final e oculta da Lenovo
  for (const id of created) {
    const o = (await select(dhl, "orders", `id=eq.${id}&select=status`)).data?.[0];
    if (!o) continue;
    if (o.status === "enviado" || o.status === "recebido") await rpc(lenovo, "cancel_order", { p_order_id: id });
    else if (o.status === "em_separacao") { await rpc(dhl, "advance_order", { p_order_id: id, p_eta: null }); await rpc(lenovo, "advance_order", { p_order_id: id, p_eta: null }); }
    else if (o.status === "em_transporte") await rpc(lenovo, "advance_order", { p_order_id: id, p_eta: null });
    await rpc(lenovo, "hide_order", { p_order_id: id });
  }
  if (serial) await rpc(dhl, "update_box_model", { p_serial: serial, p_machine_name: "Concorrência Teste", p_machine_model: "zz", p_min_stock: 0, p_active: false });
  const open = (await select(dhl, "orders", `requested_by=like.Paralelo*&status=in.(enviado,recebido,em_separacao,em_transporte)&select=id`)).data;
  ok(Array.isArray(open) && open.length === 0, `C1 limpeza: nenhum pedido de teste em aberto (${open?.length})`);
  if (serial) console.log(`caixa de teste ${serial} descontinuada; pedidos de teste ficam no histórico da DHL (reset_demo.sql limpa)`);
  console.log(`=== ${fails} falhas ===`);
  process.exit(fails ? 1 : 0);
}
