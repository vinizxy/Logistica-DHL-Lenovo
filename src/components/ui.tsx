"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Connection } from "@/lib/useLiveData";
import { STATUS_CLASS, STATUS_LABEL } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

export function Nav() {
  const path = usePathname();
  const link = (href: string, label: string) => {
    const active = path === href || path.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={
          "rounded px-3 py-1.5 text-sm font-medium " +
          (active ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-200")
        }
      >
        {label}
      </Link>
    );
  };
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div>
          <div className="text-base font-semibold">Caixas Refurbish</div>
          <div className="text-xs text-gray-500">Lenovo × DHL — pedidos e estoque</div>
        </div>
        <nav className="flex gap-2">
          {link("/lenovo", "Painel Lenovo")}
          {link("/dhl", "Painel DHL")}
        </nav>
      </div>
    </header>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={
        "inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap " +
        STATUS_CLASS[status]
      }
    >
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
        "rounded px-3 py-2 text-sm " +
        (offline ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600")
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
    <div className="flex items-start justify-between gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span>{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-red-800 hover:underline" type="button">
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
    <div className="flex items-start justify-between gap-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
      <span>{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-green-800 hover:underline" type="button">
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
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const btn = {
  primary:
    "rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40",
  secondary:
    "rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40",
  small:
    "rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40",
};

export const input =
  "rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-900 focus:outline-none disabled:bg-gray-100";
