-- M1-F S5-B — RPC update_profile_name
-- (20260723170000_m1f_s5b_update_profile_name.sql). Cobre catálogo,
-- validação de nome, self-edit, escopo por ator (Super Admin/Manager/
-- Seller), cross-tenant, idempotência, auditoria e integridade de
-- escrita. Fixtures sintéticas @test.local, transação com rollback.
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
  ('f5b10000-0000-0000-0000-000000000001', 'S5B Empresa X', 'ativa'),
  ('f5b10000-0000-0000-0000-000000000002', 'S5B Empresa Y', 'ativa'),
  ('f5b10000-0000-0000-0000-000000000003', 'S5B Empresa Z Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's5b-manager-x@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's5b-seller-x1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's5b-seller-x-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's5b-seller-x-inactive-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's5b-manager-y@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's5b-seller-y1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's5b-membro-z@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's5b-superadmin-solo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's5b-superadmin-membro@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 's5b-plain-sem-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 's5b-sem-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 's5b-legacy-trap@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 's5b-validation-user@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5b20000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 's5b-audit-target@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active, platform_role) values
  ('f5b20000-0000-0000-0000-000000000001', 'f5b10000-0000-0000-0000-000000000001', 'S5B Manager X', 's5b-manager-x@test.local', 'manager', true, null),
  ('f5b20000-0000-0000-0000-000000000002', 'f5b10000-0000-0000-0000-000000000001', 'S5B Seller X1', 's5b-seller-x1@test.local', 'seller', true, null),
  ('f5b20000-0000-0000-0000-000000000003', 'f5b10000-0000-0000-0000-000000000001', 'S5B Seller X Profile Inativo', 's5b-seller-x-inactive-profile@test.local', 'seller', false, null),
  ('f5b20000-0000-0000-0000-000000000004', 'f5b10000-0000-0000-0000-000000000001', 'S5B Seller X Membership Inativa', 's5b-seller-x-inactive-membership@test.local', 'seller', true, null),
  ('f5b20000-0000-0000-0000-000000000005', 'f5b10000-0000-0000-0000-000000000002', 'S5B Manager Y', 's5b-manager-y@test.local', 'manager', true, null),
  ('f5b20000-0000-0000-0000-000000000006', 'f5b10000-0000-0000-0000-000000000002', 'S5B Seller Y1', 's5b-seller-y1@test.local', 'seller', true, null),
  ('f5b20000-0000-0000-0000-000000000007', 'f5b10000-0000-0000-0000-000000000003', 'S5B Membro Empresa Cancelada', 's5b-membro-z@test.local', 'seller', true, null),
  ('f5b20000-0000-0000-0000-000000000008', null, 'S5B Super Admin Solo', 's5b-superadmin-solo@test.local', 'seller', true, 'super_admin'),
  ('f5b20000-0000-0000-0000-000000000009', null, 'S5B Super Admin Membro', 's5b-superadmin-membro@test.local', 'seller', true, 'super_admin'),
  ('f5b20000-0000-0000-0000-000000000010', null, 'S5B Plain Sem Membership', 's5b-plain-sem-membership@test.local', 'seller', true, null),
  -- profiles.company_id legado aponta (de forma enganosa) para a Empresa X,
  -- mas a membership REAL fica na Empresa Y — prova de que a RPC nunca usa
  -- este campo legado para autorizar.
  ('f5b20000-0000-0000-0000-000000000012', 'f5b10000-0000-0000-0000-000000000001', 'S5B Legacy Trap', 's5b-legacy-trap@test.local', 'seller', true, null),
  ('f5b20000-0000-0000-0000-000000000013', null, 'S5B Validation User', 's5b-validation-user@test.local', 'seller', true, null),
  ('f5b20000-0000-0000-0000-000000000014', 'f5b10000-0000-0000-0000-000000000001', 'S5B Audit Target', 's5b-audit-target@test.local', 'seller', true, null);
-- f5b20000-...-000011 (auth user sem profile) deliberadamente sem linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active, created_at) values
  ('f5b30000-0000-0000-0000-000000000001', 'f5b10000-0000-0000-0000-000000000001', 'f5b20000-0000-0000-0000-000000000001', 'manager', true, now()),
  ('f5b30000-0000-0000-0000-000000000002', 'f5b10000-0000-0000-0000-000000000001', 'f5b20000-0000-0000-0000-000000000002', 'seller',  true, now()),
  ('f5b30000-0000-0000-0000-000000000003', 'f5b10000-0000-0000-0000-000000000001', 'f5b20000-0000-0000-0000-000000000003', 'seller',  true, now()), -- profile inativo
  ('f5b30000-0000-0000-0000-000000000004', 'f5b10000-0000-0000-0000-000000000001', 'f5b20000-0000-0000-0000-000000000004', 'seller',  false, now()), -- membership inativa
  ('f5b30000-0000-0000-0000-000000000005', 'f5b10000-0000-0000-0000-000000000002', 'f5b20000-0000-0000-0000-000000000005', 'manager', true, now()),
  ('f5b30000-0000-0000-0000-000000000006', 'f5b10000-0000-0000-0000-000000000002', 'f5b20000-0000-0000-0000-000000000006', 'seller',  true, now()),
  ('f5b30000-0000-0000-0000-000000000007', 'f5b10000-0000-0000-0000-000000000003', 'f5b20000-0000-0000-0000-000000000007', 'seller',  true, now()), -- empresa cancelada
  ('f5b30000-0000-0000-0000-000000000009', 'f5b10000-0000-0000-0000-000000000002', 'f5b20000-0000-0000-0000-000000000009', 'manager', true, now()), -- Super Admin com membership real
  ('f5b30000-0000-0000-0000-000000000012', 'f5b10000-0000-0000-0000-000000000002', 'f5b20000-0000-0000-0000-000000000012', 'seller',  true, now()), -- legacy trap: membership REAL na empresa Y
  ('f5b30000-0000-0000-0000-000000000014', 'f5b10000-0000-0000-0000-000000000001', 'f5b20000-0000-0000-0000-000000000014', 'seller',  true, now()); -- alvo dedicado, exclusivo da secao de auditoria
-- f5b20000-...-000008 (Super Admin Solo), ...-000010 (Plain), ...-000013 (Validation) deliberadamente sem membership

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'update_profile_name' and pronamespace = 'public'::regnamespace),
  1, 'update_profile_name existe exatamente uma vez (sem overload)');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.update_profile_name(uuid,text)'::regprocedure),
  true, 'update_profile_name e SECURITY DEFINER');

select is(
  (select p.provolatile from pg_proc p where p.oid = 'public.update_profile_name(uuid,text)'::regprocedure),
  'v', 'update_profile_name e VOLATILE');

select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.update_profile_name(uuid,text)'::regprocedure),
  'postgres', 'owner e postgres');

select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.update_profile_name(uuid,text)'::regprocedure),
  array['search_path=""'], 'search_path fixo e vazio');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'update_profile_name' and grantee = 'PUBLIC'),
  0, 'PUBLIC sem EXECUTE');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'update_profile_name' and grantee = 'anon'),
  0, 'anon sem EXECUTE');

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'update_profile_name' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'authenticated com EXECUTE');

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000013');
select is(
  (select pg_typeof(profile_id)::text from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', 'Catalogo Nome') limit 1),
  'uuid', 'retorno coluna 1 profile_id e uuid');
select is(
  (select pg_typeof(name)::text from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', 'Catalogo Nome') limit 1),
  'text', 'retorno coluna 2 name e text');
select is(
  (select pg_typeof(updated_at)::text from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', 'Catalogo Nome') limit 1),
  'timestamp with time zone', 'retorno coluna 3 updated_at e timestamptz');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. VALIDAÇÃO DO NOME (self-edit, ator sem interferência de escopo)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000013');

select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', null)$$,
  '22023', 'invalid_name', 'nome NULL e invalido');
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', '')$$,
  '22023', 'invalid_name', 'nome vazio e invalido');
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', '    ')$$,
  '22023', 'invalid_name', 'nome so com espacos e invalido');

select lives_ok(
  format($$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', %L)$$, repeat('x', 120)),
  'nome com 120 caracteres (limite) e valido');
select throws_ok(
  format($$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', %L)$$, repeat('x', 121)),
  '22023', 'invalid_name', 'nome com 121 caracteres e invalido');

select is(
  (select name from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', '   Nome Com Trim   ')),
  'Nome Com Trim', 'trim remove espacos externos');
select is(
  (select name from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', 'José da Silva 日本語 Ñandú')),
  'José da Silva 日本語 Ñandú', 'Unicode preservado integralmente');
select is(
  (select name from public.update_profile_name('f5b20000-0000-0000-0000-000000000013', '  Nome   Com   Espacos   Internos  ')),
  'Nome   Com   Espacos   Internos', 'espacos internos preservados (so trim externo)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. SELF
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000008'); -- Super Admin Solo
select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000008', 'SA Solo Editado')$$,
  'Super Admin SEM membership edita o proprio nome');
reset role;

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000009'); -- Super Admin Membro
select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000009', 'SA Membro Editado')$$,
  'Super Admin COM membership edita o proprio nome');
reset role;

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000001'); -- Manager X
select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000001', 'Manager X Editado')$$,
  'Manager edita o proprio nome');
reset role;

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000002'); -- Seller X1
select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000002', 'Seller X1 Editado')$$,
  'Seller edita o proprio nome');
reset role;

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000010'); -- plain, sem membership, sem platform_role
select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000010', 'Plain Editado')$$,
  'usuario sem membership e sem platform_role ainda edita o proprio nome (self nunca exige membership)');
reset role;

-- usuario sem profile: forbidden mesmo tentando editar "a si mesmo"
set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000011');
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000011', 'Fantasma')$$,
  '42501', 'forbidden', 'usuario sem profile: forbidden mesmo tentando editar a si mesmo');
reset role;

-- profile inativo: forbidden mesmo tentando editar "a si mesmo"
set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000003', 'Tentativa')$$,
  '42501', 'forbidden', 'profile inativo: forbidden mesmo tentando editar a si mesmo');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. SUPER ADMIN (agindo sobre terceiros)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000008'); -- Super Admin Solo

select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000001', 'Manager X via SA')$$,
  'Super Admin edita Manager de qualquer empresa');
select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000006', 'Seller Y1 via SA')$$,
  'Super Admin edita Seller de outra empresa (Y)');

select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000003', 'Tentativa SA Inativo')$$,
  'P0001', 'user_inactive', 'Super Admin: target profile inativo -> user_inactive');
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000004', 'Tentativa SA Membership Inativa')$$,
  'P0001', 'user_inactive', 'Super Admin: target membership inativa -> user_inactive');
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000007', 'Tentativa SA Empresa Cancelada')$$,
  'P0001', 'user_inactive', 'Super Admin: target de empresa cancelada -> user_inactive (contrato seguro, mesma logica de can_access_company)');
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000010', 'Tentativa SA Sem Membership')$$,
  'P0002', 'profile_not_found', 'Super Admin: target sem NENHUMA membership ativa -> profile_not_found (salvo self)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. MANAGER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000001'); -- Manager X

select lives_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000002', 'Seller X1 via Manager')$$,
  'Manager edita Seller ativo da propria empresa');

select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000005', 'Tentativa Outro Manager')$$,
  'P0002', 'profile_not_found', 'Manager X tentando editar Manager Y (empresa DIFERENTE) -> profile_not_found, cross-tenant (o teste de "mesma empresa" real esta na secao Manager Y abaixo)');

select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000006', 'Tentativa Seller Outra Empresa')$$,
  'P0002', 'profile_not_found', 'Manager NAO edita Seller de outra empresa (cross-tenant, indistinguivel de nao existir)');

select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000008', 'Tentativa Super Admin')$$,
  'P0002', 'profile_not_found', 'Manager NAO edita Super Admin sem membership na propria empresa');

select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000004', 'Tentativa Membership Inativa')$$,
  'P0001', 'user_inactive', 'Manager: Seller da propria empresa com membership inativa -> user_inactive');

-- profiles.company_id legado aponta para Empresa X, mas a membership REAL
-- esta na Empresa Y — Manager X NAO deve conseguir editar (prova de que
-- profiles.company_id legado nunca e usado para autorizar)
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000012', 'Tentativa Legacy Trap')$$,
  'P0002', 'profile_not_found', 'Manager X NAO edita "legacy trap" — profiles.company_id legado (Empresa X) e ignorado, membership real e da Empresa Y');
reset role;

-- ── mesmo teste de "outro Manager", agora com um Manager de verdade NA MESMA empresa ──
set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000005'); -- Manager Y
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000009', 'Tentativa Outro Manager Mesma Empresa')$$,
  '42501', 'forbidden', 'Manager Y NAO edita Super Admin Membro (que e Manager na mesma empresa Y) — forbidden, nao not_found, pois ja e visivel via list_company_users');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. SELLER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000002'); -- Seller X1
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000001', 'Tentativa Seller->Manager')$$,
  '42501', 'forbidden', 'Seller NAO edita Manager');
reset role;

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000006'); -- Seller Y1
select throws_ok(
  $$select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000002', 'Tentativa Seller->Seller')$$,
  '42501', 'forbidden', 'Seller NAO edita outro Seller (mesma empresa ou nao)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. IDEMPOTÊNCIA
-- ══════════════════════════════════════════════════════════════════════

-- entity_id 000002 (Seller X1) ja foi alterado em secoes anteriores
-- (self-edit na secao 3, edicao pelo Manager na secao 5) — a contagem de
-- auditoria eh medida por DELTA a partir daqui (capturada em variavel
-- psql via \gset), nunca como valor absoluto.
select count(*)::int as audit_before from public.audit_log
 where entity_id = 'f5b20000-0000-0000-0000-000000000002' and action = 'user_profile_updated' \gset

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000002'); -- Seller X1

select is(
  (select name from public.update_profile_name('f5b20000-0000-0000-0000-000000000002', 'Nome Idempotente')),
  'Nome Idempotente', 'primeira chamada aplica a mudanca');
reset role;

-- audit_log e profiles.updated_at nao tem NENHUM grant para authenticated
-- (updated_at nunca foi concedido, ver S4-C2C) — leituras de verificacao
-- rodam sempre como postgres.
select is(
  (select count(*)::int from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000002' and action = 'user_profile_updated') - :audit_before,
  1, 'exatamente +1 evento de auditoria apos a primeira mudanca (delta)');

select updated_at as updated_at_before from public.profiles where id = 'f5b20000-0000-0000-0000-000000000002' \gset

set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000002');
select is(
  (select updated_at from public.update_profile_name('f5b20000-0000-0000-0000-000000000002', '  Nome Idempotente  ')),
  :'updated_at_before'::timestamptz,
  'chamada idempotente (mesmo nome normalizado) retorna o MESMO updated_at, sem nova escrita');
reset role;

select is(
  (select count(*)::int from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000002' and action = 'user_profile_updated') - :audit_before,
  1, 'chamada idempotente NAO cria nova auditoria (delta continua +1, nao +2)');

-- ══════════════════════════════════════════════════════════════════════
-- 8. AUDITORIA
-- ══════════════════════════════════════════════════════════════════════

-- alvo dedicado (000014), nunca tocado em nenhuma secao anterior — exatamente
-- 1 linha de auditoria possivel para ele, sem ambiguidade de "occurred_at"
-- (now() e fixo por transacao, nao serve para desempate entre chamadas).
set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000001'); -- Manager X
select * from public.update_profile_name('f5b20000-0000-0000-0000-000000000014', 'Nome Para Auditoria');
reset role;

select is(
  (select action from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  'user_profile_updated', 'acao registrada e user_profile_updated');
select is(
  (select actor_profile_id from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  'f5b20000-0000-0000-0000-000000000001'::uuid, 'ator registrado e o Manager X (auth.uid() real, nunca um id do cliente)');
select is(
  (select entity_type from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  'profile', 'entity_type e profile');
select is(
  (select company_id from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  'f5b10000-0000-0000-0000-000000000001'::uuid, 'empresa registrada e a da membership do alvo (Empresa X)');
select is(
  (select before_data from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  jsonb_build_object('name', 'S5B Audit Target'), 'before_data contem somente name (valor anterior)');
select is(
  (select after_data from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  jsonb_build_object('name', 'Nome Para Auditoria'), 'after_data contem somente name (valor novo)');
select is(
  (select (before_data ? 'email') or (before_data ? 'role') or (before_data ? 'password') or (before_data ? 'token') from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  false, 'before_data nunca contem email/role/password/token');
select is(
  (select (after_data ? 'email') or (after_data ? 'role') or (after_data ? 'password') or (after_data ? 'token') from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000014'),
  false, 'after_data nunca contem email/role/password/token');

-- self-edit sem membership: company_id de auditoria e NULL
select is(
  (select company_id from public.audit_log where entity_id = 'f5b20000-0000-0000-0000-000000000008' order by occurred_at desc limit 1),
  null::uuid, 'auditoria de self-edit sem membership (Super Admin Solo) tem company_id NULL');

-- ══════════════════════════════════════════════════════════════════════
-- 9. INTEGRIDADE DE ESCRITA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select email from public.profiles where id = 'f5b20000-0000-0000-0000-000000000002'),
  's5b-seller-x1@test.local', 'email do alvo inalterado apos edicao de nome');
select is(
  (select role from public.profiles where id = 'f5b20000-0000-0000-0000-000000000002'),
  'seller'::public.user_role, 'role legado do alvo inalterado');
select is(
  (select platform_role from public.profiles where id = 'f5b20000-0000-0000-0000-000000000002'),
  null::public.platform_role, 'platform_role do alvo inalterado (continua null)');
select is(
  (select company_id from public.profiles where id = 'f5b20000-0000-0000-0000-000000000002'),
  'f5b10000-0000-0000-0000-000000000001'::uuid, 'profiles.company_id legado do alvo inalterado');
select is(
  (select is_active from public.profiles where id = 'f5b20000-0000-0000-0000-000000000002'),
  true, 'is_active do alvo inalterado');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'f5b20000-0000-0000-0000-000000000002' and role = 'seller' and is_active),
  1, 'membership do alvo permanece exatamente como antes (role/estado inalterados)');

-- S5-A1 continua intacto
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_admin'),
  0, 'S5-A1 intacto: profiles_update_admin continua ausente');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE'),
  0, 'S5-A1 intacto: anon/authenticated continuam sem UPDATE de tabela em profiles');

-- list_company_users continua funcionando
set local role authenticated;
select pg_temp.as_user('f5b20000-0000-0000-0000-000000000001'); -- Manager X
select lives_ok(
  $$select count(*) from public.list_company_users()$$,
  'list_company_users (S5-A2) continua funcional apos esta migration');
reset role;

select finish();
rollback;
