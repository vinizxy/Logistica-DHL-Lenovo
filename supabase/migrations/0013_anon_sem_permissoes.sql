-- 0013: quem não está logado não tem nenhuma permissão nas tabelas.
--
-- As tabelas herdaram do Supabase REFERENCES e TRIGGER para o papel anon. Não dá acesso a dados
-- (o RLS barra a leitura), mas anon nunca precisa de nada aqui: o site inteiro exige login.
-- O PackFlow DHL já revoga tudo do anon desde a migração 0001; isto alinha os dois bancos.

revoke all on public.profiles, public.box_models, public.cushion_fits, public.orders,
  public.order_items, public.order_events, public.order_comments from anon;
