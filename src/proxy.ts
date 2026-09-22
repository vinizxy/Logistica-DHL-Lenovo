// Renova a sessão a cada requisição e faz o roteamento por perfil
// (spec docs/specs/2026-09-21-login-design.md §4.1). O banco continua sendo a
// autoridade: mesmo que alguém chegue à página errada, as funções recusam.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { HOME } from "@/lib/auth";
import type { Actor, Side } from "@/lib/types";

// Rotas de um lado só. Admin passa em todas; /admin é só dele.
const ROLE_ONLY: Record<string, Side> = { "/lenovo": "lenovo", "/dhl": "dhl", "/cadastro": "dhl" };

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser() valida o token no servidor (getSession só lê o cookie).
  const { data: { user }, error } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";

  // Falha de rede/servidor ao validar (não é "sem sessão"): deixa passar sem redirecionar.
  // Um redirect aqui seria cacheado pelo prefetch do router e mandaria a pessoa para a
  // página errada; a própria página lida com a sessão (AuthProvider).
  if (!user && error && error.status !== 401 && error.status !== 403 && !/session/i.test(error.message)) {
    return response;
  }

  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const r = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (!user) return isLogin ? response : redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (!profile) {
    // Conta sem perfil: derruba a sessão e explica na tela de login.
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?erro=sem-perfil";
    const r = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  }
  const role = profile.role as Actor;

  if (isLogin || pathname === "/") return redirect(HOME[role]);
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return role === "admin" ? response : redirect(HOME[role]);
  }
  if (role === "admin") return response;
  const only = Object.entries(ROLE_ONLY).find(([p]) => pathname === p || pathname.startsWith(p + "/"))?.[1];
  if (only && only !== role) return redirect(HOME[role]);
  return response;
}

export const config = {
  // Tudo menos arquivos estáticos e imagens.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
