-- M1-F S8-C2-D1 — move_lead_to_stage/apply_lead_event/assign_lead_seller/
-- archive_lead/unarchive_lead/add_lead_timeline_entry com contexto
-- comercial explícito (resolve_lead_mutation_context). Prova: (1) as seis
-- RPCs não leem mais profiles.company_id/role/seller_id; (2) Super Admin
-- opera somente com empresa explícita, ativa/implantacao, e só ele grava
-- audit_log; (3) Manager/Seller continuam via membership, sempre 'ativa',
-- p_company_id nunca amplia o próprio acesso; (4) locks/idempotência/
-- mapeamento de eventos preservados; (5) nenhuma outra RPC/policy foi
-- tocada. Concorrência real (dblink) já coberta e revalidada por
-- 09_m1e_concurrency.sql (assign_lead_seller/archive_lead/update_lead) —
-- não duplicada aqui com simulação falsa; este arquivo prova locks/
-- idempotência por asserções de estado (mesmo padrão do 06_m1e_archive.sql
-- original). Roda como postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ═══════════════════════════════════════════════════════════════════════

-- Empresas: D1 (ativa, cenário principal), D2 (ativa, "outra empresa" —
-- isolamento cruzado), D3 (implantacao), D4 (suspensa), D5 (cancelada).
insert into public.companies (id, name, status) values
  ('d1000000-0000-0000-0000-000000000001', 'S8C2D1 Empresa D1 Ativa', 'ativa'),
  ('d1000000-0000-0000-0000-000000000002', 'S8C2D1 Empresa D2 Ativa (outra)', 'ativa'),
  ('d1000000-0000-0000-0000-000000000003', 'S8C2D1 Empresa D3 Implantacao', 'implantacao'),
  ('d1000000-0000-0000-0000-000000000004', 'S8C2D1 Empresa D4 Suspensa', 'suspensa'),
  ('d1000000-0000-0000-0000-000000000005', 'S8C2D1 Empresa D5 Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8c2d1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8c2d1-manager-d1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8c2d1-seller-d1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8c2d1-seller-d1-other@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's8c2d1-manager-d3@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's8c2d1-manager-d4@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's8c2d1-manager-d5@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's8c2d1-nomembership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's8c2d1-suspended@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 's8c2d1-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 's8c2d1-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 's8c2d1-legacy-divergent@test.local', now(), now(), now());

-- M1-F S8-E2: profiles.company_id/role/seller_id foram removidos
-- fisicamente do catálogo — as seis RPCs desta etapa já derivavam
-- empresa/papel/vendedor exclusivamente de company_memberships/sellers.
insert into public.profiles (id, name, email, is_active, platform_role) values
  ('d2000000-0000-0000-0000-000000000001', 'Super Admin S8C2D1', 's8c2d1-superadmin@test.local', true, 'super_admin'),
  ('d2000000-0000-0000-0000-000000000002', 'Manager D1', 's8c2d1-manager-d1@test.local', true, null),
  ('d2000000-0000-0000-0000-000000000003', 'Seller D1', 's8c2d1-seller-d1@test.local', true, null),
  ('d2000000-0000-0000-0000-000000000004', 'Seller D1 Other', 's8c2d1-seller-d1-other@test.local', true, null),
  ('d2000000-0000-0000-0000-000000000005', 'Manager D3', 's8c2d1-manager-d3@test.local', true, null),
  ('d2000000-0000-0000-0000-000000000006', 'Manager D4', 's8c2d1-manager-d4@test.local', true, null),
  ('d2000000-0000-0000-0000-000000000007', 'Manager D5', 's8c2d1-manager-d5@test.local', true, null),
  ('d2000000-0000-0000-0000-000000000008', 'Sem Membership', 's8c2d1-nomembership@test.local', true, null),
  ('d2000000-0000-0000-0000-000000000009', 'Manager Suspenso', 's8c2d1-suspended@test.local', true, null),
  ('d2000000-0000-0000-0000-00000000000a', 'Manager Desligado', 's8c2d1-offboarded@test.local', true, null),
  ('d2000000-0000-0000-0000-00000000000b', 'Profile Inativo', 's8c2d1-inactive-profile@test.local', false, null),
  ('d2000000-0000-0000-0000-00000000000c', 'Legado Divergente', 's8c2d1-legacy-divergent@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('d3000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'manager', true, 'active'),
  ('d3000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000003', 'seller',  true, 'active'),
  ('d3000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004', 'seller',  true, 'active'),
  ('d3000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000005', 'manager', true, 'active'),
  ('d3000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000006', 'manager', true, 'active'),
  ('d3000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000005', 'd2000000-0000-0000-0000-000000000007', 'manager', true, 'active'),
  ('d3000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000009', 'manager', false, 'suspended'),
  ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-00000000000a', 'manager', false, 'offboarded'),
  ('d3000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-00000000000b', 'manager', true, 'active'),
  ('d3000000-0000-0000-0000-00000000000c', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-00000000000c', 'seller', true, 'active');
-- d2000000-...-08 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('d8SellerD1',      'd1000000-0000-0000-0000-000000000001', 'Seller D1',       'S8C2D1',   'd2000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000003', true),
  ('d8SellerD1Other', 'd1000000-0000-0000-0000-000000000001', 'Seller D1 Other', 'S8C2D1-B', 'd2000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000004', true),
  ('d8SellerD1Inact', 'd1000000-0000-0000-0000-000000000001', 'Seller D1 Inact', 'S8C2D1-I', null, null, false),
  ('d8SellerD2',      'd1000000-0000-0000-0000-000000000002', 'Seller D2',       'S8C2D1-D2', null, null, true),
  ('d8SellerLegacy',  'd1000000-0000-0000-0000-000000000001', 'Seller Legado',   'S8C2D1-LG', 'd2000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000c', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('d4000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'qualified', 'Qualificado', 1),
  ('d4000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('d4000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000003', 'new', 'Novo', 0),
  ('d4000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000004', 'new', 'Novo', 0),
  ('d4000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000005', 'new', 'Novo', 0);

-- Leads pré-existentes, um por cenário (evita interferência de version/
-- estado entre asserções, mesmo padrão dos arquivos 04/05/06/07 originais).
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'D1 Move',       '(11) 90000-5001', 'C1', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', null),
  ('d5000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'D1 Event',      '(11) 90000-5002', 'C2', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', null),
  ('d5000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 'D1 Assign',     '(11) 90000-5003', 'C3', 'd4000000-0000-0000-0000-000000000001', null, null),
  ('d5000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'D1 Archive SA', '(11) 90000-5004', 'C4', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', null),
  ('d5000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001', 'D1 Archive Mgr','(11) 90000-5005', 'C5', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', null),
  ('d5000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000001', 'D1 Timeline',   '(11) 90000-5006', 'C6', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', null),
  ('d5000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000001', 'D1 Archived',   '(11) 90000-5007', 'C7', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', now()),
  ('d5000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-000000000001', 'D1 Other Seller','(11) 90000-5008', 'C8', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1Other', null),
  ('d5000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-000000000001', 'D1 Legacy',     '(11) 90000-5009', 'C9', 'd4000000-0000-0000-0000-000000000001', 'd8SellerLegacy', null),
  ('d500000a-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'D2 Other Co',   '(11) 90000-500a', 'CA', 'd4000000-0000-0000-0000-000000000003', null, null),
  ('d500000b-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003', 'D3 Implant',    '(11) 90000-500b', 'CB', 'd4000000-0000-0000-0000-000000000004', null, null),
  ('d500000c-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000004', 'D4 Suspensa',   '(11) 90000-500c', 'CC', 'd4000000-0000-0000-0000-000000000005', null, null),
  ('d500000d-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', 'D5 Cancelada',  '(11) 90000-500d', 'CD', 'd4000000-0000-0000-0000-000000000006', null, null),
  -- lote dedicado a asserções de "somente leitura"/negativos sem consumir
  -- os leads acima (idempotência SA archive/unarchive, timeline SA)
  ('d5000000-0000-0000-0000-00000000000e', 'd1000000-0000-0000-0000-000000000001', 'D1 Archive SA2','(11) 90000-500e', 'CE', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', null),
  ('d5000000-0000-0000-0000-00000000000f', 'd1000000-0000-0000-0000-000000000001', 'D1 Timeline SA','(11) 90000-500f', 'CF', 'd4000000-0000-0000-0000-000000000001', 'd8SellerD1', null);

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('move_lead_to_stage','apply_lead_event','assign_lead_seller','archive_lead',
       'unarchive_lead','add_lead_timeline_entry')),
  6, 'as 6 RPCs existem, uma unica assinatura cada (sem overload)');

select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'move_lead_to_stage'),
  'move_lead_to_stage: p_company_id e o ultimo parametro, com default');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_lead_event'),
  'apply_lead_event: p_company_id e o ultimo parametro, com default');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'assign_lead_seller'),
  'assign_lead_seller: p_company_id e o ultimo parametro, com default');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'archive_lead'),
  'archive_lead: p_company_id e o ultimo parametro, com default');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'unarchive_lead'),
  'unarchive_lead: p_company_id e o ultimo parametro, com default');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_lead_timeline_entry'),
  'add_lead_timeline_entry: p_company_id e o ultimo parametro, com default');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('move_lead_to_stage','apply_lead_event','assign_lead_seller','archive_lead',
       'unarchive_lead','add_lead_timeline_entry') and p.prosecdef),
  6, 'as 6 RPCs sao SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('move_lead_to_stage','apply_lead_event','assign_lead_seller','archive_lead',
       'unarchive_lead','add_lead_timeline_entry')
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  6, 'as 6 RPCs tem search_path configurado explicitamente');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name in
      ('move_lead_to_stage','apply_lead_event','assign_lead_seller','archive_lead',
       'unarchive_lead','add_lead_timeline_entry')
      and grantee = 'authenticated'),
  6, 'authenticated tem EXECUTE nas 6 RPCs');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name in
      ('move_lead_to_stage','apply_lead_event','assign_lead_seller','archive_lead',
       'unarchive_lead','add_lead_timeline_entry')
      and grantee = 'anon'),
  0, 'anon NAO tem EXECUTE em nenhuma das 6 RPCs');

-- resolver reutilizado (nao duplicado): continua existindo, sem grant novo
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_lead_mutation_context'),
  1, 'resolve_lead_mutation_context continua com uma unica assinatura');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'resolve_lead_mutation_context'
      and grantee in ('authenticated', 'anon')),
  0, 'resolve_lead_mutation_context: nenhum GRANT novo a authenticated/anon');

-- create/update/duplicate e as 4 RPCs de leitura + list_platform_sellers_for_company intactas
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('create_lead','update_lead','check_lead_phone_duplicate')),
  3, 'create_lead/update_lead/check_lead_phone_duplicate continuam intactas (3 assinaturas)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('list_commercial_companies','list_platform_leads_for_company',
       'list_platform_lead_timeline','list_pipeline_stages_for_company',
       'list_platform_sellers_for_company')),
  5, 'as 5 RPCs de leitura comercial continuam intactas');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'pipeline_stages'),
  3, 'pipeline_stages continua com exatamente 3 policies (S8-C1-B intocado)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'leads continua com exatamente 1 policy (SELECT, S8-C2-B1 intocado)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'lead_timeline_entries continua com exatamente 1 policy (SELECT, S8-C2-B1 intocado)');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — MOVE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.move_lead_to_stage('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002')$$,
  'company_required', 'SA move sem p_company_id: company_required');

create temp table t_sa_move as
  select * from public.move_lead_to_stage('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002',
    null, 'd1000000-0000-0000-0000-000000000001');
select is((select stage_id from t_sa_move), 'd4000000-0000-0000-0000-000000000002'::uuid, 'SA move lead da empresa explicita: permitido');
select is((select updated_by_profile_id from t_sa_move), null, 'SA move: updated_by_profile_id NULL (sem membership na empresa)');

select throws_ok(
  $$select public.move_lead_to_stage('d500000a-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002',
      null, 'd1000000-0000-0000-0000-000000000001')$$,
  'lead_not_found', 'SA: lead de outra empresa (D2) negado sem vazamento, operando em D1');
select throws_ok(
  $$select public.move_lead_to_stage('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000003',
      null, 'd1000000-0000-0000-0000-000000000001')$$,
  'stage_not_found', 'SA: stage de outra empresa (D2) rejeitado');
select throws_ok(
  $$select public.move_lead_to_stage('d5000000-0000-0000-0000-000000000007', 'd4000000-0000-0000-0000-000000000002',
      null, 'd1000000-0000-0000-0000-000000000001')$$,
  'lead_archived', 'SA: lead arquivado nao pode ser movido');
select throws_ok(
  $$select public.move_lead_to_stage('d500000c-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000005',
      null, 'd1000000-0000-0000-0000-000000000004')$$,
  'company_read_only', 'SA: empresa suspensa nega move');
select throws_ok(
  $$select public.move_lead_to_stage('d500000d-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000006',
      null, 'd1000000-0000-0000-0000-000000000005')$$,
  'company_read_only', 'SA: empresa cancelada nega move');
create temp table t_sa_move_impl as
  select * from public.move_lead_to_stage('d500000b-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000004',
    null, 'd1000000-0000-0000-0000-000000000003');
select ok((select id from t_sa_move_impl) is not null, 'SA: empresa implantacao permite move');

reset role;

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000001' and action = 'lead_stage_moved'),
  1, 'SA move: exatamente 1 audit_log');
select is(
  (select actor_profile_id from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000001' and action = 'lead_stage_moved'),
  'd2000000-0000-0000-0000-000000000001'::uuid, 'SA move: ator real no audit_log');
select is(
  (select before_data->>'stage_id' from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000001' and action = 'lead_stage_moved'),
  'd4000000-0000-0000-0000-000000000001', 'SA move: before_data.stage_id = estagio anterior');
select is(
  (select after_data->>'stage_id' from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000001' and action = 'lead_stage_moved'),
  'd4000000-0000-0000-0000-000000000002', 'SA move: after_data.stage_id = estagio novo');
select is(
  (select count(*)::int from public.audit_log where action = 'lead_stage_moved'
    and company_id in ('d1000000-0000-0000-0000-000000000004','d1000000-0000-0000-0000-000000000005')),
  0, 'nenhum audit_log de move para as tentativas negadas por status');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — EVENT
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000001');
set local role authenticated;

create temp table t_sa_event as
  select * from public.apply_lead_event('d5000000-0000-0000-0000-000000000002', 'call_outcome_visit',
    'd1000000-0000-0000-0000-000000000001');
select is((select urgency from t_sa_event), 'amber'::public.lead_urgency, 'SA event: mapeamento preservado (urgency)');
-- comparacao direta de stage_id (nao join contra pipeline_stages): Super
-- Admin nao tem SELECT direto na tabela por desenho (§31.7) — um join
-- rodando ainda como authenticated/SA veria zero linhas por RLS, nao por
-- falha do mapeamento.
select is((select stage_id from t_sa_event), 'd4000000-0000-0000-0000-000000000002'::uuid,
  'SA event: mapeamento preservado (stage = qualified)');

select throws_ok(
  $$select public.apply_lead_event('d5000000-0000-0000-0000-000000000002', 'evento_invalido',
      'd1000000-0000-0000-0000-000000000001')$$,
  '22P02', null, 'SA: evento fora do enum falha no cast (preservado)');
select throws_ok(
  $$select public.apply_lead_event('d500000a-0000-0000-0000-000000000001', 'visit_confirmed',
      'd1000000-0000-0000-0000-000000000001')$$,
  'lead_not_found', 'SA: evento em lead de outra empresa negado sem vazamento');

reset role;

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000002' and action = 'call_outcome_visit'),
  1, 'SA event: audit_log com action = tipo do evento (sanitizado)');
select ok(
  not (select (before_data ? 'name') or (after_data ? 'name') or (before_data ? 'phone') or (after_data ? 'phone')
     from public.audit_log where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000002'
       and action = 'call_outcome_visit'),
  'SA event: audit_log nunca contem nome ou telefone');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — ASSIGN
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000001');
set local role authenticated;

create temp table t_sa_assign as
  select * from public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD1', 1,
    'd1000000-0000-0000-0000-000000000001');
select is((select seller_id from t_sa_assign), 'd8SellerD1', 'SA atribui seller ativo da empresa: permitido');
select is((select updated_by_profile_id from t_sa_assign), null, 'SA assign: updated_by_profile_id NULL');

create temp table t_sa_assign_swap as
  select * from public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD1Other', 2,
    'd1000000-0000-0000-0000-000000000001');
select is((select seller_id from t_sa_assign_swap), 'd8SellerD1Other', 'SA troca de seller: permitido');

create temp table t_sa_assign_null as
  select * from public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', null, 3,
    'd1000000-0000-0000-0000-000000000001');
select is((select seller_id from t_sa_assign_null), null, 'SA remove seller com null: permitido');

select throws_ok(
  $$select public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD2', 4,
      'd1000000-0000-0000-0000-000000000001')$$,
  'seller_not_found', 'SA: seller de outra empresa rejeitado');
select throws_ok(
  $$select public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD1Inact', 4,
      'd1000000-0000-0000-0000-000000000001')$$,
  'seller_not_found', 'SA: seller inativo rejeitado');
select throws_ok(
  $$select public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'inexistente-nao-e-seller', 4,
      'd1000000-0000-0000-0000-000000000001')$$,
  'seller_not_found', 'SA: identificador que nao corresponde a nenhum seller (ex.: um Manager) rejeitado');

reset role;

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000003' and action = 'lead_seller_assigned'),
  3, 'SA assign: 3 audit_log (atribuicao, troca, remocao)');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000003' and action = 'lead_seller_assigned'
      and after_data->>'seller_id' is null),
  1, 'SA assign: exatamente 1 dos 3 audit_log reflete a remocao (after_data.seller_id null)');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — ARCHIVE/UNARCHIVE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.archive_lead('d5000000-0000-0000-0000-000000000004', 99, 'd1000000-0000-0000-0000-000000000001')$$,
  'stale_write', 'SA: arquivar com versao divergente falha');

create temp table t_sa_archive as
  select * from public.archive_lead('d5000000-0000-0000-0000-000000000004', 1, 'd1000000-0000-0000-0000-000000000001');
select ok((select archived_at from t_sa_archive) is not null, 'SA arquiva lead da empresa explicita: permitido');
select is((select version from t_sa_archive), 2, 'SA archive: version incrementada exatamente uma vez');

create temp table t_sa_archive2 as
  select * from public.archive_lead('d5000000-0000-0000-0000-000000000004', 1, 'd1000000-0000-0000-0000-000000000001');
select is((select version from t_sa_archive2), 2, 'SA archive: idempotente, version NAO incrementa de novo');

create temp table t_sa_unarchive as
  select * from public.unarchive_lead('d5000000-0000-0000-0000-000000000004', 2, 'd1000000-0000-0000-0000-000000000001');
select is((select archived_at from t_sa_unarchive), null::timestamptz, 'SA restaura lead: permitido');
select is((select version from t_sa_unarchive), 3, 'SA unarchive: version incrementada');

create temp table t_sa_unarchive2 as
  select * from public.unarchive_lead('d5000000-0000-0000-0000-000000000004', 3, 'd1000000-0000-0000-0000-000000000001');
select is((select version from t_sa_unarchive2), 3, 'SA unarchive: idempotente, version NAO incrementa de novo');

select throws_ok(
  $$select public.archive_lead('d500000c-0000-0000-0000-000000000001', 1, 'd1000000-0000-0000-0000-000000000004')$$,
  'company_read_only', 'SA: empresa suspensa nega archive');
select throws_ok(
  $$select public.archive_lead('d500000d-0000-0000-0000-000000000001', 1, 'd1000000-0000-0000-0000-000000000005')$$,
  'company_read_only', 'SA: empresa cancelada nega archive');
create temp table t_sa_archive_impl as
  select * from public.archive_lead('d5000000-0000-0000-0000-00000000000e', 1, 'd1000000-0000-0000-0000-000000000001');
select ok((select archived_at from t_sa_archive_impl) is not null, 'SA archive em empresa ativa (segundo lead): permitido');

reset role;

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000004' and action = 'lead_archived'),
  1, 'SA archive: exatamente 1 audit_log (idempotente NAO duplica)');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000004' and action = 'lead_unarchived'),
  1, 'SA unarchive: exatamente 1 audit_log (idempotente NAO duplica)');
select is(
  (select (before_data->>'archived')::boolean from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000004' and action = 'lead_archived'),
  false, 'SA archive: before_data.archived=false');
select is(
  (select (after_data->>'archived')::boolean from public.audit_log
    where entity_type = 'lead' and entity_id = 'd5000000-0000-0000-0000-000000000004' and action = 'lead_archived'),
  true, 'SA archive: after_data.archived=true');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — TIMELINE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000001');
set local role authenticated;

create temp table t_sa_timeline as
  select * from public.add_lead_timeline_entry('d5000000-0000-0000-0000-000000000006',
    'phone', 'Contato SA', '#123456', 'nota interna', 'd1000000-0000-0000-0000-000000000001');
select is((select actor_profile_id from t_sa_timeline), null, 'SA timeline: actor_profile_id NULL (sem membership na empresa)');
select is((select lead_id from t_sa_timeline), 'd5000000-0000-0000-0000-000000000006'::uuid, 'SA timeline: vinculada ao lead correto');

select throws_ok(
  $$select public.add_lead_timeline_entry('d500000a-0000-0000-0000-000000000001', 'i', 'l', '#c', null,
      'd1000000-0000-0000-0000-000000000001')$$,
  'lead_not_found', 'SA: timeline em lead de outra empresa negada sem vazamento');

reset role;

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead_timeline_entry' and action = 'lead_timeline_entry_added'
      and (after_data->>'lead_id')::uuid = 'd5000000-0000-0000-0000-000000000006'),
  1, 'SA timeline: 1 audit_log, entity_type proprio');
select ok(
  not (select (after_data ? 'detail') or (after_data ? 'label')
     from public.audit_log where entity_type = 'lead_timeline_entry'
       and (after_data->>'lead_id')::uuid = 'd5000000-0000-0000-0000-000000000006'),
  'SA timeline: audit_log nunca copia o conteudo integral da anotacao');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'd5000000-0000-0000-0000-000000000006'
    and detail = 'nota interna'),
  1, 'SA timeline: a timeline comercial em si preserva o conteudo real (nao substituida pelo audit_log)');

-- ═══════════════════════════════════════════════════════════════════════
-- MANAGER (empresa ativa, p_company_id sempre ignorado)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000002');
set local role authenticated;

-- p_company_id de OUTRA empresa enviado pelo cliente: totalmente ignorado,
-- a empresa real continua sendo a da membership (D1) — lead de D1 acessivel
-- mesmo enviando D2 como parametro.
create temp table t_mgr_move as
  select * from public.move_lead_to_stage('d5000000-0000-0000-0000-000000000005', 'd4000000-0000-0000-0000-000000000002',
    null, 'd1000000-0000-0000-0000-000000000002');
select is((select stage_id from t_mgr_move), 'd4000000-0000-0000-0000-000000000002'::uuid,
  'Manager move lead da propria empresa mesmo enviando outra empresa em p_company_id (ignorado)');
select is((select updated_by_profile_id from t_mgr_move), 'd2000000-0000-0000-0000-000000000002'::uuid,
  'Manager move: updated_by_profile_id = profile real (comportamento preservado)');

create temp table t_mgr_event as
  select * from public.apply_lead_event('d5000000-0000-0000-0000-000000000005', 'visit_confirmed');
select ok((select id from t_mgr_event) is not null, 'Manager aplica evento em lead da propria empresa');

create temp table t_mgr_assign as
  select * from public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD1', 4);
select is((select seller_id from t_mgr_assign), 'd8SellerD1', 'Manager atribui seller');
select is((select updated_by_profile_id from t_mgr_assign), 'd2000000-0000-0000-0000-000000000002'::uuid,
  'Manager assign: updated_by_profile_id preservado');

-- lead005 chegou aqui na version 3 (1 -> move LWW -> 2 -> apply_lead_event
-- incondicional -> 3): archive/unarchive abaixo usam a version real.
create temp table t_mgr_archive as
  select * from public.archive_lead('d5000000-0000-0000-0000-000000000005', 3);
select ok((select archived_at from t_mgr_archive) is not null, 'Manager arquiva lead da propria empresa');
create temp table t_mgr_unarchive as
  select * from public.unarchive_lead('d5000000-0000-0000-0000-000000000005', 4);
select is((select archived_at from t_mgr_unarchive), null::timestamptz, 'Manager restaura lead da propria empresa');

create temp table t_mgr_timeline as
  select * from public.add_lead_timeline_entry('d5000000-0000-0000-0000-000000000006', 'i', 'Entrada gestor', '#c');
select is((select actor_profile_id from t_mgr_timeline), 'd2000000-0000-0000-0000-000000000002'::uuid,
  'Manager timeline: actor_profile_id = profile real');

reset role;

select is(
  (select count(*)::int from public.audit_log where action = 'lead_stage_moved'
    and actor_profile_id = 'd2000000-0000-0000-0000-000000000002'),
  0, 'Manager: nenhum audit_log de plataforma gerado (auditoria e exclusiva de Super Admin nesta etapa)');

-- ═══════════════════════════════════════════════════════════════════════
-- SELLER (somente o proprio lead; assign/archive/unarchive negados)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000003');
set local role authenticated;

create temp table t_slr_move as
  select * from public.move_lead_to_stage('d5000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002');
select ok((select id from t_slr_move) is not null, 'Seller move o proprio lead');
select throws_ok(
  $$select public.move_lead_to_stage('d5000000-0000-0000-0000-000000000008', 'd4000000-0000-0000-0000-000000000002')$$,
  'forbidden', 'Seller nao move lead alheio (atribuido a outro seller)');

select throws_ok(
  $$select public.apply_lead_event('d5000000-0000-0000-0000-000000000008', 'visit_confirmed')$$,
  'forbidden', 'Seller nao aplica evento em lead alheio');

select throws_ok(
  $$select public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD1', 5)$$,
  'forbidden', 'Seller nunca executa atribuicao (mesmo no proprio lead)');
select throws_ok(
  $$select public.archive_lead('d5000000-0000-0000-0000-000000000002', 1)$$,
  'forbidden', 'Seller nao arquiva (mesmo o proprio lead)');
select throws_ok(
  $$select public.unarchive_lead('d5000000-0000-0000-0000-000000000007', 1)$$,
  'forbidden', 'Seller nao restaura (mesmo o proprio lead)');

create temp table t_slr_timeline as
  select * from public.add_lead_timeline_entry('d5000000-0000-0000-0000-00000000000f', 'phone', 'Contato seller', '#27C75F');
select is((select actor_profile_id from t_slr_timeline), 'd2000000-0000-0000-0000-000000000003'::uuid,
  'Seller adiciona timeline no proprio lead');
select throws_ok(
  $$select public.add_lead_timeline_entry('d5000000-0000-0000-0000-000000000008', 'i', 'l', '#c')$$,
  'forbidden', 'Seller nao escreve timeline de lead alheio');

-- p_company_id enviado pelo Seller nunca amplia acesso: mesmo enviando D2,
-- o lead de D2 continua inacessivel (a empresa real e D1, e o lead de D2
-- nunca pertenceria a D1).
select throws_ok(
  $$select public.move_lead_to_stage('d500000a-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000003',
      null, 'd1000000-0000-0000-0000-000000000002')$$,
  'lead_not_found', 'Seller: p_company_id enviado pelo cliente nao amplia acesso a lead de outra empresa');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- MEMBERSHIP (ausente/suspensa/offboarded/profile inativo)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000008');
set local role authenticated;
select throws_ok(
  $$select public.move_lead_to_stage('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001')$$,
  'forbidden', 'sem membership: forbidden');
reset role;

select pg_temp.as_user('d2000000-0000-0000-0000-000000000009');
set local role authenticated;
select throws_ok(
  $$select public.add_lead_timeline_entry('d5000000-0000-0000-0000-000000000001', 'i', 'l', '#c')$$,
  'forbidden', 'membership suspensa: forbidden');
reset role;

select pg_temp.as_user('d2000000-0000-0000-0000-00000000000a');
set local role authenticated;
select throws_ok(
  $$select public.archive_lead('d5000000-0000-0000-0000-000000000001', 1)$$,
  'forbidden', 'membership offboarded: forbidden');
reset role;

select pg_temp.as_user('d2000000-0000-0000-0000-00000000000b');
set local role authenticated;
select throws_ok(
  $$select public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD1', 1)$$,
  'forbidden', 'profile globalmente inativo (mesmo com membership ativa): forbidden');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- STATUS (Manager/Seller: implantacao/suspensa/cancelada negados)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok(
  $$select public.move_lead_to_stage('d500000b-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000004')$$,
  'forbidden', 'Manager em empresa implantacao: negado (mais restritivo que Pipeline/S8-C1-B)');
reset role;

select pg_temp.as_user('d2000000-0000-0000-0000-000000000006');
set local role authenticated;
select throws_ok(
  $$select public.archive_lead('d500000c-0000-0000-0000-000000000001', 1)$$,
  'forbidden', 'Manager em empresa suspensa: negado');
reset role;

select pg_temp.as_user('d2000000-0000-0000-0000-000000000007');
set local role authenticated;
select throws_ok(
  $$select public.unarchive_lead('d500000d-0000-0000-0000-000000000001', 1)$$,
  'forbidden', 'Manager em empresa cancelada: negado');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- RESOLUÇÃO EXCLUSIVAMENTE VIA MEMBERSHIP (ex-"legado divergente")
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('d2000000-0000-0000-0000-00000000000c');
set local role authenticated;

-- este ator e seller ativo (via membership) em D1: assign_lead_seller deve
-- seguir negado a seller, e o lead de D1 deve permanecer acessivel.
select throws_ok(
  $$select public.assign_lead_seller('d5000000-0000-0000-0000-000000000003', 'd8SellerD1', 6)$$,
  'forbidden', 'papel real (seller, via membership) decide');

create temp table t_legacy_move as
  select * from public.move_lead_to_stage('d5000000-0000-0000-0000-000000000009', 'd4000000-0000-0000-0000-000000000002');
select ok((select id from t_legacy_move) is not null,
  'move o proprio lead (seller_id resolvido via sellers.membership_id)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ATOMICIDADE
-- ═══════════════════════════════════════════════════════════════════════

-- Tentativas negadas por status/cross-company nunca deixam rastro: nem
-- mudanca de estado, nem audit_log orfao.
select is(
  (select count(*)::int from public.audit_log where entity_id = 'd500000a-0000-0000-0000-000000000001'),
  0, 'nenhum audit_log para o lead de outra empresa jamais tocado (D2)');
select is(
  (select stage_id from public.leads where id = 'd500000a-0000-0000-0000-000000000001'),
  'd4000000-0000-0000-0000-000000000003'::uuid,
  'lead de outra empresa permanece inalterado apos as tentativas negadas');
select is(
  (select count(*)::int from public.audit_log al
    where al.entity_type in ('lead','lead_timeline_entry')
      and not exists (
        select 1 from public.leads l where l.id::text = al.entity_id
        union all
        select 1 from public.lead_timeline_entries t where t.id::text = al.entity_id
      )),
  0, 'nenhum audit_log orfao (entity_id sempre aponta para lead/timeline existente)');
select is(
  (select count(*)::int from public.lead_timeline_entries t
    where not exists (select 1 from public.leads l where l.id = t.lead_id)),
  0, 'nenhuma timeline orfa (FK composta lead_timeline_company_lead_fk continua garantindo isso)');

-- ═══════════════════════════════════════════════════════════════════════
-- CONCORRÊNCIA
-- ═══════════════════════════════════════════════════════════════════════
-- Cenários reais com duas conexões (dblink) para update_lead/assign_lead_
-- seller/archive_lead já existem e são revalidados sem alteração em
-- 09_m1e_concurrency.sql (fixtures de seed, memberships/status já corretos
-- — nenhuma mudança necessária). Não duplicados aqui com simulação falsa
-- (fora da autorização desta etapa). Locks/idempotência de archive/
-- unarchive sob o mesmo SELECT FOR UPDATE já são provados acima pelas
-- asserções de version (SA e Manager).

select * from finish();
rollback;
