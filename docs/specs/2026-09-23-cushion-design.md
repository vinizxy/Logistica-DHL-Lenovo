# Pedido de cushion — Lenovo × DHL

**Data:** 2026-09-23
**Status:** aprovado (design validado em conversa; implementação sem novas paradas)

## 1. Problema

Além das caixas, a linha de refurbish usa **cushions**: os acessórios que protegem a máquina
dentro da caixa. Hoje eles não estão no sistema. A Lenovo quer pedir cushion do mesmo jeito
que pede caixa, e a DHL quer controlar o estoque dos dois no mesmo lugar.

Cada cushion tem serial e modelo próprios, e **muitos cushions servem em várias máquinas**.

## 2. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Pedido | Caixas e cushions no **mesmo carrinho/pedido** | Um fluxo, uma separação, uma entrega |
| Modelagem | Cushion é uma linha do **mesmo catálogo** (`box_models`) com `kind = 'cushion'` | Reserva, baixa, cancelamento, reposição e alerta de mínimo já existem e estão testados (inclusive concorrência); nada disso é reescrito |
| Compatibilidade | Tabela `cushion_fits` (cushion ↔ caixa de cada máquina), muitos-para-muitos | Um cushion serve em várias máquinas; cada máquina do catálogo é representada pela sua caixa |
| Busca | **Pela máquina**: "X1 Carbon" mostra a caixa e todos os cushions que servem nela | A pessoa da linha sabe a máquina, não o código do cushion |
| Cadastro | Só DHL/admin | Igual às caixas |
| Dados de exemplo | Nenhum em produção | A DHL cadastra os cushions reais |

Alternativas descartadas: catálogo separado de cushions (duplicaria toda a lógica de estoque) e
refatorar tudo para "materiais" (mudança grande demais agora; fica como evolução futura).

## 3. Banco (migração `0010_cushion.sql`)

- `box_models.kind text not null default 'caixa' check (kind in ('caixa','cushion'))`.
  Para cushion, `machine_name` guarda o **nome** do cushion e `machine_model` o **modelo**.
- `cushion_fits (cushion_serial → box_models, box_serial → box_models)`, PK dupla, índice por
  `box_serial`, `on delete cascade`. RLS: leitura só para `authenticated`; nenhuma escrita
  direta. Entra na publicação do Realtime.
- `set_cushion_fits(p_serial text, p_box_serials text[]) returns integer` — só DHL. Trava a
  linha do cushion; recusa se não existir, se não for cushion, se a lista vier vazia (mín. 1
  máquina), se passar de 500 ou se algum serial não for uma **caixa** do catálogo. Substitui a
  lista inteira; devolve quantas máquinas ficaram.
- `create_cushion(p_serial, p_name, p_model, p_stock_total, p_min_stock, p_box_serials text[])
  returns text` — só DHL. Reusa `create_box_model` (validações e serial gerado), marca
  `kind = 'cushion'` e chama `set_cushion_fits`, tudo na mesma transação.
- Sem mudança em `create_order`, `advance_order`, `cancel_order`, `restock`,
  `update_box_model`: operam por serial e passam a valer para cushion.
- EXECUTE das funções novas só para `authenticated`.

## 4. Telas

- **/lenovo** — "Estoque na DHL" com filtro **Tudo · Caixas · Cushions**, etiqueta de tipo em
  cada linha, "serve em: …" sob cada cushion, busca que casa também pelas máquinas do cushion.
  Carrinho misto com total separado ("3 caixas · 20 cushions"). Números do topo separados.
- **/dhl** — itens da fila com etiqueta de tipo; estoque com o mesmo filtro; reposição e ⚠ de
  mínimo iguais.
- **/cadastro** — "Cadastro de materiais": formulário com **Caixa / Cushion**; para cushion,
  seletor de máquinas com busca. Tabela com coluna Tipo e botão **Máquinas** para editar a
  lista de cada cushion.
- **/pedido/[id]** — itens com etiqueta de tipo.
- Mesmo estilo visual do site (tokens, fontes e componentes atuais); funciona no celular.

## 5. Testes

- `supabase/tests/cushion.sql` (mesmo padrão dos outros: transação, rollback proposital,
  relatório na mensagem): cadastrar cushion com máquinas; recusas de `set_cushion_fits`
  (lista vazia, serial inexistente, ligar a outro cushion, item que não é cushion); Lenovo não
  cadastra; pedido misto reserva os dois; despacho dá baixa nos dois; cancelamento libera os
  dois; reposição de cushion.
- `security.sql` B2b: incluir as funções novas na lista permitida.
- App: lint, tipos, build e verificação no navegador.

## 6. Fora de escopo

Controle do corredor (retirada por QR Code), quantidade de cushions por caixa, sugestão
automática de cushion ao pedir caixa, relatórios.
