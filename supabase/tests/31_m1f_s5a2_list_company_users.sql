-- M1-F S5-A2 — RPC list_company_users
-- (20260723160000_m1f_s5a2_list_company_users.sql). Cobre catálogo,
-- escopo por ator (Super Admin global / Manager por empresa), bloqueios,
-- exclusão de alvos inativos/empresa cancelada, paginação por cursor
-- composto, busca com escape de wildcards e ausência de colunas sensíveis.
-- Fixtures sintéticas @test.local, tudo dentro de uma transação com
-- rollback ao final.
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
  ('f5a20000-0000-0000-0000-000000000001', 'S5A2 Empresa A', 'ativa'),
  ('f5a20000-0000-0000-0000-000000000002', 'S5A2 Empresa B', 'ativa'),
  ('f5a20000-0000-0000-0000-000000000003', 'S5A2 Empresa Cancelada', 'cancelada'),
  ('f5a20000-0000-0000-0000-000000000004', 'S5A2 Empresa Paginacao', 'ativa'),
  ('f5a20000-0000-0000-0000-000000000005', 'S5A2 Empresa D (Super Admin membro)', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's5a2-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's5a2-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's5a2-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's5a2-inactive-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'zephyr-busca@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'escape-test@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's5a2-manager-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'decoy-underscore@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'backslash-test@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 's5a2-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 's5a2-seller-b1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 's5a2-cancelada-membro@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000030', 'authenticated', 'authenticated', 's5a2-sem-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000031', 'authenticated', 'authenticated', 's5a2-sem-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000040', 'authenticated', 'authenticated', 's5a2-superadmin-solo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000041', 'authenticated', 'authenticated', 's5a2-superadmin-membro@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000050', 'authenticated', 'authenticated', 's5a2-pag-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000051', 'authenticated', 'authenticated', 's5a2-pag-p1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000052', 'authenticated', 'authenticated', 's5a2-pag-p2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000053', 'authenticated', 'authenticated', 's5a2-pag-p3@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000054', 'authenticated', 'authenticated', 's5a2-pag-p4@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5a10000-0000-0000-0000-000000000055', 'authenticated', 'authenticated', 's5a2-pag-p5@test.local', now(), now(), now());

-- profiles.role (legado) preenchido só para satisfazer a coluna NOT NULL —
-- nunca lido nem retornado por list_company_users.
insert into public.profiles (id, name, email, role, is_active, platform_role) values
  ('f5a10000-0000-0000-0000-000000000001', 'S5A2 Manager A', 's5a2-manager-a@test.local', 'manager', true, null),
  ('f5a10000-0000-0000-0000-000000000002', 'S5A2 Seller A1', 's5a2-seller-a1@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000003', 'S5A2 Profile Inativo', 's5a2-inactive-profile@test.local', 'manager', false, null),
  ('f5a10000-0000-0000-0000-000000000004', 'S5A2 Membership Inativa', 's5a2-inactive-membership@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000005', 'Zephyr Busca', 'zephyr-busca@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000006', 'Bus%ca_Especial', 'escape-test@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000007', 'S5A2 Manager A2', 's5a2-manager-a2@test.local', 'manager', true, null),
  ('f5a10000-0000-0000-0000-000000000008', 'CaXEspecial Decoy', 'decoy-underscore@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000009', 'Back\Slash', 'backslash-test@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000010', 'S5A2 Manager B', 's5a2-manager-b@test.local', 'manager', true, null),
  ('f5a10000-0000-0000-0000-000000000011', 'S5A2 Seller B1', 's5a2-seller-b1@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000020', 'S5A2 Membro Empresa Cancelada', 's5a2-cancelada-membro@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000031', 'S5A2 Sem Membership', 's5a2-sem-membership@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000040', 'S5A2 Super Admin Solo', 's5a2-superadmin-solo@test.local', 'seller', true, 'super_admin'),
  ('f5a10000-0000-0000-0000-000000000041', 'S5A2 Super Admin Membro', 's5a2-superadmin-membro@test.local', 'seller', true, 'super_admin'),
  ('f5a10000-0000-0000-0000-000000000050', 'S5A2 Pag Manager', 's5a2-pag-manager@test.local', 'manager', true, null),
  ('f5a10000-0000-0000-0000-000000000051', 'S5A2 Pag P1', 's5a2-pag-p1@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000052', 'S5A2 Pag P2', 's5a2-pag-p2@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000053', 'S5A2 Pag P3', 's5a2-pag-p3@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000054', 'S5A2 Pag P4', 's5a2-pag-p4@test.local', 'seller', true, null),
  ('f5a10000-0000-0000-0000-000000000055', 'S5A2 Pag P5', 's5a2-pag-p5@test.local', 'seller', true, null);
-- f5a10000-...-000030 (auth user sem profile) deliberadamente sem linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active, created_at) values
  ('f5a30000-0000-0000-0000-000000000001', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000001', 'manager', true, now()),
  ('f5a30000-0000-0000-0000-000000000002', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000002', 'seller',  true, now()),
  ('f5a30000-0000-0000-0000-000000000003', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000003', 'manager', true, now()),  -- profile inativo: nao deve aparecer
  ('f5a30000-0000-0000-0000-000000000004', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000004', 'seller',  false, now()), -- membership inativa: nao deve aparecer
  ('f5a30000-0000-0000-0000-000000000005', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000005', 'seller',  true, now()),
  ('f5a30000-0000-0000-0000-000000000006', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000006', 'seller',  true, now()),
  ('f5a30000-0000-0000-0000-000000000007', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000007', 'manager', true, now()),
  ('f5a30000-0000-0000-0000-000000000008', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000008', 'seller',  true, now()),
  ('f5a30000-0000-0000-0000-000000000009', 'f5a20000-0000-0000-0000-000000000001', 'f5a10000-0000-0000-0000-000000000009', 'seller',  true, now()),
  ('f5a30000-0000-0000-0000-000000000010', 'f5a20000-0000-0000-0000-000000000002', 'f5a10000-0000-0000-0000-000000000010', 'manager', true, now()),
  ('f5a30000-0000-0000-0000-000000000011', 'f5a20000-0000-0000-0000-000000000002', 'f5a10000-0000-0000-0000-000000000011', 'seller',  true, now()),
  ('f5a30000-0000-0000-0000-000000000020', 'f5a20000-0000-0000-0000-000000000003', 'f5a10000-0000-0000-0000-000000000020', 'seller',  true, now()), -- empresa cancelada: nao deve aparecer
  ('f5a30000-0000-0000-0000-000000000041', 'f5a20000-0000-0000-0000-000000000005', 'f5a10000-0000-0000-0000-000000000041', 'seller',  true, now()); -- Super Admin com membership real

-- paginação: Company P, 6 membros com created_at controlado (P1/P2 empatados)
insert into public.company_memberships (id, company_id, profile_id, role, is_active, created_at) values
  ('f5a30000-0000-0000-0000-000000000050', 'f5a20000-0000-0000-0000-000000000004', 'f5a10000-0000-0000-0000-000000000050', 'manager', true, '2026-01-01 00:00:00+00'),
  ('f5a30000-0000-0000-0000-000000000051', 'f5a20000-0000-0000-0000-000000000004', 'f5a10000-0000-0000-0000-000000000051', 'seller',  true, '2026-01-02 00:00:00+00'),
  ('f5a30000-0000-0000-0000-000000000052', 'f5a20000-0000-0000-0000-000000000004', 'f5a10000-0000-0000-0000-000000000052', 'seller',  true, '2026-01-02 00:00:00+00'),
  ('f5a30000-0000-0000-0000-000000000053', 'f5a20000-0000-0000-0000-000000000004', 'f5a10000-0000-0000-0000-000000000053', 'seller',  true, '2026-01-03 00:00:00+00'),
  ('f5a30000-0000-0000-0000-000000000054', 'f5a20000-0000-0000-0000-000000000004', 'f5a10000-0000-0000-0000-000000000054', 'seller',  true, '2026-01-04 00:00:00+00'),
  ('f5a30000-0000-0000-0000-000000000055', 'f5a20000-0000-0000-0000-000000000004', 'f5a10000-0000-0000-0000-000000000055', 'seller',  true, '2026-01-05 00:00:00+00');
-- f5a10000-...-000031 (S5A2 Sem Membership) deliberadamente sem linha em company_memberships
-- f5a10000-...-000040 (Super Admin Solo) deliberadamente sem linha em company_memberships

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'list_company_users' and pronamespace = 'public'::regnamespace),
  1, 'list_company_users existe exatamente uma vez (sem overload)');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure),
  true, 'list_company_users e SECURITY DEFINER');

select is(
  (select p.provolatile from pg_proc p where p.oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure),
  's', 'list_company_users e STABLE');

select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure),
  'postgres', 'owner e postgres (padrao administrativo)');

select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure),
  array['search_path=""'], 'search_path fixo e vazio');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_company_users' and grantee = 'PUBLIC'),
  0, 'PUBLIC sem EXECUTE em list_company_users');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_company_users' and grantee = 'anon'),
  0, 'anon sem EXECUTE em list_company_users');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_company_users' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'authenticated com EXECUTE em list_company_users');

-- retorno: exatamente 8 colunas, tipos e ordem exatos (verificado numa linha real)
set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000001');
select is(
  (select pg_typeof(profile_id)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'uuid', 'coluna 1 profile_id e uuid');
select is(
  (select pg_typeof(membership_id)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'uuid', 'coluna 2 membership_id e uuid');
select is(
  (select pg_typeof(name)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'text', 'coluna 3 name e text');
select is(
  (select pg_typeof(email)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'text', 'coluna 4 email e text');
select is(
  (select pg_typeof(company_id)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'uuid', 'coluna 5 company_id e uuid');
select is(
  (select pg_typeof(company_name)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'text', 'coluna 6 company_name e text');
select is(
  (select pg_typeof(company_role)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'company_role', 'coluna 7 company_role e public.company_role');
select is(
  (select pg_typeof(created_at)::text from public.list_company_users(p_company_id => 'f5a20000-0000-0000-0000-000000000001') limit 1),
  'timestamp with time zone', 'coluna 8 created_at e timestamptz');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. SUPER ADMIN
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000040');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => 'f5a20000-0000-0000-0000-000000000001')),
  7, 'Super Admin: filtro por empresa A retorna os 7 membros validos (exclui inativos)');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => 'f5a20000-0000-0000-0000-000000000001', p_role => 'manager')),
  2, 'Super Admin: filtro empresa A + papel manager retorna 2 (Manager A, Manager A2)');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'zephyr')),
  1, 'Super Admin: busca por nome "zephyr" retorna 1');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'zephyr-busca@test.local')),
  1, 'Super Admin: busca por e-mail exato retorna 1');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  0, 'Super Admin: empresa inexistente retorna lista vazia (nunca erro)');

select lives_ok(
  $$select count(*) from public.list_company_users(p_limit => 100)$$,
  'Super Admin sem membership propria continua autorizado (chamada global nao lanca excecao)');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100) where profile_id = 'f5a10000-0000-0000-0000-000000000040'),
  0, 'Super Admin sem membership (Solo) nao aparece como linha empresarial só por possuir platform_role');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100) where profile_id = 'f5a10000-0000-0000-0000-000000000041'),
  1, 'Super Admin COM membership (Membro) aparece exatamente 1 vez, pela propria membership real');

select is(
  (select company_role::text from public.list_company_users(p_limit => 100) where profile_id = 'f5a10000-0000-0000-0000-000000000041'),
  'seller', 'a linha do Super Admin com membership reflete o company_role real da membership (seller), nao platform_role');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. MANAGER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100)),
  7, 'Manager A (sem filtro): retorna exatamente os 7 membros validos da propria empresa');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100) where company_id <> 'f5a20000-0000-0000-0000-000000000001'),
  0, 'Manager A: nenhuma linha de outra empresa aparece');

-- p_company_id divergente enviado pelo cliente e ignorado (nao amplia nem restringe)
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => 'f5a20000-0000-0000-0000-000000000002')),
  7, 'Manager A: p_company_id de OUTRA empresa enviado pelo cliente e ignorado, continua vendo a propria empresa');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100) where profile_id = 'f5a10000-0000-0000-0000-000000000011'),
  0, 'Manager A: Seller B1 (empresa B) nunca aparece, mesmo tentando forcar via p_company_id');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_role => 'manager')),
  2, 'Manager A: filtro de papel manager, limitado a propria empresa, retorna 2');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_role => 'seller')),
  5, 'Manager A: filtro de papel seller, limitado a propria empresa, retorna 5');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'zephyr')),
  1, 'Manager A: busca por nome limitada a propria empresa funciona');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. BLOQUEIOS
-- ══════════════════════════════════════════════════════════════════════

-- Seller: forbidden
set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000002');
select throws_ok(
  $$select count(*) from public.list_company_users()$$,
  '42501', 'forbidden', 'Seller: forbidden (nao e Super Admin nem Manager)');
reset role;

-- profile inativo (mesmo com membership de manager): forbidden
set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000003');
select throws_ok(
  $$select count(*) from public.list_company_users()$$,
  '42501', 'forbidden', 'Profile inativo: forbidden mesmo com membership de manager');
reset role;

-- usuario sem profile: forbidden
set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000030');
select throws_ok(
  $$select count(*) from public.list_company_users()$$,
  '42501', 'forbidden', 'Usuario sem profile: forbidden');
reset role;

-- usuario sem membership e sem platform_role: forbidden
set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000031');
select throws_ok(
  $$select count(*) from public.list_company_users()$$,
  '42501', 'forbidden', 'Usuario sem membership e sem platform_role: forbidden');
reset role;

-- anon: bloqueado por ausencia de GRANT (nem chega a avaliar o corpo da funcao)
set local role anon;
select throws_ok(
  $$select count(*) from public.list_company_users()$$,
  '42501', null, 'anon: permission denied (sem EXECUTE)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. ALVOS EXCLUIDOS
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100) where profile_id = 'f5a10000-0000-0000-0000-000000000003'),
  0, 'target: profile inativo nao retorna na listagem');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100) where profile_id = 'f5a10000-0000-0000-0000-000000000004'),
  0, 'target: membership inativa nao retorna na listagem');
reset role;

set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000040'); -- super admin
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100) where profile_id = 'f5a10000-0000-0000-0000-000000000020'),
  0, 'target: membro de empresa cancelada nao retorna, nem para Super Admin');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => 'f5a20000-0000-0000-0000-000000000003')),
  0, 'filtro explicito por empresa cancelada tambem retorna vazio (nao revela existencia)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. PAGINAÇÃO (Company P, 6 membros, P1/P2 com created_at empatado)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000050'); -- Manager P

-- limites invalidos
select throws_ok(
  $$select count(*) from public.list_company_users(p_limit => 0)$$,
  '22023', 'invalid_limit', 'limit 0 e invalido');
select throws_ok(
  $$select count(*) from public.list_company_users(p_limit => 101)$$,
  '22023', 'invalid_limit', 'limit 101 e invalido');
select lives_ok(
  $$select count(*) from public.list_company_users(p_limit => 1)$$,
  'limit 1 (minimo) e valido');
select lives_ok(
  $$select count(*) from public.list_company_users(p_limit => 100)$$,
  'limit 100 (maximo) e valido');

-- cursor incompleto
select throws_ok(
  $$select count(*) from public.list_company_users(p_cursor_created_at => now())$$,
  '22023', 'invalid_cursor', 'cursor incompleto (so created_at) e invalido');
select throws_ok(
  $$select count(*) from public.list_company_users(p_cursor_membership_id => 'f5a30000-0000-0000-0000-000000000050')$$,
  '22023', 'invalid_cursor', 'cursor incompleto (so membership_id) e invalido');

-- nunca retorna mais que p_limit
select is(
  (select count(*)::int from public.list_company_users(p_limit => 2, p_company_id => 'f5a20000-0000-0000-0000-000000000004')),
  2, 'nunca retorna mais que p_limit (2)');

-- percorre as 3 paginas de 2 e confirma sem duplicata/perda, tie-break por membership_id desc
create temporary table pag_ids (membership_id uuid, created_at timestamptz, rownum int);

insert into pag_ids
select membership_id, created_at, 1 from public.list_company_users(p_limit => 2, p_company_id => 'f5a20000-0000-0000-0000-000000000004');

select is((select count(*)::int from pag_ids), 2, 'pagina 1: 2 linhas');
select is(
  (select array_agg(membership_id order by created_at desc, membership_id desc) from pag_ids),
  array['f5a30000-0000-0000-0000-000000000055'::uuid, 'f5a30000-0000-0000-0000-000000000054'::uuid],
  'pagina 1: P5 e P4 (mais recentes primeiro)');

insert into pag_ids
select l.membership_id, l.created_at, 2
from public.list_company_users(
  p_limit => 2, p_company_id => 'f5a20000-0000-0000-0000-000000000004',
  p_cursor_created_at => (select created_at from pag_ids where rownum = 1 order by created_at asc limit 1),
  p_cursor_membership_id => (select membership_id from pag_ids where rownum = 1 order by created_at asc, membership_id asc limit 1)
) l;

select is((select count(*)::int from pag_ids where rownum = 2), 2, 'pagina 2: 2 linhas');
select is(
  (select array_agg(membership_id order by membership_id) from pag_ids where rownum = 2),
  array['f5a30000-0000-0000-0000-000000000052'::uuid, 'f5a30000-0000-0000-0000-000000000053'::uuid],
  'pagina 2: P3 e P2 (created_at empatado entre P1/P2, desempate por membership_id desc traz P2 antes de P1)');

insert into pag_ids
select l.membership_id, l.created_at, 3
from public.list_company_users(
  p_limit => 2, p_company_id => 'f5a20000-0000-0000-0000-000000000004',
  p_cursor_created_at => (select created_at from pag_ids where rownum = 2 order by created_at asc, membership_id asc limit 1),
  p_cursor_membership_id => (select membership_id from pag_ids where rownum = 2 order by created_at asc, membership_id asc limit 1)
) l;

select is((select count(*)::int from pag_ids where rownum = 3), 2, 'pagina 3: 2 linhas finais (P1 e Manager P)');
select is(
  (select array_agg(membership_id order by membership_id desc) from pag_ids where rownum = 3),
  array['f5a30000-0000-0000-0000-000000000051'::uuid, 'f5a30000-0000-0000-0000-000000000050'::uuid],
  'pagina 3: P1 e Manager P, nessa ordem (created_at desc)');

-- pagina apos o final: vazia, nunca erro
select is(
  (select count(*)::int from public.list_company_users(
    p_limit => 2, p_company_id => 'f5a20000-0000-0000-0000-000000000004',
    p_cursor_created_at => (select created_at from pag_ids where rownum = 3 order by created_at asc, membership_id asc limit 1),
    p_cursor_membership_id => (select membership_id from pag_ids where rownum = 3 order by created_at asc, membership_id asc limit 1)
  )),
  0, 'pagina apos a ultima retorna vazia, sem erro');

reset role;

-- sem duplicata e sem perda: uniao das 3 paginas = os 6 membros exatos
-- (comparado como postgres — Manager P nao tem grant de coluna "id" em
-- company_memberships, so "company_id/role/is_active", entao esta
-- verificacao roda fora do impersonation)
select is(
  (select count(distinct membership_id)::int from pag_ids),
  6, 'as 3 paginas juntas cobrem os 6 membros sem duplicata');
select is(
  (select array_agg(membership_id order by membership_id) from pag_ids) ,
  (select array_agg(id order by id) from public.company_memberships where company_id = 'f5a20000-0000-0000-0000-000000000004'),
  'o conjunto de membership_id paginado bate exatamente com os membros reais da empresa (sem perda)');

drop table pag_ids;

-- ══════════════════════════════════════════════════════════════════════
-- 7. BUSCA
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5a10000-0000-0000-0000-000000000001'); -- Manager A

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => '')),
  7, 'busca vazia equivale a NULL (retorna todos os 7 da empresa)');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => '   ')),
  7, 'busca só com espaços (apos btrim) equivale a NULL');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'Zephyr')),
  1, 'busca contains por nome (prefixo)');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'ZEPHYR')),
  1, 'busca case-insensitive');

select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'busca@test')),
  1, 'busca contains por e-mail (meio da string)');

-- escape de % — sem escape, "s%c" combinado com ILIKE '%s%c%' faria match generico;
-- com escape, so bate no nome que contem o "%" literal
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 's%c')),
  1, 'busca por "s%c" (com % literal escapado) so bate no nome "Bus%ca_Especial"');
select is(
  (select name from public.list_company_users(p_limit => 100, p_search => 's%c')),
  'Bus%ca_Especial', 'a linha encontrada e exatamente a do % literal');

-- escape de _ — sem escape, "_" e wildcard de 1 char e bateria tambem no decoy "CaXEspecial"
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'ca_es')),
  1, 'busca por "ca_es" (com _ literal escapado) NAO bate no decoy "CaXEspecial"');
select is(
  (select name from public.list_company_users(p_limit => 100, p_search => 'ca_es')),
  'Bus%ca_Especial', 'a linha encontrada e exatamente a do _ literal, nunca o decoy');

-- escape de \
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 'k\s')),
  1, 'busca por "k\s" (com \ literal escapado) bate no nome "Back\Slash"');

-- busca acima de 100 caracteres
select throws_ok(
  format($$select count(*) from public.list_company_users(p_search => %L)$$, repeat('x', 101)),
  '22023', 'invalid_search', 'busca acima de 100 caracteres e invalida');

-- nenhuma linha externa ao escopo aparece numa busca ampla (Manager A buscando algo generico)
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_search => 's5a2') where company_id <> 'f5a20000-0000-0000-0000-000000000001'),
  0, 'busca ampla nunca traz linha de fora do escopo do Manager');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. COLUNAS E SEGURANÇA
-- ══════════════════════════════════════════════════════════════════════

-- a lista de colunas do retorno nao inclui role/platform_role/seller_id/etc:
-- ja garantido estruturalmente pelo RETURNS TABLE (8 colunas fixas), aqui
-- confirmamos que nenhum argumento de saida extra existe.
select is(
  (select array_agg(a.name::text order by a.ord)
     from unnest(
       (select proargnames from pg_proc where oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure),
       (select proargmodes from pg_proc where oid = 'public.list_company_users(integer,timestamptz,uuid,text,uuid,public.company_role)'::regprocedure)
     ) with ordinality as a(name, mode, ord)
    where a.mode = 't'),
  array['profile_id','membership_id','name','email','company_id','company_name','company_role','created_at'],
  'saida da funcao tem exatamente estas 8 colunas, nesta ordem — nunca role/platform_role/seller_id/auth metadata/audit_log/dados de convite');

-- funcao nao escreve: nenhuma linha de profiles/company_memberships mudou
-- apos multiplas chamadas acima (checagem indireta: contagem de linhas
-- ainda bate com o inserido nesta transacao, nada foi duplicado/alterado)
select is(
  (select count(*)::int from public.company_memberships where company_id = 'f5a20000-0000-0000-0000-000000000001'),
  9, 'nenhuma escrita ocorreu em company_memberships (contagem da empresa A inalterada)');

-- S5-A1 permanece intacto: profiles_update_admin continua ausente,
-- authenticated continua sem UPDATE em profiles
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_admin'),
  0, 'S5-A1 intacto: profiles_update_admin continua ausente');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE'),
  0, 'S5-A1 intacto: anon/authenticated continuam sem UPDATE de tabela em profiles');

-- grants de profiles/company_memberships nao foram ampliados por esta etapa
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array[
    'id', 'company_id', 'name', 'email', 'role', 'seller_id', 'is_active', 'platform_role'
  ]) as c),
  'grants de SELECT em profiles permanecem exatamente as mesmas 8 colunas (nao ampliados)');
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array['company_id', 'role', 'is_active']) as c),
  'grants de SELECT em company_memberships permanecem exatamente as mesmas 3 colunas (nao ampliados)');

select finish();
rollback;
