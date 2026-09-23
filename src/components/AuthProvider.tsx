"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LOGIN_REQUIRED } from "@/lib/actions";
import { fetchProfile, type Profile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Chame com a mensagem de erro de uma ação: se for "faça login", derruba a sessão. */
  handleActionError: (message: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Quem está logado e com que perfil, para o Nav e as páginas. O proxy (src/proxy.ts)
 * já garante que só quem tem sessão chega aqui; este provider cobre o que acontece
 * DEPOIS de carregar: sessão expirada, "Sair", conta sem perfil.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (u: User | null) => {
    setUser(u);
    setProfile(u ? await fetchProfile(supabase, u.id) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => load(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setProfile(null);
        if (pathname !== "/login") router.replace("/login");
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void load(session?.user ?? null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load, router, pathname]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Falha ao sair:", e);
    } finally {
      router.replace("/login");
    }
  }, [router]);

  const handleActionError = useCallback(
    (message: string) => {
      if (message === LOGIN_REQUIRED) void signOut();
    },
    [signOut],
  );

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, handleActionError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
