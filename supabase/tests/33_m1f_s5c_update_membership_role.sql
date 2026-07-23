-- M1-F S5-C — RPC update_membership_role
-- (20260723180000_m1f_s5c_update_membership_role.sql). Cobre catálogo,
-- escopo por ator, autoalteração, alvo Super Admin, guarda do último
-- Manager, ponte temporária profiles.role, idempotência/reconciliação,
-- ciclo seller↔manager em public.sellers (preservação de histórico,
-- desvincular/inativar na promoção, religar/reativar ou criar na volta,
-- conflitos), auditoria e integração com S5-A1/S5-A2/S5-B. Fixtures
-- sintéticas @test.local, transação com rollback.
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
  ('f5c20000-0000-0000-0000-000000000001', 'S5C Empresa A', 'ativa'),
  ('f5c20000-0000-0000-0000-000000000002', 'S5C Empresa B', 'ativa'),
  ('f5c20000-0000-0000-0000-000000000003', 'S5C Empresa Cancelada', 'cancelada'),
  ('f5c20000-0000-0000-0000-000000000004', 'S5C Empresa Suspensa', 'suspensa'),
  ('f5c20000-0000-0000-0000-000000000005', 'S5C Empresa Implantacao', 'implantacao'),
  ('f5c20000-0000-0000-0000-000000000006', 'S5C Empresa Manager Isolado', 'ativa'),
  ('f5c20000-0000-0000-0000-000000000007', 'S5C Empresa Last Manager Test', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's5c-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's5c-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's5c-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's5c-seller-a2-nohist@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's5c-manager-a2-lastmgr@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's5c-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's5c-seller-conflict-dup@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's5c-seller-wrong-membership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's5c-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 's5c-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 's5c-sem-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 's5c-seller-plain@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 's5c-superadmin-alvo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 's5c-manager-suspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000015', 'authenticated', 'authenticated', 's5c-manager-implantacao@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000016', 'authenticated', 'authenticated', 's5c-recon-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000017', 'authenticated', 'authenticated', 's5c-recon-seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000018', 'authenticated', 'authenticated', 's5c-legacy-admin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000019', 'authenticated', 'authenticated', 's5c-manager-isolado-companheiro@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 's5c-lastmgr-x@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5c10000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 's5c-lastmgr-y@test.local', now(), now(), now());

insert into public.profiles (id, name, email, role, is_active, platform_role) values
  ('f5c10000-0000-0000-0000-000000000001', 'S5C Super Admin', 's5c-superadmin@test.local', 'seller', true, 'super_admin'),
  ('f5c10000-0000-0000-0000-000000000002', 'S5C Manager A', 's5c-manager-a@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000003', 'S5C Seller A1', 's5c-seller-a1@test.local', 'seller', true, null),
  ('f5c10000-0000-0000-0000-000000000004', 'S5C Seller A2 Sem Historico', 's5c-seller-a2-nohist@test.local', 'seller', true, null),
  ('f5c10000-0000-0000-0000-000000000005', 'S5C Manager A2 Last', 's5c-manager-a2-lastmgr@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000006', 'S5C Profile Inativo', 's5c-inactive-profile@test.local', 'seller', false, null),
  ('f5c10000-0000-0000-0000-000000000007', 'S5C Seller Conflict Dup', 's5c-seller-conflict-dup@test.local', 'seller', true, null),
  ('f5c10000-0000-0000-0000-000000000008', 'S5C Seller Wrong Membership', 's5c-seller-wrong-membership@test.local', 'seller', true, null),
  ('f5c10000-0000-0000-0000-000000000009', 'S5C Manager B', 's5c-manager-b@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000010', 'S5C Manager', 's5c-manager@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000012', 'S5C Seller Plain', 's5c-seller-plain@test.local', 'seller', true, null),
  ('f5c10000-0000-0000-0000-000000000013', 'S5C Super Admin Alvo', 's5c-superadmin-alvo@test.local', 'seller', true, 'super_admin'),
  ('f5c10000-0000-0000-0000-000000000014', 'S5C Manager Suspensa', 's5c-manager-suspensa@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000015', 'S5C Manager Implantacao', 's5c-manager-implantacao@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000016', 'S5C Recon Manager', 's5c-recon-manager@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000017', 'S5C Recon Seller', 's5c-recon-seller@test.local', 'seller', true, null),
  ('f5c10000-0000-0000-0000-000000000018', 'S5C Legacy Admin', 's5c-legacy-admin@test.local', 'admin', true, null),
  ('f5c10000-0000-0000-0000-000000000019', 'S5C Manager Isolado Companheiro', 's5c-manager-isolado-companheiro@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000020', 'S5C LastMgr X', 's5c-lastmgr-x@test.local', 'manager', true, null),
  ('f5c10000-0000-0000-0000-000000000021', 'S5C LastMgr Y', 's5c-lastmgr-y@test.local', 'manager', true, null);
-- f5c10000-...-000011 (auth user sem profile) deliberadamente sem linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active, created_at) values
  ('f5c30000-0000-0000-0000-000000000002', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000002', 'manager', true, now()),
  ('f5c30000-0000-0000-0000-000000000003', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000003', 'seller',  true, now()),
  ('f5c30000-0000-0000-0000-000000000004', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000004', 'seller',  true, now()),
  ('f5c30000-0000-0000-0000-000000000005', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000005', 'manager', true, now()), -- unico outro manager (para testes de last-manager)
  ('f5c30000-0000-0000-0000-000000000006', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000006', 'seller',  true, now()), -- profile inativo
  ('f5c30000-0000-0000-0000-000000000007', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000007', 'seller',  true, now()), -- conflito: 2 sellers
  ('f5c30000-0000-0000-0000-000000000008', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000008', 'seller',  true, now()), -- conflito: seller ligado a outra membership
  ('f5c30000-0000-0000-0000-000000000009', 'f5c20000-0000-0000-0000-000000000002', 'f5c10000-0000-0000-0000-000000000009', 'manager', true, now()),
  ('f5c30000-0000-0000-0000-000000000010', 'f5c20000-0000-0000-0000-000000000006', 'f5c10000-0000-0000-0000-000000000010', 'manager', true, now()), -- manager isolado (empresa propria, com companheiro — demissao sem bloqueio de ultimo manager)
  ('f5c30000-0000-0000-0000-000000000019', 'f5c20000-0000-0000-0000-000000000006', 'f5c10000-0000-0000-0000-000000000019', 'manager', true, now()), -- companheiro do manager isolado
  ('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000012', 'seller',  true, now()),
  ('f5c30000-0000-0000-0000-000000000013', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000013', 'seller',  true, now()), -- Super Admin com membership real (alvo proibido)
  ('f5c30000-0000-0000-0000-000000000014', 'f5c20000-0000-0000-0000-000000000004', 'f5c10000-0000-0000-0000-000000000014', 'manager', true, now()), -- empresa suspensa
  ('f5c30000-0000-0000-0000-000000000015', 'f5c20000-0000-0000-0000-000000000005', 'f5c10000-0000-0000-0000-000000000015', 'manager', true, now()), -- empresa implantacao
  ('f5c30000-0000-0000-0000-000000000016', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000016', 'manager', true, now()), -- reconciliacao: destino manager (sem seller nenhum vinculado)
  ('f5c30000-0000-0000-0000-000000000017', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000017', 'seller',  true, now()), -- reconciliacao: destino seller
  ('f5c30000-0000-0000-0000-000000000018', 'f5c20000-0000-0000-0000-000000000001', 'f5c10000-0000-0000-0000-000000000018', 'manager', true, now()), -- profiles.role legado 'admin', membership ja manager
  ('f5c30000-0000-0000-0000-000000000020', 'f5c20000-0000-0000-0000-000000000007', 'f5c10000-0000-0000-0000-000000000020', 'manager', true, now()), -- empresa dedicada ao teste de ultimo manager: exatamente 2 managers
  ('f5c30000-0000-0000-0000-000000000021', 'f5c20000-0000-0000-0000-000000000007', 'f5c10000-0000-0000-0000-000000000021', 'manager', true, now());

-- Nota: o cenario "seller ligado a OUTRA membership" (mesmo profile) nao e'
-- construtivel como fixture — company_memberships tem unique(company_id,
-- profile_id) (m1f_s1_01), entao um profile nunca pode ter mais de UMA
-- linha de membership na mesma empresa, ativa ou nao. Combinado ao
-- trigger de consistencia (profile_id do seller == profile_id da
-- membership) e a FK composta (mesma empresa), nao existe, em nenhuma
-- circunstancia alcancavel, uma segunda membership candidata para o
-- mesmo (company_id, profile_id) a que um seller pudesse estar
-- "erroneamente" ligado. A checagem correspondente na RPC
-- (v_seller.membership_id <> v_membership.id) permanece como defesa em
-- profundidade (mesmo espirito de "nao confiar cegamente" ja usado em
-- accept_invite), mas nao ha teste real possivel para esse ramo
-- especifico — documentado aqui em vez de forcar uma fixture artificial.

-- sellers reais (historico) para os cenarios relevantes
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s5c-a1', 'f5c20000-0000-0000-0000-000000000001', 'f5c30000-0000-0000-0000-000000000003', 'f5c10000-0000-0000-0000-000000000003', 'S5C Seller A1', 'S5C', true),
  ('s5c-inactive-profile', 'f5c20000-0000-0000-0000-000000000001', 'f5c30000-0000-0000-0000-000000000006', 'f5c10000-0000-0000-0000-000000000006', 'S5C Profile Inativo', 'S5C', true),
  ('s5c-conflict-1', 'f5c20000-0000-0000-0000-000000000001', null, 'f5c10000-0000-0000-0000-000000000007', 'S5C Seller Conflict Dup', 'S5C', false),
  ('s5c-conflict-2', 'f5c20000-0000-0000-0000-000000000001', null, 'f5c10000-0000-0000-0000-000000000007', 'S5C Seller Conflict Dup', 'S5C', false),
  ('s5c-plain', 'f5c20000-0000-0000-0000-000000000001', 'f5c30000-0000-0000-0000-000000000012', 'f5c10000-0000-0000-0000-000000000012', 'S5C Seller Plain', 'S5C', true),
  ('s5c-recon-seller-unlinked', 'f5c20000-0000-0000-0000-000000000001', null, 'f5c10000-0000-0000-0000-000000000017', 'S5C Recon Seller', 'S5C', false); -- inconsistente de proposito: desvinculado+inativo mas membership ja e' seller

-- pipeline_stages minimo (nao criado via create_company() nesta fixture) —
-- necessario para o FK composta leads(company_id, stage_id).
insert into public.pipeline_stages (id, company_id, code, name, sort_order)
values ('f5c50000-0000-0000-0000-000000000001', 'f5c20000-0000-0000-0000-000000000001', 'new', 'Novo', 0);

-- historico sintetico de lead referenciando um seller.id (integridade historica)
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id)
values (
  'f5c40000-0000-0000-0000-000000000001', 'f5c20000-0000-0000-0000-000000000001',
  'Cliente Historico S5C', '(11) 90000-0000', 'Carro Teste',
  'f5c50000-0000-0000-0000-000000000001',
  's5c-a1'
);

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'update_membership_role' and pronamespace = 'public'::regnamespace),
  1, 'update_membership_role existe exatamente uma vez (sem overload)');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.update_membership_role(uuid,uuid,public.company_role)'::regprocedure),
  true, 'SECURITY DEFINER');
select is(
  (select p.provolatile from pg_proc p where p.oid = 'public.update_membership_role(uuid,uuid,public.company_role)'::regprocedure),
  'v', 'VOLATILE');
select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.update_membership_role(uuid,uuid,public.company_role)'::regprocedure),
  'postgres', 'owner e postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.update_membership_role(uuid,uuid,public.company_role)'::regprocedure),
  array['search_path=""'], 'search_path fixo');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='update_membership_role' and grantee='PUBLIC'),
  0, 'PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='update_membership_role' and grantee='anon'),
  0, 'anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='update_membership_role' and grantee='authenticated' and privilege_type='EXECUTE'),
  1, 'authenticated com EXECUTE');

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select is(
  (select pg_typeof(membership_id)::text from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', 'seller') limit 1),
  'uuid', 'retorno coluna 1 membership_id e uuid');
select is(
  (select pg_typeof(profile_id)::text from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', 'seller') limit 1),
  'uuid', 'retorno coluna 2 profile_id e uuid');
select is(
  (select pg_typeof(company_id)::text from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', 'seller') limit 1),
  'uuid', 'retorno coluna 3 company_id e uuid');
select is(
  (select pg_typeof(company_role)::text from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', 'seller') limit 1),
  'company_role', 'retorno coluna 4 company_role e public.company_role');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. ATORES
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001'); -- Super Admin sem membership
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000004', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'Super Admin sem membership propria continua autorizado (escopo global)');
reset role;

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000002'); -- Manager A
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000003', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  '42501', 'forbidden', 'Manager: forbidden (nunca altera papel, nem da propria empresa)');
reset role;

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000003'); -- Seller A1
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000004', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  '42501', 'forbidden', 'Seller: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000011'); -- sem profile
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000004', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  '42501', 'forbidden', 'usuario sem profile: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000006'); -- profile inativo
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000004', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  '42501', 'forbidden', 'profile inativo (ator): forbidden');
reset role;

set local role anon;
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000004', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  '42501', null, 'anon: bloqueado por ausencia de EXECUTE');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. INVALID_ROLE / MEMBERSHIP_NOT_FOUND / EMPRESAS
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001'); -- Super Admin

select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', null)$$,
  '22023', 'invalid_role', 'p_role NULL e invalido');

select throws_ok(
  $$select * from public.update_membership_role('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'P0002', 'membership_not_found', 'membership inexistente');

select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000002', 'manager')$$,
  'P0002', 'membership_not_found', 'empresa divergente da membership real');

select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000006', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'P0002', 'membership_not_found', 'alvo com profile inativo -> membership_not_found');

select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000003', 'manager')$$,
  'P0002', 'membership_not_found', 'empresa cancelada -> membership_not_found');

select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000014', 'f5c20000-0000-0000-0000-000000000004', 'manager')$$,
  'empresa suspensa e permitida para Super Admin (chamada idempotente, unico manager, sem acionar guarda de ultimo manager)');
reset role;

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000015', 'f5c20000-0000-0000-0000-000000000005', 'manager')$$,
  'empresa implantacao permitida para Super Admin (chamada idempotente, unico manager)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. AUTOALTERAÇÃO / ALVO SUPER ADMIN
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001'); -- Super Admin, sem membership propria: nada a testar de self aqui
-- alvo Super Admin com membership real
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000013', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  '42501', 'forbidden', 'alvo Super Admin (mesmo com membership real) e forbidden');
reset role;

-- self: Super Admin (com membership real) tentando alterar a propria membership —
-- a checagem de autoalteracao (self_role_change_forbidden) e' avaliada
-- ANTES da checagem de "alvo Super Admin", entao um super admin mirando a
-- si mesmo cai em self_role_change_forbidden, nao em forbidden.
set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000013');
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000013', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'P0001', 'self_role_change_forbidden', 'Super Admin tentando alterar a propria membership -> self_role_change_forbidden (nunca forbidden)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. ÚLTIMO MANAGER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001'); -- Super Admin

-- empresa B so tem 1 manager (f5c10000-...-000009) — demote deve falhar
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000009', 'f5c20000-0000-0000-0000-000000000002', 'seller')$$,
  'P0001', 'last_manager_requires_successor', 'unico Manager da empresa B nao pode virar seller');

-- empresa dedicada (007) tem exatamente 2 managers (LastMgr X + LastMgr Y)
-- — demote de um deles deve funcionar
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000021', 'f5c20000-0000-0000-0000-000000000007', 'seller')$$,
  'com segundo Manager ativo na empresa, demissao de um deles e permitida');

-- agora a empresa dedicada so tem 1 manager restante (LastMgr X) — demote dele deve falhar
select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000020', 'f5c20000-0000-0000-0000-000000000007', 'seller')$$,
  'P0001', 'last_manager_requires_successor', 'apos a demissao anterior, o ultimo manager restante nao pode virar seller');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. SELLER -> MANAGER (com historico real)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');

select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000003', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'Seller A1 promovido a Manager (com sellers.id=s5c-a1 real e historico de lead)');
reset role;

select is(
  (select role from public.company_memberships where id = 'f5c30000-0000-0000-0000-000000000003'),
  'manager'::public.company_role, 'membership de Seller A1 agora e manager');
select is(
  (select role from public.profiles where id = 'f5c10000-0000-0000-0000-000000000003'),
  'manager'::public.user_role, 'profiles.role de Seller A1 sincronizado para manager');
select is(
  (select platform_role from public.profiles where id = 'f5c10000-0000-0000-0000-000000000003'),
  null::public.platform_role, 'platform_role nunca mudou');
select is(
  (select membership_id from public.sellers where id = 's5c-a1'),
  null::uuid, 'sellers.membership_id desvinculado (NULL) apos a promocao');
select is(
  (select is_active from public.sellers where id = 's5c-a1'),
  false, 'sellers.is_active inativado apos a promocao');
select is(
  (select count(*)::int from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000003' and company_id = 'f5c20000-0000-0000-0000-000000000001'),
  1, 'nenhuma linha nova de sellers foi criada — continua existindo exatamente 1 (a mesma)');
select is(
  (select id from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000003' and company_id = 'f5c20000-0000-0000-0000-000000000001'),
  's5c-a1', 'sellers.id preservado (mesmo id de antes da promocao)');
select is(
  (select seller_id from public.leads where id = 'f5c40000-0000-0000-0000-000000000001'),
  's5c-a1', 'referencia historica do lead a sellers.id permanece intacta apos a promocao');

-- ══════════════════════════════════════════════════════════════════════
-- 7. SELLER -> MANAGER (sem histórico de seller)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000004'),
  0, 'Seller A2 nao tem nenhuma linha de sellers antes da promocao');

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000004', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'Seller A2 (sem historico de sellers) promovido a Manager sem erro');
reset role;
select is(
  (select count(*)::int from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000004'),
  0, 'continua sem nenhuma linha de sellers apos a promocao (nada foi criado desnecessariamente)');
select is(
  (select role from public.company_memberships where id = 'f5c30000-0000-0000-0000-000000000004'),
  'manager'::public.company_role, 'membership de Seller A2 agora e manager');

-- ══════════════════════════════════════════════════════════════════════
-- 8. MANAGER -> SELLER COM HISTÓRICO
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000003', 'f5c20000-0000-0000-0000-000000000001', 'seller')$$,
  'Seller A1 (agora Manager) rebaixado de volta a Seller');
reset role;
select is(
  (select role from public.company_memberships where id = 'f5c30000-0000-0000-0000-000000000003'),
  'seller'::public.company_role, 'membership voltou a seller');
select is(
  (select role from public.profiles where id = 'f5c10000-0000-0000-0000-000000000003'),
  'seller'::public.user_role, 'profiles.role voltou a seller');
select is(
  (select membership_id from public.sellers where id = 's5c-a1'),
  'f5c30000-0000-0000-0000-000000000003'::uuid, 'sellers.membership_id religado a mesma membership');
select is(
  (select is_active from public.sellers where id = 's5c-a1'),
  true, 'sellers.is_active reativado');
select is(
  (select count(*)::int from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000003' and company_id = 'f5c20000-0000-0000-0000-000000000001'),
  1, 'nenhuma duplicacao — continua exatamente 1 linha (mesmo id s5c-a1)');
select is(
  (select seller_id from public.leads where id = 'f5c40000-0000-0000-0000-000000000001'),
  's5c-a1', 'referencia historica do lead permanece intacta apos o ciclo completo ida e volta');

-- ══════════════════════════════════════════════════════════════════════
-- 9. MANAGER -> SELLER SEM HISTÓRICO (cria novo)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000010', 'f5c20000-0000-0000-0000-000000000006', 'seller')$$,
  'Manager sem nenhum historico de seller rebaixado a Seller — cria linha nova');
reset role;

select is(
  (select count(*)::int from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000010' and company_id = 'f5c20000-0000-0000-0000-000000000006'),
  1, 'exatamente uma linha de seller criada');
select is(
  (select company_id from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000010'),
  'f5c20000-0000-0000-0000-000000000006'::uuid, 'company_id correto');
select is(
  (select membership_id from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000010'),
  'f5c30000-0000-0000-0000-000000000010'::uuid, 'membership_id correto');
select is(
  (select name from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000010'),
  'S5C Manager', 'name vindo do profile atual');
select is(
  (select first_name from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000010'),
  'S5C', 'first_name derivado por split_part do nome atual');
select is(
  (select is_active from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000010'),
  true, 'is_active=true na criacao');

-- ══════════════════════════════════════════════════════════════════════
-- 10. INCONSISTÊNCIAS (seller_state_conflict)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');

select throws_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000007', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'P0001', 'seller_state_conflict', 'dois sellers para o mesmo profile/empresa -> seller_state_conflict');
reset role;
select is(
  (select role from public.company_memberships where id = 'f5c30000-0000-0000-0000-000000000007'),
  'seller'::public.company_role, 'nenhuma alteracao parcial: membership do conflito continua seller');
select is(
  (select count(*)::int from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000007'),
  0, 'nenhuma auditoria criada para o conflito de duplicidade');

-- "seller ligado a outra membership" nao tem fixture realista possivel
-- (ver nota na secao de fixtures, acima) — a checagem correspondente na
-- RPC existe como defesa em profundidade, sem caminho de teste real.
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 11. RECONCILIAÇÃO
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');

-- Nota: nao existe cenario testavel de "destino manager com seller ainda
-- linkado+ativo" — o proprio trigger sellers_check_membership_consistency
-- (S1) exige role='seller' na membership referenciada por qualquer
-- sellers.membership_id nao-nulo, portanto uma membership 'manager' com um
-- seller linkado e' um estado estruturalmente inalcancavel (nem via
-- fixture, nem via producao) — nao ha o que reconciliar nessa direcao.
-- membership f5c30000-...-000016 (destino manager) nunca teve nenhum
-- seller vinculado; a chamada abaixo confirma que esse caso permanece
-- idempotente (nada a corrigir, nenhuma auditoria).
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000016', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'destino manager sem nenhum seller vinculado: idempotente, sem erro');
reset role;
select is(
  (select count(*)::int from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000016'),
  0, 'chamada idempotente (nada a reconciliar) nao cria auditoria');

-- destino seller: membership ja e seller, mas o seller historico ficou desvinculado+inativo (fixture s5c-recon-seller-unlinked)
set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000017', 'f5c20000-0000-0000-0000-000000000001', 'seller')$$,
  'reconciliacao destino seller: role ja correta, mas religa/reativa o seller historico');
reset role;
select is(
  (select membership_id from public.sellers where id = 's5c-recon-seller-unlinked'), 'f5c30000-0000-0000-0000-000000000017'::uuid, 'seller religado apos reconciliacao');
select is(
  (select is_active from public.sellers where id = 's5c-recon-seller-unlinked'), true, 'seller reativado apos reconciliacao');
select is(
  (select count(*)::int from public.sellers where profile_id = 'f5c10000-0000-0000-0000-000000000017' and company_id = 'f5c20000-0000-0000-0000-000000000001'),
  1, 'nenhuma duplicacao na reconciliacao (reutilizou a linha existente)');

-- profiles.role divergente (legado 'admin') corrigido quando a membership ja e' 'manager'
select is((select role from public.profiles where id = 'f5c10000-0000-0000-0000-000000000018'), 'admin'::public.user_role, 'antes: profiles.role legado e admin');
set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000018', 'f5c20000-0000-0000-0000-000000000001', 'manager')$$,
  'reconciliacao: membership ja e manager, profiles.role legado admin e corrigido para manager');
reset role;
select is(
  (select role from public.profiles where id = 'f5c10000-0000-0000-0000-000000000018'), 'manager'::public.user_role, 'profiles.role corrigido de admin para manager (nunca fica admin)');

-- idempotência total: chamar de novo sobre um estado ja 100% coerente
select updated_at as membership_updated_before from public.company_memberships where id = 'f5c30000-0000-0000-0000-000000000012' \gset
select count(*)::int as audit_before from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000012' \gset

set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', 'seller');
select * from public.update_membership_role('f5c30000-0000-0000-0000-000000000012', 'f5c20000-0000-0000-0000-000000000001', 'seller');
reset role;
select is(
  (select updated_at from public.company_memberships where id = 'f5c30000-0000-0000-0000-000000000012'),
  :'membership_updated_before'::timestamptz,
  'chamada idempotente (tudo ja coerente) nao altera updated_at da membership');
select is(
  (select count(*)::int from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000012') - :audit_before,
  0, 'chamada idempotente nao cria nova auditoria');

-- ══════════════════════════════════════════════════════════════════════
-- 12. AUDITORIA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select action from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000003' order by occurred_at, result desc limit 1),
  'user_membership_role_updated', 'acao correta registrada (verificado no ciclo seller->manager->seller acima)');
-- nota: jsonb_object_keys() e' set-returning — se aplicado direto dentro
-- de uma query com LIMIT 1 sobre audit_log, o LIMIT corta a EXPANSAO das
-- chaves (nao as linhas de audit_log), truncando o resultado para 1 unica
-- chave. Por isso a linha e' resolvida primeiro (subquery escalar), e so
-- entao jsonb_object_keys() e' aplicado ao jsonb ja isolado.
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select before_data from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000010' order by occurred_at desc limit 1)
  ) as k),
  array['company_role','profile_role','seller_active','seller_id','seller_linked']::text[],
  'before_data contem exatamente company_role/profile_role/seller_id/seller_active/seller_linked');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select after_data from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000010' order by occurred_at desc limit 1)
  ) as k),
  array['company_role','profile_role','seller_active','seller_id','seller_linked']::text[],
  'after_data contem exatamente os mesmos 5 campos, nada mais');
select is(
  (select (before_data ? 'name') or (before_data ? 'email') or (before_data ? 'platform_role') from public.audit_log where entity_id = 'f5c30000-0000-0000-0000-000000000010' order by occurred_at desc limit 1),
  false, 'nenhum dado sensivel (nome/email/platform_role) na auditoria');

-- ══════════════════════════════════════════════════════════════════════
-- 13. INTEGRAÇÃO
-- ══════════════════════════════════════════════════════════════════════

-- list_company_users reflete o novo company_role
set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select is(
  (select company_role::text from public.list_company_users(p_limit => 100, p_company_id => 'f5c20000-0000-0000-0000-000000000001') where profile_id = 'f5c10000-0000-0000-0000-000000000004'),
  'manager', 'list_company_users reflete a promocao de Seller A2 para manager');
reset role;

-- update_profile_name continua funcionando
set local role authenticated;
select pg_temp.as_user('f5c10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_profile_name('f5c10000-0000-0000-0000-000000000001', 'S5C Super Admin Renomeado')$$,
  'update_profile_name (S5-B) continua funcional apos esta migration');
reset role;

-- S5-A1 intacto
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_admin'),
  0, 'S5-A1 intacto: profiles_update_admin continua ausente');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated') and privilege_type='UPDATE'),
  0, 'S5-A1 intacto: anon/authenticated continuam sem UPDATE de tabela em profiles');

-- nenhum grant/policy novo em sellers/company_memberships — REFERENCES/
-- TRIGGER/TRUNCATE sao privilegios padrao ja documentados como inofensivos
-- (mesmo padrao ja visto em profiles desde S5-A0/S5-A1); o que importa e
-- SELECT/INSERT/UPDATE/DELETE continuarem ausentes.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='sellers' and grantee in ('anon','authenticated')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'nenhum grant de leitura/escrita em sellers para anon/authenticated (inalterado)');
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='company_memberships'),
  1, 'company_memberships continua com exatamente 1 policy (company_memberships_select_own)');

select finish();
rollback;
