-- M1-F S8-E1 — remoção dos 4 helpers legados M1-C
-- (20260729180000_m1f_s8e1_drop_legacy_profile_helpers.sql,
-- docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §45). Cobre: catálogo
-- (os 4 nomes não existem mais, nenhum overload, nenhum grant residual),
-- helpers ativos preservados intactos, zero dependência (policy/função/
-- trigger/view) nos 4 nomes antigos, autorização real continua vindo de
-- company_memberships/platform_role (nunca de profiles.role/company_id/
-- seller_id divergentes), e regressão (RPCs/colunas/policies vizinhas
-- intocadas). Transação com rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO — os 4 helpers legados não existem mais
-- ══════════════════════════════════════════════════════════════════════

select hasnt_function('public'::name, 'current_profile_company_id'::name,
  'current_profile_company_id() não existe mais no catálogo');
select hasnt_function('public'::name, 'current_profile_role'::name,
  'current_profile_role() não existe mais no catálogo');
select hasnt_function('public'::name, 'current_profile_seller_id'::name,
  'current_profile_seller_id() não existe mais no catálogo');
select hasnt_function('public'::name, 'is_manager_or_admin'::name,
  'is_manager_or_admin() não existe mais no catálogo');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'current_profile_company_id', 'current_profile_role',
      'current_profile_seller_id', 'is_manager_or_admin')),
  0, 'zero overload residual sob qualquer um dos 4 nomes removidos');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name in (
      'current_profile_company_id', 'current_profile_role',
      'current_profile_seller_id', 'is_manager_or_admin')),
  0, 'zero grant residual (EXECUTE) para qualquer um dos 4 nomes removidos');

-- ══════════════════════════════════════════════════════════════════════
-- 2. HELPERS ATIVOS PRESERVADOS
-- ══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'current_membership_company_id'::name, array[]::name[],
  'current_membership_company_id() continua existindo');
select has_function('public'::name, 'current_membership_role'::name, array[]::name[],
  'current_membership_role() continua existindo');
select has_function('public'::name, 'current_profile_seller_id_for_company'::name, array['uuid']::name[],
  'current_profile_seller_id_for_company(uuid) continua existindo');
select has_function('public'::name, 'is_platform_super_admin'::name, array[]::name[],
  'is_platform_super_admin() continua existindo');
select has_function('public'::name, 'can_access_company'::name, array['uuid']::name[],
  'can_access_company(uuid) continua existindo');
select has_function('public'::name, 'is_manager_or_platform'::name, array['uuid']::name[],
  'is_manager_or_platform(uuid) continua existindo');
select has_function('public'::name, 'resolve_lead_mutation_context'::name, array['uuid', 'boolean']::name[],
  'resolve_lead_mutation_context(uuid, boolean) continua existindo');

-- ══════════════════════════════════════════════════════════════════════
-- 3. DEPENDÊNCIAS — zero referência ativa aos 4 nomes antigos
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and (
      coalesce(qual, '') ~ 'current_profile_company_id|current_profile_role|current_profile_seller_id\(|is_manager_or_admin'
      or coalesce(with_check, '') ~ 'current_profile_company_id|current_profile_role|current_profile_seller_id\(|is_manager_or_admin'
    )),
  0, 'nenhuma policy ativa referencia qualquer um dos 4 nomes removidos');

-- prosrc (fonte bruta), nunca pg_get_functiondef(): algumas funções
-- pré-existentes e sem relação com esta etapa (reorder_pipeline_stages,
-- complete_invite_delivery/resend_delivery) fazem pg_get_functiondef()
-- levantar "array_agg is an aggregate function" — uma limitação conhecida
-- do Postgres ao reconstruir certas definições, não um bug introduzido
-- aqui. prosrc evita esse caminho por completo e é igualmente confiável
-- para uma busca textual.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ 'current_profile_company_id\(|current_profile_role\(|current_profile_seller_id\(\)|is_manager_or_admin\('),
  0, 'nenhuma função ativa restante referencia qualquer um dos 4 nomes removidos (inclusive a antiga chamada interna is_manager_or_admin -> current_profile_role, removida junto)');

-- ══════════════════════════════════════════════════════════════════════
-- 4. AUTORIZAÇÃO REAL — sempre via company_memberships/platform_role
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('f8e10000-0000-0000-0000-000000000001', 'S8E1 Empresa A', 'ativa'),
  ('f8e10000-0000-0000-0000-000000000002', 'S8E1 Empresa B (nunca a real do Seller)', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f8e20000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8e1-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f8e20000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8e1-seller-divergente@test.local', now(), now(), now());

-- M1-F S8-E2 removeu profiles.role/company_id/seller_id fisicamente do
-- catálogo — não há mais nenhum campo legado nesta tabela capaz de
-- divergir da membership real. Os dois profiles abaixo continuam
-- provando que current_membership_role/current_membership_company_id/
-- is_manager_or_platform/current_profile_seller_id_for_company derivam
-- exclusivamente de company_memberships/sellers.
insert into public.profiles (id, name, email, is_active, platform_role) values
  ('f8e20000-0000-0000-0000-000000000001', 'S8E1 Manager', 's8e1-manager@test.local', true, null),
  ('f8e20000-0000-0000-0000-000000000002', 'S8E1 Seller Divergente', 's8e1-seller-divergente@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, created_at) values
  ('f8e30000-0000-0000-0000-000000000001', 'f8e10000-0000-0000-0000-000000000001', 'f8e20000-0000-0000-0000-000000000001', 'manager', true, now()),
  ('f8e30000-0000-0000-0000-000000000002', 'f8e10000-0000-0000-0000-000000000001', 'f8e20000-0000-0000-0000-000000000002', 'seller',  true, now());

select set_config('request.jwt.claims', '{"sub":"f8e20000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_membership_role()::text, 'manager', 'Manager reconhecido via company_memberships.role, independente de profiles.role');
select is(public.current_membership_company_id(), 'f8e10000-0000-0000-0000-000000000001'::uuid, 'company_id real vem de company_memberships, nunca de profiles.company_id');
reset role;

select set_config('request.jwt.claims', '{"sub":"f8e20000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_membership_role()::text, 'seller', 'Seller reconhecido via company_memberships.role');
select is(public.is_manager_or_platform('f8e10000-0000-0000-0000-000000000001'::uuid), false, 'Seller sem membership de manager/platform_role NAO e tratado como Manager/Super Admin');
select is(public.current_profile_seller_id_for_company('f8e10000-0000-0000-0000-000000000001'::uuid), null::text, 'sem linha real em sellers vinculada a esta membership, resultado e null');
reset role;

-- Super Admin continua identificado exclusivamente por platform_role.
update public.profiles set platform_role = 'super_admin' where id = 'f8e20000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims', '{"sub":"f8e20000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_platform_super_admin(), true, 'Super Admin reconhecido via platform_role');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. REGRESSÃO — nada mais foi tocado
-- ══════════════════════════════════════════════════════════════════════

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')), 9, 'as 9 RPCs do M1-E continuam existindo, sem duplicata');

select has_function('public'::name, 'update_membership_role'::name, array['uuid', 'uuid', 'company_role']::name[],
  'update_membership_role continua existindo, intocada');
select has_function('public'::name, 'accept_invite'::name, array['text']::name[],
  'accept_invite continua existindo, intocada');

-- M1-F S8-E2 removeu fisicamente as 3 colunas legadas do catálogo (a
-- remoção estava apenas "reservada" no momento desta migration S8-E1) —
-- cobertura completa da remoção em 50_m1f_s8e2_drop_profile_legacy_columns.sql.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('company_id', 'role', 'seller_id')),
  0, 'profiles.company_id/role/seller_id foram removidas fisicamente pelo M1-F S8-E2');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'policy de leads inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'policy de lead_timeline_entries inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'company_memberships'),
  1, 'company_memberships continua com exatamente 1 policy (company_memberships_select_own)');

select * from finish();
rollback;
