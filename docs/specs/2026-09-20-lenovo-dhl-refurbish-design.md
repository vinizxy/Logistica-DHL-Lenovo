# Logística de Caixas — Lenovo Refurbish × DHL

**Data:** 2026-09-20
**Status:** aprovado para implementação (protótipo funcional para apresentação interna)
**Repositório:** https://github.com/vinizxy/Logistica-DHL-Lenovo
**Banco:** Supabase, projeto "Logistica DHL/Lenovo" (`ioqdctwqbxfudixntdyl`, Postgres 17, us-east-1)

## 1. Problema

O projeto Refurbish da Lenovo (remanufatura de notebooks devolvidos, revendidos no outlet)
precisa de caixas específicas por modelo de máquina para embalar as unidades. As caixas
ficam no armazém da DHL. Hoje o pedido de caixas é feito sem sistema: não há visibilidade
do estoque, do que foi pedido, nem de em que etapa o pedido está.

## 2. Objetivo do protótipo

Um sistema web com dois painéis e uma tela de rastreio que permita:

- Lenovo ver o estoque de caixas da DHL e fazer pedidos multi-item.
- DHL receber os pedidos, avançá-los por etapas definidas e manter o estoque.
- Ambos acompanharem cada pedido em uma linha do tempo.

Prioridade: **funcionalidade e clareza do processo**, não estética.

## 3. Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Forma de apresentação | Link online (Vercel) | Chefe abre no celular; dois aparelhos veem o mesmo estado em tempo real |
| Serial de 10 caracteres | Identifica o **tipo** de caixa (catálogo), não a unidade física | Rastreio unitário gera volume de dados desnecessário nesta fase |
| Dono do estoque | DHL | Caixas ficam fisicamente na DHL; Lenovo consulta e pede |
| Pedido | Multi-item (carrinho) | Reflete como a linha de refurbish trabalha |
| Confirmação de entrega | Lenovo | Fecha o ciclo por quem recebeu |
| Login | Nenhum nesta fase | Painéis `/lenovo` e `/dhl` abertos; auth entra se o projeto for aprovado |
| Linguagem | TypeScript / Next.js | Client oficial Supabase com Realtime; deploy Vercel; frontend e API no mesmo código |
| Regras de negócio | Funções SQL no Postgres | Transacional (evita furar estoque com pedidos simultâneos); reutilizável por qualquer sistema futuro (WMS da DHL, backend Java etc.) |

## 4. Arquitetura

```
Navegador (Lenovo / DHL)
   │  Next.js 16 (App Router, TypeScript, Tailwind) — Vercel
   │    /lenovo        estoque + novo pedido + meus pedidos
   │    /dhl           fila de pedidos + estoque + reposição
   │    /pedido/[id]   rastreio (linha do tempo), comum aos dois
   ▼
Supabase
   ├─ Postgres: tabelas + funções SQL transacionais (regras de estoque e status)
   └─ Realtime: telas atualizam sem F5 quando o outro lado age
```

O frontend chama as funções SQL via `supabase.rpc(...)`. Leituras usam `select` direto nas
tabelas/views. Nenhuma regra de estoque vive no frontend.

## 5. Modelo de dados

### 5.1 Tabelas

```sql
box_models              -- catálogo de tipos de caixa
  serial          char(10)  PK        -- ex: 7KQ2M9XA4T
  machine_name    text      not null  -- ex: ThinkPad X1 Carbon
  machine_model   text      not null  -- ex: Gen 12
  stock_total     int       not null default 0  check (>= 0)
  stock_reserved  int       not null default 0  check (>= 0 and <= stock_total)
  min_stock       int       not null default 0
  -- disponível = stock_total - stock_reserved (coluna gerada, nunca gravada)

orders
  id              bigserial PK        -- número do pedido exibido como #0042
  status          order_status not null default 'enviado'
  requested_by    text      not null  -- nome de quem pediu (sem login)
  notes           text
  created_at      timestamptz not null default now()
  updated_at      timestamptz not null default now()

order_items
  order_id        bigint  FK orders(id) on delete cascade
  serial          char(10) FK box_models(serial)
  quantity        int not null check (> 0)
  PK (order_id, serial)

order_events            -- histórico, alimenta a linha do tempo
  id              bigserial PK
  order_id        bigint FK orders(id) on delete cascade
  from_status     order_status          -- null no evento de criação
  to_status       order_status not null
  actor           actor_role not null   -- 'lenovo' | 'dhl'
  created_at      timestamptz not null default now()
```

Enums:
- `order_status`: `enviado | recebido | em_separacao | em_transporte | entregue | cancelado`
- `actor_role`: `lenovo | dhl`

### 5.2 Fluxo de status

```
enviado → recebido → em_separacao → em_transporte → entregue
enviado → cancelado
recebido → cancelado
```

| Transição | Quem | Efeito no estoque |
|---|---|---|
| (criação) → enviado | Lenovo | `stock_reserved += qty` por item; falha se qualquer item tiver `qty > disponível` — pedido inteiro rejeitado |
| enviado → recebido | DHL | — |
| recebido → em_separacao | DHL | — |
| em_separacao → em_transporte | DHL | `stock_total -= qty`, `stock_reserved -= qty` (baixa real) |
| em_transporte → entregue | Lenovo | — |
| enviado/recebido → cancelado | Lenovo | `stock_reserved -= qty` (libera) |
| reposição (fora do fluxo de pedido) | DHL | `stock_total += qty` |

Qualquer outra transição é recusada pelo banco com erro descritivo.

### 5.3 Funções SQL (interface do banco)

| Função | Parâmetros | Retorno |
|---|---|---|
| `create_order(requested_by text, notes text, items jsonb)` | `items = [{serial, quantity}, ...]` | `order_id` |
| `advance_order(order_id bigint, actor actor_role)` | avança para o próximo status válido do fluxo principal | novo status |
| `cancel_order(order_id bigint)` | só em `enviado`/`recebido` | — |
| `restock(serial char(10), quantity int)` | `quantity > 0` | novo `stock_total` |

Todas rodam em transação única, travam as linhas de `box_models` envolvidas (`FOR UPDATE`)
e gravam em `order_events`. Erros usam `RAISE EXCEPTION` com mensagem legível em português
para ser exibida direto na tela (ex.: `ThinkPad X1 Carbon Gen 12: só 12 disponíveis, pedido 30`).

`advance_order` verifica que o `actor` é o correto para a transição (Lenovo só confirma
entrega; DHL só avança as três etapas do armazém).

### 5.4 Segurança sem login

RLS habilitado em todas as tabelas com política de leitura pública (anon) e **nenhuma**
política de escrita direta. Toda escrita passa pelas funções (`SECURITY DEFINER`).
Isso garante que mesmo sem login ninguém edita estoque ou status fora das regras.

### 5.5 Dados de exemplo (seed)

~12 tipos de caixa cobrindo as linhas Lenovo: ThinkPad X1 Carbon Gen 12, ThinkPad T14 Gen 5,
ThinkPad L14 Gen 5, ThinkBook 14 G6, IdeaPad Slim 5, IdeaPad Flex 5, Yoga 7i 2-in-1,
Yoga Slim 7, Legion 5 15IAH7, Legion Pro 7i, LOQ 15, ThinkCentre M70q, Tab P12.
Seriais: 10 caracteres alfanuméricos maiúsculos, gerados aleatoriamente, fixos no seed.
Estoques variados; 2 modelos abaixo do `min_stock` para demonstrar o alerta.
~5 pedidos em status distintos (incluindo 1 cancelado e 1 entregue) para as telas não
começarem vazias.

## 6. Telas

Atualização em tempo real (Supabase Realtime em `orders`, `order_events`, `box_models`).
Barra de navegação simples: `Lenovo | DHL`.

### 6.1 `/lenovo`

1. **Estoque de caixas** — tabela: serial, máquina, modelo, disponível, campo quantidade + botão adicionar. Busca por serial/nome. Linha desabilitada quando disponível = 0.
2. **Novo pedido** — carrinho com itens adicionados, campo solicitante (obrigatório), observação (opcional), botão Enviar (desabilitado com carrinho vazio ou sem solicitante). Erro do banco é exibido literalmente.
3. **Meus pedidos** — lista com número, data, nº de itens, status, botão "ver". Botão "Confirmar entrega" só em `em_transporte`; "Cancelar" só em `enviado`/`recebido`.

### 6.2 `/dhl`

1. **Fila de pedidos** — abas por status com contador: Novos (`enviado`), Recebidos, Em separação, Em transporte, Histórico (`entregue` + `cancelado`). Cada pedido mostra itens e **um** botão com a única próxima ação válida.
2. **Estoque** — tabela: serial, máquina, total, reservado, disponível, mínimo, campo + botão repor. ⚠ quando disponível < mínimo.

### 6.3 `/pedido/[id]`

Linha do tempo horizontal dos 5 status com o atual marcado; se cancelado, marcação em
vermelho no ponto onde parou. Lista de itens. Histórico de eventos com data/hora, ator e ação.

### 6.4 Estados de erro e vazios

- Sem conexão com Supabase → faixa no topo "Sem conexão, tentando reconectar".
- Fila DHL vazia → "Nenhum pedido novo".
- Lista de pedidos Lenovo vazia → "Nenhum pedido ainda".
- Pedido inexistente em `/pedido/[id]` → "Pedido não encontrado".

## 7. Testes

- **Banco (SQL em transação com rollback, rodado contra o Supabase):**
  - `create_order` reserva estoque em todos os itens.
  - `create_order` com 2 itens em que só 1 excede o disponível → nada gravado, erro cita o item.
  - `advance_order` segue o fluxo; transição inválida e ator errado são recusados.
  - `em_transporte` faz baixa real; `cancel_order` libera reserva; cancelar em `em_separacao` é recusado.
  - `restock` soma ao total; quantidade ≤ 0 recusada.
- **App (verificação no browser antes da entrega):** Lenovo cria pedido → DHL avança 3 vezes → Lenovo confirma → estoque final confere; segunda aba reflete cada passo sem recarregar.

## 8. Fora de escopo (nesta fase)

Login/usuários, notificações por e-mail, integração com sistemas DHL/Lenovo (WMS, SAP),
relatórios e gráficos, múltiplos armazéns, rastreio por unidade física, edição do catálogo
pela tela, exportação.

## 9. Estrutura do repositório (prevista)

```
lenovo-dhl-refurbish/
  docs/specs/                      esta spec e o plano de implementação
  supabase/migrations/             schema, funções, RLS, seed
  src/app/lenovo/  src/app/dhl/  src/app/pedido/[id]/
  src/lib/supabase.ts              client
  src/lib/types.ts                 tipos gerados do banco
  .env.example                     NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
```
