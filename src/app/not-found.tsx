import Link from "next/link";
import { Section } from "@/components/ui";

export default function NotFound() {
  return (
    <Section title="Página não encontrada">
      <p className="text-sm text-ink-2">
        Esse endereço não existe.{" "}
        <Link className="underline hover:text-red" href="/lenovo">
          Ir para o painel Lenovo
        </Link>{" "}
        ou{" "}
        <Link className="underline hover:text-red" href="/dhl">
          para o painel DHL
        </Link>
        .
      </p>
    </Section>
  );
}
