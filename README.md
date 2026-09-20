# Caixas Refurbish — Lenovo × DHL

Sistema de pedidos e estoque de caixas para o projeto Refurbish da Lenovo (remanufatura de
notebooks devolvidos, revendidos no outlet). As caixas ficam no armazém da DHL; a Lenovo
consulta o estoque e pede; a DHL separa, despacha e repõe. Os dois lados acompanham cada
pedido em tempo real.

- **Produção:** https://lenovo-dhl-refurbish.vercel.app (deploy automático a cada push na `main`)
- **Spec:** [docs/specs/2026-09-20-lenovo-dhl-refurbish-design.md](docs/specs/2026-09-20-lenovo-dhl-refurbish-design.md)
- **Plano:** [docs/specs/2026-09-20-plano-implementacao.md](docs/specs/2026-09-20-plano-implementacao.md)

## Telas

| Rota | Quem usa | O que faz |
|---|---|---|
| `/lenovo` | Linha de refurbish | Vê estoque disponível, monta pedido multi-item, acompanha pedidos, confirma entrega, cancela |
| `/dhl` | Armazém | Fila de pedidos por etapa (um botão = próxima ação), estoque com alerta de mínimo, reposição |
| `/pedido/[id]` | Ambos | Linha do tempo do pedido, itens, histórico de quem fez o quê e quando |

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

Testes das regras: `supabase/tests/rules.sql`. Roda inteiro numa transação e termina com um
`RAISE EXCEPTION` contendo o relatório — o banco fica intocado. Cole no SQL Editor do Supabase
e leia o relatório na mensagem de erro; sucesso = `0 falhas`.

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

## Fora de escopo (por enquanto)

Login e perfis, notificações, integração com WMS/SAP, relatórios, múltiplos armazéns,
rastreio por unidade física. Ver seção 8 da spec.
