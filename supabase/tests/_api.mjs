// Helper dos testes que batem na API pública: lê .env.local, faz login com as contas de
// teste e chama rpc/select com retry em falha de rede (antes de qualquer resposta).
// Rode com: node --dns-result-order=ipv4first ...   (evita timeout IPv6 em algumas redes)

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
export const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
export const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const TEST_USERS = {
  lenovo: { email: "teste123@lenovo.com", password: env.TEST_LENOVO_PASSWORD ?? "teste123" },
  dhl: { email: "teste123@dhl.com", password: env.TEST_DHL_PASSWORD ?? "teste123" },
};

export async function fetchRetry(url, init, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

function headers(token) {
  return { apikey: KEY, Authorization: `Bearer ${token ?? KEY}`, "Content-Type": "application/json" };
}

async function parse(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

/** Login por senha; devolve o access_token (ou lança). */
export async function login(who) {
  const u = TEST_USERS[who];
  const r = await fetchRetry(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const j = await parse(r);
  if (!r.ok || !j.access_token) throw new Error(`login ${who}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

/** Chama uma função SQL via PostgREST. `token` nulo = sem sessão (anon). */
export async function rpc(token, fn, body) {
  const r = await fetchRetry(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(token), body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await parse(r) };
}

export async function select(token, table, query) {
  const r = await fetchRetry(`${URL_}/rest/v1/${table}?${query}`, { headers: headers(token) });
  return { ok: r.ok, status: r.status, data: await parse(r) };
}
