-- M1-F S8-C1-B — migração das policies de pipeline_stages e da RPC
-- reorder_pipeline_stages para o modelo de company_memberships
-- (20260728150000_m1f_s8c1b_pipeline_membership_access.sql). Prova:
-- (1) autorização combina current_membership_company_id()/
-- current_membership_role()='manager' com can_access_company() — nunca
-- can_access_company()/is_manager_or_platform() isoladamente, que
-- autorizariam Super Admin; (2) Super Admin nunca opera Pipeline de
-- empresa cliente, mesmo com platform_role; (3) Manager/Seller sem
-- membership ativa, suspensos, desligados ou de empresa não operacional
-- (suspensa) são negados; (4) reorder preserva integralmente locks,
-- validação de permutação completa e atomicidade; (5) assinatura da RPC
-- e grants preservados. Roda como postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ── fixtures ──────────────────────────────────────────────────────────
-- Empresa A (ativa, 5 etapas), Empresa B (ativa, 1 etapa, para dados
-- cruzados), Empresa C (suspensa, 1 etapa, para status não operacional).
insert into public.companies (id, name, status) values
  ('cb100000-0000-0000-0000-000000000001', 'S8C1B Empresa A', 'ativa'),
  ('cb100000-0000-0000-0000-000000000002', 'S8C1B Empresa B', 'ativa'),
  ('cb100000-0000-0000-0000-000000000003', 'S8C1B Empresa C Suspensa', 'suspensa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8c1b-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8c1b-seller-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8c1b-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8c1b-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's8c1b-nomembership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's8c1b-suspended@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's8c1b-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's8c1b-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's8c1b-manager-c@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('cb200000-0000-0000-0000-000000000001', 'Manager A', 's8c1b-manager-a@test.local', true, null),
  ('cb200000-0000-0000-0000-000000000002', 'Seller A', 's8c1b-seller-a@test.local', true, null),
  ('cb200000-0000-0000-0000-000000000003', 'Manager B', 's8c1b-manager-b@test.local', true, null),
  ('cb200000-0000-0000-0000-000000000004', 'Super Admin S8C1B', 's8c1b-superadmin@test.local', true, 'super_admin'),
  ('cb200000-0000-0000-0000-000000000005', 'Sem Membership', 's8c1b-nomembership@test.local', true, null),
  ('cb200000-0000-0000-0000-000000000006', 'Manager Suspenso', 's8c1b-suspended@test.local', true, null),
  ('cb200000-0000-0000-0000-000000000007', 'Manager Desligado', 's8c1b-offboarded@test.local', true, null),
  ('cb200000-0000-0000-0000-000000000008', 'Profile Inativo', 's8c1b-inactive-profile@test.local', false, null),
  ('cb200000-0000-0000-0000-000000000009', 'Manager C', 's8c1b-manager-c@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('cb300000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'manager', true, 'active'),
  ('cb300000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'seller', true, 'active'),
  ('cb300000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000002', 'cb200000-0000-0000-0000-000000000003', 'manager', true, 'active'),
  ('cb300000-0000-0000-0000-000000000006', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000006', 'manager', false, 'suspended'),
  ('cb300000-0000-0000-0000-000000000007', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 'manager', false, 'offboarded'),
  ('cb300000-0000-0000-0000-000000000008', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000008', 'manager', true, 'active'),
  ('cb300000-0000-0000-0000-000000000009', 'cb100000-0000-0000-0000-000000000003', 'cb200000-0000-0000-0000-000000000009', 'manager', true, 'active');
-- cb200000-...-05 (Sem Membership) deliberadamente NÃO recebe nenhuma linha
-- de company_memberships — representa profile ativo sem vínculo algum.

insert into public.pipeline_stages (id, company_id, code, name, sort_order, is_terminal) values
  ('cb400000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'new', 'Novo', 0, false),
  ('cb400000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000001', 'qualified', 'Qualificado', 1, false),
  ('cb400000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000001', 'visit_scheduled', 'Visita agendada', 2, false),
  ('cb400000-0000-0000-0000-000000000004', 'cb100000-0000-0000-0000-000000000001', 'negotiation', 'Em negociação', 3, false),
  ('cb400000-0000-0000-0000-000000000005', 'cb100000-0000-0000-0000-000000000001', 'closing', 'Fechamento', 4, true),
  ('cb500000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000002', 'new', 'Novo', 0, false),
  ('cb600000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000003', 'new', 'Novo', 0, false);

-- ══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select relrowsecurity from pg_class where oid = 'public.pipeline_stages'::regclass),
  true, 'RLS habilitada em public.pipeline_stages');

select is(
  (select array_agg(policyname::text order by policyname::text) from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_stages'),
  array['stages_insert', 'stages_select', 'stages_update'],
  'pipeline_stages tem exatamente as 3 policies esperadas, nenhuma de DELETE');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_stages' and cmd = 'DELETE'),
  0, 'nenhuma policy de DELETE existe em pipeline_stages');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'pipeline_stages'
      and grantee = 'authenticated' and privilege_type = 'DELETE'),
  0, 'nenhum GRANT de DELETE em pipeline_stages para authenticated');

select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'pipeline_stages'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  array['is_terminal', 'name'],
  'UPDATE em pipeline_stages continua restrito a (name, is_terminal) — sort_order/company_id fora do grant');

select function_returns('public'::name, 'reorder_pipeline_stages'::name, array['uuid[]'], 'setof pipeline_stages'::name,
  'reorder_pipeline_stages preserva a assinatura p_ordered_ids uuid[] -> setof pipeline_stages');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reorder_pipeline_stages' and p.prosecdef),
  1, 'reorder_pipeline_stages continua SECURITY DEFINER');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reorder_pipeline_stages'
      and (pg_get_functiondef(p.oid) ilike '%current_profile_company_id(%'
        or pg_get_functiondef(p.oid) ilike '%current_profile_role(%'
        or pg_get_functiondef(p.oid) ilike '%is_manager_or_admin(%')),
  0, 'reorder_pipeline_stages nao usa nenhum dos 3 helpers legados (current_profile_company_id/role, is_manager_or_admin)');

-- assinatura continua sendo um unico parametro uuid[] — nenhum
-- p_company_id foi adicionado (checagem pelo catalogo de argumentos,
-- nao por substring de texto, que colidiria com "current_membership_
-- company_id" contendo "...ship_company_id" como substring acidental).
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reorder_pipeline_stages'),
  'p_ordered_ids uuid[]', 'reorder_pipeline_stages continua com um unico parametro, nenhum p_company_id adicionado');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reorder_pipeline_stages'
      and pg_get_functiondef(p.oid) ilike '%current_membership_company_id%'),
  1, 'reorder_pipeline_stages usa current_membership_company_id()');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'reorder_pipeline_stages'
      and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'authenticated mantem EXECUTE em reorder_pipeline_stages');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'reorder_pipeline_stages'
      and grantee in ('anon', 'PUBLIC') and privilege_type = 'EXECUTE'),
  0, 'anon/PUBLIC continuam sem EXECUTE em reorder_pipeline_stages');

-- ══════════════════════════════════════════════════════════════════════
-- MANAGER ATIVO (Empresa A)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  5, 'Manager A: SELECT das 5 etapas da propria empresa');
select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000002'),
  0, 'Manager A: NAO ve etapas da Empresa B');

select lives_ok(
  $$insert into public.pipeline_stages (company_id, code, name, sort_order)
    values ('cb100000-0000-0000-0000-000000000001', 'custom_a', 'Custom A', 5)$$,
  'Manager A: INSERT de etapa na propria empresa e aceito');
select lives_ok(
  $$update public.pipeline_stages set name = 'Novo Renomeado' where id = 'cb400000-0000-0000-0000-000000000001'$$,
  'Manager A: UPDATE de etapa da propria empresa e aceito');
select is(
  (select name from public.pipeline_stages where id = 'cb400000-0000-0000-0000-000000000001'),
  'Novo Renomeado', 'Manager A: UPDATE realmente aplicado');

select throws_ok(
  $$insert into public.pipeline_stages (company_id, code, name, sort_order)
    values ('cb100000-0000-0000-0000-000000000002', 'custom_b', 'Custom B', 5)$$,
  '42501', null, 'Manager A: INSERT em etapa de OUTRA empresa e negado');
select is(
  (select count(*)::int from public.pipeline_stages where id = 'cb500000-0000-0000-0000-000000000001' and name = 'Novo'),
  0, 'Manager A: UPDATE de etapa de OUTRA empresa nao alcanca a linha (RLS filtra silenciosamente)');
with tentativa as (
  update public.pipeline_stages set name = 'Hackeado' where id = 'cb500000-0000-0000-0000-000000000001' returning 1
)
select is((select count(*)::int from tentativa), 0, 'Manager A: UPDATE direto de etapa da Empresa B alcanca zero linhas');

-- company_id/sort_order nunca estiveram no GRANT de UPDATE (só name/
-- is_terminal) — a tentativa falha por privilégio de COLUNA, antes
-- mesmo de a RLS ser avaliada (erro de permissão, não filtragem
-- silenciosa de linhas).
select throws_ok(
  $$update public.pipeline_stages set company_id = 'cb100000-0000-0000-0000-000000000002'
    where id = 'cb400000-0000-0000-0000-000000000002'$$,
  '42501', null, 'Manager A: tentativa de UPDATE de company_id falha (coluna fora do grant)');
select throws_ok(
  $$update public.pipeline_stages set sort_order = 99
    where id = 'cb400000-0000-0000-0000-000000000002'$$,
  '42501', null, 'Manager A: tentativa de UPDATE direto de sort_order falha (coluna fora do grant, so via RPC)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- SELLER ATIVO (Empresa A)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  6, 'Seller A: SELECT das etapas da propria empresa (5 originais + custom_a do Manager A)');
select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000002'),
  0, 'Seller A: NAO ve etapas da Empresa B');

select throws_ok(
  $$insert into public.pipeline_stages (company_id, code, name, sort_order)
    values ('cb100000-0000-0000-0000-000000000001', 'seller_try', 'Seller Try', 6)$$,
  '42501', null, 'Seller A: INSERT negado (nao e manager)');
with tentativa as (
  update public.pipeline_stages set name = 'Seller Editou'
    where id = 'cb400000-0000-0000-0000-000000000001' returning 1
)
select is((select count(*)::int from tentativa), 0, 'Seller A: UPDATE negado (nao e manager)');

reset role;

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.reorder_pipeline_stages(array['cb400000-0000-0000-0000-000000000001'::uuid])$$,
  null, 'forbidden: manager/admin only', 'Seller A: reorder negado (forbidden)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN SEM MEMBERSHIP
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000004');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  0, 'Super Admin: NAO le etapas da Empresa A por SELECT direto (sem membership, sem empresa artificial)');
select is(
  (select count(*)::int from public.pipeline_stages),
  0, 'Super Admin: SELECT sem filtro tambem devolve zero linhas (nenhuma empresa implicita)');

select throws_ok(
  $$insert into public.pipeline_stages (company_id, code, name, sort_order)
    values ('cb100000-0000-0000-0000-000000000001', 'sa_try', 'SA Try', 6)$$,
  '42501', null, 'Super Admin: INSERT negado (sem contexto de membership)');
with tentativa as (
  update public.pipeline_stages set name = 'SA Editou'
    where id = 'cb400000-0000-0000-0000-000000000001' returning 1
)
select is((select count(*)::int from tentativa), 0, 'Super Admin: UPDATE negado (sem contexto de membership)');

select throws_ok(
  $$select public.reorder_pipeline_stages(array['cb400000-0000-0000-0000-000000000001'::uuid])$$,
  null, 'no active profile for current user', 'Super Admin: reorder negado por ausencia de contexto empresarial (nao por forbidden)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- SEM MEMBERSHIP (profile ativo, zero company_memberships)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000005');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  0, 'Sem membership: NAO le etapas (profile ativo, zero company_memberships)');

select throws_ok(
  $$select public.reorder_pipeline_stages(array['cb400000-0000-0000-0000-000000000001'::uuid])$$,
  null, 'no active profile for current user', 'Sem membership: reorder negado por ausencia de contexto empresarial');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- MEMBERSHIP SUSPENSA
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000006');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  0, 'Membership suspensa: SELECT negado');
select throws_ok(
  $$insert into public.pipeline_stages (company_id, code, name, sort_order)
    values ('cb100000-0000-0000-0000-000000000001', 'susp_try', 'Susp Try', 7)$$,
  '42501', null, 'Membership suspensa: INSERT negado');
select throws_ok(
  $$select public.reorder_pipeline_stages(array['cb400000-0000-0000-0000-000000000001'::uuid])$$,
  null, 'no active profile for current user', 'Membership suspensa: reorder negado');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- MEMBERSHIP OFFBOARDED
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000007');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  0, 'Membership offboarded: SELECT negado');
with tentativa as (
  update public.pipeline_stages set name = 'Offboarded Editou'
    where id = 'cb400000-0000-0000-0000-000000000001' returning 1
)
select is((select count(*)::int from tentativa), 0, 'Membership offboarded: UPDATE negado');
select throws_ok(
  $$select public.reorder_pipeline_stages(array['cb400000-0000-0000-0000-000000000001'::uuid])$$,
  null, 'no active profile for current user', 'Membership offboarded: reorder negado');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- PROFILE GLOBALMENTE INATIVO (membership ativa, profile is_active=false)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000008');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  0, 'Profile globalmente inativo: SELECT negado (helpers ja filtram profiles.is_active)');
select throws_ok(
  $$select public.reorder_pipeline_stages(array['cb400000-0000-0000-0000-000000000001'::uuid])$$,
  null, 'no active profile for current user', 'Profile globalmente inativo: reorder negado');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- EMPRESA NÃO OPERACIONAL (Empresa C, status = suspensa, Manager C ativo)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000009');

select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000003'),
  0, 'Manager C (empresa suspensa): SELECT negado mesmo com membership ativa (can_access_company nega)');
select throws_ok(
  $$insert into public.pipeline_stages (company_id, code, name, sort_order)
    values ('cb100000-0000-0000-0000-000000000003', 'c_try', 'C Try', 1)$$,
  '42501', null, 'Manager C: INSERT negado (empresa nao operacional)');
select throws_ok(
  $$select public.reorder_pipeline_stages(array['cb600000-0000-0000-0000-000000000001'::uuid])$$,
  null, 'forbidden: manager/admin only', 'Manager C: reorder negado (empresa nao operacional, mesmo sendo manager ativo)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- REORDER — MANAGER A, PERMUTAÇÃO COMPLETA E ATOMICIDADE
-- ══════════════════════════════════════════════════════════════════════

-- Snapshot da ordem ANTES de qualquer tentativa (5 originais + custom_a
-- inserida pelo Manager A acima, 6 no total).
select is(
  (select count(*)::int from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001'),
  6, 'snapshot: Empresa A tem 6 etapas antes das tentativas de reorder');

set local role authenticated;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000001');

-- ── array vazio falha, sem alterar nada ──────────────────────────────────
select throws_ok(
  $$select public.reorder_pipeline_stages('{}'::uuid[])$$,
  null, 'ordered stage list cannot be null or empty', 'Manager A: array vazio falha');

-- ── array com etapa de OUTRA empresa falha, sem alterar nada ────────────
select throws_ok(
  $$select public.reorder_pipeline_stages(array[
    'cb400000-0000-0000-0000-000000000001'::uuid, 'cb400000-0000-0000-0000-000000000002'::uuid,
    'cb400000-0000-0000-0000-000000000003'::uuid, 'cb400000-0000-0000-0000-000000000004'::uuid,
    'cb400000-0000-0000-0000-000000000005'::uuid, 'cb500000-0000-0000-0000-000000000001'::uuid
  ])$$,
  null, 'one or more stages do not belong to the current company (or duplicated ids)',
  'Manager A: array misturando IDs de outra empresa falha');

-- ── array duplicado falha ────────────────────────────────────────────────
select throws_ok(
  $$select public.reorder_pipeline_stages(array[
    'cb400000-0000-0000-0000-000000000001'::uuid, 'cb400000-0000-0000-0000-000000000001'::uuid
  ])$$,
  null, 'one or more stages do not belong to the current company (or duplicated ids)',
  'Manager A: array com id duplicado falha');

-- ── array parcial (faltando etapas da empresa) falha ────────────────────
select throws_ok(
  $$select public.reorder_pipeline_stages(array[
    'cb400000-0000-0000-0000-000000000001'::uuid, 'cb400000-0000-0000-0000-000000000002'::uuid
  ])$$,
  null, 'ordered list must include every stage of the company', 'Manager A: array parcial falha');

-- ── nenhuma das tentativas acima alterou sort_order (atomicidade) ───────
select is(
  (select array_agg(code::text order by sort_order) from public.pipeline_stages
    where company_id = 'cb100000-0000-0000-0000-000000000001'),
  array['new', 'qualified', 'visit_scheduled', 'negotiation', 'closing', 'custom_a'],
  'atomicidade: nenhuma tentativa invalida alterou sort_order — ordem original intacta');

-- ── reorder válido e completo: sucesso, nova ordem aplicada ─────────────
select lives_ok(
  $$select public.reorder_pipeline_stages(array[
    'cb400000-0000-0000-0000-000000000005'::uuid, 'cb400000-0000-0000-0000-000000000004'::uuid,
    'cb400000-0000-0000-0000-000000000003'::uuid, 'cb400000-0000-0000-0000-000000000002'::uuid,
    'cb400000-0000-0000-0000-000000000001'::uuid,
    (select id from public.pipeline_stages where company_id = 'cb100000-0000-0000-0000-000000000001' and code = 'custom_a')
  ])$$,
  'Manager A: reorder completo e valido e aceito');
select is(
  (select array_agg(code::text order by sort_order) from public.pipeline_stages
    where company_id = 'cb100000-0000-0000-0000-000000000001'),
  array['closing', 'negotiation', 'visit_scheduled', 'qualified', 'new', 'custom_a'],
  'reorder valido: sort_order final reflete exatamente a ordem enviada');

reset role;

-- ── LOCKS: garantia estrutural (nao simulacao de concorrencia) — a
--    infraestrutura pgTAP local (uma unica sessao/transacao) nao permite
--    provar concorrencia real; auditamos no catalogo que a funcao
--    preserva "for update"/"order by id" no corpo, exatamente como antes
--    desta migracao ────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reorder_pipeline_stages'
      and pg_get_functiondef(p.oid) ilike '%order by id%for update%'),
  1, 'garantia estrutural: reorder_pipeline_stages preserva lock determinístico (ORDER BY id FOR UPDATE) — nao e simulacao de concorrencia real');

select finish();
rollback;
