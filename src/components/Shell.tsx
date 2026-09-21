"use client";

import { usePathname } from "next/navigation";
import { Nav } from "@/components/ui";

// Layout comum das páginas logadas. A tela de login tem o dela (sem cabeçalho).
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">{children}</main>
    </>
  );
}
