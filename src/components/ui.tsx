"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { HOME } from "@/lib/auth";
import type { Connection } from "@/lib/useLiveData";
import { STATUS_LABEL } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

export function Nav() {
  const path = usePathname();
  const { profile, signOut } = useAuth();
  const link = (href: string, label: string, panel = true) => {
    const active = path === href || path.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={
          "relative px-3 py-3 text-sm font-medium transition-colors " +
          (active ? "text-ink" : "text-muted hover:text-ink-2")
        }
      >
        {panel && <span className="hidden sm:inline">Painel </span>}
        {label}
        {active && <span className="absolute inset-x-3 -bottom-px h-0.5 bg-red" />}
      </Link>
    );
  };
  const home = profile ? HOME[profile.role] : "/login";
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4">
        <Link href={home} className="flex items-center gap-3 py-2.5">
          {/* Logo em public/lenovo-logo.png — trocar o arquivo troca a marca. */}
          <Image
            src="/lenovo-logo.png"
            alt="Lenovo"
            width={389}
            height={129}
            priority
            className="h-7 w-auto"
          />
          <span className="border-l border-line-strong pl-3 text-[15px] font-semibold tracking-tight">
            Caixas Refurbish
          </span>
          <span className="hidden text-sm text-muted sm:inline">com DHL</span>
        </Link>
        {/* Só o painel do perfil; o proxy barra o outro lado de qualquer jeito. */}
        <nav className="flex items-center">
          {(profile?.role === "lenovo" || profile?.role === "admin") && link("/lenovo", "Lenovo")}
          {(profile?.role === "dhl" || profile?.role === "admin") && link("/dhl", "DHL")}
          {(profile?.role === "dhl" || profile?.role === "admin") && link("/cadastro", "Cadastro", false)}
          {profile?.role === "admin" && link("/admin", "Admin", false)}
          {profile && (
            <>
              <span className="ml-3 hidden max-w-[12rem] truncate border-l border-line pl-3 text-sm text-ink-2 sm:inline" title={profile.display_name}>
                {profile.display_name}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="ml-2 px-2 py-3 text-sm text-muted transition-colors hover:text-red"
              >
                Sair
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

const STATUS_DOT: Record<OrderStatus, string> = {
  enviado: "bg-red",
  recebido: "bg-sky",
  em_separacao: "bg-amber",
  em_transporte: "bg-violet",
  entregue: "bg-green",
  cancelado: "bg-muted",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-2">
      <span className={"h-1.5 w-1.5 rounded-full " + STATUS_DOT[status]} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ConnectionBanner({ connection }: { connection: Connection }) {
  // Só o estado offline merece aviso; "conectando" dura um instante e só distrai.
  if (connection !== "offline") return null;
  return (
    <div className="border border-red/40 bg-red-soft px-3 py-2 text-sm text-ink">
      Sem conexão em tempo real. Tentando reconectar; os dados são atualizados a cada 15 s.
    </div>
  );
}

export function ErrorBox({
  message,
  onClose,
}: {
  message: string | null;
  onClose?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 border-l-2 border-red bg-red-soft px-3 py-2 text-sm text-ink">
      <span>{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-ink-2 hover:text-ink" type="button">
          fechar
        </button>
      )}
    </div>
  );
}

export function SuccessBox({
  message,
  onClose,
}: {
  message: React.ReactNode;
  onClose?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 border-l-2 border-green bg-green-soft px-3 py-2 text-sm text-ink">
      <span>{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-ink-2 hover:text-ink" type="button">
          fechar
        </button>
      )}
    </div>
  );
}

export function Section({
  title,
  right,
  children,
  flush,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/** Faixa de resumo: números tabulares com rótulo ao lado, sem virar "hero". */
export function Stats({ items }: { items: { value: React.ReactNode; label: string; tone?: "red" | "amber" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
      {items.map((s) => (
        <span key={s.label} className="flex items-baseline gap-1.5">
          <span
            className={
              "num text-lg font-semibold " +
              (s.tone === "red" ? "text-red" : s.tone === "amber" ? "text-amber" : "text-ink")
            }
          >
            {s.value}
          </span>
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Etiqueta de pedido urgente: linha parada esperando caixa. */
export function UrgentBadge({ small }: { small?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 bg-red font-semibold uppercase tracking-wide text-white " +
        (small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]")
      }
    >
      <span aria-hidden>!</span> Urgente
    </span>
  );
}

/** Contador de comentários, mostrado nas listas quando há algum. */
export function CommentCount({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" title={`${n} comentário${n === 1 ? "" : "s"}`}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        <path d="M2 3h12v8H6l-3 3v-3H2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {n}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

export const btn = {
  primary:
    "bg-red px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-hover disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-muted",
  secondary:
    "border border-line-strong bg-transparent px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:border-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
  small:
    "border border-line-strong bg-transparent px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
  smallDanger:
    "border border-red/50 bg-transparent px-2.5 py-1 text-xs font-medium text-red transition-colors hover:bg-red-soft disabled:cursor-not-allowed disabled:opacity-40",
};

export const input =
  "border border-line-strong bg-bg px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:border-red focus:outline-none disabled:opacity-40";

export const checkbox = "h-4 w-4 accent-[var(--color-red)]";
