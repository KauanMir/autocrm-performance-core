-- M1-F S6-C — desligamento empresarial (offboard_seller/offboard_manager,
-- 20260728100000_m1f_s6c_membership_offboarding.sql). Cobre schema/
-- catálogo, autorização por ator, transições de lifecycle, motivo
-- obrigatório, sucessor (seller e manager), reatribuição de leads,
-- último Manager, idempotência, inconsistências, auditoria exata,
-- invariantes (nenhum DELETE, profiles.is_active/platform_role/
-- auth.users intocados) e integração com o restante do S6. Fixtures
-- sintéticas @test.local, transação com rollback.
--
-- ATUALIZADO (M1-F S6-E2, 20260728130000_...): offboard_seller trocou
-- p_successor_seller_id (text, sellers.id) por p_successor_membership_id
-- (uuid, company_memberships.id) — decisão humana explícita, motivada pela
-- ausência de fonte remota segura de sellers.id para o frontend (auditoria
-- da etapa pausada S6-F). Toda chamada de offboard_seller neste arquivo que
-- antes passava um seller_id text literal ('s6c-a1' etc.) agora passa o
-- membership_id uuid correspondente. Sucessor também deixou de ser SEMPRE
-- opcional: quando o alvo tem leads abertos, sucessor NULL agora levanta
-- successor_required (novidade coberta na seção 5B). offboard_manager não
-- muda.
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
  ('6c020000-0000-0000-0000-000000000001', 'S6C Empresa A', 'ativa'),
  ('6c020000-0000-0000-0000-000000000002', 'S6C Empresa B', 'ativa'),
  ('6c020000-0000-0000-0000-000000000003', 'S6C Empresa Cancelada', 'cancelada'),
  ('6c020000-0000-0000-0000-000000000004', 'S6C Empresa Suspensa', 'suspensa'),
  ('6c020000-0000-0000-0000-000000000005', 'S6C Empresa Last Manager', 'ativa'),
  ('6c020000-0000-0000-0000-000000000006', 'S6C Empresa Manager Solo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's6c-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's6c-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's6c-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's6c-seller-a2-noseller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's6c-seller-a3-successor@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's6c-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's6c-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's6c-seller-b1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's6c-manager-inactive-actor@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 's6c-superadmin-alvo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 's6c-seller-suspenso@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000015', 'authenticated', 'authenticated', 's6c-lastmgr-x@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000016', 'authenticated', 'authenticated', 's6c-lastmgr-y@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000017', 'authenticated', 'authenticated', 's6c-seller-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 's6c-manager-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 's6c-sem-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000022', 'authenticated', 'authenticated', 's6c-seller-catalogo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000024', 'authenticated', 'authenticated', 's6c-seller-successor-suspenso@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000031', 'authenticated', 'authenticated', 's6c-manager-solo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000032', 'authenticated', 'authenticated', 's6c-seller-empresa-cancelada@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000033', 'authenticated', 'authenticated', 's6c-superadmin-alvo-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '6c010000-0000-0000-0000-000000000034', 'authenticated', 'authenticated', 's6c-seller-a4-com-lead@test.local', now(), now(), now());

insert into public.profiles (id, name, email, role, is_active, platform_role) values
  ('6c010000-0000-0000-0000-000000000001', 'S6C Super Admin', 's6c-superadmin@test.local', 'seller', true, 'super_admin'),
  ('6c010000-0000-0000-0000-000000000002', 'S6C Manager A', 's6c-manager-a@test.local', 'manager', true, null),
  ('6c010000-0000-0000-0000-000000000003', 'S6C Seller A1', 's6c-seller-a1@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000004', 'S6C Seller A2 Sem Seller', 's6c-seller-a2-noseller@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000005', 'S6C Seller A3 Successor', 's6c-seller-a3-successor@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000006', 'S6C Profile Inativo', 's6c-inactive-profile@test.local', 'seller', false, null),
  ('6c010000-0000-0000-0000-000000000007', 'S6C Manager B', 's6c-manager-b@test.local', 'manager', true, null),
  ('6c010000-0000-0000-0000-000000000008', 'S6C Seller B1', 's6c-seller-b1@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000009', 'S6C Manager Ator Inativo', 's6c-manager-inactive-actor@test.local', 'manager', false, null),
  ('6c010000-0000-0000-0000-000000000010', 'S6C Super Admin Alvo', 's6c-superadmin-alvo@test.local', 'seller', true, 'super_admin'),
  ('6c010000-0000-0000-0000-000000000013', 'S6C Seller Suspenso', 's6c-seller-suspenso@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000015', 'S6C LastMgr X', 's6c-lastmgr-x@test.local', 'manager', true, null),
  ('6c010000-0000-0000-0000-000000000016', 'S6C LastMgr Y', 's6c-lastmgr-y@test.local', 'manager', true, null),
  ('6c010000-0000-0000-0000-000000000017', 'S6C Seller Offboarded', 's6c-seller-offboarded@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000020', 'S6C Manager A2', 's6c-manager-a2@test.local', 'manager', true, null),
  ('6c010000-0000-0000-0000-000000000022', 'S6C Seller Catalogo', 's6c-seller-catalogo@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000024', 'S6C Seller Successor Suspenso', 's6c-seller-successor-suspenso@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000031', 'S6C Manager Solo', 's6c-manager-solo@test.local', 'manager', true, null),
  ('6c010000-0000-0000-0000-000000000032', 'S6C Seller Empresa Cancelada', 's6c-seller-empresa-cancelada@test.local', 'seller', true, null),
  ('6c010000-0000-0000-0000-000000000033', 'S6C Super Admin Alvo Manager', 's6c-superadmin-alvo-manager@test.local', 'seller', true, 'super_admin'),
  ('6c010000-0000-0000-0000-000000000034', 'S6C Seller A4 Com Lead', 's6c-seller-a4-com-lead@test.local', 'seller', true, null);
-- 6c010000-...-000021 (auth user sem profile) deliberadamente sem linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status, created_at) values
  ('6c030000-0000-0000-0000-000000000001', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000002', 'manager', true,  'active',    now()),
  ('6c030000-0000-0000-0000-000000000002', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000003', 'seller',  true,  'active',    now()), -- Seller A1, ciclo principal (com sellers row + leads)
  ('6c030000-0000-0000-0000-000000000003', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000004', 'seller',  true,  'active',    now()), -- Seller A2, SEM sellers row (seller_ausente / motivo)
  ('6c030000-0000-0000-0000-000000000004', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000005', 'seller',  true,  'active',    now()), -- Seller A3, sucessor valido
  ('6c030000-0000-0000-0000-000000000005', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000006', 'seller',  true,  'active',    now()), -- profile inativo (alvo)
  ('6c030000-0000-0000-0000-000000000006', '6c020000-0000-0000-0000-000000000002', '6c010000-0000-0000-0000-000000000007', 'manager', true,  'active',    now()), -- Manager B (empresa B)
  ('6c030000-0000-0000-0000-000000000007', '6c020000-0000-0000-0000-000000000002', '6c010000-0000-0000-0000-000000000008', 'seller',  true,  'active',    now()), -- Seller B1 (empresa B, com sellers row)
  ('6c030000-0000-0000-0000-000000000008', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000009', 'manager', true,  'active',    now()), -- Manager com profile inativo (ator inativo)
  ('6c030000-0000-0000-0000-000000000009', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000010', 'seller',  true,  'active',    now()), -- Super Admin com membership real (alvo proibido / autoacao)
  ('6c030000-0000-0000-0000-000000000013', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000013', 'seller',  false, 'suspended', now()), -- Seller Suspenso (suspended -> offboarded)
  ('6c030000-0000-0000-0000-000000000015', '6c020000-0000-0000-0000-000000000005', '6c010000-0000-0000-0000-000000000015', 'manager', true,  'active',    now()), -- LastMgr X
  ('6c030000-0000-0000-0000-000000000016', '6c020000-0000-0000-0000-000000000005', '6c010000-0000-0000-0000-000000000016', 'manager', true,  'active',    now()), -- LastMgr Y
  ('6c030000-0000-0000-0000-000000000017', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000017', 'seller',  false, 'offboarded', now()), -- ja desligado (fixture direta)
  ('6c030000-0000-0000-0000-000000000020', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000020', 'manager', true,  'active',    now()), -- Manager A2 (segundo manager da empresa A)
  ('6c030000-0000-0000-0000-000000000022', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000022', 'seller',  true,  'active',    now()), -- dedicada ao teste de catalogo
  ('6c030000-0000-0000-0000-000000000024', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000024', 'seller',  false, 'suspended', now()), -- sucessor suspenso (invalido)
  ('6c030000-0000-0000-0000-000000000031', '6c020000-0000-0000-0000-000000000006', '6c010000-0000-0000-0000-000000000031', 'manager', true,  'active',    now()), -- Manager Solo (empresa dedicada, ultimo manager)
  ('6c030000-0000-0000-0000-000000000032', '6c020000-0000-0000-0000-000000000003', '6c010000-0000-0000-0000-000000000032', 'seller',  true,  'active',    now()), -- empresa cancelada
  ('6c030000-0000-0000-0000-000000000033', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000033', 'manager', true,  'active',    now()), -- Super Admin com membership real de MANAGER (alvo proibido, dedicado ao offboard_manager)
  ('6c030000-0000-0000-0000-000000000034', '6c020000-0000-0000-0000-000000000001', '6c010000-0000-0000-0000-000000000034', 'seller',  true,  'active',    now()); -- Seller A4, COM lead aberto (dedicado a successor_required, S6-E2)

insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s6c-a1', '6c020000-0000-0000-0000-000000000001', '6c030000-0000-0000-0000-000000000002', '6c010000-0000-0000-0000-000000000003', 'S6C Seller A1', 'S6C', true),
  ('s6c-a3', '6c020000-0000-0000-0000-000000000001', '6c030000-0000-0000-0000-000000000004', '6c010000-0000-0000-0000-000000000005', 'S6C Seller A3', 'S6C', true),
  ('s6c-b1', '6c020000-0000-0000-0000-000000000002', '6c030000-0000-0000-0000-000000000007', '6c010000-0000-0000-0000-000000000008', 'S6C Seller B1', 'S6C', true),
  ('s6c-suspenso', '6c020000-0000-0000-0000-000000000001', '6c030000-0000-0000-0000-000000000013', '6c010000-0000-0000-0000-000000000013', 'S6C Seller Suspenso', 'S6C', false),
  ('s6c-offboarded', '6c020000-0000-0000-0000-000000000001', '6c030000-0000-0000-0000-000000000017', '6c010000-0000-0000-0000-000000000017', 'S6C Seller Offboarded', 'S6C', false),
  ('s6c-cat', '6c020000-0000-0000-0000-000000000001', '6c030000-0000-0000-0000-000000000022', '6c010000-0000-0000-0000-000000000022', 'S6C Seller Catalogo', 'S6C', true),
  ('s6c-succ-suspenso', '6c020000-0000-0000-0000-000000000001', '6c030000-0000-0000-0000-000000000024', '6c010000-0000-0000-0000-000000000024', 'S6C Seller Successor Suspenso', 'S6C', false),
  ('s6c-a4', '6c020000-0000-0000-0000-000000000001', '6c030000-0000-0000-0000-000000000034', '6c010000-0000-0000-0000-000000000034', 'S6C Seller A4 Com Lead', 'S6C', true);

-- pipeline_stages mínimo (necessário para o FK composta leads(company_id, stage_id))
insert into public.pipeline_stages (id, company_id, code, name, sort_order)
values ('6c050000-0000-0000-0000-000000000001', '6c020000-0000-0000-0000-000000000001', 'new', 'Novo', 0);

-- leads reais de Seller A1: 2 abertos (reatribuíveis), 1 arquivado (histórico, nunca tocado)
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('6c040000-0000-0000-0000-000000000001', '6c020000-0000-0000-0000-000000000001', 'Cliente Aberto 1', '(11) 90000-0001', 'Carro 1', '6c050000-0000-0000-0000-000000000001', 's6c-a1', null),
  ('6c040000-0000-0000-0000-000000000002', '6c020000-0000-0000-0000-000000000001', 'Cliente Aberto 2', '(11) 90000-0002', 'Carro 2', '6c050000-0000-0000-0000-000000000001', 's6c-a1', null),
  ('6c040000-0000-0000-0000-000000000003', '6c020000-0000-0000-0000-000000000001', 'Cliente Arquivado', '(11) 90000-0003', 'Carro 3', '6c050000-0000-0000-0000-000000000001', 's6c-a1', now());

-- lead aberto de Seller A4 — dedicado ao teste de successor_required (S6-E2)
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('6c040000-0000-0000-0000-000000000004', '6c020000-0000-0000-0000-000000000001', 'Cliente A4 Aberto', '(11) 90000-0004', 'Carro 4', '6c050000-0000-0000-0000-000000000001', 's6c-a4', null);

-- ══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA/CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'offboard_seller' and pronamespace = 'public'::regnamespace),
  1, 'offboard_seller existe exatamente uma vez (sem overload)');
select is(
  (select count(*)::int from pg_proc where proname = 'offboard_manager' and pronamespace = 'public'::regnamespace),
  1, 'offboard_manager existe exatamente uma vez (sem overload)');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.offboard_seller(uuid,uuid,text)'::regprocedure),
  true, 'offboard_seller: SECURITY DEFINER');
select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.offboard_seller(uuid,uuid,text)'::regprocedure),
  'postgres', 'offboard_seller: owner postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.offboard_seller(uuid,uuid,text)'::regprocedure),
  array['search_path=""'], 'offboard_seller: search_path fixo');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='offboard_seller' and grantee='PUBLIC'),
  0, 'offboard_seller: PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='offboard_seller' and grantee='anon'),
  0, 'offboard_seller: anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='offboard_seller' and grantee='authenticated' and privilege_type='EXECUTE'),
  1, 'offboard_seller: authenticated com EXECUTE');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.offboard_manager(uuid,uuid,text)'::regprocedure),
  true, 'offboard_manager: SECURITY DEFINER');
select is(
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.offboard_manager(uuid,uuid,text)'::regprocedure),
  'postgres', 'offboard_manager: owner postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.offboard_manager(uuid,uuid,text)'::regprocedure),
  array['search_path=""'], 'offboard_manager: search_path fixo');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='offboard_manager' and grantee='PUBLIC'),
  0, 'offboard_manager: PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='offboard_manager' and grantee='anon'),
  0, 'offboard_manager: anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema='public' and routine_name='offboard_manager' and grantee='authenticated' and privilege_type='EXECUTE'),
  1, 'offboard_manager: authenticated com EXECUTE');

-- tipos de retorno — fixture dedicada (022/s6c-cat), nunca reutilizada
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select is(
  (select pg_typeof(membership_id)::text from public.offboard_seller('6c030000-0000-0000-0000-000000000022', null, 'motivo de catalogo') limit 1),
  'uuid', 'offboard_seller retorno: membership_id e uuid');
select is(
  (select pg_typeof(leads_reassigned)::text from public.offboard_seller('6c030000-0000-0000-0000-000000000022', null, 'motivo de catalogo') limit 1),
  'integer', 'offboard_seller retorno: leads_reassigned e integer (chamada idempotente)');
select is(
  (select pg_typeof(successor_seller_id)::text from public.offboard_seller('6c030000-0000-0000-0000-000000000022', null, 'motivo de catalogo') limit 1),
  'text', 'offboard_seller retorno: successor_seller_id e text');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. AUTORIZAÇÃO — OFFBOARD_SELLER
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'motivo valido')$$,
  '42501', null, 'offboard_seller anon: bloqueado por ausencia de EXECUTE');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000021'); -- sem profile
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_seller: usuario sem profile: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000003'); -- Seller A1
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_seller: Seller: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000007'); -- Manager B sobre Seller A1 (empresa A)
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_seller: Manager de outra empresa: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000009'); -- Manager com profile inativo
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_seller: ator inativo: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000010'); -- Super Admin Alvo sobre a propria membership
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000009', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_seller: autoacao (Super Admin sobre a propria membership): forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001'); -- Super Admin sobre outro Super Admin
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000009', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_seller: alvo Super Admin: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.offboard_seller('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'offboard_seller: membership inexistente');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000005', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'offboard_seller: alvo com profile inativo -> membership_not_found');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000001', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'offboard_seller: alvo Manager (RPC errada) -> membership_not_found');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000032', null, 'motivo valido')$$,
  'P0001', 'company_not_operational', 'offboard_seller: empresa cancelada: company_not_operational');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. MOTIVO (OFFBOARD_SELLER — obrigatório)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, null)$$,
  '22023', 'invalid_note', 'offboard_seller: motivo NULL e invalido');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, '')$$,
  '22023', 'invalid_note', 'offboard_seller: motivo vazio e invalido');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, '   ')$$,
  '22023', 'invalid_note', 'offboard_seller: motivo somente espacos e invalido');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'ab')$$,
  '22023', 'invalid_note', 'offboard_seller: motivo curto e invalido');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, repeat('x', 501))$$,
  '22023', 'invalid_note', 'offboard_seller: motivo longo e invalido');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'valido' || chr(1) || 'controle')$$,
  '22023', 'invalid_note', 'offboard_seller: motivo com caractere de controle e invalido');
reset role;
select is(
  (select count(*)::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000003'),
  0, 'offboard_seller: nenhuma auditoria por motivo invalido');
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000003'),
  'active'::public.membership_lifecycle_status, 'offboard_seller: nenhuma escrita parcial por motivo invalido');

-- ══════════════════════════════════════════════════════════════════════
-- 4. INCONSISTÊNCIAS — SELLER AUSENTE
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000003', null, 'motivo valido para seller ausente')$$,
  'P0001', 'seller_state_conflict', 'offboard_seller: membership seller sem sellers vinculado -> seller_state_conflict');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000003'),
  'active'::public.membership_lifecycle_status, 'offboard_seller: nenhuma alteracao parcial apos o conflito');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000003'),
  0, 'offboard_seller: nenhuma auditoria para o conflito de seller ausente');

-- "seller ligado a outra empresa/profile" (vínculo inconsistente) não tem
-- fixture realista possível — mesma nota já documentada em
-- 33_m1f_s5c_...sql e 35_m1f_s6b_...sql (sellers_check_membership_
-- consistency + sellers_membership_id_uidx tornam esse estado
-- inalcançável por escrita real).

-- ══════════════════════════════════════════════════════════════════════
-- 5. SUCESSOR — OFFBOARD_SELLER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');

-- próprio alvo como sucessor
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', '6c030000-0000-0000-0000-000000000002', 'sucessor e o proprio alvo')$$,
  'P0001', 'successor_invalid', 'offboard_seller: sucessor = proprio alvo -> successor_invalid');

-- sucessor de outra empresa (membership 007 = Seller B1, empresa B)
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', '6c030000-0000-0000-0000-000000000007', 'sucessor de outra empresa')$$,
  'P0001', 'successor_invalid', 'offboard_seller: sucessor de outra empresa -> successor_invalid');

-- sucessor suspenso (membership 024)
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', '6c030000-0000-0000-0000-000000000024', 'sucessor suspenso')$$,
  'P0001', 'successor_invalid', 'offboard_seller: sucessor suspenso -> successor_invalid');

-- sucessor offboarded (membership 017)
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', '6c030000-0000-0000-0000-000000000017', 'sucessor ja desligado')$$,
  'P0001', 'successor_invalid', 'offboard_seller: sucessor ja desligado -> successor_invalid');

-- sucessor com role manager (membership 020 = Manager A2 da mesma empresa)
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', '6c030000-0000-0000-0000-000000000020', 'sucessor e manager, nao seller')$$,
  'P0001', 'successor_invalid', 'offboard_seller: sucessor com role manager -> successor_invalid (S6-E2)');

-- sucessor inexistente (uuid valido, nenhuma membership real)
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'sucessor inexistente')$$,
  'P0001', 'successor_invalid', 'offboard_seller: sucessor inexistente -> successor_invalid');
reset role;

select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000002'),
  'active'::public.membership_lifecycle_status, 'offboard_seller: nenhuma tentativa de sucessor invalido alterou o alvo');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002'),
  0, 'offboard_seller: nenhuma auditoria para tentativas de sucessor invalido');
select is(
  (select seller_id from public.leads where id = '6c040000-0000-0000-0000-000000000001'),
  's6c-a1', 'offboard_seller: nenhum lead foi reatribuido por tentativas com sucessor invalido');

-- ══════════════════════════════════════════════════════════════════════
-- 5B. SUCESSOR OBRIGATÓRIO QUANDO HÁ LEADS ABERTOS (S6-E2, novo)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');

-- Seller A4 tem 1 lead aberto (fixture dedicada) — sucessor NULL falha
select throws_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000034', null, 'tentativa sem sucessor, com lead aberto')$$,
  'P0001', 'successor_required', 'offboard_seller: alvo com lead aberto e sucessor NULL -> successor_required (S6-E2)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000034'),
  'active'::public.membership_lifecycle_status, 'offboard_seller: Seller A4 permanece active apos successor_required');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000034'),
  0, 'offboard_seller: nenhuma auditoria para a tentativa que exigiu sucessor');
select is(
  (select seller_id from public.leads where id = '6c040000-0000-0000-0000-000000000004'),
  's6c-a4', 'offboard_seller: lead de Seller A4 permanece com ele apos successor_required');

-- mesmo Seller A4, agora com sucessor válido (Seller A3, membership 004): sucesso
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000034', '6c030000-0000-0000-0000-000000000004', 'Seller A4 saiu, lead para Seller A3')$$,
  'offboard_seller: Seller A4 desligado com sucessor valido, apos successor_required anterior');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000034'),
  'offboarded'::public.membership_lifecycle_status, 'offboard_seller: Seller A4: active -> offboarded');
select is(
  (select seller_id from public.leads where id = '6c040000-0000-0000-0000-000000000004'),
  's6c-a3', 'offboard_seller: lead de Seller A4 reatribuido ao sucessor apos segunda tentativa');

-- ══════════════════════════════════════════════════════════════════════
-- 6. OFFBOARD_SELLER — ciclo completo com sucessor válido
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', '6c030000-0000-0000-0000-000000000004', 'Seller A1 saiu da empresa, leads para Seller A3')$$,
  'Seller A1 desligado com sucessor valido');
reset role;

select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000002'),
  'offboarded'::public.membership_lifecycle_status, 'offboard_seller: membership Seller A1: active -> offboarded');
select is(
  (select is_active from public.company_memberships where id = '6c030000-0000-0000-0000-000000000002'),
  false, 'offboard_seller: is_active=false apos desligamento');
select is(
  (select company_id from public.company_memberships where id = '6c030000-0000-0000-0000-000000000002'),
  '6c020000-0000-0000-0000-000000000001'::uuid, 'offboard_seller: company_id preservado');
select is(
  (select is_active from public.sellers where id = 's6c-a1'),
  false, 'offboard_seller: sellers.is_active sincronizado para false');
select is(
  (select membership_id from public.sellers where id = 's6c-a1'),
  '6c030000-0000-0000-0000-000000000002'::uuid, 'offboard_seller: sellers.membership_id preservado (nunca removido)');
select is(
  (select profile_id from public.sellers where id = 's6c-a1'),
  '6c010000-0000-0000-0000-000000000003'::uuid, 'offboard_seller: sellers.profile_id preservado (historico)');
select is(
  (select is_active from public.profiles where id = '6c010000-0000-0000-0000-000000000003'),
  true, 'offboard_seller: profiles.is_active NAO tocado');
select is(
  (select platform_role from public.profiles where id = '6c010000-0000-0000-0000-000000000003') is null,
  true, 'offboard_seller: platform_role NAO tocado');

-- leads: 2 abertos reatribuídos, 1 arquivado preservado
select is(
  (select seller_id from public.leads where id = '6c040000-0000-0000-0000-000000000001'),
  's6c-a3', 'offboard_seller: lead aberto 1 reatribuido ao sucessor');
select is(
  (select seller_id from public.leads where id = '6c040000-0000-0000-0000-000000000002'),
  's6c-a3', 'offboard_seller: lead aberto 2 reatribuido ao sucessor');
select is(
  (select updated_by_profile_id from public.leads where id = '6c040000-0000-0000-0000-000000000001') is null,
  true, 'offboard_seller: updated_by_profile_id NUNCA e escrito por esta RPC (so seller_id, exatamente o passo 4 do §11) — evita violar leads_updated_by_fk (FK composta contra profiles.company_id, sempre NULL para Super Admin)');
select is(
  (select seller_id from public.leads where id = '6c040000-0000-0000-0000-000000000003'),
  's6c-a1', 'offboard_seller: lead ARQUIVADO preserva o seller_id original (nunca tocado)');
select is(
  (select created_by_profile_id from public.leads where id = '6c040000-0000-0000-0000-000000000001') is null,
  true, 'offboard_seller: created_by_profile_id (autoria historica) nunca populado por esta RPC (sanity, coluna nula desde a fixture)');

-- ══════════════════════════════════════════════════════════════════════
-- 7. OFFBOARD_SELLER — auditoria exata
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select action from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'seller_offboarded', 'auditoria: acao correta');
select is(
  (select entity_type from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'membership', 'auditoria: entity_type correto');
select is(
  (select company_id from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  '6c020000-0000-0000-0000-000000000001'::uuid, 'auditoria: company_id correto');
select is(
  (select actor_profile_id from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  '6c010000-0000-0000-0000-000000000001'::uuid, 'auditoria: ator correto');
select is(
  (select result from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'success', 'auditoria: result=success');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select before_data from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1)
  ) as k),
  array['is_active','lifecycle_status','role','seller_active','seller_id']::text[],
  'auditoria: before_data contem exatamente role/lifecycle_status/is_active/seller_id/seller_active');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select after_data from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1)
  ) as k),
  array['is_active','leads_reassigned','lifecycle_status','note','role','seller_active','seller_id','successor_seller_id']::text[],
  'auditoria: after_data contem os campos minimos + successor_seller_id/leads_reassigned/note');
select is(
  (select (after_data->>'leads_reassigned')::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  2, 'auditoria: leads_reassigned=2 (os dois leads abertos, nunca o arquivado)');
select is(
  (select after_data->>'successor_seller_id' from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  's6c-a3', 'auditoria: successor_seller_id correto');
select is(
  (select after_data->>'note' from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  'Seller A1 saiu da empresa, leads para Seller A3', 'auditoria: motivo gravado no after_data');
select is(
  (select (before_data ? 'name') or (before_data ? 'email') or (before_data ? 'platform_role')
        or (after_data ? 'name') or (after_data ? 'email') or (after_data ? 'platform_role')
     from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' order by ctid desc limit 1),
  false, 'auditoria: nenhum dado sensivel (nome/email/platform_role)');

-- ══════════════════════════════════════════════════════════════════════
-- 8. OFFBOARD_SELLER — idempotência e offboarded
-- ══════════════════════════════════════════════════════════════════════

select updated_at as membership_updated_before from public.company_memberships where id = '6c030000-0000-0000-0000-000000000002' \gset
select count(*)::int as audit_before from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002' \gset

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000002', null, 'segunda tentativa, ja desligado')$$,
  'offboard_seller: segunda chamada sobre membership ja offboarded: sucesso silencioso (idempotente)');
reset role;
select is(
  (select updated_at from public.company_memberships where id = '6c030000-0000-0000-0000-000000000002'),
  :'membership_updated_before'::timestamptz, 'offboard_seller: chamada idempotente nao altera updated_at');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000002') - :audit_before,
  0, 'offboard_seller: chamada idempotente nao cria nova auditoria');

-- fixture já offboarded desde o início (017/s6c-offboarded) — outra
-- chamada idempotente, sem sucessor
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000017', null, 'tentativa sobre fixture ja offboarded')$$,
  'offboard_seller: fixture ja offboarded desde o inicio: idempotente');
reset role;
select is(
  (select count(*)::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000017'),
  0, 'offboard_seller: nenhuma auditoria para a fixture ja offboarded');

-- ══════════════════════════════════════════════════════════════════════
-- 9. OFFBOARD_SELLER — suspended -> offboarded, sem sucessor (Manager)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000002'); -- Manager A, sobre Seller Suspenso da propria empresa
select lives_ok(
  $$select * from public.offboard_seller('6c030000-0000-0000-0000-000000000013', null, 'Seller suspenso desligado sem sucessor')$$,
  'offboard_seller: Manager desliga Seller suspenso da propria empresa, sem sucessor (permitido)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000013'),
  'offboarded'::public.membership_lifecycle_status, 'offboard_seller: suspended -> offboarded');
select is(
  (select (after_data->>'leads_reassigned')::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000013' order by ctid desc limit 1),
  0, 'offboard_seller: leads_reassigned=0 (Seller Suspenso nunca teve leads)');
select is(
  (select after_data->>'successor_seller_id' from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000013' order by ctid desc limit 1) is null,
  true, 'offboard_seller: successor_seller_id NULL quando nenhum sucessor informado');

-- ══════════════════════════════════════════════════════════════════════
-- 10. OFFBOARD_MANAGER — autorização
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, 'motivo valido')$$,
  '42501', null, 'offboard_manager anon: bloqueado por ausencia de EXECUTE');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000003'); -- Seller
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_manager: Seller: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000002'); -- Manager A tentando desligar Manager A2 (mesma empresa)
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_manager: Manager sobre Manager: forbidden (so Super Admin desliga Manager)');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000020'); -- Manager A2 tentando se autodesligar
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_manager: Manager tentando se autodesligar: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001'); -- Super Admin
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000009', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'offboard_manager: alvo nao e Manager (membership 009 e seller) -> membership_not_found (role checado antes de qualquer autorizacao especifica de alvo)');
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000002', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'offboard_manager: alvo Seller (RPC errada) -> membership_not_found');
select throws_ok(
  $$select * from public.offboard_manager('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'motivo valido')$$,
  'P0002', 'membership_not_found', 'offboard_manager: membership inexistente');
-- alvo Super Admin com membership de MANAGER real (fixture dedicada 033) —
-- este e' o caso que realmente exercita a checagem "alvo Super Admin"
-- desta RPC, ja que uma membership seller (009) e' barrada antes pelo
-- role check.
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000033', null, 'motivo valido')$$,
  '42501', 'forbidden', 'offboard_manager: alvo Super Admin com membership manager real -> forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000032', null, 'motivo valido')$$,
  'P0001', 'company_not_operational', 'offboard_manager: empresa cancelada e checada antes do role/autorizacao (mesma ordem de suspend_membership/reactivate_membership, S6-B)'
);
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 11. OFFBOARD_MANAGER — motivo obrigatório
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, null)$$,
  '22023', 'invalid_note', 'offboard_manager: motivo NULL e invalido');
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, '')$$,
  '22023', 'invalid_note', 'offboard_manager: motivo vazio e invalido');
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, 'ab')$$,
  '22023', 'invalid_note', 'offboard_manager: motivo curto e invalido');
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, repeat('z', 501))$$,
  '22023', 'invalid_note', 'offboard_manager: motivo longo e invalido');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000020'),
  'active'::public.membership_lifecycle_status, 'offboard_manager: nenhuma escrita parcial por motivo invalido');

-- ══════════════════════════════════════════════════════════════════════
-- 12. OFFBOARD_MANAGER — com outro Manager ativo (sem sucessor)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, 'Manager A2 saiu, Manager A permanece')$$,
  'offboard_manager: Manager A2 desligado sem sucessor (Manager A continua ativo na empresa)');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000020'),
  'offboarded'::public.membership_lifecycle_status, 'offboard_manager: Manager A2: active -> offboarded');
select is(
  (select action from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000020' order by ctid desc limit 1),
  'manager_offboarded', 'offboard_manager: acao correta na auditoria');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
    (select before_data from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000020' order by ctid desc limit 1)
  ) as k),
  array['is_active','lifecycle_status','role']::text[],
  'offboard_manager: before_data contem exatamente role/lifecycle_status/is_active (sem chaves de seller)');
select is(
  (select after_data->>'successor_profile_id' from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000020' order by ctid desc limit 1) is null,
  true, 'offboard_manager: successor_profile_id NULL quando nenhum sucessor informado');

-- ══════════════════════════════════════════════════════════════════════
-- 13. OFFBOARD_MANAGER — último Manager
-- ══════════════════════════════════════════════════════════════════════

-- Nota estrutural: um sucessor válido precisa JÁ ser Manager ativo da
-- mesma empresa (§12) — logo "último Manager COM sucessor válido tendo
-- sucesso" é impossível por construção nesta RPC (se um sucessor válido
-- existe, a contagem de "outros Managers ativos" já é >= 1, então não é
-- mais o caso "único Manager" que exige sucessor obrigatório). Por isso:
-- Empresa Manager Solo (031, único Manager) testa exclusivamente os dois
-- caminhos de FALHA do último Manager; Empresa Last Manager (015 X + 016
-- Y, dois Managers) testa o caminho de SUCESSO com sucessor (onde o
-- sucessor é validado mas não é estritamente obrigatório), e só depois
-- de X sair é que Y passa a ser testável como último Manager de fato.

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');

-- Manager Solo: único Manager da empresa, sem sucessor: falha
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000031', null, 'tentativa sem sucessor')$$,
  'P0001', 'last_manager_requires_successor', 'offboard_manager: unico Manager da empresa, sem sucessor -> last_manager_requires_successor');

-- Manager Solo: sucessor invalido (Seller, nao Manager): falha com successor_invalid, nao last_manager_requires_successor
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000031', '6c010000-0000-0000-0000-000000000003', 'sucessor invalido (Seller)')$$,
  'P0001', 'successor_invalid', 'offboard_manager: unico Manager com sucessor invalido (Seller de outra empresa) -> successor_invalid, nunca last_manager_requires_successor');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000031'),
  'active'::public.membership_lifecycle_status, 'offboard_manager: Manager Solo permanece active apos as duas tentativas de falha');

-- Empresa Last Manager (015 X + 016 Y, dois Managers ativos): sucessor
-- válido é aceito e registrado, mesmo não sendo estritamente obrigatório
-- aqui (Y já conta como "outro Manager ativo" antes mesmo de X sair).
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000015', '6c010000-0000-0000-0000-000000000016', 'LastMgr X saiu, sucessor LastMgr Y')$$,
  'offboard_manager: com outro Manager ja ativo, sucessor valido informado e aceito: sucesso');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000015'),
  'offboarded'::public.membership_lifecycle_status, 'offboard_manager: LastMgr X: active -> offboarded');
select is(
  (select after_data->>'successor_profile_id' from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000015' order by ctid desc limit 1),
  '6c010000-0000-0000-0000-000000000016', 'offboard_manager: successor_profile_id correto na auditoria');

-- agora LastMgr Y é o único Manager restante da empresa — desligar sem
-- sucessor falha (mesmo caminho de Manager Solo, agora alcançado por uma
-- empresa que começou com dois Managers)
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000016', null, 'ultimo restante, sem sucessor')$$,
  'P0001', 'last_manager_requires_successor', 'offboard_manager: apos a saida de X, o ultimo Manager restante (Y) nao pode ser desligado sem sucessor');
reset role;
select is(
  (select lifecycle_status from public.company_memberships where id = '6c030000-0000-0000-0000-000000000016'),
  'active'::public.membership_lifecycle_status, 'offboard_manager: LastMgr Y permanece active (guarda bloqueou a escrita)');

-- ══════════════════════════════════════════════════════════════════════
-- 14. OFFBOARD_MANAGER — idempotência
-- ══════════════════════════════════════════════════════════════════════

select updated_at as manager_updated_before from public.company_memberships where id = '6c030000-0000-0000-0000-000000000020' \gset
select count(*)::int as manager_audit_before from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000020' \gset

set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.offboard_manager('6c030000-0000-0000-0000-000000000020', null, 'segunda tentativa')$$,
  'offboard_manager: segunda chamada sobre membership ja offboarded: sucesso silencioso');
reset role;
select is(
  (select updated_at from public.company_memberships where id = '6c030000-0000-0000-0000-000000000020'),
  :'manager_updated_before'::timestamptz, 'offboard_manager: chamada idempotente nao altera updated_at');
select is(
  (select count(*)::int from public.audit_log where entity_id = '6c030000-0000-0000-0000-000000000020') - :manager_audit_before,
  0, 'offboard_manager: chamada idempotente nao cria nova auditoria');

-- ══════════════════════════════════════════════════════════════════════
-- 15. INVARIANTES
-- ══════════════════════════════════════════════════════════════════════

-- nenhum DELETE em nenhum ponto
select is(
  (select count(*)::int from public.company_memberships where id::text like '6c030000-%'),
  20, 'nenhuma linha de company_memberships desapareceu (20 fixtures, S6-E2 adicionou 034)');
select is(
  (select count(*)::int from public.sellers where id like 's6c-%'),
  8, 'nenhuma linha de sellers desapareceu (8 fixtures, S6-E2 adicionou s6c-a4)');
select is(
  (select count(*)::int from public.leads where id::text like '6c040000-%'),
  4, 'nenhum lead desapareceu (4 fixtures, S6-E2 adicionou o lead de A4)');

-- nenhum Manager histórico de seller (não existe neste arquivo, mas
-- confirma que nenhum profile/platform_role foi tocado indevidamente)
select is(
  (select count(*)::int from public.profiles where id::text like '6c010000-%' and platform_role = 'super_admin'),
  3, 'exatamente os 3 Super Admins originais (001, 010, 033) continuam super_admin');

-- offboarded nunca é reativado por reactivate_membership (S6-B, intocado)
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.reactivate_membership('6c030000-0000-0000-0000-000000000002')$$,
  'P0001', 'membership_lifecycle_conflict', 'reactivate_membership (S6-B) continua rejeitando offboarded, agora produzido por offboard_seller');
reset role;

-- update_membership_role não revive offboarded (S5-C, intocado)
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.update_membership_role('6c030000-0000-0000-0000-000000000002', '6c020000-0000-0000-0000-000000000001', 'manager')$$,
  'P0002', 'membership_not_found', 'update_membership_role (S5-C) continua rejeitando membership offboarded como inexistente');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 16. INTEGRAÇÃO
-- ══════════════════════════════════════════════════════════════════════

-- can_access_company já bloqueia a membership desligada (sob a sessão do
-- próprio desligado)
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000003'); -- Seller A1, agora offboarded
select is(
  public.current_membership_company_id(),
  null::uuid, 'Seller A1 offboarded: current_membership_company_id() retorna NULL');
reset role;

-- list_company_users deixa de retornar o desligado
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => '6c020000-0000-0000-0000-000000000001') where profile_id = '6c010000-0000-0000-0000-000000000003'),
  0, 'Seller A1 offboarded desaparece de list_company_users');
select is(
  (select count(*)::int from public.list_company_users(p_limit => 100, p_company_id => '6c020000-0000-0000-0000-000000000001') where profile_id = '6c010000-0000-0000-0000-000000000005'),
  1, 'Sucessor (Seller A3) continua aparecendo normalmente em list_company_users');
reset role;

-- suspend_membership/reactivate_membership continuam funcionais (S6-B)
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.suspend_membership('6c030000-0000-0000-0000-000000000004', 'suspend_membership (S6-B) continua funcional')$$,
  'suspend_membership (S6-B) continua funcional apos esta migration');
select lives_ok(
  $$select * from public.reactivate_membership('6c030000-0000-0000-0000-000000000004', 'reactivate_membership (S6-B) continua funcional')$$,
  'reactivate_membership (S6-B) continua funcional apos esta migration');
reset role;

-- update_profile_name continua funcional (S5-B)
set local role authenticated;
select pg_temp.as_user('6c010000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_profile_name('6c010000-0000-0000-0000-000000000001', 'S6C Super Admin Renomeado')$$,
  'update_profile_name (S5-B) continua funcional apos esta migration');
reset role;

-- nenhum grant/policy novo em company_memberships/sellers/leads
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
  0, 'nenhum grant de escrita direta em leads para authenticated (reatribuicao so pelas RPCs SECURITY DEFINER)');

select finish();
rollback;
