# Caixas Refurbish — Lenovo × DHL

Sistema de pedidos e estoque de caixas para o projeto Refurbish da Lenovo (remanufatura de
notebooks devolvidos, revendidos no outlet). As caixas ficam no armazém da DHL; a Lenovo
consulta o estoque e pede; a DHL separa, despacha e repõe. Os dois lados acompanham cada
pedido em tempo real.

- **Produção:** https://lenovo-dhl-refurbish.vercel.app — deploy manual por enquanto; para deploy automático, conecte o repositório em Vercel → Settings → Git
- **Spec:** [docs/specs/2026-09-20-lenovo-dhl-refurbish-design.md](docs/specs/2026-09-20-lenovo-dhl-refurbish-design.md)
- **Plano:** [docs/specs/2026-09-20-plano-implementacao.md](docs/specs/2026-09-20-plano-implementacao.md)

## Telas

| Rota | Quem usa | O que faz |
|---|---|---|
| `/lenovo` | Linha de refurbish | Vê estoque disponível (com busca), monta pedido multi-item (com − / +), marca urgente, acompanha, confirma entrega, cancela, exclui pedidos encerrados |
| `/dhl` | Armazém | Fila por etapa com urgentes no topo, informa previsão de entrega ao despachar, estoque com busca e alerta de mínimo, reposição, exclui pedidos do histórico |
| `/pedido/[id]` | Ambos | Linha do tempo do pedido, previsão de entrega, itens, histórico e comentários entre Lenovo e DHL; a Lenovo confirma a entrega por aqui também |
| `/cadastro` | Admin | Catálogo de caixas: incluir modelo novo (serial gerado), editar nome/modelo/mínimo, descontinuar/reativar |

## Fluxo de um pedido

```
Lenovo cria ──► Enviado ──► Recebido ──► Em separação ──► Em transporte ──► Entregue
                (reserva)     DHL           DHL          DHL (baixa real)   Lenovo confirma
                   │            │
                   └────────────┴──► Cancelado (Lenovo; libera a reserva)
```

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind) — deploy na Vercel
- **Supabase** — Postgres 17 + Realtime
- Regras de negócio em **funções SQL** (`supabase/migrations/0002_functions.sql`): reservar,
  baixar e liberar estoque acontece em transação, com trava de linha. O frontend só chama
  `rpc()` e mostra a mensagem que o banco devolve.
- Sem login nesta fase. RLS permite leitura pública e **nenhuma escrita direta** — toda
  escrita passa pelas funções.

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencher com URL e chave publishable do projeto Supabase
npm run dev                  # http://localhost:3000
```

## Banco

Migrações em `supabase/migrations/`, na ordem:

1. `0001_schema.sql` — enums, tabelas, índices, RLS, Realtime
2. `0002_functions.sql` — `create_order`, `advance_order`, `cancel_order`, `restock`
3. `0003_seed.sql` — 13 tipos de caixa e 5 pedidos de exemplo (criados via funções)
4. `0004_urgent_eta_comments_catalog.sql` — pedido urgente, previsão de entrega, comentários, cadastro de caixas
5. `0005_delete_order.sql` — `delete_order`: exclui só pedidos entregues/cancelados (em andamento, cancele antes)
6. `0006_hardening.sql` — limites de tamanho/quantidade com mensagens legíveis, tetos de estoque, EXECUTE revogado das funções internas

Testes (todos com rollback proposital: rodam inteiros numa transação e terminam com um
`RAISE EXCEPTION` contendo o relatório — o banco fica intocado; sucesso = `0 falhas`):

- `supabase/tests/rules.sql` (43) — regras de estoque e fluxo de status
- `supabase/tests/features.sql` (20) — urgente, previsão, comentários, cadastro, exclusão
- `supabase/tests/security.sql` (45) — papel `anon` não escreve direto em tabela nenhuma; funções internas
  sem EXECUTE; entradas hostis (20 mil caracteres, quantidades absurdas, HTML/SQL no texto, JSON
  malformado) recusadas com mensagem legível; invariantes de estoque no banco inteiro
- `supabase/tests/concurrency.mjs` (7) — pela API pública: 12 pedidos simultâneos brigando pelo mesmo
  estoque, cliques paralelos em avançar/cancelar. Roda com
  `node --dns-result-order=ipv4first supabase/tests/concurrency.mjs`; cria e remove os próprios dados.

Cole os `.sql` no SQL Editor do Supabase e leia o relatório na mensagem de erro.

## Roteiro de demonstração

1. Abra `/lenovo` num aparelho e `/dhl` em outro.
2. Na Lenovo, adicione 2–3 tipos de caixa ao pedido e envie. Veja o **Disponível** cair
   (reserva) e o pedido surgir em **Novos** na DHL sem recarregar.
3. Na DHL, avance: Recebido → Em separação → Despachar. Ao despachar, **Total** e
   **Reservado** caem juntos (baixa real).
4. Na Lenovo, o botão **Confirmar entrega** aparece. Confirme. Abra o pedido e veja a linha
   do tempo com data/hora e ator de cada passo.
5. Tente pedir mais do que o disponível: o banco recusa e a tela mostra qual item estourou.
6. Na DHL, `IdeaPad Slim 5` e `Legion Pro 7i` estão abaixo do mínimo (⚠). Reponha e veja o
   alerta sumir.
7. Marque um pedido como **urgente**: ele sobe pro topo da fila da DHL com etiqueta vermelha.
8. Ao **despachar**, a DHL informa a previsão de entrega; a Lenovo vê "chega hoje 14:00".
9. Abra o pedido e deixe um **comentário** de um lado; o outro lado vê na hora.
10. Em **Cadastro**, inclua um tipo de caixa novo e descontinue outro — ele some do pedido.

## Fora de escopo (por enquanto)

Login e perfis, notificações, integração com WMS/SAP, relatórios, múltiplos armazéns,
rastreio por unidade física. Ver seção 8 da spec.
