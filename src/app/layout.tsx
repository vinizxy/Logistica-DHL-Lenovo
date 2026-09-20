import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/ui";

export const metadata: Metadata = {
  title: "Caixas Refurbish — Lenovo × DHL",
  description: "Pedidos e estoque de caixas para o projeto Refurbish",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-gray-100 text-gray-900 antialiased">
        <Nav />
        <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
