// Postgres em memória (PGlite) imitando o Supabase o bastante para rodar as migrações e os
// testes: schema auth (users, identities, auth.uid()), pgcrypto em extensions, papéis
// anon/authenticated com os privilégios padrão do Supabase e a publicação do Realtime.
// Nada aqui toca o banco de produção.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPABASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema extensions;
  create extension pgcrypto schema extensions;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (
    id uuid primary key, instance_id uuid, aud text, role text, email text,
    encrypted_password text, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz,
    confirmation_token text, recovery_token text, email_change_token_new text, email_change text
  );
  create table auth.identities (
    id uuid primary key, user_id uuid references auth.users(id) on delete cascade,
    provider_id text, provider text, identity_data jsonb,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create publication supabase_realtime;
`;

// As mesmas contas que os testes .sql esperam (o trigger cria o perfil pelo app metadata).
export const ACCOUNTS = {
  lenovo: "teste123@lenovo.com",
  dhl: "teste123@dhl.com",
  admin: "admin@lenovo.com",
};
// Os testes conferem a assinatura dos comentários por estes nomes.
const DISPLAY_NAME = { lenovo: "Lenovo Teste", dhl: "DHL Teste", admin: "Admin Teste" };

/** Banco novo com todas as migrações aplicadas e as contas de teste criadas. */
export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_SHIM);
  const dir = join(SUPABASE_DIR, "migrations");
  // Um exec por arquivo: o enum do 0007b precisa estar commitado antes do 0008 usá-lo.
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`migração ${f} falhou: ${e.message}`);
    }
  }
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         $1, 'x', now(), jsonb_build_object('role', $2::text),
         jsonb_build_object('display_name', $3::text), now(), now())`,
      [email, role, DISPLAY_NAME[role]],
    );
  }
  return db;
}

/** Simula a sessão de uma conta (auth.uid()) nas próximas chamadas. */
export async function actAs(db, role) {
  const { rows } = await db.query("select id from auth.users where email = $1", [ACCOUNTS[role]]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [rows[0].id]);
}
