"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminSetPassword,
  adminUpdateUser,
  type AdminUser,
} from "@/lib/actions";
import { ACTOR_LABEL, fmtDate } from "@/lib/format";
import type { Actor } from "@/lib/types";
import { btn, Empty, ErrorBox, input, Section, Stats, SuccessBox } from "@/components/ui";

const ROLES: Actor[] = ["lenovo", "dhl", "admin"];
const ROLE_HINT: Record<Actor, string> = {
  lenovo: "Pede caixas, cancela, confirma entrega",
  dhl: "Recebe, separa, despacha, repõe estoque, mantém o catálogo",
  admin: "Tudo isso, mais contas",
};

/**
 * Painel do administrador: contas do sistema (criar, editar perfil/nome, trocar senha,
 * excluir). As regras vivem nas funções admin_* do banco; a tela só chama e mostra.
 */
export default function AdminPage() {
  const { profile, handleActionError } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<React.ReactNode>(null);

  const load = useCallback(async () => {
    const r = await adminListUsers();
    if (r.ok) {
      setUsers(r.data);
      setError(null);
    } else {
      setError(r.error);
      handleActionError(r.error);
    }
  }, [handleActionError]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const count = (role: Actor) => users?.filter((u) => u.role === role).length ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Administração</h1>
          <p className="text-sm text-muted">
            Contas do sistema. Você também acessa os painéis{" "}
            <Link className="underline hover:text-red" href="/lenovo">Lenovo</Link>,{" "}
            <Link className="underline hover:text-red" href="/dhl">DHL</Link> e o{" "}
            <Link className="underline hover:text-red" href="/cadastro">cadastro de caixas</Link>.
          </p>
        </div>
        {users && (
          <Stats
            items={[
              { value: count("lenovo"), label: "contas Lenovo" },
              { value: count("dhl"), label: "contas DHL" },
              { value: count("admin"), label: "admins" },
            ]}
          />
        )}
      </div>

      <ErrorBox message={error} onClose={() => setError(null)} />
      <SuccessBox message={success} onClose={() => setSuccess(null)} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="Contas" flush>
          {users === null ? (
            <Empty>Carregando…</Empty>
          ) : users.length === 0 ? (
            <Empty>Nenhuma conta.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {users.map((u) => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  isSelf={u.user_id === profile?.user_id}
                  onChanged={(msg) => {
                    setSuccess(msg);
                    void load();
                  }}
                  onError={(msg) => {
                    setError(msg);
                    handleActionError(msg);
                  }}
                />
              ))}
            </ul>
          )}
        </Section>

        <CreateUser
          onCreated={(email) => {
            setSuccess(<>Conta <span className="font-medium">{email}</span> criada. Passe a senha para a pessoa.</>);
            void load();
          }}
          onError={(msg) => {
            setError(msg);
            handleActionError(msg);
          }}
        />
      </div>
    </>
  );
}

function UserRow({
  user: u,
  isSelf,
  onChanged,
  onError,
}: {
  user: AdminUser;
  isSelf: boolean;
  onChanged: (msg: React.ReactNode) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "password">("view");
  const [role, setRole] = useState<Actor>(u.role);
  const [name, setName] = useState(u.display_name);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: React.ReactNode) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      setMode("view");
      setPassword("");
      onChanged(msg);
    } else {
      onError(r.error ?? "Erro desconhecido");
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{u.display_name}</span>
            <RoleBadge role={u.role} />
            {isSelf && <span className="text-xs text-muted">(você)</span>}
          </div>
          <div className="mono text-xs">{u.email}</div>
          <div className="text-xs text-muted">
            criada {fmtDate(u.created_at)}
            {u.last_sign_in_at ? <> · último acesso {fmtDate(u.last_sign_in_at)}</> : <> · nunca entrou</>}
          </div>
        </div>
        {mode === "view" && (
          <div className="flex flex-wrap gap-2">
            <button className={btn.small} type="button" disabled={busy} onClick={() => setMode("edit")}>
              Editar
            </button>
            <button className={btn.small} type="button" disabled={busy} onClick={() => setMode("password")}>
              Nova senha
            </button>
            {!isSelf && (
              <button
                className={btn.smallDanger}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Excluir a conta ${u.email}? A pessoa perde o acesso na hora. Pedidos e histórico ficam.`))
                    void run(() => adminDeleteUser(u.user_id), <>Conta <span className="font-medium">{u.email}</span> excluída.</>);
                }}
              >
                Excluir
              </button>
            )}
          </div>
        )}
      </div>

      {mode === "edit" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border border-line bg-surface-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => adminUpdateUser(u.user_id, role, name.trim()), <>Conta <span className="font-medium">{u.email}</span> atualizada.</>);
          }}
        >
          <label className="block text-sm">
            <span className="text-ink-2">Nome de exibição</span>
            <input className={input + " mt-1 block w-56"} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Perfil</span>
            <select className={input + " mt-1 block"} value={role} onChange={(e) => setRole(e.target.value as Actor)} disabled={isSelf}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ACTOR_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <button className={btn.primary} type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
          <button className={btn.secondary} type="button" disabled={busy} onClick={() => { setMode("view"); setRole(u.role); setName(u.display_name); }}>
            Cancelar
          </button>
          {isSelf && <span className="basis-full text-xs text-muted">Você não pode tirar o próprio perfil de admin.</span>}
        </form>
      )}

      {mode === "password" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border border-line bg-surface-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => adminSetPassword(u.user_id, password), <>Senha de <span className="font-medium">{u.email}</span> trocada. Passe a senha nova para a pessoa.</>);
          }}
        >
          <label className="block text-sm">
            <span className="text-ink-2">Senha nova (mín. 8)</span>
            <PasswordInput className="mt-1 w-56" value={password} onChange={setPassword} />
          </label>
          <button className={btn.primary} type="submit" disabled={busy || password.length < 8}>{busy ? "Salvando…" : "Definir senha"}</button>
          <button className={btn.secondary} type="button" disabled={busy} onClick={() => { setMode("view"); setPassword(""); }}>
            Cancelar
          </button>
          <span className="basis-full text-xs text-muted">
            Não há e-mail de recuperação nesta fase: o admin define a senha e passa para a pessoa.
          </span>
        </form>
      )}
    </li>
  );
}

function CreateUser({ onCreated, onError }: { onCreated: (email: string) => void; onError: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Actor>("lenovo");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length >= 8 && name.trim().length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    const r = await adminCreateUser({ email: email.trim(), password, role, displayName: name.trim() });
    setBusy(false);
    if (r.ok) {
      onCreated(email.trim().toLowerCase());
      setEmail("");
      setPassword("");
      setName("");
      setRole("lenovo");
    } else {
      onError(r.error);
    }
  }

  return (
    <Section title="Nova conta">
      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm">
          <span className="text-ink-2">Perfil</span>
          <select className={input + " mt-1 w-full"} value={role} onChange={(e) => setRole(e.target.value as Actor)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ACTOR_LABEL[r]}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">{ROLE_HINT[role]}</span>
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Nome de exibição</span>
          <input className={input + " mt-1 w-full"} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Maria Silva" maxLength={80} required />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">E-mail</span>
          <input className={input + " mt-1 w-full"} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={role === "dhl" ? "nome@dhl.com" : "nome@lenovo.com"} required />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Senha inicial (mín. 8)</span>
          <PasswordInput className="mt-1 w-full" value={password} onChange={setPassword} />
        </label>
        <button className={btn.primary + " w-full"} type="submit" disabled={!canSubmit}>
          {busy ? "Criando…" : "Criar conta"}
        </button>
        <p className="text-xs text-muted">A conta já nasce ativa, sem e-mail de confirmação. Passe a senha para a pessoa.</p>
      </form>
    </Section>
  );
}

function PasswordInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className={"flex " + className}>
      <input
        className={input + " min-w-0 flex-1"}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={8}
        maxLength={72}
        required
      />
      <button type="button" className={btn.secondary + " ml-1 shrink-0"} onClick={() => setShow((s) => !s)} aria-pressed={show}>
        {show ? "Ocultar" : "Mostrar"}
      </button>
    </span>
  );
}

function RoleBadge({ role }: { role: Actor }) {
  const cls =
    role === "admin"
      ? "border-amber/50 text-amber"
      : role === "dhl"
        ? "border-line-strong text-ink-2"
        : "border-red/50 text-red";
  return <span className={"border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide " + cls}>{ACTOR_LABEL[role]}</span>;
}
