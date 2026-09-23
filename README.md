# PackFlow — Lenovo × DHL

Sistema de pedidos e estoque de caixas e **cushions** (o acessório que protege a máquina dentro
da caixa) para o projeto Refurbish da Lenovo (remanufatura de notebooks devolvidos, revendidos
no outlet). O material fica no armazém da DHL; a Lenovo consulta o estoque e pede; a DHL
separa, despacha e repõe. Os dois lados acompanham cada pedido em tempo real.

Caixas e cushions vão no mesmo pedido. Um cushion pode servir em várias máquinas: buscar
pela máquina (ex.: "X1 Carbon") mostra a caixa dela e todos os cushions que servem nela.
Spec: [docs/specs/2026-09-23-cushion-design.md](docs/specs/2026-09-23-cushion-design.md).

- **Produção:** https://lenovo-dhl-refurbish.vercel.app — deploy manual por enquanto; para deploy automático, conecte o repositório em Vercel → Settings → Git
- **Spec:** [docs/specs/2026-09-20-lenovo-dhl-refurbish-design.md](docs/specs/2026-09-20-lenovo-dhl-refurbish-design.md)
- **Plano:** [docs/specs/2026-09-20-plano-implementacao.md](docs/specs/2026-09-20-plano-implementacao.md)

## Login e perfis

Cada conta tem um perfil **Lenovo**, **DHL** ou **Admin**. Lenovo e DHL só veem o próprio
painel; o banco confere o perfil dentro de cada função: uma conta DHL não cria pedido nem pela
API, uma conta Lenovo não repõe estoque. O admin controla tudo (os dois painéis, o catálogo) e
gerencia contas em `/admin`. Sem login, a API não lê nem escreve nada.

- `/login` — escolha o lado (logo Lenovo ou DHL), e-mail e senha. Conta do outro lado é recusada
  com aviso. Depois de entrar, cada perfil cai no seu painel e o outro redireciona.
- Contas são criadas pelo admin em `/admin` (sem cadastro público): criar, editar perfil/nome,
  definir senha nova, excluir. As funções `admin_*` escrevem em `auth.users` no formato do
  GoTrue, então não há service role no frontend. Alternativas: o script
  `supabase/scripts/create_test_users.mjs` (service role no `.env.local`) ou Authentication →
  Add user no painel do Supabase (com `role` no **app** metadata e `display_name` no user metadata).
- O perfil de uma conta nova vem só de `raw_app_meta_data` (que apenas o servidor grava); sem ele,
  vale o domínio do e-mail (`@lenovo.com` / `@dhl.com`), que nunca dá admin. O `role` que o
  cliente manda no cadastro é ignorado.
- Contas de teste: `teste123@lenovo.com` / `teste123@dhl.com` e um admin. As senhas não ficam
  neste repositório (ele é público); peça ao administrador.
- Spec: [docs/specs/2026-09-21-login-design.md](docs/specs/2026-09-21-login-design.md).

> Desligue **Authentication → Providers → Email → "Enable sign ups"** no painel do Supabase para
> fechar o cadastro público de vez. Não há cadastro pela tela; todas as contas vêm do `/admin`.

## Telas

| Rota | Perfil | O que faz |
|---|---|---|
| `/login` | — | Entrar como Lenovo ou DHL (o admin entra por qualquer um dos dois) |
| `/admin` | Admin | Contas: criar, editar perfil/nome, nova senha, excluir |
| `/lenovo` | Lenovo | Vê estoque disponível (filtro Tudo/Caixas/Cushions, busca pela máquina), monta pedido multi-item misturando caixas e cushions (com − / +), marca urgente, acompanha, confirma entrega, cancela, exclui pedidos encerrados **da própria lista** (a DHL continua vendo) |
| `/dhl` | DHL | Fila por etapa com urgentes no topo, informa previsão de entrega ao despachar, estoque com busca e alerta de mínimo, reposição; histórico permanente |
| `/pedido/[id]` | Ambos | Linha do tempo do pedido, previsão de entrega, itens, histórico e comentários (assinados pelo perfil); a Lenovo confirma a entrega por aqui também |
| `/cadastro` | DHL | Catálogo de materiais: incluir caixa (serial gerado se vazio) ou cushion (só o serial e as máquinas em que serve), editar nome/modelo/mínimo, trocar as máquinas de um cushion, descontinuar/reativar |

## Fluxo de um pedido

```
Lenovo cria ──► Enviado ──► Recebido ──► Em separação ──► Em transporte ──► Entregue
                (reserva)     DHL           DHL          DHL (baixa real)   Lenovo confirma
                   │            │
                   └────────────┴──► Cancelado (Lenovo; libera a reserva)
```

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind) — deploy na Vercel
- **Supabase** — Postgres 17 + Auth + Realtime; sessão em cookie via `@supabase/ssr`,
  `src/proxy.ts` faz o roteamento por perfil
- Regras de negócio em **funções SQL** (`supabase/migrations/`): reservar, baixar e liberar
  estoque acontece em transação, com trava de linha; cada função lê `auth.uid()` e recusa o
  perfil errado. O frontend só chama `rpc()` e mostra a mensagem que o banco devolve.
- RLS: leitura só para logados e **nenhuma escrita direta** — toda escrita passa pelas funções.

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
7. `0007_auth.sql` — perfis (`profiles`, trigger em `auth.users`), `require_role()` em toda função, `hide_order` no lugar de `delete_order`, leitura/EXECUTE só para `authenticated`, colunas de auditoria (`created_by`, `user_id`)
   `0007b_admin_role_enum.sql` — acrescenta `admin` ao enum de perfis (arquivo separado: o valor precisa estar commitado antes do 0008 usá-lo)
8. `0008_admin.sql` — perfil `admin` (passa em qualquer checagem) e gestão de contas: `admin_list_users`, `admin_create_user`, `admin_update_user`, `admin_set_password`, `admin_delete_user`
9. `0009_signup_role_fix.sql` — correção de segurança: o perfil de conta nova vem de `raw_app_meta_data`, não do user metadata que o cliente controla (antes, o cadastro público podia criar admin)
10. `0010_cushion.sql` — cushion no mesmo catálogo (`box_models.kind`), tabela `cushion_fits` (em quais máquinas cada cushion serve), `create_cushion` e `set_cushion_fits` (só DHL); reserva/baixa/cancelamento/reposição seguem nas funções existentes
11. `0011_cushion_serial_only.sql` — cushion identificado só pelo serial (obrigatório): `create_cushion(serial, estoque, mínimo, máquinas)`; nome/modelo ficam derivados (`Cushion` + serial) e a edição de cushion só muda mínimo e situação

Testes (todos com rollback proposital: rodam inteiros numa transação e terminam com um
`RAISE EXCEPTION` contendo o relatório — o banco fica intocado; sucesso = `0 falhas`):

Os `.sql` simulam a sessão de cada conta de teste (`request.jwt.claim.sub`), então as contas
precisam existir.

- `supabase/tests/rules.sql` (29) — regras de estoque e fluxo de status
- `supabase/tests/features.sql` (22) — urgente, previsão, comentários, cadastro, ocultação
- `supabase/tests/admin_api.mjs` (76) — pela API, com login real: admin cria conta de cada perfil e
  loga com cada uma; validações; senha trocada (antiga falha, nova entra); perfil trocado muda as
  permissões na hora; estoque pelo admin (cadastrar, repor, mínimo, descontinuar, limites); conta
  excluída não loga, sessão cai, pedidos ficam; segundo admin. Roda com
  `node --dns-result-order=ipv4first supabase/tests/admin_api.mjs`
- `supabase/tests/admin.sql` (27) — só admin gerencia contas; ciclo criar → senha → perfil → excluir;
  admin não apaga nem rebaixa a si mesmo; admin opera os dois lados; pedidos sobrevivem à exclusão da conta
- `supabase/tests/cushion.sql` (29) — cadastro de cushion pelo serial com máquinas, troca e recusas da lista,
  perfis, pedido misto caixa + cushion (reserva, baixa no despacho, cancelamento, reposição)
- `supabase/tests/security.sql` (64) — sem login nada lê nem escreve; logado não escreve direto em
  tabela; cada perfil só executa o que é dele (seção P); funções internas sem EXECUTE; entradas
  hostis recusadas com mensagem legível; invariantes de estoque no banco inteiro
- `supabase/tests/concurrency.mjs` (19) — pela API, com login: acesso por perfil, 12 pedidos
  simultâneos brigando pelo mesmo estoque, cliques paralelos em avançar/cancelar, `hide_order`.
  Roda com `node --dns-result-order=ipv4first supabase/tests/concurrency.mjs`; os pedidos de
  teste ficam encerrados e ocultos da Lenovo (o `reset_demo.sql` limpa).

Cole os `.sql` no SQL Editor do Supabase e leia o relatório na mensagem de erro.

### Testes locais, sem tocar o Supabase

```bash
npm run test:db
```

Sobe um Postgres em memória ([PGlite](https://pglite.dev)) que imita o Supabase (schema `auth`,
`auth.uid()`, papéis `anon`/`authenticated`), aplica todas as migrações, cria as contas de teste e:

- roda todos os `.sql` de `supabase/tests/`, cada um num banco novo
  (`node supabase/tests/local/run-sql.mjs [arquivo.sql]`);
- roda a **simulação de estoque** (`supabase/tests/local/stock-sim.mjs [semente] [passos]`):
  centenas de operações aleatórias pelas funções do banco — pedidos mistos de caixa e cushion,
  pedidos acima do disponível, avançar, despachar, entregar, cancelar (inclusive fora de hora),
  repor (inclusive quantidade inválida) e ações com o perfil errado. Depois de cada passo
  compara total, reservado e disponível de cada item com um modelo calculado à parte, e confere
  no banco inteiro que o reservado é a soma dos pedidos abertos. A mesma semente repete a mesma
  sequência, então uma falha é reproduzível.

O PGlite tem uma conexão só: concorrência de verdade continua coberta pelo `concurrency.mjs`
contra a API.

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
