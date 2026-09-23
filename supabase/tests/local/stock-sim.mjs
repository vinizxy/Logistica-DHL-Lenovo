// Simulação automática de pedidos e estoque (caixas e cushions) num Postgres local.
// Faz centenas de operações aleatórias pelas funções do banco, como a Lenovo e a DHL
// fariam, incluindo pedidos acima do disponível e ações com o perfil errado. Depois de
// cada passo compara o estoque do banco com um modelo calculado aqui, de forma independente.
// Uso: node supabase/tests/local/stock-sim.mjs [semente] [passos]
import { actAs, createDb } from "./db.mjs";

const SEED = Number(process.argv[2] ?? process.env.SEED ?? 20260923);
const STEPS = Number(process.argv[3] ?? process.env.STEPS ?? 600);

// PRNG com semente (mulberry32): a mesma semente repete exatamente a mesma sequência.
let s = SEED >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[int(0, arr.length - 1)];

const db = await createDb();

async function call(role, sql, params = []) {
  await actAs(db, role);
  try {
    const { rows } = await db.query(sql, params);
    return { ok: true, value: rows[0] ? Object.values(rows[0])[0] : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Modelo independente: o que o estoque DEVERIA ser.
const stock = new Map(); // serial → { kind, total, reserved }
const orders = new Map(); // id → { status, items: [{ serial, qty }] }
const NEXT = { enviado: "recebido", recebido: "em_separacao", em_separacao: "em_transporte", em_transporte: "entregue" };
const avail = (serial) => stock.get(serial).total - stock.get(serial).reserved;

const problems = [];
const stats = {};
const tally = (op, ok) => {
  stats[op] ??= { aceitas: 0, recusadas: 0 };
  stats[op][ok ? "aceitas" : "recusadas"]++;
};
function expect(step, op, res, shouldPass, detail) {
  tally(op, res.ok);
  if (res.ok !== shouldPass) {
    problems.push(
      `passo ${step} ${op}: esperado ${shouldPass ? "aceitar" : "recusar"}, banco ${res.ok ? "aceitou" : "recusou"}` +
        (res.error ? ` (${res.error})` : "") + (detail ? ` — ${detail}` : ""),
    );
  }
}

// Catálogo da simulação: 4 caixas e 3 cushions, criados pela DHL.
const boxes = [];
for (let i = 1; i <= 4; i++) {
  const total = int(0, 60);
  const r = await call("dhl", "select public.create_box_model(null, $1, 'sim', $2, 5)", [`Sim Máquina ${i}`, total]);
  if (!r.ok) throw new Error(`cadastro de caixa falhou: ${r.error}`);
  boxes.push(r.value);
  stock.set(r.value, { kind: "caixa", total, reserved: 0 });
}
const cushions = [];
for (let i = 1; i <= 3; i++) {
  const total = int(0, 120);
  const fits = boxes.filter(() => rand() < 0.6);
  if (fits.length === 0) fits.push(boxes[0]);
  const r = await call("dhl", "select public.create_cushion($1, $2, 10, $3::text[])", [`SIMCUSH00${i}`, total, fits]);
  if (!r.ok) throw new Error(`cadastro de cushion falhou: ${r.error}`);
  cushions.push(r.value);
  stock.set(r.value, { kind: "cushion", total, reserved: 0 });
}
const items = [...boxes, ...cushions];

async function checkStock(step, op) {
  const { rows } = await db.query(
    "select serial, kind, stock_total, stock_reserved, stock_available from public.box_models where serial = any($1)",
    [items],
  );
  for (const r of rows) {
    const m = stock.get(r.serial);
    if (r.stock_total !== m.total || r.stock_reserved !== m.reserved || r.stock_available !== m.total - m.reserved || r.kind !== m.kind) {
      problems.push(
        `passo ${step} (${op}) ${m.kind} ${r.serial}: banco total=${r.stock_total} reservado=${r.stock_reserved}, ` +
          `esperado total=${m.total} reservado=${m.reserved}`,
      );
    }
  }
  // Invariante do banco inteiro: reservado = soma das quantidades em pedidos abertos.
  const inv = await db.query(`
    select b.serial, b.stock_reserved,
           coalesce(sum(oi.quantity) filter (where o.status in ('enviado','recebido','em_separacao')), 0)::int as aberto
      from public.box_models b
      left join public.order_items oi on oi.serial = b.serial
      left join public.orders o on o.id = oi.order_id
     group by b.serial, b.stock_reserved
    having b.stock_reserved <> coalesce(sum(oi.quantity) filter (where o.status in ('enviado','recebido','em_separacao')), 0)`);
  for (const r of inv.rows) problems.push(`passo ${step} (${op}) ${r.serial}: reservado ${r.stock_reserved} ≠ pedidos abertos ${r.aberto}`);
}

const ordersIn = (...st) => [...orders.entries()].filter(([, o]) => st.includes(o.status));

for (let step = 1; step <= STEPS && problems.length < 20; step++) {
  const roll = rand();
  let op;
  if (roll < 0.32) {
    // Lenovo pede 1 a 3 itens; às vezes mais do que há disponível.
    op = "pedido";
    const chosen = [...items].sort(() => rand() - 0.5).slice(0, int(1, 3));
    const lines = chosen.map((serial) => {
      const a = avail(serial);
      const qty = rand() < 0.75 && a > 0 ? int(1, Math.min(a, 25)) : a + int(1, 5);
      return { serial, qty };
    });
    const fits = lines.every((l) => l.qty <= avail(l.serial));
    const wrongRole = rand() < 0.05;
    const payload = JSON.stringify(lines.map((l) => ({ serial: l.serial, quantity: l.qty })));
    const res = await call(wrongRole ? "dhl" : "lenovo", "select public.create_order('Simulação', null, $1::jsonb, $2)", [payload, rand() < 0.2]);
    op = wrongRole ? "pedido pela DHL" : fits ? "pedido" : "pedido acima do disponível";
    expect(step, op, res, fits && !wrongRole, lines.map((l) => `${l.serial}×${l.qty} (disp. ${avail(l.serial)})`).join(", "));
    if (res.ok) {
      for (const l of lines) stock.get(l.serial).reserved += l.qty;
      orders.set(Number(res.value), { status: "enviado", items: lines });
    }
  } else if (roll < 0.62) {
    // DHL avança uma etapa do armazém (o despacho dá baixa no estoque).
    const open = ordersIn("enviado", "recebido", "em_separacao");
    if (open.length === 0) continue;
    const [id, o] = pick(open);
    op = o.status === "em_separacao" ? "despacho" : "avançar";
    const res = await call("dhl", "select public.advance_order($1)", [id]);
    expect(step, op, res, true, `pedido ${id} em ${o.status}`);
    if (res.ok) {
      if (o.status === "em_separacao") {
        for (const l of o.items) {
          stock.get(l.serial).total -= l.qty;
          stock.get(l.serial).reserved -= l.qty;
        }
      }
      o.status = NEXT[o.status];
    }
  } else if (roll < 0.72) {
    // Lenovo confirma a entrega; às vezes a DHL tenta confirmar (não pode).
    const moving = ordersIn("em_transporte");
    if (moving.length === 0) continue;
    const [id, o] = pick(moving);
    const wrongRole = rand() < 0.15;
    op = wrongRole ? "entrega pela DHL" : "entrega";
    const res = await call(wrongRole ? "dhl" : "lenovo", "select public.advance_order($1)", [id]);
    expect(step, op, res, !wrongRole, `pedido ${id}`);
    if (res.ok) o.status = "entregue";
  } else if (roll < 0.86) {
    // Lenovo cancela: só vale em enviado/recebido, e devolve a reserva.
    const candidates = ordersIn("enviado", "recebido", "em_separacao", "em_transporte", "entregue");
    if (candidates.length === 0) continue;
    const [id, o] = pick(candidates);
    const allowed = o.status === "enviado" || o.status === "recebido";
    op = allowed ? "cancelar" : "cancelar fora de hora";
    const res = await call("lenovo", "select public.cancel_order($1)", [id]);
    expect(step, op, res, allowed, `pedido ${id} em ${o.status}`);
    if (res.ok) {
      for (const l of o.items) stock.get(l.serial).reserved -= l.qty;
      o.status = "cancelado";
    }
  } else {
    // DHL repõe; às vezes quantidade inválida ou a Lenovo tentando repor.
    const serial = pick(items);
    const kind = rand();
    const qty = kind < 0.1 ? -int(0, 5) : int(1, 40);
    const wrongRole = kind > 0.92;
    op = wrongRole ? "reposição pela Lenovo" : qty <= 0 ? "reposição inválida" : "reposição";
    const res = await call(wrongRole ? "lenovo" : "dhl", "select public.restock($1, $2)", [serial, qty]);
    expect(step, op, res, qty > 0 && !wrongRole, `${serial} +${qty}`);
    if (res.ok) {
      stock.get(serial).total += qty;
      if (res.value !== stock.get(serial).total) problems.push(`passo ${step} reposição devolveu ${res.value}, esperado ${stock.get(serial).total}`);
    }
  }
  await checkStock(step, op);
}

// Status final de cada pedido da simulação confere com o modelo.
const { rows } = await db.query("select id, status::text from public.orders where id = any($1)", [[...orders.keys()]]);
for (const r of rows) {
  if (orders.get(Number(r.id)).status !== r.status) problems.push(`pedido ${r.id}: banco "${r.status}", esperado "${orders.get(Number(r.id)).status}"`);
}
await db.close();

console.log(`Simulação de estoque — semente ${SEED}, ${STEPS} passos, ${orders.size} pedidos criados`);
console.log("Itens: " + items.map((i) => `${stock.get(i).kind} ${i} (total ${stock.get(i).total}, reservado ${stock.get(i).reserved})`).join("; "));
for (const [op, n] of Object.entries(stats).sort()) console.log(`  ${op.padEnd(28)} aceitas ${String(n.aceitas).padStart(4)}   recusadas ${String(n.recusadas).padStart(4)}`);
if (problems.length) {
  console.log(`\n✘ ${problems.length} divergência(s):`);
  for (const p of problems) console.log("  " + p);
  process.exit(1);
}
console.log("\n✔ Estoque do banco bateu com o modelo em todos os passos.");
