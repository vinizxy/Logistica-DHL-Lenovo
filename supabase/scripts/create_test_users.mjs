// Cria (ou atualiza) as contas do sistema pela API admin do Supabase.
// Precisa de SUPABASE_SERVICE_ROLE_KEY no .env.local (nunca no frontend nem no git).
// O perfil (lenovo|dhl) vai no app metadata (só o servidor grava) e o nome no user metadata;
// o trigger handle_new_user cria a linha em public.profiles. Contas nascem com e-mail confirmado.
//
// Uso:
//   node --dns-result-order=ipv4first supabase/scripts/create_test_users.mjs
//   node ... create_test_users.mjs maria@lenovo.com "senha forte" lenovo "Maria Silva"
//
// Sem argumentos, cria as duas contas de teste (teste123@lenovo.com / teste123@dhl.com) com as
// senhas TEST_LENOVO_PASSWORD e TEST_DHL_PASSWORD do .env.local.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local (a service role fica em Project Settings → API).");
  process.exit(1);
}
const headers = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

// Senhas das contas de teste só pelo .env.local (o repositório é público).
const DEFAULTS = [
  ["teste123@lenovo.com", env.TEST_LENOVO_PASSWORD, "lenovo", "Lenovo Teste"],
  ["teste123@dhl.com", env.TEST_DHL_PASSWORD, "dhl", "DHL Teste"],
];
const [, , email, password, role, ...nameParts] = process.argv;
const users = email ? [[email, password, role, nameParts.join(" ")]] : DEFAULTS;

for (const [email, password, role, display_name] of users) {
  if (!password || !["lenovo", "dhl"].includes(role) || !display_name) {
    console.error(`uso: <email> <senha> <lenovo|dhl> <nome de exibição>  (recebido: ${email} ${role} "${display_name}")`);
    process.exit(1);
  }
  const body = { email, password, email_confirm: true, app_metadata: { role }, user_metadata: { role, display_name } };
  // existe? → atualiza (senha/metadata). Não? → cria.
  const list = await fetch(`${URL_}/auth/v1/admin/users?page=1&per_page=1000`, { headers }).then((r) => r.json());
  const existing = list.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  const r = existing
    ? await fetch(`${URL_}/auth/v1/admin/users/${existing.id}`, { method: "PUT", headers, body: JSON.stringify(body) })
    : await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) {
    console.error(`${email}: ${r.status} ${j.msg ?? j.message ?? JSON.stringify(j)}`);
    process.exit(1);
  }
  console.log(`${existing ? "atualizada" : "criada"}: ${email} (${role}, "${display_name}") id=${j.id}`);
}
