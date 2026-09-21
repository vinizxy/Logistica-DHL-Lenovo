import { redirect } from "next/navigation";

// O proxy (src/proxy.ts) manda cada perfil para o seu painel; sem sessão, para /login.
export default function Home() {
  redirect("/login");
}
