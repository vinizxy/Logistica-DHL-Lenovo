# Pedido de cushion — Plano de implementação

> **Execução:** inline nesta sessão (o usuário pediu para seguir sem novas perguntas).
> Passos com checkbox (`- [ ]`) para acompanhar.

**Objetivo:** a Lenovo pede cushions no mesmo carrinho das caixas; a DHL cadastra, separa e
repõe cushions como faz com caixas.

**Arquitetura:** cushion é uma linha do catálogo `box_models` com `kind = 'cushion'`; a
compatibilidade fica em `cushion_fits`. Reserva/baixa/cancelamento/reposição continuam nas
funções existentes (operam por serial). No front, um módulo de regras puras
(`src/lib/catalog.ts`) e um de componentes (`src/components/catalog.tsx`) são usados pelas
quatro telas.

**Stack:** Next.js 16 (App Router), React 19, Tailwind 4, Supabase (Postgres 17, RLS, Realtime).

**Spec:** [2026-09-23-cushion-design.md](2026-09-23-cushion-design.md)

## Restrições globais

- Toda escrita passa por função SQL `security definer` com `set search_path = ''`, objetos
  qualificados (`public.`), `require_role(...)` no início; EXECUTE só para `authenticated`.
- Mensagens de erro em PT-BR, prontas para a tela (`raise exception` = SQLSTATE P0001).
- Sem dados de exemplo em produção.
- Visual: tokens de `src/app/globals.css`, componentes de `src/components/ui.tsx`; sem caixa
  alta em rótulos novos; funciona no celular (lista em cartões abaixo de `md`).
- Texto de interface em português simples, voz ativa.

## Arquivos

| Arquivo | Papel |
|---|---|
| `supabase/migrations/0010_cushion.sql` (novo) | coluna `kind`, tabela `cushion_fits`, `set_cushion_fits`, `create_cushion` |
| `supabase/tests/cushion.sql` (novo) | testes do banco (padrão dos outros: rollback proposital) |
| `supabase/tests/security.sql` | lista B2b inclui as funções novas |
| `src/lib/types.ts` | `ItemKind`, `BoxModel.kind`, `CushionFit`, `kind` no item do pedido |
| `src/lib/catalog.ts` (novo) | regras puras: rótulos, busca por máquina, ordenação, resumo de unidades |
| `src/lib/queries.ts` | `fetchFits`, `fetchCatalog`; `fits` nos fetchers das telas; `kind` no select do pedido |
| `src/lib/actions.ts` | `createCushion`, `setCushionFits` |
| `src/lib/useLiveData.ts` | assina `cushion_fits` |
| `src/components/catalog.tsx` (novo) | `KindTag`, `KindTabs`, `FitsLine`, `MachinePicker` |
| `src/app/lenovo/page.tsx` | filtro, etiqueta, "serve em", busca por máquina, carrinho misto |
| `src/app/dhl/page.tsx` | etiqueta na fila, filtro e busca no estoque |
| `src/app/cadastro/page.tsx` | formulário Caixa/Cushion, seletor de máquinas, editar máquinas |
| `src/app/pedido/[id]/page.tsx` | etiqueta nos itens, título com resumo |
| `README.md` | migração 0010, teste `cushion.sql`, rotas |

---

### Tarefa 1: Banco — migração 0010 com testes (TDD num Postgres local)

**Interfaces produzidas:**
- `box_models.kind text` (`'caixa' | 'cushion'`, padrão `'caixa'`)
- `cushion_fits(cushion_serial text, box_serial text, created_at timestamptz)`
- `set_cushion_fits(p_serial text, p_box_serials text[]) returns integer`
- `create_cushion(p_serial text, p_name text, p_model text, p_stock_total integer default 0, p_min_stock integer default 0, p_box_serials text[] default '{}') returns text`

- [ ] **Passo 1: harness local.** No scratchpad, `npm i @electric-sql/pglite` e um script
  `run.mjs` que: cria roles `anon`/`authenticated`, schema `auth` (tabelas `users` e
  `identities` com as colunas usadas pelas migrações, função `auth.uid()` lendo
  `request.jwt.claim.sub`), schema `extensions` com `pgcrypto`, publicação
  `supabase_realtime`; aplica `0001`…`0009` (cada arquivo num `exec` próprio, para o `0007b`
  commitar o enum antes do `0008`); cria as contas de teste inserindo em `auth.users` com
  `raw_app_meta_data.role`; roda um arquivo de teste e imprime a mensagem do
  `RAISE EXCEPTION` final.
- [ ] **Passo 2: escrever `supabase/tests/cushion.sql`** (código na seção "Testes do banco").
- [ ] **Passo 3: rodar e ver falhar** — `node run.mjs cushion.sql` sem a 0010: erro
  "function public.create_cushion ... does not exist".
- [ ] **Passo 4: escrever `0010_cushion.sql`** (código na seção "Migração").
- [ ] **Passo 5: rodar e ver passar** — `node run.mjs cushion.sql` → `0 falhas`. Rodar também
  `rules.sql` e `features.sql` para garantir que nada antigo quebrou.
- [ ] **Passo 6: `security.sql` B2b** — incluir `'create_cushion','set_cushion_fits'` na
  lista (e os `admin_*`, que já são do `authenticated` desde a 0008).
- [ ] **Passo 7: aplicar em produção** (`apply_migration`, nome `cushion`) e commit.

#### Migração

```sql
-- Cushion: acessório que protege a máquina dentro da caixa. Fica no mesmo catálogo das
-- caixas (kind = 'cushion'): machine_name = nome do cushion, machine_model = modelo.
-- Reserva, baixa, cancelamento, reposição e mínimo continuam nas funções existentes.

alter table public.box_models
  add column kind text not null default 'caixa'
  constraint box_models_kind_check check (kind in ('caixa', 'cushion'));

-- Em quais máquinas cada cushion serve; cada máquina é representada pela sua caixa.
create table public.cushion_fits (
  cushion_serial text not null references public.box_models (serial) on delete cascade,
  box_serial     text not null references public.box_models (serial) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (cushion_serial, box_serial),
  constraint cushion_fits_not_self check (cushion_serial <> box_serial)
);
create index cushion_fits_box_idx on public.cushion_fits (box_serial);

alter table public.cushion_fits enable row level security;
create policy "leitura de logados" on public.cushion_fits for select to authenticated using (true);
revoke all on public.cushion_fits from anon;
revoke insert, update, delete, truncate on public.cushion_fits from authenticated;
alter publication supabase_realtime add table public.cushion_fits;

-- Troca a lista inteira de máquinas de um cushion. Só DHL.
create or replace function public.set_cushion_fits(p_serial text, p_box_serials text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.box_models%rowtype;
  v_serials text[];
  v_missing text;
begin
  perform public.require_role('dhl');

  select * into v_item from public.box_models
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if not found then
    raise exception 'Cushion % não existe no catálogo.', coalesce(nullif(btrim(p_serial), ''), '(sem serial)');
  end if;
  if v_item.kind <> 'cushion' then
    raise exception '% % é uma caixa, não um cushion.', v_item.machine_name, v_item.machine_model;
  end if;

  select coalesce(array_agg(distinct upper(btrim(s))), '{}') into v_serials
    from unnest(coalesce(p_box_serials, '{}')) s
   where btrim(coalesce(s, '')) <> '';
  if cardinality(v_serials) = 0 then
    raise exception 'Marque pelo menos uma máquina em que o cushion serve.';
  end if;
  if cardinality(v_serials) > 500 then
    raise exception 'Um cushion pode servir em no máximo 500 máquinas.';
  end if;

  select string_agg(left(s, 20), ', ' order by s) into v_missing
    from unnest(v_serials) s
   where not exists (select 1 from public.box_models b where b.serial = s and b.kind = 'caixa');
  if v_missing is not null then
    raise exception 'Máquina não encontrada no catálogo de caixas: %.', left(v_missing, 200);
  end if;

  delete from public.cushion_fits where cushion_serial = v_item.serial;
  insert into public.cushion_fits (cushion_serial, box_serial)
  select v_item.serial, s from unnest(v_serials) s;
  return cardinality(v_serials);
end;
$$;

-- Cadastra cushion já com as máquinas, numa transação só. Só DHL.
create or replace function public.create_cushion(
  p_serial text,
  p_name text,
  p_model text,
  p_stock_total integer default 0,
  p_min_stock integer default 0,
  p_box_serials text[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial text;
begin
  perform public.require_role('dhl');
  perform public.check_text(p_name, 'Informe o nome do cushion.', 'Nome do cushion', 80);
  if cardinality(coalesce(p_box_serials, '{}')) = 0 then
    raise exception 'Marque pelo menos uma máquina em que o cushion serve.';
  end if;

  v_serial := public.create_box_model(p_serial, p_name, p_model, p_stock_total, p_min_stock);
  update public.box_models set kind = 'cushion' where serial = v_serial;
  perform public.set_cushion_fits(v_serial, p_box_serials);
  return v_serial;
end;
$$;

revoke all on function public.set_cushion_fits(text, text[]) from public, anon;
revoke all on function public.create_cushion(text, text, text, integer, integer, text[]) from public, anon;
grant execute on function public.set_cushion_fits(text, text[]) to authenticated;
grant execute on function public.create_cushion(text, text, text, integer, integer, text[]) to authenticated;
```

#### Testes do banco (`supabase/tests/cushion.sql`)

Cobertura (cada item um `pg_temp.ok`):
- C1 DHL cadastra cushion com 2 máquinas → `kind = 'cushion'`, 2 linhas em `cushion_fits`.
- C2 caixa nova nasce `kind = 'caixa'`.
- C3 `create_cushion` sem máquinas → "Marque pelo menos uma máquina…", nada gravado.
- C4 `create_cushion` com nome vazio → "Informe o nome do cushion."
- C5 `set_cushion_fits` troca a lista (3 máquinas → 1).
- C6 lista vazia recusada; C7 serial inexistente recusado; C8 ligar a outro cushion recusado;
  C9 `set_cushion_fits` num item que é caixa recusado; C10 duplicados/minúsculas normalizados.
- C11 Lenovo não cadastra cushion; C12 Lenovo não troca máquinas.
- C13 pedido misto (caixa + cushion) reserva os dois; C14 despacho baixa os dois;
  C15 cancelamento de outro pedido misto libera os dois; C16 reposição de cushion soma.
- C17 cushion descontinuado não entra em pedido (regra existente vale).

### Tarefa 2: Front — dados e regras puras

**Interfaces produzidas:**
- `types.ts`: `type ItemKind = "caixa" | "cushion"`; `BoxModel.kind: ItemKind`;
  `interface CushionFit { cushion_serial: string; box_serial: string }`;
  `OrderItem.box_models: Pick<BoxModel, "machine_name" | "machine_model" | "kind"> | null`.
- `catalog.ts`: `KIND_LABEL`, `type KindFilter = "tudo" | ItemKind`, `itemName(b)`,
  `buildFitsIndex(fits)` → `Map<string, string[]>`, `matchItem(item, q, fitsOf, bySerial)` →
  `{ match: boolean; hits: Set<string> }`, `sortCatalog(items)`, `unitsSummary(lines)`.
- `queries.ts`: `fetchFits()`, `fetchCatalog()` → `{ boxes, fits }`; `fetchLenovoData` e
  `fetchDhlData` → `{ boxes, fits, orders }`.
- `actions.ts`: `createCushion({ serial, name, model, stockTotal, minStock, machines })` →
  `Result<string>`; `setCushionFits(serial, machines)` → `Result<number>`.
- `useLiveData.ts`: `TABLES` inclui `"cushion_fits"`.

- [ ] Passo 1: tipos. - [ ] Passo 2: `catalog.ts`. - [ ] Passo 3: queries/actions/useLiveData.
- [ ] Passo 4: `npx tsc --noEmit` (as telas ainda compilam: `kind` é campo novo).

### Tarefa 3: Componentes do catálogo (`src/components/catalog.tsx`)

- `KindTag({ kind, small? })` — símbolo + texto, padrão do `StatusBadge`. Caixa: quadrado
  vazado em `text-ink-2`. Cushion: bloco arredondado em `text-sky`. Forma diferente além da cor.
- `KindTabs({ value, onChange, counts })` — abas sublinhadas (mesmo padrão da fila da DHL):
  "Tudo", "Caixas", "Cushions", com contagem.
- `FitsLine({ machines, hits })` — "Serve em X, Y e mais N"; máquinas em `hits` em
  `text-ink font-medium`, primeiro; mostra até 3 (todas quando há busca).
- `MachinePicker({ machines, value, onChange })` — busca + lista com checkbox (máx. 14rem,
  rolagem), marcadas no topo, contador "N marcadas" e "Limpar".

- [ ] Passo 1: escrever. - [ ] Passo 2: `tsc`.

### Tarefa 4: Telas

- **/lenovo**: `StockTable` recebe `items`, `fitsOf`, `bySerial`; estado `filter`; busca via
  `matchItem`; ordena com `sortCatalog`; `KindTag` ao lado do nome; `FitsLine` sob cushion;
  título "Estoque na DHL"; placeholder "Buscar máquina, serial ou cushion". Topo: "caixas
  disponíveis" e "cushions disponíveis". Carrinho: `KindTag small` em cada linha, rodapé com
  `unitsSummary`. "Pedidos": coluna itens com `unitsSummary`. Textos: "pedir caixas e
  cushions", "Linha parada esperando material".
- **/dhl**: fila com `KindTag small` por item e "`unitsSummary` no total"; estoque com
  `KindTabs`, busca por máquina, `KindTag`; subtítulo "separar, despachar e repor caixas e
  cushions".
- **/cadastro**: "Cadastro de materiais"; formulário com seletor Caixa/Cushion (dois botões,
  `aria-pressed`); cushion pede nome, modelo, máquinas (`MachinePicker`, obrigatório);
  tabela com coluna Tipo, `KindTabs`, `FitsLine` sob cushion e botão "Máquinas" que abre
  linha de edição com `MachinePicker` → `setCushionFits`. Stats: caixas, cushions,
  descontinuados.
- **/pedido/[id]**: `KindTag small` nos itens; título "Itens — `unitsSummary`";
  "O pedido está a caminho da Lenovo".

- [ ] Passo 1: telas. - [ ] Passo 2: `tsc`, `eslint`, `next build`.
- [ ] Passo 3: navegador (login feito pelo usuário no painel do navegador): pedir caixa +
  cushion, avançar na DHL, cadastrar cushion, editar máquinas, celular (375 px).
- [ ] Passo 4: README e commit.
