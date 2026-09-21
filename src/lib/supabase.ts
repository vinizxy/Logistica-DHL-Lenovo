import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Copie .env.example para .env.local.",
  );
}

// Um único client no browser. A sessão fica em cookie (@supabase/ssr), então o
// servidor (proxy.ts) também sabe quem está logado.
export const supabase = createBrowserClient(url, key);
