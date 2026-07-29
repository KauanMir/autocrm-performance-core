-- M1-F S6-E — RPC list_inactive_company_users
-- (20260728120000_m1f_s6e_inactive_listing.sql). Cobre catálogo, escopo por
-- ator (Super Admin global / Manager só Sellers da própria empresa), nunca
-- retorna lifecycle_status='active', exclusão de alvos (profile inativo,
-- empresa cancelada), inclusão de empresa suspensa (só 'cancelada' exclui
-- Super Admin), bloqueios, paginação por cursor (updated_at, id), busca com
-- escape de wildcards, filtro de lifecycle e ausência de escrita/expansão
-- de grants. Mesmo padrão de 31_m1f_s5a2_list_company_users.sql (fixtures
-- sintéticas @test.local, tudo dentro de uma transação com rollback).
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
  ('f6e20000-0000-0000-0000-000000000001', 'S6E Empresa A', 'ativa'),
  ('f6e20000-0000-0000-0000-000000000002', 'S6E Empresa B', 'ativa'),
  ('f6e20000-0000-0000-0000-000000000003', 'S6E Empresa Cancelada', 'cancelada'),
  ('f6e20000-0000-0000-0000-000000000004', 'S6E Empresa Suspensa', 'suspensa'),
  ('f6e20000-0000-0000-0000-000000000005', 'S6E Empresa Paginacao', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's6e-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's6e-seller-a1-suspenso@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's6e-manager-a2-desligado@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's6e-seller-a2-ativo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's6e-profile-inativo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's6e-seller-b1-suspenso@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's6e-zephyr-busca@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's6e-superadmin-solo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's6e-superadmin-membro@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 's6e-manager-cancelada@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 's6e-seller-suspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 's6e-manager-empresa-suspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 's6e-sem-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 's6e-sem-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000015', 'authenticated', 'authenticated', 's6e-seller-ativo-solo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000016', 'authenticated', 'authenticated', 's6e-seller-a3-desligado@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000017', 'authenticated', 'authenticated', 's6e-manager-inativo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000018', 'authenticated', 'authenticated', 's6e-escape-percent@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000019', 'authenticated', 'authenticated', 's6e-escape-underscore-decoy@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 's6e-pag-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 's6e-pag-p1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000022', 'authenticated', 'authenticated', 's6e-pag-p2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000023', 'authenticated', 'authenticated', 's6e-pag-p3@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000024', 'authenticated', 'authenticated', 's6e-pag-p4@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f6e10000-0000-0000-0000-000000000025', 'authenticated', 'authenticated', 's6e-pag-p5@test.local', now(), now(), now());

-- M1-F S8-E2: profiles.role foi removida fisicamente do catálogo (nunca
-- foi lida nem retornada por list_inactive_company_users).
insert into public.profiles (id, name, email, is_active, platform_role) values
  ('f6e10000-0000-0000-0000-000000000001', 'S6E Manager A', 's6e-manager-a@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000002', 'S6E Seller A1 Suspenso', 's6e-seller-a1-suspenso@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000003', 'S6E Manager A2 Desligado', 's6e-manager-a2-desligado@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000004', 'S6E Seller A2 Ativo', 's6e-seller-a2-ativo@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000005', 'S6E Profile Inativo', 's6e-profile-inativo@test.local', false, null),
  ('f6e10000-0000-0000-0000-000000000006', 'S6E Seller B1 Suspenso', 's6e-seller-b1-suspenso@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000007', 'Zephyr Busca S6E', 's6e-zephyr-busca@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000008', 'S6E Super Admin Solo', 's6e-superadmin-solo@test.local', true, 'super_admin'),
  ('f6e10000-0000-0000-0000-000000000009', 'S6E Super Admin Membro', 's6e-superadmin-membro@test.local', true, 'super_admin'),
  ('f6e10000-0000-0000-0000-000000000010', 'S6E Manager Empresa Cancelada', 's6e-manager-cancelada@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000011', 'S6E Seller Empresa Suspensa', 's6e-seller-suspensa@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000012', 'S6E Manager Empresa Suspensa', 's6e-manager-empresa-suspensa@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000014', 'S6E Sem Membership', 's6e-sem-membership@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000015', 'S6E Seller Ativo Solo', 's6e-seller-ativo-solo@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000016', 'S6E Seller A3 Desligado', 's6e-seller-a3-desligado@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000017', 'S6E Manager Inativo', 's6e-manager-inativo@test.local', false, null),
  ('f6e10000-0000-0000-0000-000000000018', 'Bus%ca_Especial S6E', 's6e-escape-percent@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000019', 'CaXEspecial S6E Decoy', 's6e-escape-underscore-decoy@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000020', 'S6E Pag Manager', 's6e-pag-manager@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000021', 'S6E Pag P1', 's6e-pag-p1@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000022', 'S6E Pag P2', 's6e-pag-p2@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000023', 'S6E Pag P3', 's6e-pag-p3@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000024', 'S6E Pag P4', 's6e-pag-p4@test.local', true, null),
  ('f6e10000-0000-0000-0000-000000000025', 'S6E Pag P5', 's6e-pag-p5@test.local', true, null);
-- f6e10000-...-000013 (auth user sem profile) deliberadamente sem linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at, updated_at) values
  ('f6e30000-0000-0000-0000-000000000001', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000001', 'manager', true,  'active',     now(), now()), -- Manager A (ator)
  ('f6e30000-0000-0000-0000-000000000002', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000002', 'seller',  false, 'suspended',  now(), now()), -- alvo valido
  ('f6e30000-0000-0000-0000-000000000003', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000003', 'manager', false, 'offboarded', now(), now()), -- manager inativo: nunca aparece p/ Manager
  ('f6e30000-0000-0000-0000-000000000004', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000004', 'seller',  true,  'active',     now(), now()), -- ativo: nunca aparece
  ('f6e30000-0000-0000-0000-000000000005', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000005', 'seller',  false, 'suspended',  now(), now()), -- profile inativo: nunca aparece
  ('f6e30000-0000-0000-0000-000000000006', 'f6e20000-0000-0000-0000-000000000002', 'f6e10000-0000-0000-0000-000000000006', 'seller',  false, 'suspended',  now(), now()), -- empresa B
  ('f6e30000-0000-0000-0000-000000000007', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000007', 'seller',  false, 'suspended',  now(), now()), -- zephyr
  ('f6e30000-0000-0000-0000-000000000009', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000009', 'seller',  false, 'suspended',  now(), now()), -- super admin com membership propria
  ('f6e30000-0000-0000-0000-000000000010', 'f6e20000-0000-0000-0000-000000000003', 'f6e10000-0000-0000-0000-000000000010', 'manager', false, 'offboarded', now(), now()), -- empresa cancelada: nunca aparece
  ('f6e30000-0000-0000-0000-000000000011', 'f6e20000-0000-0000-0000-000000000004', 'f6e10000-0000-0000-0000-000000000011', 'seller',  false, 'offboarded', now(), now()), -- empresa suspensa: aparece p/ Super Admin
  ('f6e30000-0000-0000-0000-000000000012', 'f6e20000-0000-0000-0000-000000000004', 'f6e10000-0000-0000-0000-000000000012', 'manager', true,  'active',     now(), now()), -- manager da empresa suspensa (ator, forbidden)
  ('f6e30000-0000-0000-0000-000000000015', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000015', 'seller',  true,  'active',     now(), now()), -- seller ativo (ator, forbidden)
  ('f6e30000-0000-0000-0000-000000000016', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000016', 'seller',  false, 'offboarded', now(), now()), -- desligado (lifecycle filter)
  ('f6e30000-0000-0000-0000-000000000017', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000017', 'manager', true,  'active',     now(), now()), -- manager profile inativo (ator, forbidden)
  ('f6e30000-0000-0000-0000-000000000018', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000018', 'seller',  false, 'suspended',  now(), now()), -- escape %
  ('f6e30000-0000-0000-0000-000000000019', 'f6e20000-0000-0000-0000-000000000001', 'f6e10000-0000-0000-0000-000000000019', 'seller',  false, 'suspended',  now(), now()); -- decoy _
-- f6e10000-...-000014 (Sem Membership) deliberadamente sem linha em company_memberships
-- f6e10000-...-000008 (Super Admin Solo) deliberadamente sem linha em company_memberships

-- paginação: Company Paginacao, Manager P (ativo, nao aparece) + 5 sellers
-- suspensos/desligados com updated_at controlado (P2/P3 empatados). Trigger
-- company_memberships_set_updated_at só dispara em UPDATE (nao em INSERT),
-- entao o valor inserido aqui e definitivo.
insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at, updated_at) values
  ('f6e30000-0000-0000-0000-000000000020', 'f6e20000-0000-0000-0000-000000000005', 'f6e10000-0000-0000-0000-000000000020', 'manager', true,  'active',     now(), now()),
  ('f6e30000-0000-0000-0000-000000000021', 'f6e20000-0000-0000-0000-000000000005', 'f6e10000-0000-0000-0000-000000000021', 'seller',  false, 'suspended',  now(), '2026-01-01 00:00:00+00'),
  ('f6e30000-0000-0000-0000-000000000022', 'f6e20000-0000-0000-0000-000000000005', 'f6e10000-0000-0000-0000-000000000022', 'seller',  false, 'suspended',  now(), '2026-01-02 00:00:00+00'),
  ('f6e30000-0000-0000-0000-000000000023', 'f6e20000-0000-0000-0000-000000000005', 'f6e10000-0000-0000-0000-000000000023', 'seller',  false, 'offboarded', now(), '2026-01-02 00:00:00+00'),
  ('f6e30000-0000-0000-0000-000000000024', 'f6e20000-0000-0000-0000-000000000005', 'f6e10000-0000-0000-0000-000000000024', 'seller',  false, 'suspended',  now(), '2026-01-03 00:00:00+00'),
  ('f6e30000-0000-0000-0000-000000000025', 'f6e20000-0000-0000-0000-000000000005', 'f6e10000-0000-0000-0000-000000000025', 'seller',  false, 'offboarded', now(), '2026-01-04 00:00:00+00');

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'list_inactive_company_users' and pronamespace = 'public'::regnamespace),
  1, 'list_inactive_company_users existe exatamente uma vez (sem overload)');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.list_inactive_company_users(integer,timestamptz,uuid,text,uuid,public.company_role,public.membership_lifecycle_status)'::regprocedure),
  true, 'list_inactive_company_users e SECURITY DEFINER');

select is(
  (select p.provolatile from pg_proc p where p.oid = 'public.list_inactive_company_users(integer,timestamptz,uuid,text,uuid,public.company_role,public.membership_lifecycle_status)'::regprocedure),
  's', 'list_inactive_company_users e STABLE');

select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.list_inactive_company_users(integer,timestamptz,uuid,text,uuid,public.company_role,public.membership_lifecycle_status)'::regprocedure),
  'postgres', 'owner e postgres (padrao administrativo)');

select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.list_inactive_company_users(integer,timestamptz,uuid,text,uuid,public.company_role,public.membership_lifecycle_status)'::regprocedure),
  array['search_path=""'], 'search_path fixo e vazio');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_inactive_company_users' and grantee = 'PUBLIC'),
  0, 'PUBLIC sem EXECUTE em list_inactive_company_users');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_inactive_company_users' and grantee = 'anon'),
  0, 'anon sem EXECUTE em list_inactive_company_users');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_inactive_company_users' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'authenticated com EXECUTE em list_inactive_company_users');

-- retorno: exatamente 11 colunas, tipos e ordem exatos
set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000001');
select is(
  (select pg_typeof(profile_id)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'uuid', 'coluna 1 profile_id e uuid');
select is(
  (select pg_typeof(membership_id)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'uuid', 'coluna 2 membership_id e uuid');
select is(
  (select pg_typeof(name)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'text', 'coluna 3 name e text');
select is(
  (select pg_typeof(email)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'text', 'coluna 4 email e text');
select is(
  (select pg_typeof(company_id)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'uuid', 'coluna 5 company_id e uuid');
select is(
  (select pg_typeof(company_name)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'text', 'coluna 6 company_name e text');
select is(
  (select pg_typeof(company_role)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'company_role', 'coluna 7 company_role e public.company_role');
select is(
  (select pg_typeof(lifecycle_status)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'membership_lifecycle_status', 'coluna 8 lifecycle_status e public.membership_lifecycle_status');
select is(
  (select pg_typeof(is_active)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'boolean', 'coluna 9 is_active e boolean');
select is(
  (select pg_typeof(created_at)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'timestamp with time zone', 'coluna 10 created_at e timestamptz');
select is(
  (select pg_typeof(updated_at)::text from public.list_inactive_company_users(p_company_id => 'f6e20000-0000-0000-0000-000000000001') limit 1),
  'timestamp with time zone', 'coluna 11 updated_at e timestamptz');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. SUPER ADMIN
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000008'); -- Solo, sem membership

select lives_ok(
  $$select count(*) from public.list_inactive_company_users(p_limit => 100)$$,
  'Super Admin sem membership propria continua autorizado (chamada global nao lanca excecao)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_company_id => 'f6e20000-0000-0000-0000-000000000001')),
  7, 'Super Admin: filtro por empresa A retorna os 7 alvos inativos validos (02,03,07,09,16,18,19 — exclui 04 ativo e 05 profile inativo)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_company_id => 'f6e20000-0000-0000-0000-000000000001', p_role => 'manager')),
  1, 'Super Admin: filtro empresa A + papel manager retorna 1 (Manager A2 Desligado)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000006'),
  1, 'Super Admin: Seller B1 Suspenso (empresa B) aparece na listagem global');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000011'),
  1, 'Super Admin: empresa com status suspensa NAO exclui o alvo (so cancelada exclui)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000010'),
  0, 'Super Admin: empresa cancelada exclui o alvo mesmo global');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_company_id => 'f6e20000-0000-0000-0000-000000000003')),
  0, 'Super Admin: filtro explicito por empresa cancelada retorna vazio (nao revela existencia)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000009'),
  1, 'Super Admin COM membership propria suspensa aparece exatamente 1 vez, pela propria membership real');

select is(
  (select company_role::text from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000009'),
  'seller', 'a linha do Super Admin com membership reflete o company_role real da membership (seller), nao platform_role');
select is(
  (select lifecycle_status::text from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000009'),
  'suspended', 'a linha do Super Admin com membership reflete o lifecycle_status real (suspended)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. MANAGER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000001'); -- Manager A

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100)),
  6, 'Manager A (sem filtro): retorna 6 Sellers inativos da propria empresa (02,07,09,16,18,19 — nunca 03, que e manager)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where company_role = 'manager'),
  0, 'Manager A: nenhum Manager inativo aparece, mesmo sem filtro de papel');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000003'),
  0, 'Manager A: Manager A2 Desligado (mesma empresa) nunca aparece');

-- p_company_id de outra empresa enviado pelo cliente e ignorado
select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_company_id => 'f6e20000-0000-0000-0000-000000000002')),
  6, 'Manager A: p_company_id de OUTRA empresa enviado pelo cliente e ignorado, continua vendo a propria empresa');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000006'),
  0, 'Manager A: Seller B1 (empresa B) nunca aparece, mesmo tentando forcar via p_company_id');

-- p_role=manager enviado por um Manager e silenciosamente ignorado (nunca amplia p/ ver Managers)
select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_role => 'manager')),
  6, 'Manager A: p_role=manager enviado pelo cliente e ignorado, continua vendo so Sellers');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_lifecycle => 'suspended')),
  5, 'Manager A: filtro lifecycle=suspended retorna 5 (02,07,09,18,19)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_lifecycle => 'offboarded')),
  1, 'Manager A: filtro lifecycle=offboarded retorna 1 (16)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. BLOQUEIOS
-- ══════════════════════════════════════════════════════════════════════

-- Seller (mesmo ativo): forbidden
set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000015');
select throws_ok(
  $$select count(*) from public.list_inactive_company_users()$$,
  '42501', 'forbidden', 'Seller: forbidden (nao e Super Admin nem Manager)');
reset role;

-- profile inativo (mesmo com membership de manager): forbidden
set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000017');
select throws_ok(
  $$select count(*) from public.list_inactive_company_users()$$,
  '42501', 'forbidden', 'Profile inativo: forbidden mesmo com membership de manager');
reset role;

-- Manager de empresa nao operacional (status suspensa): forbidden — mesmo
-- gate de can_access_company usado por list_company_users (membership ativa
-- nao contorna o status da empresa)
set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000012');
select throws_ok(
  $$select count(*) from public.list_inactive_company_users()$$,
  '42501', 'forbidden', 'Manager de empresa suspensa: forbidden (can_access_company nega, empresa nao operacional)');
reset role;

-- usuario sem profile: forbidden
set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000013');
select throws_ok(
  $$select count(*) from public.list_inactive_company_users()$$,
  '42501', 'forbidden', 'Usuario sem profile: forbidden');
reset role;

-- usuario sem membership e sem platform_role: forbidden
set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000014');
select throws_ok(
  $$select count(*) from public.list_inactive_company_users()$$,
  '42501', 'forbidden', 'Usuario sem membership e sem platform_role: forbidden');
reset role;

-- anon: bloqueado por ausencia de GRANT
set local role anon;
select throws_ok(
  $$select count(*) from public.list_inactive_company_users()$$,
  '42501', null, 'anon: permission denied (sem EXECUTE)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. LIFECYCLE — nunca retorna ativos; 'active' explicito e invalido
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000008'); -- Super Admin

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where lifecycle_status = 'active'),
  0, 'nenhuma linha retornada tem lifecycle_status=active, mesmo sem filtro explicito');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100) where profile_id = 'f6e10000-0000-0000-0000-000000000004'),
  0, 'Seller A2 Ativo (membership ativa) nunca aparece, mesmo global');

select throws_ok(
  $$select count(*) from public.list_inactive_company_users(p_lifecycle => 'active')$$,
  '22023', 'invalid_lifecycle', 'p_lifecycle=active explicito e rejeitado');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. PAGINAÇÃO (Company Paginacao, 5 alvos inativos, P2/P3 empatados em updated_at)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000020'); -- Manager P

-- limites invalidos
select throws_ok(
  $$select count(*) from public.list_inactive_company_users(p_limit => 0)$$,
  '22023', 'invalid_limit', 'limit 0 e invalido');
select throws_ok(
  $$select count(*) from public.list_inactive_company_users(p_limit => 101)$$,
  '22023', 'invalid_limit', 'limit 101 e invalido');
select lives_ok(
  $$select count(*) from public.list_inactive_company_users(p_limit => 1)$$,
  'limit 1 (minimo) e valido');
select lives_ok(
  $$select count(*) from public.list_inactive_company_users(p_limit => 100)$$,
  'limit 100 (maximo) e valido');

-- cursor incompleto
select throws_ok(
  $$select count(*) from public.list_inactive_company_users(p_cursor_updated_at => now())$$,
  '22023', 'invalid_cursor', 'cursor incompleto (so updated_at) e invalido');
select throws_ok(
  $$select count(*) from public.list_inactive_company_users(p_cursor_membership_id => 'f6e30000-0000-0000-0000-000000000021')$$,
  '22023', 'invalid_cursor', 'cursor incompleto (so membership_id) e invalido');

-- nunca retorna mais que p_limit
select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 2)),
  2, 'nunca retorna mais que p_limit (2)');

create temporary table pag_ids (membership_id uuid, updated_at timestamptz, rownum int);

insert into pag_ids
select membership_id, updated_at, 1 from public.list_inactive_company_users(p_limit => 2);

select is((select count(*)::int from pag_ids), 2, 'pagina 1: 2 linhas');
select is(
  (select array_agg(membership_id order by updated_at desc, membership_id desc) from pag_ids),
  array['f6e30000-0000-0000-0000-000000000025'::uuid, 'f6e30000-0000-0000-0000-000000000024'::uuid],
  'pagina 1: P5 e P4 (mais recentemente atualizados primeiro)');

insert into pag_ids
select l.membership_id, l.updated_at, 2
from public.list_inactive_company_users(
  p_limit => 2,
  p_cursor_updated_at => (select updated_at from pag_ids where rownum = 1 order by updated_at asc limit 1),
  p_cursor_membership_id => (select membership_id from pag_ids where rownum = 1 order by updated_at asc, membership_id asc limit 1)
) l;

select is((select count(*)::int from pag_ids where rownum = 2), 2, 'pagina 2: 2 linhas');
select is(
  (select array_agg(membership_id order by membership_id) from pag_ids where rownum = 2),
  array['f6e30000-0000-0000-0000-000000000022'::uuid, 'f6e30000-0000-0000-0000-000000000023'::uuid],
  'pagina 2: P3 e P2 (updated_at empatado entre P2/P3, desempate por membership_id desc traz P3 antes de P2)');

insert into pag_ids
select l.membership_id, l.updated_at, 3
from public.list_inactive_company_users(
  p_limit => 2,
  p_cursor_updated_at => (select updated_at from pag_ids where rownum = 2 order by updated_at asc, membership_id asc limit 1),
  p_cursor_membership_id => (select membership_id from pag_ids where rownum = 2 order by updated_at asc, membership_id asc limit 1)
) l;

select is((select count(*)::int from pag_ids where rownum = 3), 1, 'pagina 3: 1 linha final (P1)');
select is(
  (select membership_id from pag_ids where rownum = 3),
  'f6e30000-0000-0000-0000-000000000021'::uuid, 'pagina 3: P1 (updated_at mais antigo)');

-- pagina apos o final: vazia, nunca erro
select is(
  (select count(*)::int from public.list_inactive_company_users(
    p_limit => 2,
    p_cursor_updated_at => (select updated_at from pag_ids where rownum = 3 limit 1),
    p_cursor_membership_id => (select membership_id from pag_ids where rownum = 3 limit 1)
  )),
  0, 'pagina apos a ultima retorna vazia, sem erro');

reset role;

select is(
  (select count(distinct membership_id)::int from pag_ids),
  5, 'as 3 paginas juntas cobrem os 5 alvos sem duplicata');
select is(
  (select array_agg(membership_id order by membership_id) from pag_ids),
  (select array_agg(id order by id) from public.company_memberships
    where company_id = 'f6e20000-0000-0000-0000-000000000005' and not is_active),
  'o conjunto paginado bate exatamente com os alvos inativos reais da empresa (sem perda)');

drop table pag_ids;

-- ══════════════════════════════════════════════════════════════════════
-- 7. BUSCA
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f6e10000-0000-0000-0000-000000000001'); -- Manager A

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => '')),
  6, 'busca vazia equivale a NULL (retorna todos os 6 Sellers inativos da empresa)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => '   ')),
  6, 'busca so com espacos (apos trim) equivale a NULL');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => 'Zephyr')),
  1, 'busca contains por nome (prefixo)');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => 'ZEPHYR')),
  1, 'busca case-insensitive');

select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => 'busca@test')),
  1, 'busca contains por e-mail (meio da string)');

-- escape de % — sem escape, "s%c" combinado com ILIKE '%s%c%' faria match generico
select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => 's%c')),
  1, 'busca por "s%c" (com % literal escapado) so bate no nome "Bus%ca_Especial S6E"');
select is(
  (select name from public.list_inactive_company_users(p_limit => 100, p_search => 's%c')),
  'Bus%ca_Especial S6E', 'a linha encontrada e exatamente a do % literal');

-- escape de _ — sem escape, "_" e wildcard de 1 char e bateria tambem no decoy
select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => 'ca_es')),
  1, 'busca por "ca_es" (com _ literal escapado) NAO bate no decoy "CaXEspecial S6E Decoy"');
select is(
  (select name from public.list_inactive_company_users(p_limit => 100, p_search => 'ca_es')),
  'Bus%ca_Especial S6E', 'a linha encontrada e exatamente a do _ literal, nunca o decoy');

-- backslash reaproveita a mesma expressao de escape ja validada em
-- 31_m1f_s5a2_list_company_users.sql (copiada verbatim) — nao duplicado
-- aqui para nao inflar fixtures sem ganho real de cobertura.

-- busca acima de 100 caracteres
select throws_ok(
  format($$select count(*) from public.list_inactive_company_users(p_search => %L)$$, repeat('x', 101)),
  '22023', 'invalid_search', 'busca acima de 100 caracteres e invalida');

-- busca nunca traz linha de fora do escopo do Manager
select is(
  (select count(*)::int from public.list_inactive_company_users(p_limit => 100, p_search => 's6e') where company_id <> 'f6e20000-0000-0000-0000-000000000001'),
  0, 'busca ampla nunca traz linha de fora do escopo do Manager');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. COLUNAS E SEGURANÇA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select array_agg(a.name::text order by a.ord)
     from unnest(
       (select proargnames from pg_proc where oid = 'public.list_inactive_company_users(integer,timestamptz,uuid,text,uuid,public.company_role,public.membership_lifecycle_status)'::regprocedure),
       (select proargmodes from pg_proc where oid = 'public.list_inactive_company_users(integer,timestamptz,uuid,text,uuid,public.company_role,public.membership_lifecycle_status)'::regprocedure)
     ) with ordinality as a(name, mode, ord)
    where a.mode = 't'),
  array['profile_id','membership_id','name','email','company_id','company_name','company_role','lifecycle_status','is_active','created_at','updated_at'],
  'saida da funcao tem exatamente estas 11 colunas, nesta ordem');

-- funcao nao escreve: contagem de company_memberships da empresa A inalterada
select is(
  (select count(*)::int from public.company_memberships where company_id = 'f6e20000-0000-0000-0000-000000000001'),
  12, 'nenhuma escrita ocorreu em company_memberships (contagem da empresa A inalterada)');

-- list_company_users permanece 100% intacto (contrato/assinatura nao tocados)
select is(
  (select count(*)::int from pg_proc where proname = 'list_company_users' and pronamespace = 'public'::regnamespace),
  1, 'list_company_users continua existindo exatamente uma vez, sem overload novo');
select is(
  (select array_agg(a.name::text order by a.ord)
     from unnest(
       (select proargnames from pg_proc where oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure),
       (select proargmodes from pg_proc where oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure)
     ) with ordinality as a(name, mode, ord)
    where a.mode = 't'),
  array['profile_id','membership_id','name','email','company_id','company_name','company_role','created_at'],
  'list_company_users continua com exatamente as mesmas 8 colunas de saida, nesta ordem — contrato S5-A2 intacto');

-- grants de profiles/company_memberships nao foram ampliados por esta etapa
-- (M1-F S8-E2 removeu company_id/role/seller_id do catálogo — o grant de
-- coluna cai junto com a coluna dropada, restando 5).
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array[
    'id', 'name', 'email', 'is_active', 'platform_role'
  ]) as c),
  'grants de SELECT em profiles permanecem exatamente as 5 colunas restantes (nao ampliados)');
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array['company_id', 'role', 'is_active']) as c),
  'grants de SELECT em company_memberships permanecem exatamente as mesmas 3 colunas (nao ampliados — SECURITY DEFINER nao precisa de grant de coluna, roda como postgres)');

select finish();
rollback;
