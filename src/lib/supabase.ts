import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Copie .env.example para .env.local.",
  );
}

// Um único client no browser; sem sessão de usuário (sem login nesta fase).
export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
