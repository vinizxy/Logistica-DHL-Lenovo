// Roda os testes .sql de supabase/tests num Postgres local (PGlite), cada um num banco novo.
// Os testes terminam com RAISE EXCEPTION contendo o relatório; sucesso = "0 falhas".
// Uso: node supabase/tests/local/run-sql.mjs [arquivo.sql ...]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, SUPABASE_DIR } from "./db.mjs";

const dir = join(SUPABASE_DIR, "tests");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let failed = 0;
for (const f of files) {
  const db = await createDb();
  let report;
  try {
    await db.exec(readFileSync(join(dir, f), "utf8"));
    report = "terminou sem o relatório final (esperado RAISE EXCEPTION)";
  } catch (e) {
    report = e.message;
  }
  await db.close();
  const ok = /=== 0 falhas ===/.test(report);
  if (!ok) failed++;
  const lines = report.split("\n");
  const total = lines.filter((l) => /^(ok|FALHOU) /.test(l)).length;
  console.log(`${ok ? "✔" : "✘"} ${f} — ${total} verificações`);
  for (const l of lines.filter((l) => l.startsWith("FALHOU") || (!ok && !/^ok /.test(l)))) console.log("    " + l);
}
console.log(failed ? `\n${failed} arquivo(s) com falha` : "\nTodos os testes SQL passaram.");
process.exit(failed ? 1 : 0);
