-- M1-E E4-A1 — pré-requisitos de backend para Seller picker e duplicidade
-- na edição (20260730040000_m1e_e4a1_assignable_sellers_and_duplicate_
-- exclusion.sql). Cobre: catálogo da nova RPC
-- list_current_company_assignable_sellers (assinatura sem parâmetro,
-- SECURITY DEFINER, search_path, grants), Manager recebe somente Sellers
-- OPERACIONAIS (nunca históricos/inativos, diferente de E3-A1), Seller
-- recebe no máximo a própria linha operacional, Super Admin nunca usa esta
-- RPC, transferência (linha antiga NUNCA aparece — diferente de E3-A1),
-- extensão p_exclude_lead_id de check_lead_phone_duplicate (comportamento
-- antigo preservado, exclusão nunca esconde outro duplicado, ID inexistente/
-- de outra empresa sem efeito), create_lead/update_lead/
-- list_current_company_seller_labels/list_platform_sellers_for_company
-- intactas. Roda como postgres dentro de uma transação com rollback ao
-- final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_assignable_sellers'),
  1, 'list_current_company_assignable_sellers existe, assinatura unica');
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_assignable_sellers'),
  '', 'assinatura: zero parametros — empresa nunca enviada pelo cliente');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_assignable_sellers'),
  'SECURITY DEFINER');
select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_assignable_sellers'),
  array['search_path=""'], 'search_path fixo e vazio');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_current_company_assignable_sellers' and grantee = 'PUBLIC'),
  0, 'PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_current_company_assignable_sellers' and grantee = 'anon'),
  0, 'anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_current_company_assignable_sellers' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'authenticated com EXECUTE');

-- nenhuma tabela recebeu SELECT novo — a RPC continua sendo o único caminho.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sellers'
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'),
  0, 'nenhum SELECT novo em public.sellers para anon/authenticated');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'
      and table_name not in (select table_name from information_schema.role_column_grants where grantee='authenticated' and privilege_type='SELECT')),
  0, 'nenhum SELECT de TABELA INTEIRA novo em public.profiles');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'),
  0, 'nenhum SELECT de TABELA INTEIRA novo em public.company_memberships');

-- catálogo histórico (E3-A1) e RPC platform (M1-F) continuam intactos.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_seller_labels'),
  1, 'list_current_company_seller_labels continua existindo, sem duplicata');
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_seller_labels'),
  '', 'list_current_company_seller_labels mantem zero parametros, intocada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_platform_sellers_for_company'),
  1, 'list_platform_sellers_for_company continua existindo, sem duplicata');
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_platform_sellers_for_company'),
  'p_company_id uuid', 'list_platform_sellers_for_company mantem p_company_id uuid, intocada');

-- create_lead/update_lead intactas (mesma assinatura terminando em
-- p_company_id — nenhum p_exclude_lead_id vazou para elas).
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_lead'),
  'create_lead: intocada, ainda termina em p_company_id uuid DEFAULT NULL');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_lead'),
  'update_lead: intocada, ainda termina em p_company_id uuid DEFAULT NULL');

-- check_lead_phone_duplicate: assinatura antiga (2 args) NAO permanece como
-- overload; apenas a assinatura nova (3 args) existe.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_lead_phone_duplicate'),
  1, 'check_lead_phone_duplicate: uma unica assinatura (sem overload da versao antiga)');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_exclude_lead_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_lead_phone_duplicate'),
  'check_lead_phone_duplicate: p_exclude_lead_id e o ultimo parametro, com default');
select ok(
  (select pg_get_function_arguments(p.oid) like 'p_phone text, p_company_id uuid DEFAULT NULL::uuid,%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_lead_phone_duplicate'),
  'check_lead_phone_duplicate: p_phone/p_company_id preservados na mesma posicao/ordem');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'check_lead_phone_duplicate' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'check_lead_phone_duplicate: authenticated com EXECUTE (grants preservados)');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'check_lead_phone_duplicate' and grantee = 'anon'),
  0, 'check_lead_phone_duplicate: anon sem EXECUTE (preservado)');

-- ══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('e4a10000-0000-0000-0000-000000000001', 'E4A1 Empresa A Ativa', 'ativa'),
  ('e4a10000-0000-0000-0000-000000000002', 'E4A1 Empresa B Ativa (destino)', 'ativa'),
  ('e4a10000-0000-0000-0000-000000000003', 'E4A1 Empresa C Ativa (sem sellers)', 'ativa'),
  ('e4a10000-0000-0000-0000-000000000004', 'E4A1 Empresa D Suspensa', 'suspensa');

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('e4a10000-0000-0000-0000-0000000000a1', 'e4a10000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('e4a10000-0000-0000-0000-0000000000b1', 'e4a10000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e4a1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e4a1-seller-a1-op@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'e4a1-seller-a2-inactive-seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'e4a1-seller-a3-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'e4a1-seller-a4-suspended-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'e4a1-seller-a5-offboarded-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'e4a1-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'e4a1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'e4a1-manager-c-empty@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'e4a1-manager-d-suspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4a20000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'e4a1-seller-transfer@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e4a20000-0000-0000-0000-000000000001', 'E4A1 Manager A', 'e4a1-manager-a@test.local', true, null),
  ('e4a20000-0000-0000-0000-000000000002', 'E4A1 Seller A1 Operacional', 'e4a1-seller-a1-op@test.local', true, null),
  ('e4a20000-0000-0000-0000-000000000003', 'E4A1 Seller A2 (seller inativo)', 'e4a1-seller-a2-inactive-seller@test.local', true, null),
  ('e4a20000-0000-0000-0000-000000000004', 'E4A1 Seller A3 (profile inativo)', 'e4a1-seller-a3-inactive-profile@test.local', false, null),
  ('e4a20000-0000-0000-0000-000000000005', 'E4A1 Seller A4 (membership suspensa)', 'e4a1-seller-a4-suspended-membership@test.local', true, null),
  ('e4a20000-0000-0000-0000-000000000006', 'E4A1 Seller A5 (membership desligada)', 'e4a1-seller-a5-offboarded-membership@test.local', true, null),
  ('e4a20000-0000-0000-0000-000000000007', 'E4A1 Manager B', 'e4a1-manager-b@test.local', true, null),
  ('e4a20000-0000-0000-0000-000000000008', 'E4A1 Super Admin', 'e4a1-superadmin@test.local', true, 'super_admin'),
  ('e4a20000-0000-0000-0000-000000000009', 'E4A1 Manager C', 'e4a1-manager-c-empty@test.local', true, null),
  ('e4a20000-0000-0000-0000-00000000000a', 'E4A1 Manager D', 'e4a1-manager-d-suspensa@test.local', true, null),
  ('e4a20000-0000-0000-0000-00000000000b', 'E4A1 Seller Transferido', 'e4a1-seller-transfer@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('e4a30000-0000-0000-0000-000000000001', 'e4a10000-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-000000000001', 'manager', true, 'active'),
  ('e4a30000-0000-0000-0000-000000000002', 'e4a10000-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-000000000002', 'seller', true, 'active'),
  ('e4a30000-0000-0000-0000-000000000003', 'e4a10000-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-000000000003', 'seller', true, 'active'),
  ('e4a30000-0000-0000-0000-000000000004', 'e4a10000-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-000000000004', 'seller', true, 'active'),
  ('e4a30000-0000-0000-0000-000000000005', 'e4a10000-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-000000000005', 'seller', false, 'suspended'),
  ('e4a30000-0000-0000-0000-000000000006', 'e4a10000-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-000000000006', 'seller', false, 'offboarded'),
  ('e4a30000-0000-0000-0000-000000000007', 'e4a10000-0000-0000-0000-000000000002', 'e4a20000-0000-0000-0000-000000000007', 'manager', true, 'active'),
  ('e4a30000-0000-0000-0000-000000000009', 'e4a10000-0000-0000-0000-000000000003', 'e4a20000-0000-0000-0000-000000000009', 'manager', true, 'active'),
  ('e4a3000a-0000-0000-0000-000000000001', 'e4a10000-0000-0000-0000-000000000004', 'e4a20000-0000-0000-0000-00000000000a', 'manager', true, 'active'),
  ('e4a3000b-0000-0000-0000-000000000001', 'e4a10000-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-00000000000b', 'seller', true, 'active');

insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('e4a1SellerA1Op',      'e4a10000-0000-0000-0000-000000000001', 'e4a30000-0000-0000-0000-000000000002', 'e4a20000-0000-0000-0000-000000000002', 'E4A1 Seller A1 Operacional', 'E4A1', true),
  ('e4a1SellerA2Inact',   'e4a10000-0000-0000-0000-000000000001', 'e4a30000-0000-0000-0000-000000000003', 'e4a20000-0000-0000-0000-000000000003', 'E4A1 Seller A2', 'E4A1', false),
  ('e4a1SellerA3ProfInac','e4a10000-0000-0000-0000-000000000001', 'e4a30000-0000-0000-0000-000000000004', 'e4a20000-0000-0000-0000-000000000004', 'E4A1 Seller A3', 'E4A1', true),
  ('e4a1SellerA4Susp',    'e4a10000-0000-0000-0000-000000000001', 'e4a30000-0000-0000-0000-000000000005', 'e4a20000-0000-0000-0000-000000000005', 'E4A1 Seller A4', 'E4A1', true),
  ('e4a1SellerA5Off',     'e4a10000-0000-0000-0000-000000000001', 'e4a30000-0000-0000-0000-000000000006', 'e4a20000-0000-0000-0000-000000000006', 'E4A1 Seller A5', 'E4A1', true),
  ('e4a1SellerTransfer',  'e4a10000-0000-0000-0000-000000000001', 'e4a3000b-0000-0000-0000-000000000001', 'e4a20000-0000-0000-0000-00000000000b', 'E4A1 Seller Transferido', 'E4A1', true),
  ('e4a1SellerOtherCo',   'e4a10000-0000-0000-0000-000000000002', null, null, 'E4A1 Seller Outra Empresa', 'E4A1', true),
  ('e4a1SellerNoMembersh','e4a10000-0000-0000-0000-000000000001', null, null, 'E4A1 Seller Sem Membership', 'E4A1', true);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at, created_at) values
  ('e4a40000-0000-0000-0000-000000000001', 'e4a10000-0000-0000-0000-000000000001', 'E4A1 Lead Original',  '(11) 97000-0001', 'HB20',
   'e4a10000-0000-0000-0000-0000000000a1', 'e4a1SellerA1Op', null, '2026-01-01'),
  ('e4a40000-0000-0000-0000-000000000002', 'e4a10000-0000-0000-0000-000000000001', 'E4A1 Lead Duplicado', '(11) 97000-0001', 'Onix',
   'e4a10000-0000-0000-0000-0000000000a1', 'e4a1SellerA1Op', null, '2026-01-02'),
  ('e4a40000-0000-0000-0000-000000000003', 'e4a10000-0000-0000-0000-000000000001', 'E4A1 Lead Arquivado', '(11) 97000-0002', 'Argo',
   'e4a10000-0000-0000-0000-0000000000a1', 'e4a1SellerA1Op', now(), '2026-01-03'),
  ('e4a40000-0000-0000-0000-000000000004', 'e4a10000-0000-0000-0000-000000000002', 'E4A1 Lead Empresa B', '(11) 97000-0003', 'Polo',
   'e4a10000-0000-0000-0000-0000000000b1', null, null, '2026-01-01'),
  ('e4a40000-0000-0000-0000-000000000005', 'e4a10000-0000-0000-0000-000000000001', 'E4A1 Lead Alheio',    '(11) 97000-0005', 'Kicks',
   'e4a10000-0000-0000-0000-0000000000a1', null, null, '2026-01-01');

-- ══════════════════════════════════════════════════════════════════════
-- 2. MANAGER — assignable sellers
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000001'); -- Manager A
-- Dois Sellers sao operacionais nesta empresa neste ponto (e4a1SellerA1Op e
-- e4a1SellerTransfer, este ultimo ainda nao transferido — secao 6, abaixo)
-- — ambos precisam aparecer, ordenados por name.
select results_eq(
  $$select seller_id, name from public.list_current_company_assignable_sellers()$$,
  $$values ('e4a1SellerA1Op'::text, 'E4A1 Seller A1 Operacional'::text),
           ('e4a1SellerTransfer'::text, 'E4A1 Seller Transferido'::text)$$,
  'Manager A: recebe SOMENTE os Sellers operacionais (ativo + membership ativa/lifecycle active/role seller + profile ativo)');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerA2Inact'),
  0, 'Manager A: NAO recebe Seller com sellers.is_active=false');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerA3ProfInac'),
  0, 'Manager A: NAO recebe Seller cujo profile esta inativo');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerA4Susp'),
  0, 'Manager A: NAO recebe Seller com membership suspensa (mesmo com sellers.is_active=true)');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerA5Off'),
  0, 'Manager A: NAO recebe Seller com membership desligada (mesmo com sellers.is_active=true)');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerOtherCo'),
  0, 'Manager A: NUNCA ve Seller de outra empresa');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerNoMembersh'),
  0, 'Manager A: Seller sem membership_id (linha orfa) nunca aparece');
-- Manager A propria nunca aparece como Seller assignable (nenhum Manager
-- tem linha em sellers referenciando sua propria membership — ja provado
-- implicitamente pelo results_eq acima, que especifica o conjunto inteiro
-- retornado; checagem adicional sem exigir SELECT direto em sellers/
-- company_memberships, que authenticated nao possui por design).
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a30000-0000-0000-0000-000000000001'),
  0, 'Manager A: o proprio id de membership do Manager nunca aparece como seller_id assignable');
reset role;

-- Manager de empresa sem nenhum Seller: conjunto vazio, sem erro.
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000009'); -- Manager C
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()),
  0, 'Manager C (empresa sem Sellers): conjunto vazio, sem erro');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. SELLER — assignable sellers
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000002'); -- Seller A1 (operacional)
select results_eq(
  $$select seller_id, name from public.list_current_company_assignable_sellers()$$,
  $$values ('e4a1SellerA1Op'::text, 'E4A1 Seller A1 Operacional'::text)$$,
  'Seller A1: recebe no maximo a propria linha operacional');
reset role;

set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000003'); -- Seller A2 (sellers.is_active=false)
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()),
  0, 'Seller A2 (propria linha sellers inativa): conjunto vazio — invalido nunca amplia acesso');
reset role;

set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000005'); -- Seller A4 (membership suspensa)
select throws_ok(
  $$select * from public.list_current_company_assignable_sellers()$$,
  '42501', 'forbidden', 'Seller com a propria membership suspensa: forbidden no gate (current_membership_role/company_id ja falham)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. SUPER ADMIN — nunca usa esta RPC
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000008'); -- Super Admin, sem membership por design
select throws_ok(
  $$select * from public.list_current_company_assignable_sellers()$$,
  '42501', 'forbidden', 'Super Admin (sem membership, por design) e negado — nunca aceita company_id, nunca delega para list_platform_sellers_for_company');
-- RPC platform continua disponivel para Super Admin, intocada.
select lives_ok(
  $$select * from public.list_platform_sellers_for_company('e4a10000-0000-0000-0000-000000000001')$$,
  'list_platform_sellers_for_company continua disponivel e funcional para Super Admin');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. STATUS DA EMPRESA
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-00000000000a'); -- Manager D, empresa suspensa
select throws_ok(
  $$select * from public.list_current_company_assignable_sellers()$$,
  '42501', 'forbidden', 'Manager de empresa suspensa: forbidden (mesmo gate de list_current_company_seller_labels)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. TRANSFERÊNCIA — diferença deliberada do catálogo histórico (E3-A1)
-- ══════════════════════════════════════════════════════════════════════

-- Antes da transferencia: Manager A ve o Seller Transferido como assignable
-- (ainda operacional na empresa A).
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerTransfer'),
  1, 'Manager A (pre-transferencia): Seller Transferido aparece como assignable');
reset role;

-- transfer_membership exige Super Admin real; move o Seller Transferido da
-- empresa A para a empresa B, desativando a linha de origem e criando uma
-- linha NOVA no destino (mesmo padrao ja coberto em 37_m1f_s6d_.../51_).
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000008'); -- Super Admin
select * from public.transfer_membership(
  'e4a3000b-0000-0000-0000-000000000001',
  'e4a10000-0000-0000-0000-000000000002',
  'seller',
  null,
  'E4A1 - teste de transferencia'
);
reset role;

-- Depois da transferencia: Manager A (empresa de ORIGEM) NAO VE MAIS o
-- Seller como assignable — diferenca central do catalogo historico
-- (list_current_company_seller_labels AINDA mostraria essa linha).
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerTransfer'),
  0, 'Manager A (pos-transferencia): a linha ANTIGA nunca aparece como assignable (sellers.is_active=false apos transfer_membership)');
select is(
  (select count(*)::int from public.list_current_company_seller_labels()
     where seller_id = 'e4a1SellerTransfer'),
  1, 'Contraste: o catalogo HISTORICO (E3-A1) continua mostrando a linha antiga — os dois catalogos nunca convergem');
reset role;

-- O Seller transferido, agora na empresa B, resolve exatamente a linha NOVA.
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()),
  1, 'Seller transferido: resolve exatamente 1 linha (a NOVA, da empresa destino)');
select isnt(
  (select seller_id from public.list_current_company_assignable_sellers()),
  'e4a1SellerTransfer',
  'Seller transferido: a linha assignable atual e uma identidade NOVA, nunca reaproveita a antiga');
reset role;

-- Manager B (destino) agora resolve a linha nova como assignable.
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000007'); -- Manager B
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()),
  1, 'Manager B: catalogo assignable da empresa destino agora inclui exatamente o Seller transferido (linha nova)');
select is(
  (select count(*)::int from public.list_current_company_assignable_sellers()
     where seller_id = 'e4a1SellerTransfer'),
  0, 'Manager B: NUNCA ve a linha antiga (que ficou inativa na empresa de origem)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. PII
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select array_agg(a.name::text order by a.name::text)
     from unnest(
       (select proargnames from pg_proc where oid = 'public.list_current_company_assignable_sellers()'::regprocedure),
       (select proargmodes from pg_proc where oid = 'public.list_current_company_assignable_sellers()'::regprocedure)
     ) with ordinality as a(name, mode, ord)
    where a.mode = 't'),
  array['name', 'seller_id'],
  'retorno contem exatamente seller_id/name — nenhuma outra PII');

-- ══════════════════════════════════════════════════════════════════════
-- 8. DUPLICIDADE — p_exclude_lead_id
-- ══════════════════════════════════════════════════════════════════════

-- Manager A: comportamento antigo preservado com exclude null (default).
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000001'); -- Manager A
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002'),
           ('accessible', 'e4a40000-0000-0000-0000-000000000001')$$,
  'Manager A: comportamento antigo preservado (exclude null) — 2 acessiveis, mais recente primeiro');

-- excluir o Lead ORIGINAL (o "proprio registro em edicao"): o OUTRO
-- duplicado continua aparecendo — nunca escondido.
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001', null, 'e4a40000-0000-0000-0000-000000000001')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002')$$,
  'Manager A: excluir o proprio Lead em edicao ainda retorna o OUTRO Lead duplicado (nunca escondido)');

-- excluir o Lead DUPLICADO: o Lead ORIGINAL continua aparecendo.
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001', null, 'e4a40000-0000-0000-0000-000000000002')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000001')$$,
  'Manager A: excluir o Lead Duplicado ainda retorna o Lead Original');

-- ID inexistente: nao altera o resultado.
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001', null, '99999999-9999-9999-9999-999999999999')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002'),
           ('accessible', 'e4a40000-0000-0000-0000-000000000001')$$,
  'Manager A: p_exclude_lead_id inexistente nao altera o resultado');

-- ID de OUTRA empresa: nao esconde nem amplia o duplicado da empresa atual.
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001', null, 'e4a40000-0000-0000-0000-000000000004')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002'),
           ('accessible', 'e4a40000-0000-0000-0000-000000000001')$$,
  'Manager A: p_exclude_lead_id de OUTRA empresa nao tem efeito nenhum (nao amplia acesso, nao esconde duplicado)');

-- archived preservado (exclude null).
select results_eq(
  $$select status::text, lead_archived from public.check_lead_phone_duplicate('(11) 97000-0002')$$,
  $$values ('accessible', true)$$,
  'Manager A: comportamento de arquivado preservado (accessible com lead_archived=true)');

-- invalid_phone preservado.
select throws_ok(
  $$select * from public.check_lead_phone_duplicate('abc-def')$$,
  'invalid_phone', 'invalid_phone preservado para telefone sem digitos');
reset role;

-- Seller A1: mesmo comportamento de exclusao no proprio conjunto acessivel.
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000002'); -- Seller A1
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002'),
           ('accessible', 'e4a40000-0000-0000-0000-000000000001')$$,
  'Seller A1: comportamento antigo preservado (exclude null) — 2 proprios acessiveis');
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001', null, 'e4a40000-0000-0000-0000-000000000001')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002')$$,
  'Seller A1: excluir o proprio Lead em edicao ainda retorna o OUTRO Lead duplicado proprio');

-- Lead alheio (Lead Alheio, sem vendedor): aparece como restricted.
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0005')$$,
  $$values ('restricted', null)$$,
  'Seller A1: Lead sem vendedor definido conta como restricted');
-- excluir esse mesmo Lead alheio da busca: deixa de contar para o aviso.
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0005', null, 'e4a40000-0000-0000-0000-000000000005')$$,
  $$values ('none', null)$$,
  'Seller A1: excluir o Lead alheio da busca remove tambem o restricted (exclusao vale para a checagem inteira, nao so para accessible)');
reset role;

-- Super Admin com p_company_id: comportamento preservado, com exclusao.
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000008'); -- Super Admin
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001', 'e4a10000-0000-0000-0000-000000000001')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002'),
           ('accessible', 'e4a40000-0000-0000-0000-000000000001')$$,
  'Super Admin com p_company_id explicito: comportamento preservado');
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 97000-0001', 'e4a10000-0000-0000-0000-000000000001', 'e4a40000-0000-0000-0000-000000000001')$$,
  $$values ('accessible', 'e4a40000-0000-0000-0000-000000000002')$$,
  'Super Admin: p_exclude_lead_id funciona identicamente com p_company_id explicito');
reset role;

-- ── criacao/edicao permanecem nunca bloqueadas pela checagem ────────────
set local role authenticated;
select pg_temp.as_user('e4a20000-0000-0000-0000-000000000001'); -- Manager A
select lives_ok(
  $$select public.create_lead('E4A1 Novo Apesar de Duplicado', '(11) 97000-0001', 'C9')$$,
  'create_lead permanece permitido com telefone duplicado (checagem nunca e autoridade)');
reset role;

select * from finish();
rollback;
