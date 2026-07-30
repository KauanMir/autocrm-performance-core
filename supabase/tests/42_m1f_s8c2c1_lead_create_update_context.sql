-- M1-F S8-C2-C1 — create_lead/update_lead/check_lead_phone_duplicate com
-- contexto comercial explícito (resolve_lead_mutation_context). Prova:
-- (1) as três RPCs não leem mais profiles.company_id/role/seller_id;
-- (2) Super Admin opera somente com empresa explícita, ativa/implantacao
--     para mutation, qualquer status para a checagem de duplicidade;
-- (3) Manager/Seller continuam via membership, sempre 'ativa', p_company_id
--     nunca amplia o próprio acesso; (4) auditoria cobre exclusivamente
--     mutations de Super Admin, sem PII completa; (5) nenhuma outra RPC/
--     policy foi tocada. Roda como postgres. Rollback ao final.
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

-- Empresas: CA1 (ativa, cenário principal), CA2 (ativa, "outra empresa" —
-- isolamento cruzado, sem estágio 'new' para o teste de
-- initial_stage_missing do Super Admin), CA3 (implantacao), CA4
-- (suspensa), CA5 (cancelada).
insert into public.companies (id, name, status) values
  ('ca100000-0000-0000-0000-000000000001', 'S8C2C1 Empresa A Ativa', 'ativa'),
  ('ca100000-0000-0000-0000-000000000002', 'S8C2C1 Empresa B Ativa (outra)', 'ativa'),
  ('ca100000-0000-0000-0000-000000000003', 'S8C2C1 Empresa C Implantacao', 'implantacao'),
  ('ca100000-0000-0000-0000-000000000004', 'S8C2C1 Empresa D Suspensa', 'suspensa'),
  ('ca100000-0000-0000-0000-000000000005', 'S8C2C1 Empresa E Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8c2c1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8c2c1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8c2c1-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8c2c1-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's8c2c1-manager-d@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's8c2c1-manager-e@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's8c2c1-seller-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's8c2c1-nomembership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's8c2c1-suspended@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 's8c2c1-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 's8c2c1-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 's8c2c1-legacy-divergent@test.local', now(), now(), now());

-- M1-F S8-E2: profiles.company_id/role/seller_id foram removidos
-- fisicamente do catálogo — não há mais nenhum campo legado nesta tabela
-- capaz de divergir da membership real. O profile "Legado Divergente"
-- abaixo é mantido apenas como um ator comum (membership real = seller em
-- CA1, ver company_memberships), preservando a cobertura de que
-- create_lead/update_lead resolvem empresa/vendedor exclusivamente via
-- company_memberships/sellers.
insert into public.profiles (id, name, email, is_active, platform_role) values
  ('ca200000-0000-0000-0000-000000000001', 'Super Admin S8C2C1', 's8c2c1-superadmin@test.local', true, 'super_admin'),
  ('ca200000-0000-0000-0000-000000000002', 'Manager A', 's8c2c1-manager-a@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000003', 'Seller A1', 's8c2c1-seller-a1@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000004', 'Manager C', 's8c2c1-manager-c@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000005', 'Manager D', 's8c2c1-manager-d@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000006', 'Manager E', 's8c2c1-manager-e@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000007', 'Seller C', 's8c2c1-seller-c@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000008', 'Sem Membership', 's8c2c1-nomembership@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000009', 'Manager Suspenso', 's8c2c1-suspended@test.local', true, null),
  ('ca200000-0000-0000-0000-00000000000a', 'Manager Desligado', 's8c2c1-offboarded@test.local', true, null),
  ('ca200000-0000-0000-0000-00000000000b', 'Profile Inativo', 's8c2c1-inactive-profile@test.local', false, null),
  ('ca200000-0000-0000-0000-00000000000c', 'Legado Divergente', 's8c2c1-legacy-divergent@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('ca300000-0000-0000-0000-000000000002', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000002', 'manager', true, 'active'),
  ('ca300000-0000-0000-0000-000000000003', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000003', 'seller',  true, 'active'),
  ('ca300000-0000-0000-0000-000000000004', 'ca100000-0000-0000-0000-000000000003', 'ca200000-0000-0000-0000-000000000004', 'manager', true, 'active'),
  ('ca300000-0000-0000-0000-000000000005', 'ca100000-0000-0000-0000-000000000004', 'ca200000-0000-0000-0000-000000000005', 'manager', true, 'active'),
  ('ca300000-0000-0000-0000-000000000006', 'ca100000-0000-0000-0000-000000000005', 'ca200000-0000-0000-0000-000000000006', 'manager', true, 'active'),
  ('ca300000-0000-0000-0000-000000000007', 'ca100000-0000-0000-0000-000000000003', 'ca200000-0000-0000-0000-000000000007', 'seller',  true, 'active'),
  ('ca300000-0000-0000-0000-000000000009', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000009', 'manager', false, 'suspended'),
  ('ca300000-0000-0000-0000-00000000000a', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-00000000000a', 'manager', false, 'offboarded'),
  ('ca300000-0000-0000-0000-00000000000b', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-00000000000b', 'manager', true, 'active'),
  ('ca300000-0000-0000-0000-00000000000c', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-00000000000c', 'seller', true, 'active');
-- ca200000-...-08 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('s8c2c1SellerA1',       'ca100000-0000-0000-0000-000000000001', 'Seller A1',       'S8C2C1-A1', 'ca200000-0000-0000-0000-000000000003', 'ca300000-0000-0000-0000-000000000003', true),
  ('s8c2c1SellerA1Alt',    'ca100000-0000-0000-0000-000000000001', 'Seller A1 Alt',   'S8C2C1-A1B', null, null, true),
  ('s8c2c1SellerA1Inact',  'ca100000-0000-0000-0000-000000000001', 'Seller A1 Inact', 'S8C2C1-A1I', null, null, false),
  ('s8c2c1SellerOther',    'ca100000-0000-0000-0000-000000000002', 'Seller Outra',    'S8C2C1-B',  null, null, true),
  ('s8c2c1SellerLegacy',   'ca100000-0000-0000-0000-000000000001', 'Seller Legado',   'S8C2C1-LG', 'ca200000-0000-0000-0000-00000000000c', 'ca300000-0000-0000-0000-00000000000c', true),
  ('s8c2c1SellerC',        'ca100000-0000-0000-0000-000000000003', 'Seller C',        'S8C2C1-C',  'ca200000-0000-0000-0000-000000000007', 'ca300000-0000-0000-0000-000000000007', true);

-- CA1 e CA3 têm estágio 'new' (necessário para create_lead ter sucesso);
-- CA2 tem só um estágio 'qualified' (nunca 'new') — usado tanto para
-- isolamento cruzado quanto para o teste de initial_stage_missing do
-- Super Admin. CA4/CA5 não precisam de estágio (create sempre nega antes,
-- por status).
insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('ca400000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('ca400000-0000-0000-0000-000000000002', 'ca100000-0000-0000-0000-000000000002', 'qualified', 'Qualificado', 0),
  ('ca400000-0000-0000-0000-000000000003', 'ca100000-0000-0000-0000-000000000003', 'new', 'Novo', 0);

-- CA4/CA5 também precisam de um estágio próprio — leads.stage_id é NOT
-- NULL (FK composta company_id+stage_id) — mesmo essas duas empresas
-- nunca permitindo create_lead (status não ativa/implantacao), os leads
-- PRÉ-EXISTENTES usados na prova de leitura de duplicidade do Super Admin
-- precisam de um estágio válido para poderem existir.
insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('ca400000-0000-0000-0000-000000000004', 'ca100000-0000-0000-0000-000000000004', 'new', 'Novo', 0),
  ('ca400000-0000-0000-0000-000000000005', 'ca100000-0000-0000-0000-000000000005', 'new', 'Novo', 0);

-- Leads pré-existentes: L-A (CA1, seller A1, ativo — alvo de update por
-- Seller/Manager/Super Admin), L-A-Other (CA1, seller Alt — "alheio" para
-- Seller), L-B (CA2 — nunca tocável a partir de CA1), L-D/L-E (CA4/CA5 —
-- só para prova de leitura de duplicidade do Super Admin).
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('ca500000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', 'Lead A',       '(11) 90000-2001', 'C1',
   'ca400000-0000-0000-0000-000000000001', 's8c2c1SellerA1', null),
  ('ca500000-0000-0000-0000-000000000002', 'ca100000-0000-0000-0000-000000000001', 'Lead A Outro', '(11) 90000-2002', 'C2',
   'ca400000-0000-0000-0000-000000000001', 's8c2c1SellerA1Alt', null),
  ('ca500000-0000-0000-0000-000000000003', 'ca100000-0000-0000-0000-000000000002', 'Lead B',       '(11) 90000-2003', 'C3',
   'ca400000-0000-0000-0000-000000000002', null, null),
  ('ca500000-0000-0000-0000-000000000004', 'ca100000-0000-0000-0000-000000000004', 'Lead D Susp',  '(11) 90000-2004', 'C4',
   'ca400000-0000-0000-0000-000000000004', null, null),
  ('ca500000-0000-0000-0000-000000000005', 'ca100000-0000-0000-0000-000000000005', 'Lead E Canc',  '(11) 90000-2005', 'C5',
   'ca400000-0000-0000-0000-000000000005', null, null),
  -- Lead dedicado à checagem de duplicidade (nunca alvo de update_lead em
  -- nenhuma seção — telefone permanece estável do início ao fim do arquivo).
  ('ca500000-0000-0000-0000-000000000006', 'ca100000-0000-0000-0000-000000000001', 'Lead A Dup',   '(11) 90000-2006', 'C6',
   'ca400000-0000-0000-0000-000000000001', 's8c2c1SellerA1', null);

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_lead'),
  1, 'create_lead: uma única assinatura');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_lead'),
  1, 'update_lead: uma única assinatura');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_lead_phone_duplicate'),
  1, 'check_lead_phone_duplicate: uma única assinatura');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_lead_mutation_context'),
  1, 'resolve_lead_mutation_context existe, uma única assinatura');

select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_lead'),
  'create_lead: p_company_id e o ultimo parametro, com default');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_lead'),
  'update_lead: p_company_id e o ultimo parametro, com default');
-- M1-E E4-A1 (autorizado, 2026-07-30): p_company_id deixou de ser o ULTIMO
-- parametro por design (p_exclude_lead_id foi acrescentado depois dele,
-- 20260730040000_m1e_e4a1_assignable_sellers_and_duplicate_exclusion.sql).
-- A garantia de compatibilidade que importa é outra: p_company_id preserva
-- posicao (2o parametro), tipo e DEFAULT NULL; p_exclude_lead_id aparece
-- depois, tambem com DEFAULT NULL — string exata observada no catalogo.
select is(
  (select pg_get_function_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_lead_phone_duplicate'),
  'p_phone text, p_company_id uuid DEFAULT NULL::uuid, p_exclude_lead_id uuid DEFAULT NULL::uuid',
  'check_lead_phone_duplicate: p_company_id preserva posicao/tipo/default (2o parametro); p_exclude_lead_id (E4-A1) vem depois, tambem com DEFAULT NULL');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('create_lead','update_lead','check_lead_phone_duplicate','resolve_lead_mutation_context')
      and p.prosecdef),
  4, 'as 4 funcoes sao SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('create_lead','update_lead','check_lead_phone_duplicate','resolve_lead_mutation_context')
      and exists (
        select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
      )),
  4, 'as 4 funcoes tem search_path configurado explicitamente');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'resolve_lead_mutation_context'
      and grantee = 'authenticated'),
  0, 'resolve_lead_mutation_context: authenticated NAO tem EXECUTE (nunca API publica)');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'resolve_lead_mutation_context'
      and grantee = 'anon'),
  0, 'resolve_lead_mutation_context: anon NAO tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'create_lead'
      and grantee = 'authenticated'),
  1, 'create_lead: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'create_lead' and grantee = 'anon'),
  0, 'create_lead: anon NAO tem EXECUTE');

-- ── as demais 6 RPCs de mutation + 4 de leitura + policies continuam intactas ──
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('move_lead_to_stage','apply_lead_event','assign_lead_seller','archive_lead',
       'unarchive_lead','add_lead_timeline_entry')),
  6, 'as 6 demais RPCs de mutation de leads continuam existindo, sem duplicata');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('list_commercial_companies','list_platform_leads_for_company',
       'list_platform_lead_timeline','list_pipeline_stages_for_company')),
  4, 'as 4 RPCs de leitura comercial do S8-C2-B1 continuam intactas');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'pipeline_stages'),
  3, 'pipeline_stages continua com exatamente 3 policies (S8-C1-B intocado)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'leads continua com exatamente 1 policy (SELECT, S8-C2-B1 intocado)');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — CREATE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C')$$,
  'company_required', 'SA sem p_company_id: company_required');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', null, null, null, null, '00000000-0000-0000-0000-00000000ffff')$$,
  'company_not_found', 'SA com empresa inexistente: company_not_found');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', null, null, null, null, 'ca100000-0000-0000-0000-000000000004')$$,
  'company_read_only', 'SA em empresa suspensa: company_read_only');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', null, null, null, null, 'ca100000-0000-0000-0000-000000000005')$$,
  'company_read_only', 'SA em empresa cancelada: company_read_only');

create temp table t_sa_create_ativa as
  select * from public.create_lead('SA Cliente Ativa', '(11) 90000-3001', 'HB20', null, null, null, null,
    'ca100000-0000-0000-0000-000000000001');
select is((select company_id from t_sa_create_ativa), 'ca100000-0000-0000-0000-000000000001'::uuid,
  'SA cria em empresa ativa: company_id = empresa explicita');
select is((select seller_id from t_sa_create_ativa), null, 'SA cria sem vendedor: permitido');
select is((select created_by_profile_id from t_sa_create_ativa), null,
  'SA create: created_by_profile_id NULL (leads_created_by_fk exige mesma company_id, SA nunca tem)');
select is((select updated_by_profile_id from t_sa_create_ativa), null,
  'SA create: updated_by_profile_id tambem NULL, mesmo motivo');

create temp table t_sa_create_impl as
  select * from public.create_lead('SA Cliente Impl', '(11) 90000-3002', 'Onix', 's8c2c1SellerC', null, null, null,
    'ca100000-0000-0000-0000-000000000003');
select is((select seller_id from t_sa_create_impl), 's8c2c1SellerC',
  'SA cria em empresa implantacao com vendedor ativo da mesma empresa: permitido');

select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', 's8c2c1SellerOther', null, null, null, 'ca100000-0000-0000-0000-000000000001')$$,
  'seller_not_found', 'SA: vendedor de outra empresa rejeitado');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', 's8c2c1SellerA1Inact', null, null, null, 'ca100000-0000-0000-0000-000000000001')$$,
  'seller_not_found', 'SA: vendedor inativo rejeitado');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', null, null, null, null, 'ca100000-0000-0000-0000-000000000002')$$,
  'initial_stage_missing', 'SA: empresa sem estagio code new falha com erro preservado');

reset role;
-- audit_log nao tem GRANT nem policy para authenticated (RLS fechada por
-- completo, mesmo padrao de toda a auditoria desde o S4-A1) — as
-- assercoes abaixo rodam como postgres, unico papel com acesso direto.

-- auditoria da criacao em empresa ativa (t_sa_create_ativa)
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_sa_create_ativa)
      and action = 'lead_created'),
  1, 'SA create: exatamente 1 audit_log');
select is(
  (select actor_profile_id from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_sa_create_ativa)),
  'ca200000-0000-0000-0000-000000000001'::uuid, 'SA create: ator real no audit_log');
select is(
  (select company_id from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_sa_create_ativa)),
  'ca100000-0000-0000-0000-000000000001'::uuid, 'SA create: empresa-alvo no audit_log');
select is(
  (select result from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_sa_create_ativa)),
  'success', 'SA create: result=success');
select ok(
  (select before_data is null from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_sa_create_ativa)),
  'SA create: before_data null (nada existia antes)');
select ok(
  not (select (after_data ? 'name') or (after_data ? 'phone') from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_sa_create_ativa)),
  'SA create: after_data nunca contem nome ou telefone completo');
select is(
  (select (after_data->>'archived')::boolean from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_sa_create_ativa)),
  false, 'SA create: after_data.archived=false');

-- criacao em empresa suspensa/cancelada falha ANTES de qualquer insert —
-- nenhum lead, nenhum audit_log foi criado por essas tentativas.
select is((select count(*)::int from public.leads where company_id in
    ('ca100000-0000-0000-0000-000000000004','ca100000-0000-0000-0000-000000000005')
    and name = 'X'), 0, 'nenhum lead criado nas tentativas negadas por status');
select is((select count(*)::int from public.audit_log where action = 'lead_created'
    and company_id in ('ca100000-0000-0000-0000-000000000004','ca100000-0000-0000-0000-000000000005')),
  0, 'nenhum audit_log de create para as tentativas negadas por status');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — UPDATE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.update_lead('ca500000-0000-0000-0000-000000000001', 1, 'X', '(11) 9', 'C')$$,
  'company_required', 'SA update sem p_company_id: company_required');

create temp table t_sa_update as
  select * from public.update_lead('ca500000-0000-0000-0000-000000000001', 1,
    'Lead A Editado SA', '(11) 90000-9001', 'HRV', 'hot', 'financiado', 'showroom',
    'ca100000-0000-0000-0000-000000000001');
select is((select name from t_sa_update), 'Lead A Editado SA', 'SA edita lead da empresa explicita: permitido');
select is((select version from t_sa_update), 2, 'SA update: version incrementada');

select throws_ok(
  $$select public.update_lead('ca500000-0000-0000-0000-000000000003', 1, 'X', '(11) 9', 'C', null, null, null,
      'ca100000-0000-0000-0000-000000000001')$$,
  'lead_not_found', 'SA: lead de outra empresa (CA2) negado sem vazamento, operando em CA1');
select throws_ok(
  $$select public.update_lead('ca500000-0000-0000-0000-000000000004', 1, 'X', '(11) 9', 'C', null, null, null,
      'ca100000-0000-0000-0000-000000000004')$$,
  'company_read_only', 'SA: empresa suspensa nega update');
select throws_ok(
  $$select public.update_lead('ca500000-0000-0000-0000-000000000005', 1, 'X', '(11) 9', 'C', null, null, null,
      'ca100000-0000-0000-0000-000000000005')$$,
  'company_read_only', 'SA: empresa cancelada nega update');

reset role;
-- auditoria: name/phone nunca com valor, car/temperature/payment/source com antes/depois reais
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = 'ca500000-0000-0000-0000-000000000001'
      and action = 'lead_updated'),
  1, 'SA update: exatamente 1 audit_log');
select ok(
  (select (before_data->>'name_changed')::boolean and (after_data->>'name_changed')::boolean
     from public.audit_log where entity_type = 'lead' and entity_id = 'ca500000-0000-0000-0000-000000000001'
       and action = 'lead_updated'),
  'SA update: name_changed=true, sem o valor');
select ok(
  not (select (before_data ? 'name') or (after_data ? 'name')
     from public.audit_log where entity_type = 'lead' and entity_id = 'ca500000-0000-0000-0000-000000000001'
       and action = 'lead_updated'),
  'SA update: chave "name" (valor) nunca aparece no audit_log');
select ok(
  not (select (before_data ? 'phone') or (after_data ? 'phone')
     from public.audit_log where entity_type = 'lead' and entity_id = 'ca500000-0000-0000-0000-000000000001'
       and action = 'lead_updated'),
  'SA update: telefone completo nunca aparece no audit_log');
select is(
  (select before_data->>'car' from public.audit_log
     where entity_type = 'lead' and entity_id = 'ca500000-0000-0000-0000-000000000001' and action = 'lead_updated'),
  'C1', 'SA update: before_data.car e o valor antigo real');
select is(
  (select after_data->>'car' from public.audit_log
     where entity_type = 'lead' and entity_id = 'ca500000-0000-0000-0000-000000000001' and action = 'lead_updated'),
  'HRV', 'SA update: after_data.car e o valor novo real');

-- nenhuma escrita/log para as tentativas negadas por status
select is((select count(*)::int from public.audit_log where action = 'lead_updated'
    and entity_id in ('ca500000-0000-0000-0000-000000000004','ca500000-0000-0000-0000-000000000005')), 0,
  'nenhum audit_log de update para as tentativas negadas por status');
select is((select name from public.leads where id = 'ca500000-0000-0000-0000-000000000004'), 'Lead D Susp',
  'lead em empresa suspensa permanece inalterado apos tentativa negada');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — DUPLICIDADE (leitura, qualquer status)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000001');
set local role authenticated;

select throws_ok(
  $$select * from public.check_lead_phone_duplicate('(11) 90000-2001')$$,
  'company_required', 'SA duplicidade sem p_company_id: company_required');
select throws_ok(
  $$select * from public.check_lead_phone_duplicate('(11) 90000-2001', '00000000-0000-0000-0000-00000000ffff')$$,
  'company_not_found', 'SA duplicidade com empresa inexistente: company_not_found');

select is(
  (select status::text from public.check_lead_phone_duplicate('(11) 90000-2006', 'ca100000-0000-0000-0000-000000000001')),
  'accessible', 'SA duplicidade em empresa ATIVA: permitido');
select is(
  (select status::text from public.check_lead_phone_duplicate('(11) 90000-2003', 'ca100000-0000-0000-0000-000000000002')),
  'accessible', 'SA duplicidade em outra empresa ATIVA, explicitamente selecionada: permitido');
select is(
  (select count(*)::int from public.check_lead_phone_duplicate('(11) 90000-2006', 'ca100000-0000-0000-0000-000000000002')
     where status = 'accessible'),
  0, 'SA duplicidade: empresas nunca se misturam (telefone de CA1 nao aparece ao consultar CA2)');
select is(
  (select status::text from public.check_lead_phone_duplicate('(11) 90000-3002', 'ca100000-0000-0000-0000-000000000003')),
  'accessible', 'SA duplicidade em empresa IMPLANTACAO: permitido');
select is(
  (select status::text from public.check_lead_phone_duplicate('(11) 90000-2004', 'ca100000-0000-0000-0000-000000000004')),
  'accessible', 'SA duplicidade em empresa SUSPENSA: permitido (leitura historica)');
select is(
  (select status::text from public.check_lead_phone_duplicate('(11) 90000-2005', 'ca100000-0000-0000-0000-000000000005')),
  'accessible', 'SA duplicidade em empresa CANCELADA: permitido (leitura historica)');

reset role;
select is(
  (select count(*)::int from public.audit_log where action ilike '%duplicate%'), 0,
  'checagem de duplicidade nunca grava audit_log, nem para Super Admin');

-- ═══════════════════════════════════════════════════════════════════════
-- MANAGER — CREATE/UPDATE/DUPLICIDADE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000002'); -- Manager A (CA1 ativa)
set local role authenticated;

create temp table t_mgr_create_noseller as
  select * from public.create_lead('Mgr Cliente', '(11) 90000-4001', 'Kicks');
select is((select company_id from t_mgr_create_noseller), 'ca100000-0000-0000-0000-000000000001'::uuid,
  'Manager cria na propria empresa (da membership)');
select is((select seller_id from t_mgr_create_noseller), null, 'Manager cria sem vendedor: permitido');
select is((select created_by_profile_id from t_mgr_create_noseller), 'ca200000-0000-0000-0000-000000000002'::uuid,
  'Manager create: created_by_profile_id continua sendo o profile real (nenhuma mudanca de comportamento)');
select is((select updated_by_profile_id from t_mgr_create_noseller), 'ca200000-0000-0000-0000-000000000002'::uuid,
  'Manager create: updated_by_profile_id continua sendo o profile real');

create temp table t_mgr_create_seller as
  select * from public.create_lead('Mgr Cliente2', '(11) 90000-4002', 'Kicks', 's8c2c1SellerA1');
select is((select seller_id from t_mgr_create_seller), 's8c2c1SellerA1',
  'Manager escolhe vendedor ativo da propria empresa: permitido');

-- p_company_id enviado pelo cliente e sempre ignorado para Manager.
create temp table t_mgr_create_ignored as
  select * from public.create_lead('Mgr Cliente3', '(11) 90000-4003', 'Kicks', null, null, null, null,
    'ca100000-0000-0000-0000-000000000002');
select is((select company_id from t_mgr_create_ignored), 'ca100000-0000-0000-0000-000000000001'::uuid,
  'Manager: p_company_id de outra empresa enviado pelo cliente e ignorado (empresa continua sendo a da membership)');

create temp table t_mgr_update as
  select * from public.update_lead('ca500000-0000-0000-0000-000000000002', 1, 'Editado Manager', '(11) 90000-4004', 'C2');
select is((select name from t_mgr_update), 'Editado Manager', 'Manager edita lead de qualquer seller da propria empresa');
select is((select updated_by_profile_id from t_mgr_update), 'ca200000-0000-0000-0000-000000000002'::uuid,
  'Manager update: updated_by_profile_id continua sendo o profile real');

select throws_ok(
  $$select public.update_lead('ca500000-0000-0000-0000-000000000003', 1, 'X', '(11) 9', 'C')$$,
  'lead_not_found', 'Manager: lead de outra empresa negado sem vazamento');

reset role;
-- audit_log so eh legivel como postgres (RLS fechada) — verificado apos
-- reset role.
select is((select count(*)::int from public.audit_log
    where entity_id in ((select id::text from t_mgr_create_noseller), (select id::text from t_mgr_create_seller),
      (select id::text from t_mgr_create_ignored))),
  0, 'Manager create: nenhum audit_log de plataforma (auditoria e exclusiva de Super Admin)');
select is((select count(*)::int from public.audit_log where entity_id = 'ca500000-0000-0000-0000-000000000003'), 0,
  'Manager: p_company_id nao amplia acesso, mesmo enviado explicitamente na tentativa acima (nao ha parametro aqui: prova pela ausencia de qualquer efeito)');

-- Super Admin edita um lead CRIADO POR MANAGER: created_by_profile_id
-- (autoria original) permanece intocado; updated_by_profile_id vira NULL
-- (decisao humana registrada na migration 20260729110000).
select pg_temp.as_user('ca200000-0000-0000-0000-000000000001');
set local role authenticated;
create temp table t_sa_update_on_mgr_lead as
  select * from public.update_lead((select id from t_mgr_create_noseller), 1,
    'Editado por SA depois do Manager', '(11) 90000-4099', 'C9', null, null, null,
    'ca100000-0000-0000-0000-000000000001');
select is((select created_by_profile_id from t_sa_update_on_mgr_lead), 'ca200000-0000-0000-0000-000000000002'::uuid,
  'SA update sobre lead criado por Manager: created_by_profile_id do Manager permanece intacto');
select is((select updated_by_profile_id from t_sa_update_on_mgr_lead), null,
  'SA update: updated_by_profile_id vira NULL, mesmo sobre lead criado por Manager');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SELLER — CREATE/UPDATE/DUPLICIDADE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000003'); -- Seller A1 (CA1 ativa)
set local role authenticated;

create temp table t_seller_create as
  select * from public.create_lead('Seller Cliente', '(11) 90000-5001', 'Onix');
select is((select seller_id from t_seller_create), 's8c2c1SellerA1', 'Seller: autoatribuicao mesmo sem informar seller');

select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', 's8c2c1SellerA1Alt')$$,
  'forbidden', 'Seller: nao escolhe outro vendedor');
select lives_ok(
  $$select public.create_lead('Seller Cliente2', '(11) 90000-5002', 'C', 's8c2c1SellerA1')$$,
  'Seller: informar o proprio seller_id e permitido');

-- p_company_id enviado pelo cliente e sempre ignorado para Seller.
create temp table t_seller_create_ignored as
  select * from public.create_lead('Seller Cliente3', '(11) 90000-5003', 'C', null, null, null, null,
    'ca100000-0000-0000-0000-000000000002');
select is((select company_id from t_seller_create_ignored), 'ca100000-0000-0000-0000-000000000001'::uuid,
  'Seller: p_company_id de outra empresa enviado pelo cliente e ignorado');

create temp table t_seller_update_own as
  select * from public.update_lead('ca500000-0000-0000-0000-000000000001', (select version from t_sa_update),
    'Editado Seller', '(11) 90000-5004', 'C1');
select is((select name from t_seller_update_own), 'Editado Seller', 'Seller edita o proprio lead');

select throws_ok(
  $$select public.update_lead('ca500000-0000-0000-0000-000000000002', 1, 'X', '(11) 9', 'C')$$,
  'forbidden', 'Seller: lead alheio negado');

select results_eq(
  $$select status::text from public.check_lead_phone_duplicate('(11) 90000-2006')$$,
  $$values ('accessible')$$,
  'Seller: proprio lead ativo aparece como accessible na duplicidade');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- EMPRESA NAO ATIVA NEGA MANAGER/SELLER (implantacao/suspensa/cancelada)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000004'); -- Manager C (CA3 implantacao)
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden',
  'Manager em empresa implantacao: create negado');
select throws_ok($$select public.update_lead('ca500000-0000-0000-0000-000000000001', 1, 'X', '(11) 9', 'C')$$, 'forbidden',
  'Manager em empresa implantacao: update negado (lead de outra empresa de qualquer forma)');
select throws_ok($$select * from public.check_lead_phone_duplicate('(11) 90000-2001')$$, 'forbidden',
  'Manager em empresa implantacao: duplicidade negada (Manager/Seller nunca leem fora de ativa)');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000005'); -- Manager D (CA4 suspensa)
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden',
  'Manager em empresa suspensa: create negado');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000006'); -- Manager E (CA5 cancelada)
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden',
  'Manager em empresa cancelada: create negado');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000007'); -- Seller C (CA3 implantacao)
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden',
  'Seller em empresa nao ativa: create negado');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- MEMBERSHIP AUSENTE/SUSPENSA/OFFBOARDED/PROFILE INATIVO
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000008'); -- sem membership
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden', 'sem membership: forbidden');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000009'); -- membership suspensa
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden', 'membership suspensa: forbidden');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-00000000000a'); -- membership offboarded
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden', 'membership offboarded: forbidden');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-00000000000b'); -- profile globalmente inativo (membership ativa)
set local role authenticated;
select throws_ok($$select public.create_lead('X', '(11) 9', 'C')$$, 'forbidden',
  'profile globalmente inativo: forbidden mesmo com membership ativa');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- RESOLUÇÃO EXCLUSIVAMENTE VIA MEMBERSHIP (ex-"legado divergente")
-- ═══════════════════════════════════════════════════════════════════════
-- M1-F S8-E2 removeu fisicamente profiles.company_id/role/seller_id — não
-- há mais campo legado para divergir. Este bloco preserva a cobertura de
-- que create_lead/update_lead resolvem empresa/vendedor exclusivamente a
-- partir de company_memberships/sellers: o ator abaixo é seller ativo em
-- CA1 (via membership) e deve se comportar exatamente como qualquer outro
-- Seller da empresa.

select pg_temp.as_user('ca200000-0000-0000-0000-00000000000c');
set local role authenticated;
create temp table t_legacy_create as
  select * from public.create_lead('Legado Cliente', '(11) 90000-6001', 'C');
select is((select company_id from t_legacy_create), 'ca100000-0000-0000-0000-000000000001'::uuid,
  'empresa resolvida e a da MEMBERSHIP real (CA1)');
select is((select seller_id from t_legacy_create), 's8c2c1SellerLegacy',
  'autoatribuido ao seller da membership real, nunca a um seller inventado');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', 's8c2c1SellerA1')$$,
  'forbidden', 'ator continua tratado como Seller (nao escolhe outro vendedor)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ANON
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select public.create_lead('a', '(11) 9', 'c')$$, '42501', null, 'anon nao executa create_lead');
select throws_ok($$select public.update_lead('ca500000-0000-0000-0000-000000000001', 1, 'a', '(11) 9', 'c')$$,
  '42501', null, 'anon nao executa update_lead');
select throws_ok($$select * from public.check_lead_phone_duplicate('(11) 9')$$, '42501', null,
  'anon nao executa check_lead_phone_duplicate');
reset role;

select * from finish();
rollback;
