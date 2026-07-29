-- M1-F S8-E2 (parte 2/2) — remoção física das 3 colunas legadas de
-- profiles (docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §46).
-- Migration anterior (20260729190000) já parou todo escritor/leitor
-- ativo (accept_invite/update_membership_role) — esta migration remove
-- exclusivamente o armazenamento.
--
-- Dependências exclusivas removidas primeiro, na ordem auditada no
-- estado ATIVO do catálogo:
--   - profiles_company_id_fkey (FK -> companies) — exclusiva de
--     company_id.
--   - profiles_seller_id_fkey (FK -> sellers) — exclusiva de
--     seller_id.
--   - profiles_company_id_idx (btree em company_id) — exclusivo.
--   - profiles_company_id_uidx (UNIQUE company_id, id) — confirmado
--     ÓRFÃO por auditoria: nenhuma FK externa referencia esse par
--     composto (as FKs de autoria de leads/lead_timeline_entries já
--     apontam para company_memberships(company_id, profile_id) desde
--     S8-C2-C1-AUTH-A1/S8-C2-D1-TIMELINE-AUTH-A1) — seguro remover
--     junto de company_id.
--   - profiles_seller_id_idx (btree em seller_id) — exclusivo.
--
-- platform_role, id, name, email, is_active, created_at, updated_at
-- permanecem intactos. company_memberships/sellers/enums usados por
-- elas não são tocados. O enum user_role (tipo da coluna role) fica
-- órfão após esta migration — mantido de propósito (não solicitado
-- pela decisão humana desta etapa; risco residual menor, registrado no
-- design doc, não bloqueante).
--
-- Sem CASCADE, sem IF EXISTS: falha alto se o catálogo não corresponder
-- exatamente ao auditado.
begin;

alter table public.profiles drop constraint profiles_company_id_fkey;
alter table public.profiles drop constraint profiles_seller_id_fkey;
drop index public.profiles_company_id_idx;
alter table public.profiles drop constraint profiles_company_id_uidx;
drop index public.profiles_seller_id_idx;

alter table public.profiles
  drop column company_id,
  drop column role,
  drop column seller_id;

commit;
