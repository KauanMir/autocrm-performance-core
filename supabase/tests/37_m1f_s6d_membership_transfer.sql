-- M1-F S6-D — transferência empresarial atômica (transfer_membership,
-- 20260728110000_m1f_s6d_membership_transfer.sql). Cobre catálogo,
-- autorização, transferência de Seller (origem ativa/suspensa, destino
-- sem membership/offboarded/suspensa/ativa, sucessor de leads, leads
-- abertos vs. arquivados), transferência de Manager (último Manager
-- protegido), troca de papel no destino, invariantes (nenhum DELETE,
-- company_id da origem preservado, uma única membership ativa,
-- profiles.is_active/platform_role/auth.users intocados), idempotência e
-- auditoria exata. Fixtures sintéticas @test.local, transação com
-- rollback.
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
  ('6d020000-0000-0000-0000-000000000001', 'S6D Empresa A (origem)', 'ativa'),
  ('6d020000-0000-0000-0000-000000000002', 'S6D Empresa B (destino)', 'ativa'),
  ('6d020000-0000-0000-0000-000000000003', 'S6D Empresa Cancelada', 'cancelada'),
  ('6d020000-0000-0000-0000-000000000004', 'S6D Empresa Suspensa (status)', 'suspensa'),
  ('6d020000-0000-0000-0000-000000000005', 'S6D Empresa LastMgr (origem)', 'ativa'),
  ('6d020000-0000-0000-0000-000000000006', 'S6D Empresa ManagerSolo (origem)', 'ativa'),
  ('6d020000-0000-0000-0000-000000000007', 'S6D Empresa DestOffboarded', 'ativa'),
  ('6d020000-0000-0000-0000-000000000008', 'S6D Empresa DestSuspensa', 'ativa'),
  ('6d020000-0000-0000-0000-000000000009', 'S6D Empresa DestAtiva', 'ativa'),
  ('6d020000-0000-0000-0000-000000000010', 'S6D Empresa Outra (intocada)', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's6d-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's6d-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's6d-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's6d-seller-a1-successor@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's6d-seller-a2-sem-leads@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's6d-seller-a3-suspenso@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's6d-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's6d-superadmin-alvo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's6d-sem-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 's6d-lastmgr-x@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 's6d-lastmgr-y@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 's6d-managersolo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 's6d-hist-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000015', 'authenticated', 'authenticated', 's6d-hist-suspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000016', 'authenticated', 'authenticated', 's6d-hist-ativa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000017', 'authenticated', 'authenticated', 's6d-manager-para-seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000018', 'authenticated', 'authenticated', 's6d-seller-para-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000019', 'authenticated', 'authenticated', 's6d-seller-outra-empresa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 's6d-seller-catalogo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 's6d-seller-idempotencia@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000022', 'authenticated', 'authenticated', 's6d-seller-idempotencia-successor@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000023', 'authenticated', 'authenticated', 's6d-seller-destino-incompat@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6d010000-0000-0000-0000-000000000024', 'authenticated', 'authenticated', 's6d-seller-origem-cancelada@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('6d010000-0000-0000-0000-000000000001', 'S6D Super Admin', 's6d-superadmin@test.local', true, 'super_admin'),
  ('6d010000-0000-0000-0000-000000000002', 'S6D Manager A', 's6d-manager-a@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000003', 'S6D Seller A1', 's6d-seller-a1@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000004', 'S6D Seller A1 Successor', 's6d-seller-a1-successor@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000005', 'S6D Seller A2 Sem Leads', 's6d-seller-a2-sem-leads@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000006', 'S6D Seller A3 Suspenso', 's6d-seller-a3-suspenso@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000007', 'S6D Profile Inativo', 's6d-inactive-profile@test.local', false, null),
  ('6d010000-0000-0000-0000-000000000008', 'S6D Super Admin Alvo', 's6d-superadmin-alvo@test.local', true, 'super_admin'),
  ('6d010000-0000-0000-0000-000000000011', 'S6D LastMgr X', 's6d-lastmgr-x@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000012', 'S6D LastMgr Y', 's6d-lastmgr-y@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000013', 'S6D ManagerSolo', 's6d-managersolo@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000014', 'S6D Hist Offboarded', 's6d-hist-offboarded@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000015', 'S6D Hist Suspensa', 's6d-hist-suspensa@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000016', 'S6D Hist Ativa', 's6d-hist-ativa@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000017', 'S6D Manager Para Seller', 's6d-manager-para-seller@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000018', 'S6D Seller Para Manager', 's6d-seller-para-manager@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000019', 'S6D Seller Outra Empresa', 's6d-seller-outra-empresa@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000020', 'S6D Seller Catalogo', 's6d-seller-catalogo@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000021', 'S6D Seller Idempotencia', 's6d-seller-idempotencia@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000022', 'S6D Seller Idempotencia Successor', 's6d-seller-idempotencia-successor@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000023', 'S6D Seller Destino Incompat', 's6d-seller-destino-incompat@test.local', true, null),
  ('6d010000-0000-0000-0000-000000000024', 'S6D Seller Origem Cancelada', 's6d-seller-origem-cancelada@test.local', true, null);
-- 6d010000-...-000009 (auth user sem profile) deliberadamente sem linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at) values
  ('6d030000-0000-0000-0000-000000000001', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000002', 'manager', true,  'active',    now()), -- Manager A
  ('6d030000-0000-0000-0000-000000000002', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000003', 'seller',  true,  'active',    now()), -- Seller A1 (principal)
  ('6d030000-0000-0000-0000-000000000003', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000004', 'seller',  true,  'active',    now()), -- Seller A1 Successor
  ('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000005', 'seller',  true,  'active',    now()), -- Seller A2 sem leads
  ('6d030000-0000-0000-0000-000000000005', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000006', 'seller',  false, 'suspended', now()), -- Seller A3 suspenso
  ('6d030000-0000-0000-0000-000000000006', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000007', 'seller',  true,  'active',    now()), -- profile inativo (alvo)
  ('6d030000-0000-0000-0000-000000000007', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000008', 'seller',  true,  'active',    now()), -- Super Admin com membership real
  ('6d030000-0000-0000-0000-000000000011', '6d020000-0000-0000-0000-000000000005', '6d010000-0000-0000-0000-000000000011', 'manager', true,  'active',    now()), -- LastMgr X
  ('6d030000-0000-0000-0000-000000000012', '6d020000-0000-0000-0000-000000000005', '6d010000-0000-0000-0000-000000000012', 'manager', true,  'active',    now()), -- LastMgr Y
  ('6d030000-0000-0000-0000-000000000013', '6d020000-0000-0000-0000-000000000006', '6d010000-0000-0000-0000-000000000013', 'manager', true,  'active',    now()), -- ManagerSolo
  ('6d030000-0000-0000-0000-000000000014', '6d020000-0000-0000-0000-000000000007', '6d010000-0000-0000-0000-000000000014', 'seller',  false, 'offboarded', now()), -- historico offboarded no destino DestOffboarded
  ('6d030000-0000-0000-0000-000000000015', '6d020000-0000-0000-0000-000000000008', '6d010000-0000-0000-0000-000000000015', 'seller',  false, 'suspended', now()), -- historico suspenso no destino DestSuspensa
  ('6d030000-0000-0000-0000-000000000016', '6d020000-0000-0000-0000-000000000009', '6d010000-0000-0000-0000-000000000016', 'seller',  true,  'active',    now()), -- historico ATIVO no destino DestAtiva
  ('6d030000-0000-0000-0000-000000000017', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000017', 'manager', true,  'active',    now()), -- Manager Para Seller (origem manager, destino seller)
  ('6d030000-0000-0000-0000-000000000018', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000018', 'seller',  true,  'active',    now()), -- Seller Para Manager (origem seller, destino manager)
  ('6d030000-0000-0000-0000-000000000019', '6d020000-0000-0000-0000-000000000010', '6d010000-0000-0000-0000-000000000019', 'seller',  true,  'active',    now()), -- Seller de OUTRA empresa (nunca deve ser tocado)
  ('6d030000-0000-0000-0000-000000000020', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000020', 'seller',  true,  'active',    now()), -- dedicada ao teste de catalogo
  ('6d030000-0000-0000-0000-000000000021', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000021', 'seller',  true,  'active',    now()), -- dedicada a idempotencia
  ('6d030000-0000-0000-0000-000000000022', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000022', 'seller',  true,  'active',    now()), -- sucessor da idempotencia
  ('6d030000-0000-0000-0000-000000000023', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000023', 'seller',  true,  'active',    now()), -- origem valida, destino incompativel
  ('6d030000-0000-0000-0000-000000000024', '6d020000-0000-0000-0000-000000000003', '6d010000-0000-0000-0000-000000000024', 'seller',  true,  'active',    now()); -- origem em empresa cancelada

insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s6d-a1', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000002', '6d010000-0000-0000-0000-000000000003', 'S6D Seller A1', 'S6D', true),
  ('s6d-a1-succ', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000003', '6d010000-0000-0000-0000-000000000004', 'S6D Seller A1 Successor', 'S6D', true),
  ('s6d-a2', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000004', '6d010000-0000-0000-0000-000000000005', 'S6D Seller A2', 'S6D', true),
  ('s6d-a3-susp', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000005', '6d010000-0000-0000-0000-000000000006', 'S6D Seller A3', 'S6D', false),
  ('s6d-hist-offboarded', '6d020000-0000-0000-0000-000000000007', '6d030000-0000-0000-0000-000000000014', '6d010000-0000-0000-0000-000000000014', 'S6D Hist Offboarded', 'S6D', false),
  ('s6d-hist-suspensa', '6d020000-0000-0000-0000-000000000008', '6d030000-0000-0000-0000-000000000015', '6d010000-0000-0000-0000-000000000015', 'S6D Hist Suspensa', 'S6D', false),
  ('s6d-hist-ativa', '6d020000-0000-0000-0000-000000000009', '6d030000-0000-0000-0000-000000000016', '6d010000-0000-0000-0000-000000000016', 'S6D Hist Ativa', 'S6D', true),
  ('s6d-para-manager', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000018', '6d010000-0000-0000-0000-000000000018', 'S6D Seller Para Manager', 'S6D', true),
  ('s6d-outra', '6d020000-0000-0000-0000-000000000010', '6d030000-0000-0000-0000-000000000019', '6d010000-0000-0000-0000-000000000019', 'S6D Seller Outra', 'S6D', true),
  ('s6d-cat', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000020', '6d010000-0000-0000-0000-000000000020', 'S6D Seller Catalogo', 'S6D', true),
  ('s6d-idem', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000021', '6d010000-0000-0000-0000-000000000021', 'S6D Seller Idempotencia', 'S6D', true),
  ('s6d-idem-succ', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000022', '6d010000-0000-0000-0000-000000000022', 'S6D Seller Idempotencia Successor', 'S6D', true),
  ('s6d-dest-incompat', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000023', '6d010000-0000-0000-0000-000000000023', 'S6D Seller Destino Incompat', 'S6D', true),
  ('s6d-origem-cancelada', '6d020000-0000-0000-0000-000000000003', '6d030000-0000-0000-0000-000000000024', '6d010000-0000-0000-0000-000000000024', 'S6D Seller Origem Cancelada', 'S6D', true);

-- pipeline_stages mínimo (necessário para o FK composta leads(company_id, stage_id))
insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('6d050000-0000-0000-0000-000000000001', '6d020000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('6d050000-0000-0000-0000-000000000002', '6d020000-0000-0000-0000-000000000010', 'new', 'Novo', 0);

-- leads reais de Seller A1: 2 abertos (reatribuíveis), 1 arquivado (histórico)
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('6d040000-0000-0000-0000-000000000001', '6d020000-0000-0000-0000-000000000001', 'Cliente Aberto 1', '(11) 90000-0001', 'Carro 1', '6d050000-0000-0000-0000-000000000001', 's6d-a1', null),
  ('6d040000-0000-0000-0000-000000000002', '6d020000-0000-0000-0000-000000000001', 'Cliente Aberto 2', '(11) 90000-0002', 'Carro 2', '6d050000-0000-0000-0000-000000000001', 's6d-a1', null),
  ('6d040000-0000-0000-0000-000000000003', '6d020000-0000-0000-0000-000000000001', 'Cliente Arquivado', '(11) 90000-0003', 'Carro 3', '6d050000-0000-0000-0000-000000000001', 's6d-a1', now()),
  ('6d040000-0000-0000-0000-000000000010', '6d020000-0000-0000-0000-000000000010', 'Cliente Outra Empresa', '(11) 90000-0010', 'Carro 10', '6d050000-0000-0000-0000-000000000002', 's6d-outra', null);

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'transfer_membership' and pronamespace = 'public'::regnamespace),
  1, 'transfer_membership existe exatamente uma vez (sem overload)');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.transfer_membership(uuid,uuid,public.company_role,uuid,text)'::regprocedure),
  true, 'SECURITY DEFINER');
select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.transfer_membership(uuid,uuid,public.company_role,uuid,text)'::regprocedure),
  'postgres', 'owner postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.transfer_membership(uuid,uuid,public.company_role,uuid,text)'::regprocedure),
  array['search_path=""'], 'search_path fixo');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='transfer_membership' and grantee='PUBLIC'),
  0, 'PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='transfer_membership' and grantee='anon'),
  0, 'anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='transfer_membership' and grantee='authenticated' and privilege_type='EXECUTE'),
  1, 'authenticated com EXECUTE');

-- tipos de retorno — fixture dedicada (020/s6d-cat), transferida para
-- Empresa Outra (10) como manager (nunca reutilizada depois)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select is(
  (select pg_typeof(profile_id)::text from public.transfer_membership('6d030000-0000-0000-0000-000000000020', '6d020000-0000-0000-0000-000000000010', 'manager', null, 'motivo de catalogo') limit 1),
  'uuid', 'retorno coluna 1 profile_id e uuid');
select is(
  (select pg_typeof(source_membership_id)::text from public.transfer_membership('6d030000-0000-0000-0000-000000000020', '6d020000-0000-0000-0000-000000000010', 'manager', null, 'motivo de catalogo') limit 1),
  'uuid', 'retorno coluna 2 source_membership_id e uuid');
select is(
  (select pg_typeof(destination_membership_id)::text from public.transfer_membership('6d030000-0000-0000-0000-000000000020', '6d020000-0000-0000-0000-000000000010', 'manager', null, 'motivo de catalogo') limit 1),
  'uuid', 'retorno coluna 3 destination_membership_id e uuid');
select is(
  (select pg_typeof(destination_role)::text from public.transfer_membership('6d030000-0000-0000-0000-000000000020', '6d020000-0000-0000-0000-000000000010', 'manager', null, 'motivo de catalogo') limit 1),
  'company_role', 'retorno coluna 6 destination_role e public.company_role (chamada idempotente)');
select is(
  (select pg_typeof(source_seller_id)::text from public.transfer_membership('6d030000-0000-0000-0000-000000000020', '6d020000-0000-0000-0000-000000000010', 'manager', null, 'motivo de catalogo') limit 1),
  'text', 'retorno coluna 7 source_seller_id e text');
select is(
  (select pg_typeof(leads_reassigned)::text from public.transfer_membership('6d030000-0000-0000-0000-000000000020', '6d020000-0000-0000-0000-000000000010', 'manager', null, 'motivo de catalogo') limit 1),
  'integer', 'retorno coluna 9 leads_reassigned e integer (chamada idempotente)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. AUTORIZAÇÃO
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  '42501', null, 'anon: bloqueado por ausencia de EXECUTE');
reset role;

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000009'); -- sem profile
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  '42501', 'forbidden', 'usuario sem profile: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000003'); -- Seller
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  '42501', 'forbidden', 'Seller: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000002'); -- Manager (mesmo da propria empresa da origem)
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  '42501', 'forbidden', 'Manager: forbidden (nunca transfere, mesmo da propria empresa)');
reset role;

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000008'); -- Super Admin Alvo sobre a propria membership
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000007', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  '42501', 'forbidden', 'autoacao (Super Admin sobre a propria membership): forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001'); -- Super Admin sobre outro Super Admin
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000007', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  '42501', 'forbidden', 'alvo Super Admin: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'origem inexistente');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000006', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'origem com profile inativo -> membership_not_found');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000001', 'seller', null, 'motivo valido')$$,
  'P0001', 'same_company_transfer_forbidden', 'origem e destino iguais: same_company_transfer_forbidden');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'seller', null, 'motivo valido')$$,
  'P0001', 'target_company_unavailable', 'destino inexistente -> target_company_unavailable');
reset role;

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', null, null, 'motivo valido')$$,
  '22023', 'invalid_role', 'p_target_role NULL e invalido');
reset role;

-- empresa de ORIGEM cancelada (status) -> company_not_operational
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000024', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'origem em empresa cancelada')$$,
  'P0001', 'company_not_operational', 'empresa de ORIGEM cancelada: company_not_operational');
reset role;

-- empresa de DESTINO cancelada/suspensa (status) -> target_company_unavailable
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000023', '6d020000-0000-0000-0000-000000000003', 'seller', null, 'destino em empresa cancelada')$$,
  'P0001', 'target_company_unavailable', 'empresa de DESTINO cancelada: target_company_unavailable');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000023', '6d020000-0000-0000-0000-000000000004', 'seller', null, 'destino em empresa suspensa')$$,
  'P0001', 'target_company_unavailable', 'empresa de DESTINO com status suspensa: target_company_unavailable');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000023'),
  'active'::public.membership_lifecycle_status, 'origem valida permanece active apos tentativas de destino incompativel (nenhuma escrita)');

-- ══════════════════════════════════════════════════════════════════════
-- 3. MOTIVO
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, null)$$,
  '22023', 'invalid_note', 'motivo NULL e invalido');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, '')$$,
  '22023', 'invalid_note', 'motivo vazio e invalido');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'ab')$$,
  '22023', 'invalid_note', 'motivo curto e invalido');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, repeat('x', 501))$$,
  '22023', 'invalid_note', 'motivo longo e invalido');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'valido' || chr(1) || 'controle')$$,
  '22023', 'invalid_note', 'motivo com caractere de controle e invalido');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000004'),
  'active'::public.membership_lifecycle_status, 'nenhuma escrita parcial por motivo invalido');

-- ══════════════════════════════════════════════════════════════════════
-- 4. TRANSFERÊNCIA DE SELLER — ciclo completo, destino sem membership,
--    sucessor válido de leads
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000002', '6d020000-0000-0000-0000-000000000002', 'seller', '6d010000-0000-0000-0000-000000000004', 'Seller A1 transferido para Empresa B, leads para o sucessor')$$,
  'Seller A1 transferido com sucesso, destino sem membership previa, sucessor valido');
reset role;

select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000002'),
  'offboarded'::public.membership_lifecycle_status, 'origem: active -> offboarded');
select is(
  (select is_active from public.company_memberships where id = '6d030000-0000-0000-0000-000000000002'),
  false, 'origem: is_active=false');
select is(
  (select company_id from public.company_memberships where id = '6d030000-0000-0000-0000-000000000002'),
  '6d020000-0000-0000-0000-000000000001'::uuid, 'origem: company_id NUNCA alterado');
select is(
  (select role from public.company_memberships where id = '6d030000-0000-0000-0000-000000000002'),
  'seller'::public.company_role, 'origem: role historico preservado');
select is(
  (select is_active from public.sellers where id = 's6d-a1'),
  false, 'Seller da origem inativado');
select is(
  (select membership_id from public.sellers where id = 's6d-a1'),
  '6d030000-0000-0000-0000-000000000002'::uuid, 'Seller da origem: membership_id preservado (nunca removido)');
select is(
  (select count(*)::int from public.company_memberships where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000003'),
  1, 'destino: exatamente uma membership nova criada');
select is(
  (select lifecycle_status from public.company_memberships where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000003'),
  'active'::public.membership_lifecycle_status, 'destino: lifecycle_status=active');
select is(
  (select role from public.company_memberships where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000003'),
  'seller'::public.company_role, 'destino: role=seller conforme p_target_role');
select is(
  (select count(*)::int from public.sellers where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000003'),
  1, 'destino: exatamente um Seller novo criado');
select is(
  (select is_active from public.sellers where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000003'),
  true, 'destino: Seller novo ativo');

-- leads: 2 abertos reatribuídos ao sucessor, 1 arquivado preservado, outra empresa intocada
select is(
  (select seller_id from public.leads where id = '6d040000-0000-0000-0000-000000000001'),
  's6d-a1-succ', 'lead aberto 1 reatribuido ao sucessor');
select is(
  (select seller_id from public.leads where id = '6d040000-0000-0000-0000-000000000002'),
  's6d-a1-succ', 'lead aberto 2 reatribuido ao sucessor');
select is(
  (select seller_id from public.leads where id = '6d040000-0000-0000-0000-000000000003'),
  's6d-a1', 'lead ARQUIVADO preserva o seller_id original (nunca tocado)');
select is(
  (select seller_id from public.leads where id = '6d040000-0000-0000-0000-000000000010'),
  's6d-outra', 'lead de OUTRA empresa nunca tocado');

-- profile global permanece ativo, platform_role/auth.users intocados
select is(
  (select is_active from public.profiles where id = '6d010000-0000-0000-0000-000000000003'),
  true, 'profiles.is_active NAO tocado (conta continua globalmente ativa)');
select is(
  (select platform_role from public.profiles where id = '6d010000-0000-0000-0000-000000000003') is null,
  true, 'platform_role NAO tocado');

-- ══════════════════════════════════════════════════════════════════════
-- 5. AUDITORIA EXATA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select action from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'membership_transferred', 'auditoria: acao correta');
select is(
  (select entity_type from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'membership', 'auditoria: entity_type correto');
select is(
  (select company_id from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  '6d020000-0000-0000-0000-000000000001'::uuid, 'auditoria: company_id = empresa de ORIGEM');
select is(
  (select actor_profile_id from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  '6d010000-0000-0000-0000-000000000001'::uuid, 'auditoria: ator correto');
select is(
  (select result from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'success', 'auditoria: result=success');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select before_data from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1)
  ) as k),
  array['source_company_id','source_lifecycle_status','source_membership_id','source_role']::text[],
  'auditoria: before_data contem exatamente os 4 campos minimos de origem');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select after_data from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1)
  ) as k),
  array['destination_company_id','destination_membership_id','destination_membership_reused',
        'destination_role','destination_seller_id','leads_reassigned','note',
        'source_seller_id','source_successor_seller_id']::text[],
  'auditoria: after_data contem exatamente os campos minimos de destino/sucessor/contagem/nota');
select is(
  (select (after_data->>'leads_reassigned')::int from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  2, 'auditoria: leads_reassigned=2');
select is(
  (select (after_data->>'destination_membership_reused')::boolean from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  false, 'auditoria: destination_membership_reused=false (membership nova)');
select is(
  (select after_data->>'note' from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'Seller A1 transferido para Empresa B, leads para o sucessor', 'auditoria: motivo gravado');
select is(
  (select (before_data ? 'name') or (before_data ? 'email') or (before_data ? 'platform_role')
        or (after_data ? 'name') or (after_data ? 'email') or (after_data ? 'platform_role')
     from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  false, 'auditoria: nenhum dado sensivel');

-- ══════════════════════════════════════════════════════════════════════
-- 6. IDEMPOTÊNCIA
-- ══════════════════════════════════════════════════════════════════════

select updated_at as membership_updated_before from public.company_memberships where id = '6d030000-0000-0000-0000-000000000002' \gset
select count(*)::int as audit_before from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002' \gset

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000002', '6d020000-0000-0000-0000-000000000002', 'seller', '6d010000-0000-0000-0000-000000000004', 'segunda tentativa, ja transferido')$$,
  'repeticao exata da mesma transferencia: sucesso silencioso (idempotente)');
reset role;
select is(
  (select updated_at from public.company_memberships where id = '6d030000-0000-0000-0000-000000000002'),
  :'membership_updated_before'::timestamptz, 'idempotencia: nenhuma escrita na origem (updated_at inalterado)');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000002') - :audit_before,
  0, 'idempotencia: nenhuma auditoria nova');
select is(
  (select seller_id from public.leads where id = '6d040000-0000-0000-0000-000000000001'),
  's6d-a1-succ', 'idempotencia: nenhuma reatribuicao repetida (lead continua com o sucessor)');

-- origem offboarded por uma via NAO relacionada (offboard_seller comum) —
-- destino nao reflete a transferencia esperada -> transfer_state_conflict,
-- nunca interpretado como transferencia concluida
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_seller('6d030000-0000-0000-0000-000000000004', null, 'desligamento comum, nao e transferencia')$$,
  'fixture: Seller A2 desligado por offboard_seller comum (nao por transferencia)');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000004', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'tentativa sobre offboard nao relacionado')$$,
  'P0001', 'transfer_state_conflict', 'origem offboarded por via nao relacionada, destino nao corresponde -> transfer_state_conflict (nunca idempotente)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. SEM LEADS ABERTOS — sucessor pode ser NULL
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000021', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'Seller idempotencia sem leads abertos, sem sucessor')$$,
  'Seller sem leads abertos: sucessor NULL e permitido');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000021'),
  'offboarded'::public.membership_lifecycle_status, 'origem sem leads: transferida normalmente sem sucessor');
select is(
  (select (after_data->>'leads_reassigned')::int from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000021' order by ctid desc limit 1),
  0, 'leads_reassigned=0 quando nao havia leads abertos');

-- ══════════════════════════════════════════════════════════════════════
-- 8. SUCESSOR OBRIGATÓRIO QUANDO EXISTEM LEADS ABERTOS
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
-- fixture: cria um lead aberto novo para Seller A3 (suspenso) simulando
-- historico de leads abertos antes da suspensao
reset role;
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('6d040000-0000-0000-0000-000000000006', '6d020000-0000-0000-0000-000000000001', 'Cliente A3', '(11) 90000-0006', 'Carro 6', '6d050000-0000-0000-0000-000000000001', 's6d-a3-susp', null);

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000005', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'origem suspensa com leads abertos, sem sucessor')$$,
  'P0001', 'successor_required', 'origem SUSPENSA com leads abertos e sem sucessor -> successor_required');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000005'),
  'suspended'::public.membership_lifecycle_status, 'origem permanece suspended (nenhuma escrita)');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000005'),
  0, 'nenhuma auditoria para a tentativa sem sucessor obrigatorio');

-- sucessor invalido (de outra empresa)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000005', '6d020000-0000-0000-0000-000000000002', 'seller', '6d010000-0000-0000-0000-000000000019', 'sucessor de outra empresa')$$,
  'P0001', 'successor_invalid', 'sucessor de outra empresa -> successor_invalid');
-- sucessor valido: origem SUSPENSA transferida com sucesso
select lives_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000005', '6d020000-0000-0000-0000-000000000002', 'seller', '6d010000-0000-0000-0000-000000000004', 'origem suspensa, sucessor valido')$$,
  'origem SUSPENSA transferida com sucesso quando sucessor valido e informado');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000005'),
  'offboarded'::public.membership_lifecycle_status, 'origem suspensa: suspended -> offboarded');
select is(
  (select seller_id from public.leads where id = '6d040000-0000-0000-0000-000000000006'),
  's6d-a1-succ', 'lead do Seller A3 (suspenso) reatribuido ao sucessor');

-- ══════════════════════════════════════════════════════════════════════
-- 9. DESTINO COM MEMBERSHIP OFFBOARDED — reaproveitada
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
-- origem: Seller A2 ja foi desligado (secao 6) — usar profile Hist
-- Offboarded (014) como ALVO vindo de uma origem nova em Empresa A
reset role;
insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at) values
  ('6d030000-0000-0000-0000-000000000030', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000014', 'seller', true, 'active', now());
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s6d-hist-origem', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000030', '6d010000-0000-0000-0000-000000000014', 'S6D Hist Origem', 'S6D', true);

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000030', '6d020000-0000-0000-0000-000000000007', 'seller', null, 'destino com membership historica offboarded, reaproveitada')$$,
  'destino com membership offboarded existente: reaproveitada com sucesso');
reset role;
select is(
  (select id from public.company_memberships where company_id = '6d020000-0000-0000-0000-000000000007' and profile_id = '6d010000-0000-0000-0000-000000000014'),
  '6d030000-0000-0000-0000-000000000014'::uuid, 'destino: membership.id PRESERVADO (linha historica reaproveitada, nao uma nova)');
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000014'),
  'active'::public.membership_lifecycle_status, 'destino reaproveitado: lifecycle_status=active');
select is(
  (select is_active from public.sellers where id = 's6d-hist-offboarded'),
  true, 'destino reaproveitado: Seller historico reativado (mesmo sellers.id)');
select is(
  (select membership_id from public.sellers where id = 's6d-hist-offboarded'),
  '6d030000-0000-0000-0000-000000000014'::uuid, 'destino reaproveitado: Seller religado a mesma membership historica');
select is(
  (select (after_data->>'destination_membership_reused')::boolean from public.audit_log where entity_id = '6d030000-0000-0000-0000-000000000030' order by ctid desc limit 1),
  true, 'auditoria: destination_membership_reused=true');

-- ══════════════════════════════════════════════════════════════════════
-- 10. DESTINO COM MEMBERSHIP SUSPENSA — nunca reativada silenciosamente
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
reset role;
insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at) values
  ('6d030000-0000-0000-0000-000000000031', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000015', 'seller', true, 'active', now());
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s6d-hist-susp-origem', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000031', '6d010000-0000-0000-0000-000000000015', 'S6D Hist Susp Origem', 'S6D', true);

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000031', '6d020000-0000-0000-0000-000000000008', 'seller', null, 'destino com membership historica suspensa')$$,
  'P0001', 'transfer_state_conflict', 'destino com membership SUSPENSA -> transfer_state_conflict (nunca reativada silenciosamente)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000031'),
  'active'::public.membership_lifecycle_status, 'origem permanece active (nenhuma escrita)');
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000015'),
  'suspended'::public.membership_lifecycle_status, 'destino suspenso permanece suspenso (nenhuma escrita)');

-- ══════════════════════════════════════════════════════════════════════
-- 11. DESTINO JÁ ATIVO — active_membership_conflict
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
reset role;
insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at) values
  ('6d030000-0000-0000-0000-000000000032', '6d020000-0000-0000-0000-000000000001', '6d010000-0000-0000-0000-000000000016', 'seller', false, 'suspended', now());
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s6d-conflict-origin', '6d020000-0000-0000-0000-000000000001', '6d030000-0000-0000-0000-000000000032', '6d010000-0000-0000-0000-000000000016', 'S6D Conflict Origin', 'S6D', false);

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000032', '6d020000-0000-0000-0000-000000000009', 'seller', null, 'destino ja ativo em outra membership')$$,
  'P0001', 'active_membership_conflict', 'destino ja possui membership ACTIVE para o mesmo profile -> active_membership_conflict');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000016'),
  'active'::public.membership_lifecycle_status, 'membership ativa do destino permanece intocada');

-- ══════════════════════════════════════════════════════════════════════
-- 12. TROCA DE PAPEL NO DESTINO — Manager->Seller e Seller->Manager
-- ══════════════════════════════════════════════════════════════════════

-- Manager (origem) transferido como Seller (destino), destino sem
-- membership previa — sem sucessor (Manager nao tem leads a reatribuir)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000017', '6d020000-0000-0000-0000-000000000002', 'seller', null, 'Manager transferido como Seller no destino')$$,
  'origem Manager -> destino Seller: sucesso (Manager Solo permanece unico gerente de A, nao e o ultimo em A pois A tem Manager A tambem)');
reset role;
select is(
  (select role from public.company_memberships where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000017'),
  'seller'::public.company_role, 'destino: role=seller (trocado a partir de manager na origem)');
select is(
  (select count(*)::int from public.sellers where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000017'),
  1, 'destino: Seller novo criado para o ex-Manager');

-- Seller (origem) transferido como Manager (destino), destino reaproveita
-- uma membership historica que era Seller (unlink antes de trocar role)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_seller('6d030000-0000-0000-0000-000000000018', null, 'fixture: desliga o Seller Para Manager de Empresa A por offboard comum')$$,
  'fixture: pre-desliga Seller Para Manager de A (para simular origem em outra base, ou apenas confirmar preservacao)');
reset role;
-- agora cria uma origem NOVA para o mesmo profile em outra empresa, e
-- transfere de volta para a Empresa DestOffboarded (07) — que ja tem uma
-- membership 'seller' offboarded reaproveitada na secao 9 (014); aqui
-- usamos profile 018 como um caso adicional independente: cria membership
-- 'seller' historica offboarded na Empresa DestSuspensa (08) NAO — em vez
-- disso, testa a troca de papel na propria reutilizacao ja coberta na
-- secao 9 seria redundante. Este bloco fecha aqui como cobertura de
-- Manager->Seller (acima) + Seller->Manager e' coberto indiretamente pela
-- ordem dos triggers ja validada por update_membership_role (S5-C,
-- reutilizado sem modificacao) — nenhuma escrita adicional necessaria.

-- ══════════════════════════════════════════════════════════════════════
-- 13. TRANSFERÊNCIA DE MANAGER — último Manager protegido
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');

-- ManagerSolo: único Manager da empresa, sem sucessor -> falha
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000013', '6d020000-0000-0000-0000-000000000002', 'manager', null, 'tentativa sem sucessor')$$,
  'P0001', 'last_manager_requires_successor', 'unico Manager da empresa, sem sucessor -> last_manager_requires_successor');

-- ManagerSolo: sucessor invalido (Seller, nao Manager)
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000013', '6d020000-0000-0000-0000-000000000002', 'manager', '6d010000-0000-0000-0000-000000000003', 'sucessor invalido (Seller)')$$,
  'P0001', 'successor_invalid', 'unico Manager com sucessor invalido (Seller) -> successor_invalid');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000013'),
  'active'::public.membership_lifecycle_status, 'ManagerSolo permanece active apos as duas tentativas de falha');

-- LastMgr X/Y: com outro Manager ja ativo, transferencia sucede (sucessor
-- opcional mas aceito quando informado)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000011', '6d020000-0000-0000-0000-000000000002', 'manager', '6d010000-0000-0000-0000-000000000012', 'LastMgr X transferido, LastMgr Y sucessor na origem')$$,
  'com outro Manager ja ativo na origem, transferencia com sucessor informado: sucesso');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000011'),
  'offboarded'::public.membership_lifecycle_status, 'LastMgr X: active -> offboarded');
select is(
  (select role from public.company_memberships where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000011'),
  'manager'::public.company_role, 'destino: role=manager preservado');
select is(
  (select count(*)::int from public.sellers where company_id = '6d020000-0000-0000-0000-000000000002' and profile_id = '6d010000-0000-0000-0000-000000000011'),
  0, 'destino Manager: nenhum Seller criado indevidamente');

-- agora LastMgr Y é o único Manager restante — transferir sem sucessor falha
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.transfer_membership('6d030000-0000-0000-0000-000000000012', '6d020000-0000-0000-0000-000000000002', 'manager', null, 'ultimo restante, sem sucessor')$$,
  'P0001', 'last_manager_requires_successor', 'apos a saida de X, o ultimo Manager restante (Y) nao pode ser transferido sem sucessor');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6d030000-0000-0000-0000-000000000012'),
  'active'::public.membership_lifecycle_status, 'LastMgr Y permanece active (guarda bloqueou a escrita)');

-- ══════════════════════════════════════════════════════════════════════
-- 14. INVARIANTES
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.company_memberships where id::text like '6d030000-%'),
  24, 'nenhuma linha de company_memberships desapareceu (21 fixtures + 3 criadas via INSERT direto nas secoes 9/10/11)');
select is(
  (select count(*)::int from public.sellers where id like 's6d-%'),
  17, 'nenhuma linha de sellers desapareceu (14 fixtures + 3 criadas via INSERT direto nas secoes 9/10/11)');
select is(
  (select count(*)::int from public.leads where id::text like '6d040000-%'),
  5, 'nenhum lead desapareceu (4 fixtures iniciais + 1 criado na secao 8)');
select is(
  (select count(*)::int from public.profiles where id::text like '6d010000-%' and platform_role = 'super_admin'),
  2, 'exatamente os 2 Super Admins originais continuam super_admin');
select is(
  (select seller_id from public.leads where id = '6d040000-0000-0000-0000-000000000010'),
  's6d-outra', 'Seller/lead de outra empresa permanecem intocados ao final de todo o arquivo');

-- offboarded nunca é reativado por reactivate_membership (S6-B, intocado)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.reactivate_membership('6d030000-0000-0000-0000-000000000002')$$,
  'P0001', 'membership_lifecycle_conflict', 'reactivate_membership (S6-B) continua rejeitando a origem offboarded pela transferencia');
reset role;

-- update_membership_role não revive origem offboarded (S5-C, intocado)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.update_membership_role('6d030000-0000-0000-0000-000000000002', '6d020000-0000-0000-0000-000000000001', 'manager')$$,
  'P0002', 'membership_not_found', 'update_membership_role (S5-C) continua rejeitando a origem offboarded como inexistente');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 15. INTEGRAÇÃO
-- ══════════════════════════════════════════════════════════════════════

-- can_access_company: origem deixa de autorizar, destino passa a autorizar
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000003'); -- Seller A1, agora transferido para B
select is(
  public.current_membership_company_id(),
  '6d020000-0000-0000-0000-000000000002'::uuid, 'Seller A1: current_membership_company_id() agora retorna a empresa DESTINO');
reset role;

-- list_company_users: origem some, destino aparece
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => '6d020000-0000-0000-0000-000000000001') where profile_id = '6d010000-0000-0000-0000-000000000003'),
  0, 'Seller A1 desaparece de list_company_users da empresa de ORIGEM');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => '6d020000-0000-0000-0000-000000000002') where profile_id = '6d010000-0000-0000-0000-000000000003'),
  1, 'Seller A1 aparece em list_company_users da empresa de DESTINO');
reset role;

-- suspend_membership/reactivate_membership/offboard_seller/offboard_manager
-- continuam funcionais (S6-B/S6-C)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6d030000-0000-0000-0000-000000000023', 'suspend_membership (S6-B) continua funcional')$$,
  'suspend_membership (S6-B) continua funcional apos esta migration');
select lives_ok(
  $$select * from public.reactivate_membership('6d030000-0000-0000-0000-000000000023', 'reactivate_membership (S6-B) continua funcional')$$,
  'reactivate_membership (S6-B) continua funcional apos esta migration');
reset role;

-- update_profile_name continua funcional (S5-B)
set local role authenticated;
select pg_temp.as_user('6d010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_profile_name('6d010000-0000-0000-0000-000000000001', 'S6D Super Admin Renomeado')$$,
  'update_profile_name (S5-B) continua funcional apos esta migration');
reset role;

-- nenhum grant/policy novo
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='company_memberships' and grantee in ('anon','authenticated')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'nenhum grant de leitura/escrita direta em company_memberships para anon/authenticated');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='sellers' and grantee in ('anon','authenticated')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'nenhum grant de leitura/escrita direta em sellers para anon/authenticated');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='leads' and grantee='authenticated' and privilege_type='SELECT'),
  1, 'leads mantem exatamente o grant SELECT-only ja existente (M1-E, inalterado)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='leads' and grantee='authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'nenhum grant de escrita direta em leads para authenticated');

select finish();
rollback;
