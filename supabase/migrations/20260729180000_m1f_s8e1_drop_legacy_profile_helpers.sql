-- M1-F S8-E1 — remoção física dos 4 helpers legados M1-C que liam a
-- identidade empresarial pelas colunas legadas de profiles
-- (docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §45):
--   1. public.current_profile_company_id()
--   2. public.current_profile_role()
--   3. public.current_profile_seller_id()
--   4. public.is_manager_or_admin()
--
-- Auditoria no estado ATIVO do catálogo (dump de pg_get_functiondef de
-- toda função public.*, pg_policies, information_schema.views — nunca
-- migrations históricas, já que funções Postgres são substituídas
-- in-place) confirmou zero consumidor ativo: nenhuma policy, nenhuma
-- outra RPC/função, nenhum trigger, nenhuma view referencia qualquer um
-- dos 4 nomes — o único cruzamento encontrado é interno ao próprio grupo
-- (is_manager_or_admin chama current_profile_role, ambos removidos
-- juntos aqui). Nenhum frontend TypeScript os invoca (confirmado desde
-- S8-D1/S8-D2-A/S8-D2-B). A identidade empresarial real hoje vem
-- inteiramente de company_memberships via current_membership_company_id/
-- current_membership_role/current_profile_seller_id_for_company/
-- is_manager_or_platform/is_platform_super_admin/can_access_company —
-- nenhum desses é tocado por esta migration.
--
-- profiles.company_id/role/seller_id continuam existindo fisicamente no
-- banco (remoção física reservada ao S8-E2). accept_invite continua
-- populando profiles.role/company_id no INSERT inicial, intocado nesta
-- etapa. update_membership_role continua sem sincronizar profiles.role
-- (S8-D2-B), intocado.
--
-- DROP sem CASCADE e sem IF EXISTS de propósito: se a assinatura
-- auditada acima não bater exatamente com o catálogo real no momento em
-- que esta migration rodar, a migration deve falhar alto (erro do
-- Postgres), nunca mascarar uma divergência silenciosamente.
begin;

drop function public.current_profile_company_id();
drop function public.current_profile_role();
drop function public.current_profile_seller_id();
drop function public.is_manager_or_admin();

commit;
