-- M1-F S5-E1-A — backend de alteração administrativa de e-mail
-- (20260727120000_m1f_s5e1a_email_update_backend.sql). Cobre catálogo das
-- três funções, grants (service_role exclusivo nas duas de leitura,
-- authenticated na de escrita), autorização de commit_profile_email_update
-- (Super Admin apenas, nunca o próprio, nunca outro Super Admin, alvo
-- ativo/empresa não cancelada), compare-and-set, conflito de e-mail em
-- profiles, idempotência, auditoria (before/after fechado em
-- {"changed":...}, nunca e-mail completo), e confirmação estrutural de que
-- nenhuma das três funções toca auth.users por escrita (só
-- get_auth_email_update_state lê, nenhuma escreve). Fixtures sintéticas
-- @test.local, transação com rollback.
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
  ('5e120000-0000-0000-0000-000000000001', 'S5E1A Empresa A', 'ativa'),
  ('5e120000-0000-0000-0000-000000000002', 'S5E1A Empresa Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', '5e1a-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', '5e1a-superadmin-alvo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', '5e1a-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', '5e1a-seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', '5e1a-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', '5e1a-sem-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', '5e1a-empresa-cancelada@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', '5e1a-manager-ator@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', '5e1a-seller-ator@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', '5e1a-inactive-ator@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', '5e1a-idempotente@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', '5e1a-conflito-alvo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5e110000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', '5e1a-outro-auth-email@test.local', now(), now(), now());

insert into public.profiles (id, name, email, role, is_active, platform_role) values
  ('5e110000-0000-0000-0000-000000000001', 'S5E1A Super Admin', '5e1a-superadmin@test.local', 'seller', true, 'super_admin'),
  ('5e110000-0000-0000-0000-000000000002', 'S5E1A Super Admin Alvo', '5e1a-superadmin-alvo@test.local', 'seller', true, 'super_admin'),
  ('5e110000-0000-0000-0000-000000000003', 'S5E1A Manager', '5e1a-manager@test.local', 'manager', true, null),
  ('5e110000-0000-0000-0000-000000000004', 'S5E1A Seller', '5e1a-seller@test.local', 'seller', true, null),
  ('5e110000-0000-0000-0000-000000000005', 'S5E1A Profile Inativo', '5e1a-inactive-profile@test.local', 'seller', false, null),
  ('5e110000-0000-0000-0000-000000000006', 'S5E1A Sem Membership', '5e1a-sem-membership@test.local', 'seller', true, null),
  ('5e110000-0000-0000-0000-000000000007', 'S5E1A Empresa Cancelada', '5e1a-empresa-cancelada@test.local', 'seller', true, null),
  ('5e110000-0000-0000-0000-000000000008', 'S5E1A Manager Ator', '5e1a-manager-ator@test.local', 'manager', true, null),
  ('5e110000-0000-0000-0000-000000000009', 'S5E1A Seller Ator', '5e1a-seller-ator@test.local', 'seller', true, null),
  ('5e110000-0000-0000-0000-000000000010', 'S5E1A Ator Inativo', '5e1a-inactive-ator@test.local', 'seller', false, null),
  ('5e110000-0000-0000-0000-000000000011', 'S5E1A Idempotente', '5e1a-idempotente@test.local', 'seller', true, null),
  ('5e110000-0000-0000-0000-000000000012', 'S5E1A Conflito Alvo', '5e1a-conflito-alvo@test.local', 'seller', true, null),
  ('5e110000-0000-0000-0000-000000000013', 'S5E1A Outro Auth Email', '5e1a-outro-auth-email@test.local', 'seller', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('5e130000-0000-0000-0000-000000000003', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000003', 'manager', true),
  ('5e130000-0000-0000-0000-000000000004', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000004', 'seller',  true),
  ('5e130000-0000-0000-0000-000000000005', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000005', 'seller',  true), -- profile inativo
  ('5e130000-0000-0000-0000-000000000007', '5e120000-0000-0000-0000-000000000002', '5e110000-0000-0000-0000-000000000007', 'manager', true), -- empresa cancelada
  ('5e130000-0000-0000-0000-000000000008', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000008', 'manager', true), -- ator Manager
  ('5e130000-0000-0000-0000-000000000009', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000009', 'seller',  true), -- ator Seller
  ('5e130000-0000-0000-0000-000000000011', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000011', 'seller',  true),
  ('5e130000-0000-0000-0000-000000000012', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000012', 'seller',  true),
  ('5e130000-0000-0000-0000-000000000013', '5e120000-0000-0000-0000-000000000001', '5e110000-0000-0000-0000-000000000013', 'seller',  true);
-- 5e110000-...-000006 (sem membership) e 5e110000-...-000010 (ator inativo,
-- sem membership) deliberadamente sem linha em company_memberships.

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'get_auth_email_update_state' and pronamespace = 'public'::regnamespace),
  1, 'get_auth_email_update_state existe exatamente uma vez');
select is(
  (select count(*)::int from pg_proc where proname = 'get_profile_email_update_state' and pronamespace = 'public'::regnamespace),
  1, 'get_profile_email_update_state existe exatamente uma vez');
select is(
  (select count(*)::int from pg_proc where proname = 'commit_profile_email_update' and pronamespace = 'public'::regnamespace),
  1, 'commit_profile_email_update existe exatamente uma vez');

select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.get_auth_email_update_state(uuid,text)'::regprocedure),
  'get_auth_email_update_state e SECURITY DEFINER');
select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.get_profile_email_update_state(uuid,text)'::regprocedure),
  'get_profile_email_update_state e SECURITY DEFINER');
select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.commit_profile_email_update(uuid,text,text)'::regprocedure),
  'commit_profile_email_update e SECURITY DEFINER');

select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.commit_profile_email_update(uuid,text,text)'::regprocedure),
  'postgres', 'commit_profile_email_update: owner e postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.commit_profile_email_update(uuid,text,text)'::regprocedure),
  array['search_path=""'], 'commit_profile_email_update: search_path fixo');

-- grants — as duas de leitura sao EXCLUSIVAS de service_role.
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='get_auth_email_update_state' and grantee in ('PUBLIC','anon','authenticated')),
  0, 'get_auth_email_update_state: PUBLIC/anon/authenticated sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='get_auth_email_update_state' and grantee='service_role' and privilege_type='EXECUTE'),
  1, 'get_auth_email_update_state: service_role com EXECUTE');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='get_profile_email_update_state' and grantee in ('PUBLIC','anon','authenticated')),
  0, 'get_profile_email_update_state: PUBLIC/anon/authenticated sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='get_profile_email_update_state' and grantee='service_role' and privilege_type='EXECUTE'),
  1, 'get_profile_email_update_state: service_role com EXECUTE');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='commit_profile_email_update' and grantee in ('PUBLIC','anon')),
  0, 'commit_profile_email_update: PUBLIC/anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='commit_profile_email_update' and grantee='authenticated' and privilege_type='EXECUTE'),
  1, 'commit_profile_email_update: authenticated com EXECUTE');

-- defesa estrutural: commit_profile_email_update nunca referencia
-- auth.users (a unica escrita em auth.users e' via updateUserById no Route
-- Handler, nunca por SQL).
select ok(
  (select pg_get_functiondef('public.commit_profile_email_update(uuid,text,text)'::regprocedure) not ilike '%auth.users%'),
  'commit_profile_email_update nunca referencia auth.users');

-- ══════════════════════════════════════════════════════════════════════
-- 2. get_auth_email_update_state
-- ══════════════════════════════════════════════════════════════════════

set local role service_role;
select is(
  (select current_email from public.get_auth_email_update_state('5e110000-0000-0000-0000-000000000003', 'novo@test.local')),
  '5e1a-manager@test.local', 'retorna o e-mail atual em auth.users');
select is(
  (select new_email_in_use from public.get_auth_email_update_state('5e110000-0000-0000-0000-000000000003', 'novo-livre@test.local')),
  false, 'e-mail livre -> new_email_in_use=false');
select is(
  (select new_email_in_use from public.get_auth_email_update_state('5e110000-0000-0000-0000-000000000003', '5e1a-seller@test.local')),
  true, 'e-mail ja usado por OUTRO usuario -> new_email_in_use=true');
select is(
  (select new_email_in_use from public.get_auth_email_update_state('5e110000-0000-0000-0000-000000000003', upper('5e1a-seller@test.local'))),
  true, 'comparacao case-insensitive');
select is(
  (select new_email_in_use from public.get_auth_email_update_state('5e110000-0000-0000-0000-000000000003', '5e1a-manager@test.local')),
  false, 'o proprio e-mail atual do alvo nao conta como conflito (desconsidera o proprio usuario)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. get_profile_email_update_state
-- ══════════════════════════════════════════════════════════════════════

set local role service_role;
select is(
  (select row(profile_exists, profile_is_active, platform_role, current_email, company_id, membership_is_active, company_status, new_email_in_use)
     from public.get_profile_email_update_state('5e110000-0000-0000-0000-000000000003', 'novo@test.local')),
  row(true, true, null::public.platform_role, '5e1a-manager@test.local'::text, '5e120000-0000-0000-0000-000000000001'::uuid, true, 'ativa'::public.company_status, false),
  'Manager ativo com membership ativa em empresa ativa: estado completo correto');

select is(
  (select profile_exists from public.get_profile_email_update_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'novo@test.local')),
  false, 'profile inexistente -> profile_exists=false');

select is(
  (select platform_role from public.get_profile_email_update_state('5e110000-0000-0000-0000-000000000002', 'novo@test.local')),
  'super_admin'::public.platform_role, 'alvo Super Admin: platform_role retornado corretamente');

select is(
  (select profile_is_active from public.get_profile_email_update_state('5e110000-0000-0000-0000-000000000005', 'novo@test.local')),
  false, 'profile inativo -> profile_is_active=false');

select is(
  (select company_id from public.get_profile_email_update_state('5e110000-0000-0000-0000-000000000006', 'novo@test.local')),
  null::uuid, 'sem membership -> company_id NULL');

select is(
  (select company_status from public.get_profile_email_update_state('5e110000-0000-0000-0000-000000000007', 'novo@test.local')),
  'cancelada'::public.company_status, 'empresa cancelada retornada corretamente');

select is(
  (select new_email_in_use from public.get_profile_email_update_state('5e110000-0000-0000-0000-000000000003', '5e1a-seller@test.local')),
  true, 'e-mail ja usado por OUTRO profile -> new_email_in_use=true');
select is(
  (select new_email_in_use from public.get_profile_email_update_state('5e110000-0000-0000-0000-000000000003', '5e1a-manager@test.local')),
  false, 'o proprio e-mail atual do alvo nao conta como conflito');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. commit_profile_email_update — AUTORIZAÇÃO
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000003'); -- Manager (nao-ator-designado)
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000004', '5e1a-seller@test.local', 'novo@test.local')$$,
  '42501', 'forbidden', 'Manager: forbidden (nunca altera e-mail de terceiros)');
reset role;

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000009'); -- Seller ator
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000004', '5e1a-seller@test.local', 'novo@test.local')$$,
  '42501', 'forbidden', 'Seller: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000010'); -- ator com profile inativo
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000004', '5e1a-seller@test.local', 'novo@test.local')$$,
  '42501', 'forbidden', 'ator com profile inativo: forbidden');
reset role;

set local role anon;
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000004', '5e1a-seller@test.local', 'novo@test.local')$$,
  '42501', null, 'anon: bloqueado por ausencia de EXECUTE');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. AUTOALTERAÇÃO / ALVO SUPER ADMIN
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000001'); -- Super Admin
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000001', '5e1a-superadmin@test.local', 'novo-sa@test.local')$$,
  '42501', 'forbidden', 'Super Admin nao pode alterar o proprio e-mail por este fluxo');

select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000002', '5e1a-superadmin-alvo@test.local', 'novo@test.local')$$,
  '42501', 'forbidden', 'outro Super Admin nunca e alvo por este fluxo');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. ALVO INEXISTENTE / INATIVO / EMPRESA CANCELADA
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000001');

select throws_ok(
  $$select * from public.commit_profile_email_update('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'qualquer@test.local', 'novo@test.local')$$,
  'P0002', 'user_not_found', 'alvo inexistente -> user_not_found');

select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000006', '5e1a-sem-membership@test.local', 'novo@test.local')$$,
  'P0002', 'user_not_found', 'alvo sem membership -> user_not_found');

select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000005', '5e1a-inactive-profile@test.local', 'novo@test.local')$$,
  'P0001', 'user_inactive', 'alvo com profile inativo -> user_inactive');

select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000007', '5e1a-empresa-cancelada@test.local', 'novo@test.local')$$,
  'P0001', 'user_inactive', 'alvo em empresa cancelada -> user_inactive');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. E-MAIL INVÁLIDO
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000003', '5e1a-manager@test.local', '   ')$$,
  '22023', 'invalid_email', 'p_new_email em branco -> invalid_email');
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000003', '   ', 'novo@test.local')$$,
  '22023', 'invalid_email', 'p_expected_email em branco -> invalid_email');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. COMPARE-AND-SET / CONFLITO
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000012', 'email-que-nao-e-o-atual@test.local', 'novo@test.local')$$,
  'P0001', 'user_email_state_conflict', 'p_expected_email divergente do valor real -> user_email_state_conflict, nenhuma escrita');
reset role;
select is(
  (select email from public.profiles where id = '5e110000-0000-0000-0000-000000000012'),
  '5e1a-conflito-alvo@test.local', 'nenhuma alteracao parcial apos o conflito');
select is(
  (select count(*)::int from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000012'),
  0, 'nenhuma auditoria criada para o conflito de compare-and-set');

-- ══════════════════════════════════════════════════════════════════════
-- 9. CONFLITO DE E-MAIL EM PROFILES
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000013', '5e1a-outro-auth-email@test.local', '5e1a-manager@test.local')$$,
  'P0001', 'email_already_in_use', 'novo e-mail ja usado por OUTRO profile -> email_already_in_use, nunca revela por quem');
reset role;
select is(
  (select email from public.profiles where id = '5e110000-0000-0000-0000-000000000013'),
  '5e1a-outro-auth-email@test.local', 'nenhuma alteracao parcial apos o conflito de e-mail em profiles');

-- ══════════════════════════════════════════════════════════════════════
-- 10. SUCESSO E AUDITORIA
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000003', '5e1a-manager@test.local', '5e1a-manager-novo@test.local')$$,
  'Super Admin altera o e-mail do Manager com sucesso');
reset role;

select is(
  (select email from public.profiles where id = '5e110000-0000-0000-0000-000000000003'),
  '5e1a-manager-novo@test.local', 'profiles.email atualizado');

select is(
  (select action from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  'user_email_updated', 'evento de auditoria correto');
select is(
  (select actor_profile_id from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  '5e110000-0000-0000-0000-000000000001'::uuid, 'ator real (auth.uid()) registrado');
select is(
  (select company_id from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  '5e120000-0000-0000-0000-000000000001'::uuid, 'empresa correta registrada');
select is(
  (select before_data from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  '{"changed": false}'::jsonb, 'before_data contem exclusivamente {"changed": false} — nunca o e-mail antigo');
select is(
  (select after_data from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  '{"changed": true}'::jsonb, 'after_data contem exclusivamente {"changed": true} — nunca o e-mail novo');
select is(
  (select (before_data::text ilike '%test.local%') or (after_data::text ilike '%test.local%')
     from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  false, 'nenhum e-mail completo (nem dominio sintetico) aparece em before_data/after_data');

-- ══════════════════════════════════════════════════════════════════════
-- 11. IDEMPOTÊNCIA
-- ══════════════════════════════════════════════════════════════════════

select updated_at as updated_before from public.profiles where id = '5e110000-0000-0000-0000-000000000011' \gset
select count(*)::int as audit_before from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000011' \gset

set local role authenticated;
select pg_temp.as_user('5e110000-0000-0000-0000-000000000001');
select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000011', '5e1a-idempotente@test.local', '5e1a-idempotente@test.local');
select * from public.commit_profile_email_update('5e110000-0000-0000-0000-000000000011', '5e1a-idempotente@test.local', '5e1a-idempotente@test.local');
reset role;

select is(
  (select updated_at from public.profiles where id = '5e110000-0000-0000-0000-000000000011'),
  :'updated_before'::timestamptz,
  'chamada idempotente (mesmo e-mail) nao altera updated_at');
select is(
  (select count(*)::int from public.audit_log where entity_id = '5e110000-0000-0000-0000-000000000011') - :audit_before,
  0, 'chamada idempotente nao cria nenhuma auditoria');

select finish();
rollback;
