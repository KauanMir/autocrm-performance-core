-- M1-F S6-B — lifecycle da membership (suspend_membership/
-- reactivate_membership, 20260727130000_m1f_s6b_membership_lifecycle.sql).
-- Cobre schema (enum/coluna/constraint/índice), catálogo das duas RPCs,
-- autorização por ator (Super Admin/Manager/Seller/sem sessão/ator
-- inativo/autoação/alvo Super Admin/alvo inexistente/empresa não
-- operacional), motivo obrigatório (suspensão) e opcional (reativação),
-- sincronização company_memberships<->sellers, guarda do último Manager,
-- idempotência, rejeição de offboarded, inconsistências
-- (seller_state_conflict), auditoria exata e integração com
-- can_access_company/list_company_users. Fixtures sintéticas @test.local,
-- transação com rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('6b020000-0000-0000-0000-000000000001', 'S6B Empresa A', 'ativa'),
  ('6b020000-0000-0000-0000-000000000002', 'S6B Empresa B', 'ativa'),
  ('6b020000-0000-0000-0000-000000000003', 'S6B Empresa Cancelada', 'cancelada'),
  ('6b020000-0000-0000-0000-000000000004', 'S6B Empresa Suspensa', 'suspensa'),
  ('6b020000-0000-0000-0000-000000000005', 'S6B Empresa Last Manager', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's6b-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's6b-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's6b-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's6b-seller-a2-noseller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's6b-seller-a3@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's6b-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's6b-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's6b-seller-b1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's6b-manager-inactive-actor@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 's6b-superadmin-alvo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 's6b-seller-suspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 's6b-seller-cancelada@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000015', 'authenticated', 'authenticated', 's6b-lastmgr-x@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000016', 'authenticated', 'authenticated', 's6b-lastmgr-y@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000017', 'authenticated', 'authenticated', 's6b-seller-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 's6b-manager-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 's6b-sem-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000022', 'authenticated', 'authenticated', 's6b-seller-catalogo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6b010000-0000-0000-0000-000000000023', 'authenticated', 'authenticated', 's6b-seller-a4@test.local', now(), now(), now());

insert into public.profiles (id, name, email, role, is_active, platform_role) values
  ('6b010000-0000-0000-0000-000000000001', 'S6B Super Admin', 's6b-superadmin@test.local', 'seller', true, 'super_admin'),
  ('6b010000-0000-0000-0000-000000000002', 'S6B Manager A', 's6b-manager-a@test.local', 'manager', true, null),
  ('6b010000-0000-0000-0000-000000000003', 'S6B Seller A1', 's6b-seller-a1@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000004', 'S6B Seller A2 Sem Seller', 's6b-seller-a2-noseller@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000005', 'S6B Seller A3', 's6b-seller-a3@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000006', 'S6B Profile Inativo', 's6b-inactive-profile@test.local', 'seller', false, null),
  ('6b010000-0000-0000-0000-000000000007', 'S6B Manager B', 's6b-manager-b@test.local', 'manager', true, null),
  ('6b010000-0000-0000-0000-000000000008', 'S6B Seller B1', 's6b-seller-b1@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000009', 'S6B Manager Ator Inativo', 's6b-manager-inactive-actor@test.local', 'manager', false, null),
  ('6b010000-0000-0000-0000-000000000010', 'S6B Super Admin Alvo', 's6b-superadmin-alvo@test.local', 'seller', true, 'super_admin'),
  ('6b010000-0000-0000-0000-000000000013', 'S6B Seller Empresa Suspensa', 's6b-seller-suspensa@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000014', 'S6B Seller Empresa Cancelada', 's6b-seller-cancelada@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000015', 'S6B LastMgr X', 's6b-lastmgr-x@test.local', 'manager', true, null),
  ('6b010000-0000-0000-0000-000000000016', 'S6B LastMgr Y', 's6b-lastmgr-y@test.local', 'manager', true, null),
  ('6b010000-0000-0000-0000-000000000017', 'S6B Seller Offboarded', 's6b-seller-offboarded@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000020', 'S6B Manager A2', 's6b-manager-a2@test.local', 'manager', true, null),
  ('6b010000-0000-0000-0000-000000000022', 'S6B Seller Catalogo', 's6b-seller-catalogo@test.local', 'seller', true, null),
  ('6b010000-0000-0000-0000-000000000023', 'S6B Seller A4', 's6b-seller-a4@test.local', 'seller', true, null);
-- 6b010000-...-000021 (auth user sem profile) deliberadamente sem linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at) values
  ('6b030000-0000-0000-0000-000000000001', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000002', 'manager', true,  'active', now()),
  ('6b030000-0000-0000-0000-000000000002', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000003', 'seller',  true,  'active', now()), -- Seller A1, ciclo principal (com sellers row)
  ('6b030000-0000-0000-0000-000000000003', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000004', 'seller',  true,  'active', now()), -- Seller A2, SEM sellers row (seller_ausente / motivo)
  ('6b030000-0000-0000-0000-000000000004', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000005', 'seller',  true,  'active', now()), -- Seller A3, idempotencia (com sellers row)
  ('6b030000-0000-0000-0000-000000000005', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000006', 'seller',  true,  'active', now()), -- profile inativo (alvo)
  ('6b030000-0000-0000-0000-000000000006', '6b020000-0000-0000-0000-000000000002', '6b010000-0000-0000-0000-000000000007', 'manager', true,  'active', now()), -- Manager B (empresa B)
  ('6b030000-0000-0000-0000-000000000007', '6b020000-0000-0000-0000-000000000002', '6b010000-0000-0000-0000-000000000008', 'seller',  true,  'active', now()), -- Seller B1 (empresa B, com sellers row)
  ('6b030000-0000-0000-0000-000000000008', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000009', 'manager', true,  'active', now()), -- Manager com profile inativo (ator inativo)
  ('6b030000-0000-0000-0000-000000000009', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000010', 'seller',  true,  'active', now()), -- Super Admin com membership real (alvo proibido / autoacao)
  ('6b030000-0000-0000-0000-000000000013', '6b020000-0000-0000-0000-000000000004', '6b010000-0000-0000-0000-000000000013', 'seller',  true,  'active', now()), -- empresa suspensa
  ('6b030000-0000-0000-0000-000000000014', '6b020000-0000-0000-0000-000000000003', '6b010000-0000-0000-0000-000000000014', 'seller',  true,  'active', now()), -- empresa cancelada
  ('6b030000-0000-0000-0000-000000000015', '6b020000-0000-0000-0000-000000000005', '6b010000-0000-0000-0000-000000000015', 'manager', true,  'active', now()), -- LastMgr X
  ('6b030000-0000-0000-0000-000000000016', '6b020000-0000-0000-0000-000000000005', '6b010000-0000-0000-0000-000000000016', 'manager', true,  'active', now()), -- LastMgr Y
  ('6b030000-0000-0000-0000-000000000017', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000017', 'seller',  false, 'offboarded', now()), -- ja desligado (fora do fluxo da RPC, fixture direta)
  ('6b030000-0000-0000-0000-000000000020', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000020', 'manager', true,  'active', now()), -- Manager A2 (segundo manager da empresa A)
  ('6b030000-0000-0000-0000-000000000022', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000022', 'seller',  true,  'active', now()), -- dedicada ao teste de catalogo (tipos de retorno), nunca reutilizada
  ('6b030000-0000-0000-0000-000000000023', '6b020000-0000-0000-0000-000000000001', '6b010000-0000-0000-0000-000000000023', 'seller',  true,  'active', now()); -- dedicada ao teste de autorizacao "Manager sobre Seller da propria empresa" (com sellers row real)

insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s6b-a1', '6b020000-0000-0000-0000-000000000001', '6b030000-0000-0000-0000-000000000002', '6b010000-0000-0000-0000-000000000003', 'S6B Seller A1', 'S6B', true),
  ('s6b-a3', '6b020000-0000-0000-0000-000000000001', '6b030000-0000-0000-0000-000000000004', '6b010000-0000-0000-0000-000000000005', 'S6B Seller A3', 'S6B', true),
  ('s6b-b1', '6b020000-0000-0000-0000-000000000002', '6b030000-0000-0000-0000-000000000007', '6b010000-0000-0000-0000-000000000008', 'S6B Seller B1', 'S6B', true),
  ('s6b-cat', '6b020000-0000-0000-0000-000000000001', '6b030000-0000-0000-0000-000000000022', '6b010000-0000-0000-0000-000000000022', 'S6B Seller Catalogo', 'S6B', true),
  ('s6b-offboarded', '6b020000-0000-0000-0000-000000000001', '6b030000-0000-0000-0000-000000000017', '6b010000-0000-0000-0000-000000000017', 'S6B Seller Offboarded', 'S6B', false), -- consistente com o estado ja offboarded da membership (is_active=false)
  ('s6b-a4', '6b020000-0000-0000-0000-000000000001', '6b030000-0000-0000-0000-000000000023', '6b010000-0000-0000-0000-000000000023', 'S6B Seller A4', 'S6B', true);

-- ══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_type where typname = 'membership_lifecycle_status' and typnamespace = 'public'::regnamespace),
  1, 'enum membership_lifecycle_status existe');
select is(
  (select array_agg(enumlabel::text order by enumsortorder) from pg_enum where enumtypid = 'public.membership_lifecycle_status'::regtype),
  array['active','suspended','offboarded'], 'valores do enum, nesta ordem exata');

select is(
  (select data_type from information_schema.columns where table_schema='public' and table_name='company_memberships' and column_name='lifecycle_status'),
  'USER-DEFINED', 'coluna lifecycle_status existe');
select is(
  (select udt_name from information_schema.columns where table_schema='public' and table_name='company_memberships' and column_name='lifecycle_status'),
  'membership_lifecycle_status', 'tipo correto');
select is(
  (select is_nullable from information_schema.columns where table_schema='public' and table_name='company_memberships' and column_name='lifecycle_status'),
  'NO', 'NOT NULL');
select is(
  (select column_default from information_schema.columns where table_schema='public' and table_name='company_memberships' and column_name='lifecycle_status'),
  '''active''::membership_lifecycle_status', 'default active');

select is(
  (select count(*)::int from pg_constraint where conname = 'company_memberships_lifecycle_is_active_ck' and conrelid = 'public.company_memberships'::regclass),
  1, 'constraint de compatibilidade lifecycle_status/is_active existe');
select throws_ok(
  $$update public.company_memberships set lifecycle_status = 'suspended' where id = '6b030000-0000-0000-0000-000000000001' and is_active$$,
  '23514', null, 'constraint rejeita lifecycle_status=suspended com is_active=true (violacao direta, como postgres)');
select throws_ok(
  $$update public.company_memberships set is_active = false where id = '6b030000-0000-0000-0000-000000000001' and lifecycle_status = 'active'$$,
  '23514', null, 'constraint rejeita is_active=false com lifecycle_status=active');

select is(
  (select count(*)::int from pg_indexes where schemaname='public' and tablename='company_memberships' and indexname='company_memberships_profile_single_active_uidx'),
  1, 'indice unico de membership ativa preservado (S1, intocado)');

-- ══════════════════════════════════════════════════════════════════════
-- 2. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'suspend_membership' and pronamespace = 'public'::regnamespace),
  1, 'suspend_membership existe exatamente uma vez (sem overload)');
select is(
  (select count(*)::int from pg_proc where proname = 'reactivate_membership' and pronamespace = 'public'::regnamespace),
  1, 'reactivate_membership existe exatamente uma vez (sem overload)');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.suspend_membership(uuid,text)'::regprocedure),
  true, 'suspend_membership: SECURITY DEFINER');
select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.suspend_membership(uuid,text)'::regprocedure),
  'postgres', 'suspend_membership: owner postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.suspend_membership(uuid,text)'::regprocedure),
  array['search_path=""'], 'suspend_membership: search_path fixo');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='suspend_membership' and grantee='PUBLIC'),
  0, 'suspend_membership: PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='suspend_membership' and grantee='anon'),
  0, 'suspend_membership: anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='suspend_membership' and grantee='authenticated' and privilege_type='EXECUTE'),
  1, 'suspend_membership: authenticated com EXECUTE');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.reactivate_membership(uuid,text)'::regprocedure),
  true, 'reactivate_membership: SECURITY DEFINER');
select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.reactivate_membership(uuid,text)'::regprocedure),
  'postgres', 'reactivate_membership: owner postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.reactivate_membership(uuid,text)'::regprocedure),
  array['search_path=""'], 'reactivate_membership: search_path fixo');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='reactivate_membership' and grantee='PUBLIC'),
  0, 'reactivate_membership: PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='reactivate_membership' and grantee='anon'),
  0, 'reactivate_membership: anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='reactivate_membership' and grantee='authenticated' and privilege_type='EXECUTE'),
  1, 'reactivate_membership: authenticated com EXECUTE');

select is(
  (select count(*)::int from pg_proc where proname in ('suspend_membership','reactivate_membership') and pronamespace='public'::regnamespace and prosecdef and pg_get_functiondef(oid) ilike '%grant%'),
  0, 'nenhuma escrita direta de grant reaberta dentro do corpo das funcoes (sanidade textual)');

-- retorno: tipos das 8 colunas — fixture dedicada (membership 022, com
-- sellers row real), nunca reutilizada em nenhuma outra secao, para nao
-- interferir no estado usado pelos testes de suspensao/reativacao abaixo.
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select is(
  (select pg_typeof(membership_id)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'uuid', 'retorno coluna 1 membership_id e uuid');
select is(
  (select pg_typeof(profile_id)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'uuid', 'retorno coluna 2 profile_id e uuid');
select is(
  (select pg_typeof(company_id)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'uuid', 'retorno coluna 3 company_id e uuid');
select is(
  (select pg_typeof(company_role)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'company_role', 'retorno coluna 4 company_role e public.company_role');
select is(
  (select pg_typeof(lifecycle_status)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'membership_lifecycle_status', 'retorno coluna 5 lifecycle_status e public.membership_lifecycle_status');
select is(
  (select pg_typeof(is_active)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'boolean', 'retorno coluna 6 is_active e boolean');
select is(
  (select pg_typeof(seller_id)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'text', 'retorno coluna 7 seller_id e text');
select is(
  (select pg_typeof(seller_active)::text from public.suspend_membership('6b030000-0000-0000-0000-000000000022', 'motivo de teste de catalogo') limit 1),
  'boolean', 'retorno coluna 8 seller_active e boolean');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. AUTORIZAÇÃO
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'motivo valido')$$,
  '42501', null, 'anon: bloqueado por ausencia de EXECUTE');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000021'); -- sem profile
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'motivo valido')$$,
  '42501', 'forbidden', 'usuario sem profile: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000003'); -- Seller A1
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'motivo valido')$$,
  '42501', 'forbidden', 'Seller: forbidden (nenhuma acao administrativa)');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000007'); -- Manager B tentando agir na empresa A
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'motivo valido')$$,
  '42501', 'forbidden', 'Manager fora da propria empresa: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000002'); -- Manager A tentando agir sobre Manager A2 (mesma empresa)
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000020', 'motivo valido')$$,
  '42501', 'forbidden', 'Manager sobre Manager (mesma empresa): forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000009'); -- Manager com profile inativo
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'motivo valido')$$,
  '42501', 'forbidden', 'ator inativo (profile.is_active=false): forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000002'); -- Manager A sobre a propria membership
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000001', 'motivo valido')$$,
  '42501', 'forbidden', 'Manager sobre a propria membership (autoacao): forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000010'); -- Super Admin Alvo sobre a propria membership
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000009', 'motivo valido')$$,
  '42501', 'forbidden', 'Super Admin sobre a propria membership (autoacao): forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001'); -- Super Admin (sem membership) sobre outro Super Admin
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000009', 'motivo valido')$$,
  '42501', 'forbidden', 'alvo Super Admin (mesmo com membership real): forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001'); -- Super Admin
select throws_ok(
  $$select * from public.suspend_membership('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'motivo valido')$$,
  'P0002', 'membership_not_found', 'membership inexistente');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000005', 'motivo valido')$$,
  'P0002', 'membership_not_found', 'alvo com profile inativo -> membership_not_found');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001'); -- Super Admin
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000013', 'motivo valido')$$,
  'P0001', 'company_not_operational', 'empresa suspensa: company_not_operational');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000014', 'motivo valido')$$,
  'P0001', 'company_not_operational', 'empresa cancelada: company_not_operational');
reset role;

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000002'); -- Manager A sobre Seller da propria empresa (membership 023, com sellers row real)
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000023', 'Manager suspende Seller da propria empresa')$$,
  'Manager sobre Seller da propria empresa: autorizado');
reset role;
-- desfaz para as secoes seguintes
update public.company_memberships set lifecycle_status = 'active', is_active = true where id = '6b030000-0000-0000-0000-000000000023';
update public.sellers set is_active = true where membership_id = '6b030000-0000-0000-0000-000000000023';
delete from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000023';

-- ══════════════════════════════════════════════════════════════════════
-- 4. MOTIVO (SUSPENSÃO — obrigatório)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', null)$$,
  '22023', 'invalid_note', 'motivo NULL e invalido (obrigatorio)');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', '')$$,
  '22023', 'invalid_note', 'motivo vazio e invalido');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', '   ')$$,
  '22023', 'invalid_note', 'motivo somente espacos e invalido');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'ab')$$,
  '22023', 'invalid_note', 'motivo com menos de 3 caracteres e invalido');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', repeat('x', 501))$$,
  '22023', 'invalid_note', 'motivo com mais de 500 caracteres e invalido');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'valido' || chr(1) || 'controle')$$,
  '22023', 'invalid_note', 'motivo com caractere de controle e invalido');
reset role;
select is(
  (select count(*)::int from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000003'),
  0, 'nenhuma auditoria criada por nenhuma tentativa de motivo invalido');
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000003'),
  'active'::public.membership_lifecycle_status, 'nenhuma escrita parcial por motivo invalido');

-- ══════════════════════════════════════════════════════════════════════
-- 5. SUSPENSÃO
-- ══════════════════════════════════════════════════════════════════════

-- Seller A1 (com sellers row real) — ciclo completo
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000002', 'Ausencia prolongada, suspensao temporaria')$$,
  'Seller A1 suspenso com sucesso');
reset role;

select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  'suspended'::public.membership_lifecycle_status, 'membership Seller A1: active -> suspended');
select is(
  (select is_active from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  false, 'is_active=false apos suspensao');
select is(
  (select company_id from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  '6b020000-0000-0000-0000-000000000001'::uuid, 'company_id preservado');
select is(
  (select profile_id from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  '6b010000-0000-0000-0000-000000000003'::uuid, 'profile_id preservado');
select is(
  (select role from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  'seller'::public.company_role, 'role preservado (seller)');
select is(
  (select is_active from public.sellers where id = 's6b-a1'),
  false, 'sellers.is_active sincronizado para false');
select is(
  (select membership_id from public.sellers where id = 's6b-a1'),
  '6b030000-0000-0000-0000-000000000002'::uuid, 'sellers.membership_id NAO removido durante suspensao');
select is(
  (select profile_id from public.sellers where id = 's6b-a1'),
  '6b010000-0000-0000-0000-000000000003'::uuid, 'sellers.profile_id preservado (historico)');
select is(
  (select is_active from public.profiles where id = '6b010000-0000-0000-0000-000000000003'),
  true, 'profiles.is_active NAO foi tocado pela suspensao');
select is(
  (select platform_role from public.profiles where id = '6b010000-0000-0000-0000-000000000003') is null,
  true, 'platform_role NAO foi tocado');

-- último Manager: empresa dedicada (LastMgr X + LastMgr Y)
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000015', 'Substituido por LastMgr Y')$$,
  'com segundo Manager ativo, suspensao de um deles e permitida');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000016', 'tentativa sobre o ultimo manager restante')$$,
  'P0001', 'last_manager_requires_successor', 'apos a suspensao anterior, ultimo manager restante nao pode ser suspenso');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000016'),
  'active'::public.membership_lifecycle_status, 'LastMgr Y permanece active (guarda bloqueou a escrita)');

-- Manager comum (empresa A tem 2 managers: Manager A + Manager A2) — sucesso
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000020', 'Manager A2 suspenso, Manager A permanece')$$,
  'Manager A2 suspenso (Manager A continua ativo na empresa)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000020'),
  'suspended'::public.membership_lifecycle_status, 'Manager A2: active -> suspended');

-- idempotência: Seller A3
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000004', 'primeira suspensao de Seller A3')$$,
  'Seller A3 suspenso (primeira chamada)');
reset role;
select updated_at as membership_updated_before from public.company_memberships where id = '6b030000-0000-0000-0000-000000000004' \gset
select count(*)::int as audit_before from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000004' \gset

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000004', 'segunda tentativa, ja suspenso')$$,
  'segunda chamada sobre membership ja suspensa: sucesso silencioso (idempotente)');
reset role;
select is(
  (select updated_at from public.company_memberships where id = '6b030000-0000-0000-0000-000000000004'),
  :'membership_updated_before'::timestamptz, 'chamada idempotente nao altera updated_at');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000004') - :audit_before,
  0, 'chamada idempotente nao cria nova auditoria');

-- offboarded rejeitado
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000017', 'tentativa sobre membership ja desligada')$$,
  'P0001', 'membership_lifecycle_conflict', 'offboarded nao pode ser suspenso (conflito de estado)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000017'),
  'offboarded'::public.membership_lifecycle_status, 'estado offboarded preservado (nenhuma escrita)');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000017'),
  0, 'nenhuma auditoria para a tentativa sobre offboarded');

-- ══════════════════════════════════════════════════════════════════════
-- 6. AUDITORIA (suspensão)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select action from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'membership_suspended', 'acao correta registrada');
select is(
  (select entity_type from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'membership', 'entity_type correto');
select is(
  (select company_id from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  '6b020000-0000-0000-0000-000000000001'::uuid, 'company_id correto na auditoria');
select is(
  (select actor_profile_id from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  '6b010000-0000-0000-0000-000000000001'::uuid, 'ator correto na auditoria (Super Admin real)');
select is(
  (select result from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'success', 'result=success');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select before_data from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1)
  ) as k),
  array['is_active','lifecycle_status','role','seller_active','seller_id']::text[],
  'before_data contem exatamente role/lifecycle_status/is_active/seller_id/seller_active');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select after_data from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1)
  ) as k),
  array['is_active','lifecycle_status','note','role','seller_active','seller_id']::text[],
  'after_data contem os mesmos 5 campos MAIS note (obrigatorio na suspensao)');
select is(
  (select (before_data ? 'name') or (before_data ? 'email') or (before_data ? 'platform_role') or (after_data ? 'name') or (after_data ? 'email') or (after_data ? 'platform_role')
     from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  false, 'nenhum dado sensivel (nome/email/platform_role) na auditoria');
select is(
  (select after_data->>'note' from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'Ausencia prolongada, suspensao temporaria', 'motivo gravado apenas no after_data da auditoria');

-- ══════════════════════════════════════════════════════════════════════
-- 7. REATIVAÇÃO
-- ══════════════════════════════════════════════════════════════════════

-- motivo opcional: NULL permitido
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000002')$$,
  'Seller A1 reativado sem motivo (opcional, default NULL)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  'active'::public.membership_lifecycle_status, 'membership Seller A1: suspended -> active');
select is(
  (select is_active from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  true, 'is_active=true apos reativacao');
select is(
  (select is_active from public.sellers where id = 's6b-a1'),
  true, 'sellers.is_active sincronizado de volta para true');
select is(
  (select id from public.sellers where membership_id = '6b030000-0000-0000-0000-000000000002'),
  's6b-a1', 'mesmo sellers.id (nenhum novo criado, nenhuma linha de outra empresa reutilizada)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select after_data from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' and action='membership_reactivated' order by ctid desc limit 1)
  ) as k),
  array['is_active','lifecycle_status','role','seller_active','seller_id']::text[],
  'reativacao sem motivo: after_data NAO contem a chave note');

-- motivo invalido quando informado
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000002', 'suspender de novo para testar motivo de reativacao')$$,
  'Seller A1 suspenso novamente para os testes de motivo da reativacao');
select throws_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000002', '')$$,
  '22023', 'invalid_note', 'motivo vazio (quando informado) e invalido na reativacao');
select throws_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000002', 'ab')$$,
  '22023', 'invalid_note', 'motivo curto (quando informado) e invalido na reativacao');
select throws_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000002', repeat('y', 501))$$,
  '22023', 'invalid_note', 'motivo longo (quando informado) e invalido na reativacao');

-- motivo valido, com sucesso
select lives_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000002', 'Retorno confirmado')$$,
  'Seller A1 reativado com motivo valido');
reset role;
select is(
  (select after_data->>'note' from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' and action='membership_reactivated' order by ctid desc limit 1),
  'Retorno confirmado', 'motivo da reativacao gravado no after_data quando informado');

-- offboarded rejeitado na reativação
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000017')$$,
  'P0001', 'membership_lifecycle_conflict', 'offboarded nao pode ser reativado por este contrato');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000017'),
  'offboarded'::public.membership_lifecycle_status, 'estado offboarded preservado (reativacao nao muda nada)');

-- empresa incompatível na reativação
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000013', 'tentativa')$$,
  'P0001', 'company_not_operational', 'reativacao em empresa suspensa: company_not_operational');
reset role;

-- idempotência da reativação
select updated_at as membership_updated_before from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002' \gset
select count(*)::int as audit_before from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' and action='membership_reactivated' \gset

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000002')$$,
  'chamar reativacao sobre membership ja active: sucesso silencioso');
reset role;
select is(
  (select updated_at from public.company_memberships where id = '6b030000-0000-0000-0000-000000000002'),
  :'membership_updated_before'::timestamptz, 'idempotencia da reativacao nao altera updated_at');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000002' and action='membership_reactivated') - :audit_before,
  0, 'idempotencia da reativacao nao cria nova auditoria');

-- Manager sobre Seller da propria empresa: reativacao tambem autorizada
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000002'); -- Manager A
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000004', 'Manager suspende Seller A3')$$,
  'Manager A suspende Seller A3 (propria empresa)');
select lives_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000004', 'Manager reativa Seller A3')$$,
  'Manager A reativa Seller A3 (propria empresa)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000004'),
  'active'::public.membership_lifecycle_status, 'Seller A3 de volta a active via Manager');

-- ══════════════════════════════════════════════════════════════════════
-- 8. INCONSISTÊNCIAS (seller_state_conflict)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000003', 'motivo valido para seller ausente')$$,
  'P0001', 'seller_state_conflict', 'membership seller sem nenhum sellers vinculado -> seller_state_conflict (suspensao)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6b030000-0000-0000-0000-000000000003'),
  'active'::public.membership_lifecycle_status, 'nenhuma alteracao parcial apos o conflito');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6b030000-0000-0000-0000-000000000003'),
  0, 'nenhuma auditoria criada para o conflito de seller ausente');

-- "seller ligado a outra empresa/profile" (vinculo inconsistente) nao tem
-- fixture realista possivel — sellers_check_membership_consistency (S1)
-- garante company_id/profile_id corretos em qualquer INSERT/UPDATE de
-- membership_id, e sellers_membership_id_uidx (S2) impede duplicidade de
-- membership_id. A checagem correspondente nas duas RPCs (comparação de
-- s.company_id/s.profile_id contra a membership) permanece como defesa em
-- profundidade, mesmo espirito documentado em 33_m1f_s5c_...sql.

-- ══════════════════════════════════════════════════════════════════════
-- 9. CONCORRÊNCIA / INVARIANTES
-- ══════════════════════════════════════════════════════════════════════

-- nenhum DELETE em nenhum ponto (contagens estaveis desde as fixtures)
select is(
  (select count(*)::int from public.company_memberships where id::text like '6b030000-%'),
  17, 'nenhuma linha de company_memberships desapareceu (17 fixtures)');
select is(
  (select count(*)::int from public.sellers where id like 's6b-%'),
  6, 'nenhuma linha de sellers desapareceu (6 fixtures)');

-- nenhuma alteracao em profiles.is_active/platform_role por qualquer
-- operacao de suspensao/reativacao acima
select is(
  (select count(*)::int from public.profiles where id::text like '6b010000-%' and platform_role = 'super_admin'),
  2, 'exatamente os 2 Super Admins originais continuam super_admin (nenhuma promocao/remocao lateral)');
select is(
  (select is_active from public.profiles where id = '6b010000-0000-0000-0000-000000000003'),
  true, 'profiles.is_active de Seller A1 continua true apos todo o ciclo suspender/reativar');

-- ══════════════════════════════════════════════════════════════════════
-- 10. INTEGRAÇÃO
-- ══════════════════════════════════════════════════════════════════════

-- suspende Seller A1 novamente para os testes de integracao
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6b030000-0000-0000-0000-000000000002', 'suspensao para teste de integracao')$$,
  'Seller A1 suspenso para os testes de integracao');
reset role;

-- can_access_company ja bloqueia (via current_membership_company_id, sob a
-- sessao do proprio suspenso) — nenhuma policy precisou ser ampliada
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000003'); -- Seller A1, agora suspenso
select is(
  public.current_membership_company_id(),
  null::uuid, 'Seller A1 suspenso: current_membership_company_id() retorna NULL (RLS/helpers ja bloqueiam, sem mudanca)');
reset role;

-- list_company_users continua retornando somente ativos — o suspenso some da lista
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => '6b020000-0000-0000-0000-000000000001') where profile_id = '6b010000-0000-0000-0000-000000000003'),
  0, 'Seller A1 suspenso desaparece de list_company_users (S5-A2 inalterada)');
reset role;

-- reativa de volta e confirma que reaparece
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.reactivate_membership('6b030000-0000-0000-0000-000000000002', 'reativacao final de integracao')$$,
  'Seller A1 reativado ao final dos testes de integracao');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => '6b020000-0000-0000-0000-000000000001') where profile_id = '6b010000-0000-0000-0000-000000000003'),
  1, 'Seller A1 reaparece em list_company_users apos reativacao');
reset role;

-- update_profile_name e update_membership_role continuam funcionando
set local role authenticated;
select pg_temp.as_user('6b010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_profile_name('6b010000-0000-0000-0000-000000000001', 'S6B Super Admin Renomeado')$$,
  'update_profile_name (S5-B) continua funcional apos esta migration');
select lives_ok(
  $$select * from public.update_membership_role('6b030000-0000-0000-0000-000000000023', '6b020000-0000-0000-0000-000000000001', 'seller')$$,
  'update_membership_role (S5-C) continua funcional apos esta migration (chamada idempotente, Seller A4 ja e seller com sellers row correta)');
reset role;

-- nenhum grant/policy novo em company_memberships/sellers para authenticated/anon
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='company_memberships' and grantee in ('anon','authenticated')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'nenhum grant de leitura/escrita direta em company_memberships para anon/authenticated (inalterado)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='sellers' and grantee in ('anon','authenticated')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'nenhum grant de leitura/escrita direta em sellers para anon/authenticated (inalterado)');
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='company_memberships'),
  1, 'company_memberships continua com exatamente 1 policy (company_memberships_select_own, S4-F1)');

select finish();
rollback;
