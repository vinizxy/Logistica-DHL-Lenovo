import type { Metadata } from "next";
// Fontes auto-hospedadas (funcionam sem acesso ao Google Fonts, no build e offline).
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";
import { Nav } from "@/components/ui";

export const metadata: Metadata = {
  title: "Caixas Refurbish — Lenovo × DHL",
  description: "Pedidos e estoque de caixas para o projeto Refurbish",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
