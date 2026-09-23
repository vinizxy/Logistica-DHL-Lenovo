-- Valor 'admin' no enum de perfis. Fica num arquivo próprio porque ALTER TYPE ... ADD VALUE
-- precisa estar commitado antes de ser usado (0008_admin.sql usa 'admin').
-- Em produção já foi aplicado como a migration "admin_role_enum".
alter type public.actor_role add value if not exists 'admin';
