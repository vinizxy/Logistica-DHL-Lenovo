// Testes do admin pela API real, com login de verdade (o que o admin.sql não cobre:
// senha aceita pelo Supabase Auth, sessão de conta apagada, perfil mudando no meio):
//   A) login do admin e proteção das funções admin_*
//   B) contas: criar cada perfil e logar com cada uma; validações; duplicidade
//   C) senha: trocar → antiga falha, nova entra; sessão antiga continua até expirar
//   D) perfil: mudar → permissões mudam na hora
//   E) estoque pelo admin: cadastrar, repor, mínimo, descontinuar, reativar, limites
//   F) excluir conta: não loga mais, sessão antiga cai, pedidos/histórico ficam
//   G) segundo admin: gerencia contas, não apaga a si, o primeiro apaga ele
// Cria e remove tudo que usa (contas com e-mail *.teste@…, caixa "Admin API Teste").
//
// Uso:  node --dns-result-order=ipv4first supabase/tests/admin_api.mjs   (lê .env.local)

import { login, loginAs, rpc, select, whoami } from "./_api.mjs";

let fails = 0;
const ok = (cond, label) => { console.log((cond ? "ok     " : "FALHOU ") + label); if (!cond) fails++; };
const msg = (r) => String(r.data?.message ?? r.data ?? "").slice(0, 90);

const NEW = {
  lenovo: { email: "lenovo.teste@lenovo.com", password: "lenovo12345", name: "Lenovo API" },
  dhl: { email: "dhl.teste@dhl.com", password: "dhl123456", name: "DHL API" },
  admin: { email: "admin2.teste@lenovo.com", password: "admin212345", name: "Admin Dois" },
};
const created = {}; // role → user_id
let admin, lenovo, dhl, serial, orderId;

try {
  // A. admin ---------------------------------------------------------------------------
  admin = await login("admin");
  lenovo = await login("lenovo");
  dhl = await login("dhl");
  const me = await whoami(admin);
  ok(me.ok && me.data.user_metadata?.role === "admin", `A1 login do admin (metadata role=${me.data.user_metadata?.role})`);
  let r = await rpc(admin, "admin_list_users", {});
  ok(r.ok && r.data.some((u) => u.role === "admin"), `A2 admin lista contas (${r.data?.length})`);
  r = await rpc(null, "admin_list_users", {});
  ok(!r.ok && r.status === 401, `A3 sem sessão não lista contas (${r.status})`);
  r = await rpc(lenovo, "admin_list_users", {});
  ok(!r.ok && /ADMIN/.test(msg(r)), `A4 Lenovo não lista contas: ${msg(r)}`);
  r = await rpc(dhl, "admin_create_user", { p_email: "x@dhl.com", p_password: "senha12345", p_role: "dhl", p_display_name: "X" });
  ok(!r.ok && /ADMIN/.test(msg(r)), `A5 DHL não cria conta: ${msg(r)}`);
  r = await select(lenovo, "profiles", "select=role");
  ok(r.ok, "A6 perfis legíveis por logados (Nav precisa)");

  // limpeza preventiva de execuções anteriores
  for (const u of (await rpc(admin, "admin_list_users", {})).data) {
    if (u.email.endsWith(".teste@lenovo.com") || u.email.endsWith(".teste@dhl.com")) await rpc(admin, "admin_delete_user", { p_user_id: u.user_id });
  }

  // B. criar contas e logar com cada uma ------------------------------------------------------
  for (const role of ["lenovo", "dhl", "admin"]) {
    const n = NEW[role];
    r = await rpc(admin, "admin_create_user", { p_email: n.email.toUpperCase(), p_password: n.password, p_role: role, p_display_name: `  ${n.name}  ` });
    ok(r.ok, `B1 criar conta ${role}: ${r.ok ? "ok" : msg(r)}`);
    created[role] = r.data;
    const t = await loginAs(n.email, n.password);
    ok(t.ok, `B2 login ${role} com a senha definida pelo admin (${t.ok ? "ok" : t.error})`);
    const w = t.ok ? await whoami(t.token) : null;
    ok(w?.data?.email === n.email && w?.data?.email_confirmed_at, `B3 ${role}: e-mail normalizado e confirmado`);
    const p = (await select(t.token, "profiles", `user_id=eq.${created[role]}&select=role,display_name`)).data?.[0];
    ok(p?.role === role && p?.display_name === n.name, `B4 ${role}: perfil ${p?.role}, nome aparado "${p?.display_name}"`);
  }
  r = await rpc(admin, "admin_create_user", { p_email: NEW.dhl.email, p_password: "senha12345", p_role: "dhl", p_display_name: "Dup" });
  ok(!r.ok && /Já existe/.test(msg(r)), `B5 e-mail duplicado (mesma caixa) recusado`);
  r = await rpc(admin, "admin_create_user", { p_email: "  DHL.Teste@DHL.com ", p_password: "senha12345", p_role: "dhl", p_display_name: "Dup" });
  ok(!r.ok && /Já existe/.test(msg(r)), `B6 e-mail duplicado (maiúsculas/espaços) recusado`);
  r = await rpc(admin, "admin_create_user", { p_email: "invalido", p_password: "senha12345", p_role: "dhl", p_display_name: "X" });
  ok(!r.ok && /inválido/.test(msg(r)), `B7 e-mail inválido recusado`);
  r = await rpc(admin, "admin_create_user", { p_email: "curta.teste@dhl.com", p_password: "1234567", p_role: "dhl", p_display_name: "X" });
  ok(!r.ok && /8 caracteres/.test(msg(r)), `B8 senha de 7 caracteres recusada`);
  r = await rpc(admin, "admin_create_user", { p_email: "nome.teste@dhl.com", p_password: "senha12345", p_role: "dhl", p_display_name: "x".repeat(81) });
  ok(!r.ok && /longo/.test(msg(r)), `B9 nome de 81 caracteres recusado`);
  r = await rpc(admin, "admin_create_user", { p_email: "perfil.teste@dhl.com", p_password: "senha12345", p_role: "gerente", p_display_name: "X" });
  ok(!r.ok, `B10 perfil inexistente recusado (${r.status})`);
  r = await rpc(admin, "admin_create_user", { p_email: "outro.teste@gmail.com", p_password: "senha12345", p_role: "lenovo", p_display_name: "Outro Domínio" });
  ok(r.ok, `B11 outro domínio com perfil explícito é aceito`);
  if (r.ok) created.other = r.data;

  // as contas novas agem conforme o perfil
  const tl = (await loginAs(NEW.lenovo.email, NEW.lenovo.password)).token;
  const td = (await loginAs(NEW.dhl.email, NEW.dhl.password)).token;
  const ta = (await loginAs(NEW.admin.email, NEW.admin.password)).token;
  r = await rpc(tl, "restock", { p_serial: "E5A8N99V99", p_quantity: 1 });
  ok(!r.ok && /DHL/.test(msg(r)), `B12 Lenovo nova não repõe`);
  r = await rpc(td, "create_order", { p_requested_by: "x", p_notes: null, p_items: [{ serial: "E5A8N99V99", quantity: 1 }] });
  ok(!r.ok && /LENOVO/.test(msg(r)), `B13 DHL nova não pede`);
  r = await rpc(td, "admin_list_users", {});
  ok(!r.ok && /ADMIN/.test(msg(r)), `B14 DHL nova não gerencia contas`);

  // C. senha ------------------------------------------------------------------------------------
  const oldToken = td;
  r = await rpc(admin, "admin_set_password", { p_user_id: created.dhl, p_password: "novasenha123" });
  ok(r.ok, "C1 admin troca a senha da DHL nova");
  let t = await loginAs(NEW.dhl.email, NEW.dhl.password);
  ok(!t.ok && t.status === 400, `C2 senha antiga não entra mais (${t.status})`);
  t = await loginAs(NEW.dhl.email, "novasenha123");
  ok(t.ok, `C3 senha nova entra`);
  NEW.dhl.password = "novasenha123";
  r = await whoami(oldToken);
  ok(r.ok, "C4 sessão aberta antes da troca continua válida até expirar (comportamento do Supabase; avisar a pessoa)");
  r = await rpc(admin, "admin_set_password", { p_user_id: created.dhl, p_password: "curta" });
  ok(!r.ok && /8 caracteres/.test(msg(r)), "C5 senha curta recusada na troca");
  r = await rpc(admin, "admin_set_password", { p_user_id: "00000000-0000-0000-0000-000000000000", p_password: "senha12345" });
  ok(!r.ok && /não encontrada/.test(msg(r)), "C6 troca em conta inexistente recusada");
  r = await rpc(tl, "admin_set_password", { p_user_id: created.dhl, p_password: "hacker12345" });
  ok(!r.ok && /ADMIN/.test(msg(r)), "C7 Lenovo não troca senha de ninguém");

  // D. perfil muda → permissões mudam na hora -----------------------------------------------------
  r = await rpc(admin, "admin_update_user", { p_user_id: created.lenovo, p_role: "dhl", p_display_name: "Virou DHL" });
  ok(r.ok, "D1 admin muda Lenovo nova para DHL");
  const before = (await select(admin, "box_models", "serial=eq.E5A8N99V99&select=stock_total")).data[0].stock_total;
  r = await rpc(tl, "restock", { p_serial: "E5A8N99V99", p_quantity: 1 });
  ok(r.ok && r.data === before + 1, `D2 mesma sessão agora repõe (${before} → ${r.data})`);
  r = await rpc(tl, "create_order", { p_requested_by: "x", p_notes: null, p_items: [{ serial: "E5A8N99V99", quantity: 1 }] });
  ok(!r.ok && /LENOVO/.test(msg(r)), "D3 e não pede mais");
  const w2 = await whoami(tl);
  ok(w2.data?.user_metadata?.role === "dhl" && w2.data?.user_metadata?.display_name === "Virou DHL", "D4 metadata da conta acompanha (role/display_name)");
  r = await rpc(admin, "admin_update_user", { p_user_id: created.lenovo, p_role: "lenovo", p_display_name: NEW.lenovo.name });
  ok(r.ok, "D5 volta para Lenovo");
  r = await rpc(admin, "admin_update_user", { p_user_id: created.lenovo, p_role: "lenovo", p_display_name: "   " });
  ok(!r.ok && /Informe/.test(msg(r)), "D6 nome em branco recusado");

  // E. estoque pelo admin ----------------------------------------------------------------------------
  r = await rpc(admin, "create_box_model", { p_serial: null, p_machine_name: "Admin API Teste", p_machine_model: "v1", p_stock_total: 20, p_min_stock: 5 });
  ok(r.ok && /^[A-Z0-9]{10}$/.test(r.data), `E1 admin cadastra caixa (${r.data})`);
  serial = r.data;
  r = await rpc(admin, "restock", { p_serial: serial, p_quantity: 10 });
  ok(r.ok && r.data === 30, `E2 admin repõe (total ${r.data})`);
  r = await rpc(admin, "update_box_model", { p_serial: serial, p_machine_name: "Admin API Teste", p_machine_model: "v2", p_min_stock: 40, p_active: true });
  let b = (await select(admin, "box_models", `serial=eq.${serial}&select=machine_model,min_stock,stock_available`)).data[0];
  ok(r.ok && b.machine_model === "v2" && b.min_stock === 40 && b.stock_available < b.min_stock, `E3 admin edita modelo/mínimo (fica "abaixo do mínimo": ${b.stock_available} < ${b.min_stock})`);
  r = await rpc(admin, "create_order", { p_requested_by: "Admin", p_notes: null, p_items: [{ serial, quantity: 4 }] });
  ok(r.ok, "E4 admin cria pedido na caixa");
  orderId = r.data;
  r = await rpc(admin, "update_box_model", { p_serial: serial, p_machine_name: "Admin API Teste", p_machine_model: "v2", p_min_stock: 40, p_active: false });
  ok(!r.ok && /reservadas/.test(msg(r)), `E5 descontinuar com reserva recusado: ${msg(r)}`);
  r = await rpc(admin, "advance_order", { p_order_id: orderId, p_eta: null });
  r = await rpc(admin, "advance_order", { p_order_id: orderId, p_eta: null });
  r = await rpc(admin, "advance_order", { p_order_id: orderId, p_eta: new Date(Date.now() + 864e5).toISOString() });
  r = await rpc(admin, "advance_order", { p_order_id: orderId, p_eta: null });
  b = (await select(admin, "box_models", `serial=eq.${serial}&select=stock_total,stock_reserved`)).data[0];
  ok(r.ok && r.data === "entregue" && b.stock_total === 26 && b.stock_reserved === 0, `E6 admin conduz o pedido até entregue; baixa real (total ${b.stock_total}, reserva ${b.stock_reserved})`);
  const ev = (await select(admin, "order_events", `order_id=eq.${orderId}&select=actor&order=id`)).data;
  ok(ev.length === 5 && ev.every((e) => e.actor === "admin"), "E7 todos os eventos gravados como admin");
  r = await rpc(admin, "update_box_model", { p_serial: serial, p_machine_name: "Admin API Teste", p_machine_model: "v2", p_min_stock: 5, p_active: false });
  ok(r.ok, "E8 sem reserva, admin descontinua");
  r = await rpc(admin, "create_order", { p_requested_by: "Admin", p_notes: null, p_items: [{ serial, quantity: 1 }] });
  ok(!r.ok && /descontinuada/.test(msg(r)), "E9 descontinuada não pode ser pedida (nem pelo admin)");
  r = await rpc(admin, "restock", { p_serial: serial, p_quantity: 100001 });
  ok(!r.ok && /limite/.test(msg(r)), `E10 reposição acima do limite recusada`);
  r = await rpc(admin, "restock", { p_serial: "NAOEXISTE1", p_quantity: 1 });
  ok(!r.ok && /não existe/.test(msg(r)), "E11 serial inexistente recusado");
  r = await rpc(admin, "create_box_model", { p_serial: serial, p_machine_name: "Dup", p_machine_model: "x", p_stock_total: 1, p_min_stock: 0 });
  ok(!r.ok && /Já existe/.test(msg(r)), "E12 serial duplicado recusado");
  r = await rpc(admin, "create_box_model", { p_serial: null, p_machine_name: "X", p_machine_model: "y", p_stock_total: -1, p_min_stock: 0 });
  ok(!r.ok && /negativos/.test(msg(r)), "E13 estoque negativo recusado");
  r = await rpc(admin, "hide_order", { p_order_id: orderId });
  ok(r.ok, "E14 admin oculta o pedido (como a Lenovo faria)");
  // invariantes depois de tudo
  const inv = (await select(admin, "box_models", "select=stock_total,stock_reserved")).data;
  ok(inv.every((x) => x.stock_reserved >= 0 && x.stock_reserved <= x.stock_total), "E15 nenhuma caixa com estoque inconsistente");

  // F. excluir conta --------------------------------------------------------------------------------
  // a Lenovo nova faz um pedido antes de ser apagada: pedido e histórico têm que ficar
  r = await rpc(tl, "create_order", { p_requested_by: NEW.lenovo.name, p_notes: "antes de excluir", p_items: [{ serial: "E5A8N99V99", quantity: 2 }] });
  ok(r.ok, "F1 Lenovo nova cria pedido");
  const o2 = r.data;
  r = await rpc(admin, "admin_delete_user", { p_user_id: created.lenovo });
  ok(r.ok, "F2 admin exclui a Lenovo nova");
  t = await loginAs(NEW.lenovo.email, NEW.lenovo.password);
  ok(!t.ok, `F3 conta excluída não loga (${t.status})`);
  r = await whoami(tl);
  ok(!r.ok && r.status === 403, `F4 sessão antiga da conta excluída cai (${r.status})`);
  r = await rpc(tl, "cancel_order", { p_order_id: o2 });
  ok(!r.ok, `F5 token antigo não opera mais (${r.status})`);
  const o2row = (await select(admin, "orders", `id=eq.${o2}&select=status,created_by,requested_by,stock:order_items(quantity)`)).data[0];
  ok(o2row && o2row.status === "enviado" && o2row.created_by === null && o2row.requested_by === NEW.lenovo.name, "F6 pedido fica (enviado, created_by nulo, nome preservado)");
  const b5 = (await select(admin, "box_models", "serial=eq.E5A8N99V99&select=stock_reserved")).data[0];
  ok(b5.stock_reserved === 2, `F7 reserva do pedido continua (${b5.stock_reserved}) — a DHL ainda precisa atender`);
  r = await rpc(admin, "cancel_order", { p_order_id: o2 });
  ok(r.ok, "F8 admin cancela o pedido órfão (libera reserva)");
  r = await rpc(admin, "hide_order", { p_order_id: o2 });

  // G. segundo admin --------------------------------------------------------------------------------
  r = await rpc(ta, "admin_list_users", {});
  ok(r.ok, "G1 segundo admin lista contas");
  r = await rpc(ta, "admin_create_user", { p_email: "terceiro.teste@dhl.com", p_password: "senha12345", p_role: "dhl", p_display_name: "Terceiro" });
  ok(r.ok, "G2 segundo admin cria conta");
  if (r.ok) created.third = r.data;
  r = await rpc(ta, "admin_delete_user", { p_user_id: created.admin });
  ok(!r.ok && /própria conta/.test(msg(r)), "G3 segundo admin não apaga a si mesmo");
  r = await rpc(ta, "admin_update_user", { p_user_id: created.admin, p_role: "dhl", p_display_name: "Rebaixado" });
  ok(!r.ok && /próprio perfil/.test(msg(r)), "G4 segundo admin não se rebaixa");
  r = await rpc(ta, "admin_delete_user", { p_user_id: created.third });
  ok(r.ok, "G5 segundo admin apaga a conta que criou");
  delete created.third;
  r = await rpc(admin, "admin_delete_user", { p_user_id: created.admin });
  ok(r.ok, "G6 primeiro admin apaga o segundo");
  r = await whoami(ta);
  ok(!r.ok, `G7 sessão do segundo admin cai (${r.status})`);
  delete created.admin;
} catch (e) {
  console.error("erro:", e.message, e.cause ?? "");
  fails++;
} finally {
  // limpeza: contas de teste, caixa de teste (descontinuada), estoque da Legion 5
  if (admin) {
    for (const u of (await rpc(admin, "admin_list_users", {})).data ?? []) {
      if (/\.teste@/.test(u.email)) await rpc(admin, "admin_delete_user", { p_user_id: u.user_id });
    }
    const left = (await rpc(admin, "admin_list_users", {})).data?.filter((u) => /\.teste@/.test(u.email)) ?? [];
    ok(left.length === 0, `Z1 limpeza: nenhuma conta de teste sobrou (${left.length})`);
    if (serial) await rpc(admin, "update_box_model", { p_serial: serial, p_machine_name: "Admin API Teste", p_machine_model: "v2", p_min_stock: 0, p_active: false });
    const open = (await select(admin, "orders", "status=in.(enviado,recebido,em_separacao,em_transporte)&select=id")).data ?? [];
    ok(open.length === 0, `Z2 limpeza: nenhum pedido em aberto (${open.length})`);
    console.log("obs.: a Legion 5 ganhou +1 no D2 (restock de teste); o reset_demo.sql devolve o valor inicial.");
  }
  console.log(`=== ${fails} falhas ===`);
  process.exit(fails ? 1 : 0);
}
