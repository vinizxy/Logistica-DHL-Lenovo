# Plano de implementação — Logística de Caixas Lenovo × DHL

Spec: [2026-09-20-lenovo-dhl-refurbish-design.md](2026-09-20-lenovo-dhl-refurbish-design.md)

Cada etapa termina com uma verificação objetiva e um commit. Ordem: banco primeiro
(regras testadas antes de existir tela), depois camada de dados, depois telas.

| # | Etapa | Entrega | Verificação |
|---|---|---|---|
| 1 | Scaffold | Next.js 16 + TS + Tailwind, `.gitattributes` (LF), `.env.example`, client Supabase | `npm run build` passa |
| 2 | Schema | Migração `0001_schema`: enums, tabelas, coluna gerada `stock_available`, índices em FKs, RLS (leitura anon, sem escrita direta), publicação Realtime | `list_tables` mostra 4 tabelas; `insert` direto como anon falha |
| 3 | Funções | Migração `0002_functions`: `create_order`, `advance_order`, `cancel_order`, `restock` — `security definer`, `search_path=''`, `for update`, mensagens de erro em PT-BR | Testes SQL da etapa 5 |
| 4 | Seed | Migração `0003_seed`: 13 tipos de caixa (2 abaixo do mínimo), 5 pedidos em status distintos criados **via funções** (não insert direto) para o histórico ser coerente | `select` mostra estoques reservados batendo com pedidos abertos |
| 5 | Testes SQL | Script `supabase/tests/rules.sql` rodado em transação com rollback: reserva, rejeição parcial, fluxo completo, transições inválidas, ator errado, cancelamento, reposição | Todas as asserções passam; banco fica intocado |
| 6 | Camada de dados | `src/lib/types.ts` (tipos do banco), `src/lib/queries.ts` (leituras), `src/lib/actions.ts` (rpc), hook `useRealtime` | `tsc --noEmit` limpo |
| 7 | `/lenovo` | Estoque com busca, carrinho, envio, meus pedidos com ações condicionais, erros do banco na tela | Browser: criar pedido, ver reserva cair no estoque |
| 8 | `/dhl` | Abas com contador, botão único de próxima ação, estoque com alerta e reposição | Browser: avançar pedido 3×, ver baixa real |
| 9 | `/pedido/[id]` | Linha do tempo, itens, histórico, estado "não encontrado" | Browser: abrir pedido em cada status |
| 10 | Tempo real + robustez | Duas abas refletindo mudanças sem F5; faixa de "sem conexão"; estados vazios | Browser: duas abas lado a lado |
| 11 | Entrega | `git push`, deploy Vercel com env vars, README com como rodar e como demonstrar | Link público abre `/lenovo` e `/dhl` no celular |
