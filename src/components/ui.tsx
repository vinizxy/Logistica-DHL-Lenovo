"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Connection } from "@/lib/useLiveData";
import { STATUS_LABEL } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

export function Nav() {
  const path = usePathname();
  const link = (href: string, label: string) => {
    const active = path === href || path.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={
          "relative px-3 py-3 text-sm font-medium transition-colors " +
          (active ? "text-ink" : "text-muted hover:text-ink-2")
        }
      >
        <span className="hidden sm:inline">Painel </span>
        {label}
        {active && <span className="absolute inset-x-3 -bottom-px h-0.5 bg-red" />}
      </Link>
    );
  };
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4">
        <Link href="/lenovo" className="flex items-center gap-3 py-2.5">
          {/* Logo em public/lenovo-logo.png — trocar o arquivo troca a marca. */}
          <Image
            src="/lenovo-logo.png"
            alt="Lenovo"
            width={237}
            height={129}
            priority
            className="h-7 w-auto"
          />
          <span className="border-l border-line-strong pl-3 text-[15px] font-semibold tracking-tight">
            Caixas Refurbish
          </span>
          <span className="hidden text-sm text-muted sm:inline">com DHL</span>
        </Link>
        <nav className="flex">
          {link("/lenovo", "Lenovo")}
          {link("/dhl", "DHL")}
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
  if (connection === "online") return null;
  const offline = connection === "offline";
  return (
    <div
      className={
        "border px-3 py-2 text-sm " +
        (offline ? "border-red/40 bg-red-soft text-ink" : "border-line bg-surface text-muted")
      }
    >
      {offline
        ? "Sem conexão em tempo real. Tentando reconectar; os dados são atualizados a cada 15 s."
        : "Conectando…"}
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
