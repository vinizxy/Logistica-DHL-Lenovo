"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { fetchProfile, HOME } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Side } from "@/lib/types";
import { btn, input } from "@/components/ui";

const SIDE_LABEL: Record<Side, string> = { lenovo: "Lenovo", dhl: "DHL" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [side, setSide] = useState<Side | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(
    params.get("erro") === "sem-perfil" ? "Conta sem perfil. Fale com o administrador." : null,
  );

  const canSubmit = side !== null && email.trim().length > 0 && password.length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !side) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      setBusy(false);
      const msg = error?.message.toLowerCase() ?? "";
      setErr(
        error?.code === "invalid_credentials" || msg.includes("invalid")
          ? "E-mail ou senha incorretos."
          : error?.code === "email_not_confirmed"
            ? "E-mail ainda não confirmado. Fale com o administrador."
            : error?.status === 429 || error?.code === "over_request_rate_limit"
              ? "Muitas tentativas. Aguarde alguns minutos e tente de novo."
              : msg.includes("fetch")
                ? "Sem conexão. Tente de novo."
                : "Não foi possível entrar. Tente de novo ou fale com o administrador.",
      );
      return;
    }
    const profile = await fetchProfile(supabase, data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      setBusy(false);
      setErr("Conta sem perfil. Fale com o administrador.");
      return;
    }
    // Admin entra por qualquer um dos dois lados e vai para o painel dele.
    if (profile.role !== "admin" && profile.role !== side) {
      // Entrou, mas pelo lado errado: desfaz e sugere o lado certo.
      await supabase.auth.signOut();
      setBusy(false);
      setSide(profile.role);
      setErr(`Essa conta é da ${SIDE_LABEL[profile.role]}. Escolha ${SIDE_LABEL[profile.role]} para entrar.`);
      return;
    }
    router.replace(HOME[profile.role]);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">Caixas Refurbish</h1>
          <p className="mt-1 text-sm text-muted">Pedidos e estoque de caixas e cushions — Lenovo × DHL</p>
        </div>

        {/* Os dois logos são o seletor: clique em quem você é. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Entrar como">
          <SideCard active={side === "lenovo"} onClick={() => setSide("lenovo")} label="Lenovo">
            <Image src="/lenovo-logo.png" alt="Lenovo" width={389} height={129} priority className="h-10 w-auto" />
          </SideCard>
          <SideCard active={side === "dhl"} onClick={() => setSide("dhl")} label="DHL">
            {/* Logo em public/dhl-logo.png, sobre o amarelo da marca. */}
            <span className="flex h-10 items-center bg-[#FFCC00] px-3">
              <Image src="/dhl-logo.png" alt="DHL" width={1963} height={283} priority className="h-5 w-auto" />
            </span>
          </SideCard>
        </div>

        <form className="space-y-3 border border-line bg-surface p-4" onSubmit={submit}>
          <label className="block text-sm">
            <span className="text-ink-2">E-mail</span>
            <input
              className={input + " mt-1 w-full"}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={side === "dhl" ? "voce@dhl.com" : "voce@lenovo.com"}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Senha</span>
            <input
              className={input + " mt-1 w-full"}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {err && (
            <div className="border border-red/50 bg-red-soft px-3 py-2 text-sm text-red" role="alert">
              {err}
            </div>
          )}
          <button className={btn.primary + " w-full py-2.5"} type="submit" disabled={!canSubmit}>
            {busy ? "Entrando…" : side ? `Entrar como ${SIDE_LABEL[side]}` : "Escolha Lenovo ou DHL acima"}
          </button>
          <p className="text-center text-xs text-muted">
            Sem conta? As contas são criadas pelo administrador do sistema.
          </p>
        </form>
      </div>
    </main>
  );
}

function SideCard({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Entrar como ${label}`}
      className={
        "flex h-28 items-center justify-center border-2 bg-surface transition-colors " +
        (active ? "border-red bg-red-soft/30" : "border-line hover:border-line-strong")
      }
    >
      {children}
    </button>
  );
}
