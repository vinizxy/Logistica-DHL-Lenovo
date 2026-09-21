# Login e perfis — Lenovo × DHL

**Data:** 2026-09-21
**Status:** implementado (migração 0007, commit da tela em 2026-09-21)
**Depende de:** spec de 2026-09-20 (sistema base), migrações 0001–0006

## 1. Objetivo

Fechar o sistema com login por e-mail/senha e dois perfis — **Lenovo** e **DHL** — com
separação estrita: cada perfil só vê e opera o próprio painel, e o banco recusa qualquer
ação do perfil errado, mesmo pela API. Sem login, a API não lê nem escreve nada.

## 2. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Autenticação | Supabase Auth, e-mail/senha | Já está no projeto; sessão em cookie via `@supabase/ssr` |
| Perfis | `lenovo` \| `dhl`, um por conta, em `profiles` | Transparente e editável; sem perfil admin nesta fase |
| Onde a regra vive | Nas funções SQL (`auth.uid()` → perfil) | Mesmo princípio do sistema: regra no banco, não na tela |
| Criação de contas | Só pelo administrador (script ou painel do Supabase) | Sem cadastro público; contas nascem confirmadas |
| Catálogo (`/cadastro`) | Só DHL | DHL é dona do estoque |
| Excluir pedido | Lenovo: oculta só da lista dela (`hidden_by_lenovo`). DHL: sem exclusão | Histórico do armazém é permanente; nada some do banco |
| Solicitante | Campo continua, pré-preenchido com o nome da conta | Uma conta pode ser usada por um turno inteiro |
| Ator de avanço/comentário | Vem do perfil, não é mais parâmetro | Impossível se passar pelo outro lado |
| Logo DHL | Enviado pelo usuário → `public/dhl-logo.png`; placeholder textual até lá | Marca registrada; não baixar da web |

## 3. Banco — migração `0007_auth.sql`

### 3.1 Perfis

```sql
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         public.actor_role not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  created_at   timestamptz not null default now()
);
```

Trigger `after insert on auth.users` cria o perfil:
- `role` = `raw_user_meta_data->>'role'`; se ausente, pelo domínio do e-mail
  (`@lenovo.com` → lenovo, `@dhl.com` → dhl); qualquer outro caso → exceção, conta não é criada.
- `display_name` = `raw_user_meta_data->>'display_name'`, senão a parte do e-mail antes do `@`.

RLS em `profiles`: `select` para `authenticated` (todos veem nome/papel de todos — necessário
para o Nav e para exibir autor). Sem escrita direta.

### 3.2 Função auxiliar

```sql
public.require_role(p_expected public.actor_role default null) returns public.profiles
```
- `auth.uid()` nulo → `'Faça login para continuar.'`
- sem linha em `profiles` → `'Conta sem perfil. Fale com o administrador.'`
- `p_expected` informado e diferente do papel → `'Só a LENOVO pode fazer isso.'` / `'Só a DHL pode fazer isso.'`
- devolve o perfil (papel + nome) para a função chamadora usar.

### 3.3 Funções de escrita

| Função | Assinatura nova | Exige | Notas |
|---|---|---|---|
| `create_order(p_requested_by, p_notes, p_items, p_urgent)` | igual | lenovo | grava `orders.created_by = auth.uid()` |
| `cancel_order(p_order_id)` | igual | lenovo | — |
| `hide_order(p_order_id)` | **nova** | lenovo | só `entregue`/`cancelado`; seta `hidden_by_lenovo = true`; já oculto → sem erro |
| `advance_order(p_order_id, p_eta)` | **sem `p_actor`** | passo a passo: enviado/recebido/em_separacao → dhl; em_transporte → lenovo | mensagem de papel errado continua: `Só a DHL pode mover o pedido #N de "X" para "Y".` |
| `restock(p_serial, p_quantity)` | igual | dhl | — |
| `create_box_model(...)`, `update_box_model(...)` | iguais | dhl | — |
| `add_comment(p_order_id, p_body)` | **sem `p_actor`, sem `p_author`** | qualquer perfil | `actor` e `author` vêm do perfil |
| `delete_order` | **removida** | — | substituída por `hide_order` |

Colunas novas: `orders.hidden_by_lenovo boolean not null default false`,
`orders.created_by uuid`, `order_events.user_id uuid`, `order_comments.user_id uuid`
(todas `references auth.users (id) on delete set null`, para auditoria).

Índice: `orders (hidden_by_lenovo, created_at desc)` — lista da Lenovo.

### 3.4 Acesso

- Policies de `select` das 5 tabelas + `profiles`: `to authenticated` (as policies `to anon` são removidas).
- `revoke execute` de todas as funções públicas `from anon`; `grant ... to authenticated`.
- Publicação Realtime: inalterada; o client assina com o JWT do usuário.
- Efeito colateral desejado: os 8 avisos "SECURITY DEFINER executável por anon" do advisor somem.

### 3.5 Testes SQL

Simulação de sessão nos testes: `select set_config('request.jwt.claim.sub', '<uuid>', true)` e
`set local role authenticated` — é como `auth.uid()` é resolvido. Os dois usuários de teste
precisam existir no banco (criados pelo script da seção 5). Cada suíte define
`pg_temp.as_lenovo()` / `pg_temp.as_dhl()` / `pg_temp.as_nobody()`.

Adaptações: `rules.sql`, `features.sql`, `security.sql` trocam `advance_order(o, 'dhl')` por
`as_dhl(); advance_order(o)` etc., e `add_comment` perde os dois parâmetros. Casos novos em
`security.sql`:
- sem sessão: `create_order`, `restock`, leitura de `orders` → recusados
- Lenovo tenta `restock`/`create_box_model`/`update_box_model` → `Só a DHL…`
- DHL tenta `create_order`/`cancel_order`/`hide_order` → `Só a LENOVO…`
- DHL tenta confirmar entrega; Lenovo tenta receber → recusados
- `hide_order`: em andamento → recusado; entregue → `hidden_by_lenovo`, linha continua existindo, DHL continua lendo
- `add_comment` grava `actor`/`author`/`user_id` do perfil, ignorando o que a tela mandar

`concurrency.mjs` faz login com as duas contas (senha via `.env.local`) e usa o token de cada
uma; a limpeza final usa `hide_order` para a Lenovo e não apaga nada (pedidos de teste ficam no
histórico da DHL marcados por `requested_by like 'Paralelo%'` — o `reset_demo.sql` limpa).

## 4. Frontend

### 4.1 Sessão

- `@supabase/ssr` adicionado.
- `src/lib/supabase.ts`: `createBrowserClient` (mesmo export `supabase`; `actions.ts`, `queries.ts`,
  `useLiveData.ts` mantêm as assinaturas).
- `src/lib/supabase-server.ts`: client para Server Components/proxy, lendo cookies.
- `src/lib/auth.ts`: tipos `Profile`, helper `fetchProfile()`.
- `src/proxy.ts`: renova a sessão a cada requisição e redireciona:

| Rota | Sem sessão | Lenovo | DHL |
|---|---|---|---|
| `/login` | mostra | → `/lenovo` | → `/dhl` |
| `/lenovo` | → `/login` | ok | → `/dhl` |
| `/dhl`, `/cadastro` | → `/login` | → `/lenovo` | ok |
| `/pedido/[id]` | → `/login` | ok | ok |
| `/` | → `/login` | → `/lenovo` | → `/dhl` |

Sessão sem perfil → `/login?erro=sem-perfil` e sign-out.

### 4.2 Tela `/login`

- Layout próprio (sem `Nav`), centralizado, fundo grafite.
- Dois cartões lado a lado (empilhados no celular): logo Lenovo | logo DHL. Clicar seleciona; o
  selecionado ganha borda vermelha e `aria-pressed`.
- Abaixo: e-mail, senha, botão `Entrar como Lenovo` / `Entrar como DHL` (desabilitado sem seleção).
- Fluxo: `signInWithPassword` → `fetchProfile` → se `profile.role !== selecionado`: sign-out e
  mensagem *"Essa conta é da DHL. Escolha DHL para entrar."* (seleção sugerida troca para a certa);
  senão `router.replace` para o painel.
- Erros: credenciais erradas → *"E-mail ou senha incorretos."*; rede → *"Sem conexão. Tente de novo."*
- Logo DHL: `public/dhl-logo.png` quando enviado; até lá, placeholder `<DhlMark />` textual
  (amarelo/vermelho da marca, mesmo tamanho do logo Lenovo).

### 4.3 `AuthProvider` e `Nav`

- `src/components/AuthProvider.tsx` (client): expõe `{ user, profile, signOut }`; escuta
  `onAuthStateChange`; `SIGNED_OUT` → `router.replace('/login')`.
- `Nav`: logo · link do painel do perfil (+ `Cadastro` se DHL) · `display_name` · `Sair`.
  Em `/login` o `Nav` não é renderizado.

### 4.4 Páginas

- `/lenovo`: Solicitante pré-preenchido com `profile.display_name` (localStorage deixa de ser
  usado); Excluir → `hideOrder`; `fetchOrders` filtra `hidden_by_lenovo = false` quando o perfil é
  Lenovo (parâmetro do fetcher).
- `/dhl`: sem Excluir; `advanceOrder(id, eta?)`.
- `/pedido/[id]`: `Comments` sem seletor Lenovo/DHL e sem campo nome; `addComment(id, body)`;
  faixa "Confirmar entrega" só para `profile.role === 'lenovo'`.
- `/cadastro`: sem mudança visual.
- `actions.ts`: `hideOrder` no lugar de `deleteOrder`; `advanceOrder` e `addComment` com as novas
  assinaturas; erro `'Faça login para continuar.'` dispara `signOut` no `AuthProvider`.

## 5. Contas

Script `supabase/scripts/create_test_users.mjs` (usa `SUPABASE_SERVICE_ROLE_KEY` do `.env.local`,
que fica fora do git; `.env.example` ganha a linha comentada):

| E-mail | Senha | role | display_name |
|---|---|---|---|
| teste123@lenovo.com | teste123 | lenovo | Lenovo Teste |
| teste123@dhl.com | teste123 | dhl | DHL Teste |

Idempotente (se a conta existe, só atualiza senha/metadata). `email_confirm: true`.
Contas reais depois: mesmo script com outros dados, ou Authentication → Add user no painel, com
`role` e `display_name` no *user metadata*. Confirmação por e-mail desligada nesta fase.

## 6. Erros e resiliência

- Sessão expirada/revogada durante o uso: a ação seguinte devolve `Faça login para continuar.`;
  o `AuthProvider` faz sign-out e manda para `/login`.
- Token do Realtime: o client renova sozinho; se o canal cair, o polling de 15 s existente cobre.
- Conta sem perfil: bloqueada no proxy e no login, com mensagem para procurar o administrador.

## 7. Sequência de implementação

1. Migração 0007, script de contas, testes SQL adaptados; rodar as 3 suítes (0 falhas).
2. `@supabase/ssr`, clients, proxy, `AuthProvider`, `/login`, `Nav`.
3. Ajustes nas 4 páginas e em `actions.ts`/`queries.ts`.
4. `concurrency.mjs` com login.
5. Verificação no preview: login errado, lado errado, Lenovo em `/dhl`, fluxo completo com as duas
   contas em abas separadas (Realtime entre elas), celular.
6. README, `reset_demo.sql` (zera `hidden_by_lenovo`), deploy quando liberado.

## 8. Fora de escopo

Recuperar/trocar senha na tela, perfil admin, cadastro público, várias contas por lado com
permissões diferentes, e-mail de confirmação, auditoria visível na tela (as colunas `user_id`
ficam gravadas para uso futuro).
