-- SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC —
-- _resolve_commercial_read_company + list_platform_tasks_for_company +
-- list_platform_visits_for_company + list_platform_deals_for_company
-- (20260825160000_super_admin_context_v2a_read.sql). READ ONLY: nenhuma
-- mutation testada aqui (create_task/register_visit_result/create_deal
-- etc. já têm cobertura própria, intocada por este lote).
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

insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('e9a10000-0000-0000-0000-000000000001', 'V2A Company A',       null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9a10000-0000-0000-0000-000000000002', 'V2A Company B',       null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9a10000-0000-0000-0000-000000000003', 'V2A Company Suspensa', null, null, 'America/Sao_Paulo', 'suspensa'),
  ('e9a10000-0000-0000-0000-000000000004', 'V2A Company Cancelada', null, null, 'America/Sao_Paulo', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e9a20000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'v2a-manager-a@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9a20000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'v2a-seller-a@test.local',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9a20000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'v2a-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9a20000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'v2a-manager-b@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9a20000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'v2a-manager-s@test.local',  now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e9a20000-0000-0000-0000-000000000001', 'V2A Manager A',   'v2a-manager-a@test.local',  true, null),
  ('e9a20000-0000-0000-0000-000000000002', 'V2A Seller A',    'v2a-seller-a@test.local',   true, null),
  ('e9a20000-0000-0000-0000-000000000003', 'V2A Super Admin', 'v2a-superadmin@test.local', true, 'super_admin'),
  ('e9a20000-0000-0000-0000-000000000004', 'V2A Manager B',   'v2a-manager-b@test.local',  true, null),
  ('e9a20000-0000-0000-0000-000000000005', 'V2A Manager Suspensa', 'v2a-manager-s@test.local', true, null);

-- Manager Suspensa: profile DEDICADO, própria membership ATIVA (perfil
-- nunca usado para logar neste teste — só existe para satisfazer o FK de
-- created_by/updated_by/assigned_seller dos fixtures da empresa
-- suspensa; company_memberships_profile_single_active_uidx só limita a 1
-- membership ativa POR PROFILE, e este é um profile novo/dedicado, sem
-- conflito com nenhum outro ator deste arquivo).
insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('e9a30000-0000-0000-0000-000000000001', 'e9a10000-0000-0000-0000-000000000001', 'e9a20000-0000-0000-0000-000000000001', 'manager', true),
  ('e9a30000-0000-0000-0000-000000000002', 'e9a10000-0000-0000-0000-000000000001', 'e9a20000-0000-0000-0000-000000000002', 'seller',  true),
  ('e9a30000-0000-0000-0000-000000000003', 'e9a10000-0000-0000-0000-000000000002', 'e9a20000-0000-0000-0000-000000000004', 'manager', true),
  ('e9a30000-0000-0000-0000-000000000004', 'e9a10000-0000-0000-0000-000000000003', 'e9a20000-0000-0000-0000-000000000005', 'manager', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('v2aSellerA', 'e9a10000-0000-0000-0000-000000000001', 'V2A Seller A', 'A', 'e9a20000-0000-0000-0000-000000000002', 'e9a30000-0000-0000-0000-000000000002', true),
  ('v2aSellerB', 'e9a10000-0000-0000-0000-000000000002', 'V2A Seller B', 'B', null, null, true),
  ('v2aSellerS', 'e9a10000-0000-0000-0000-000000000003', 'V2A Seller Suspensa', 'S', null, null, true);

-- Tasks: 2 em A (1 pending, 1 done — done NUNCA deve aparecer, mesma
-- paridade de fetchPendingTaskRows), 1 em B, 1 em Suspensa.
insert into public.tasks (id, company_id, assigned_seller_id, title, priority, due_at, status, completed_at, completed_by) values
  ('e9a40000-0000-0000-0000-000000000001', 'e9a10000-0000-0000-0000-000000000001', 'v2aSellerA', 'Task A pendente', 'media', now(), 'pending', null, null),
  ('e9a40000-0000-0000-0000-000000000002', 'e9a10000-0000-0000-0000-000000000001', 'v2aSellerA', 'Task A concluida', 'media', now(), 'completed', now(), 'e9a20000-0000-0000-0000-000000000001'),
  ('e9a40000-0000-0000-0000-000000000003', 'e9a10000-0000-0000-0000-000000000002', 'v2aSellerB', 'Task B pendente', 'media', now(), 'pending', null, null),
  ('e9a40000-0000-0000-0000-000000000004', 'e9a10000-0000-0000-0000-000000000003', 'v2aSellerS', 'Task Suspensa pendente', 'media', now(), 'pending', null, null);

-- Visits: 1 em A, 1 em B, 1 em Suspensa — sem filtro de status (paridade
-- de fetchVisibleVisitRows).
insert into public.visits (id, company_id, assigned_seller_id, vehicles, scheduled_at, client_name) values
  ('e9a50000-0000-0000-0000-000000000001', 'e9a10000-0000-0000-0000-000000000001', 'v2aSellerA', array['Onix'], now(), 'Cliente A'),
  ('e9a50000-0000-0000-0000-000000000002', 'e9a10000-0000-0000-0000-000000000002', 'v2aSellerB', array['Onix'], now(), 'Cliente B'),
  ('e9a50000-0000-0000-0000-000000000003', 'e9a10000-0000-0000-0000-000000000003', 'v2aSellerS', array['Onix'], now(), 'Cliente Suspensa');

-- Deals: 1 em A, 1 em B, 1 em Suspensa.
insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('e9a70000-0000-0000-0000-000000000001', 'e9a10000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('e9a70000-0000-0000-0000-000000000002', 'e9a10000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('e9a70000-0000-0000-0000-000000000003', 'e9a10000-0000-0000-0000-000000000003', 'new', 'Novo', 0);
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('e9a60000-0000-0000-0000-000000000001', 'e9a10000-0000-0000-0000-000000000001', 'Lead A', '(11) 90000-0001', 'Onix', 'e9a70000-0000-0000-0000-000000000001', 'v2aSellerA'),
  ('e9a60000-0000-0000-0000-000000000002', 'e9a10000-0000-0000-0000-000000000002', 'Lead B', '(11) 90000-0002', 'Onix', 'e9a70000-0000-0000-0000-000000000002', 'v2aSellerB'),
  ('e9a60000-0000-0000-0000-000000000003', 'e9a10000-0000-0000-0000-000000000003', 'Lead Suspensa', '(11) 90000-0003', 'Onix', 'e9a70000-0000-0000-0000-000000000003', 'v2aSellerS');
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by) values
  ('e9a80000-0000-0000-0000-000000000001', 'e9a10000-0000-0000-0000-000000000001', 'e9a60000-0000-0000-0000-000000000001', 'Lead A', 'v2aSellerA', 'Onix', 100000, 0, 'a_vista', 'open', 'e9a20000-0000-0000-0000-000000000001', 'e9a20000-0000-0000-0000-000000000001'),
  ('e9a80000-0000-0000-0000-000000000002', 'e9a10000-0000-0000-0000-000000000002', 'e9a60000-0000-0000-0000-000000000002', 'Lead B', 'v2aSellerB', 'Onix', 100000, 0, 'a_vista', 'open', 'e9a20000-0000-0000-0000-000000000004', 'e9a20000-0000-0000-0000-000000000004'),
  ('e9a80000-0000-0000-0000-000000000003', 'e9a10000-0000-0000-0000-000000000003', 'e9a60000-0000-0000-0000-000000000003', 'Lead Suspensa', 'v2aSellerS', 'Onix', 100000, 0, 'a_vista', 'open', 'e9a20000-0000-0000-0000-000000000005', 'e9a20000-0000-0000-0000-000000000005');

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO / GRANTS
-- ══════════════════════════════════════════════════════════════════════

select is(has_function_privilege('authenticated', 'public._resolve_commercial_read_company(uuid)', 'EXECUTE'), false, 'resolver interno sem EXECUTE para authenticated (§4/§36)');
select is(has_function_privilege('anon', 'public._resolve_commercial_read_company(uuid)', 'EXECUTE'), false, 'resolver interno sem EXECUTE para anon');
select is(has_function_privilege('authenticated', 'public.list_platform_tasks_for_company(uuid)', 'EXECUTE'), true, 'list_platform_tasks_for_company: authenticated com EXECUTE');
select is(has_function_privilege('authenticated', 'public.list_platform_visits_for_company(uuid)', 'EXECUTE'), true, 'list_platform_visits_for_company: authenticated com EXECUTE');
select is(has_function_privilege('authenticated', 'public.list_platform_deals_for_company(uuid)', 'EXECUTE'), true, 'list_platform_deals_for_company: authenticated com EXECUTE');
select is(has_function_privilege('anon', 'public.list_platform_tasks_for_company(uuid)', 'EXECUTE'), false, 'list_platform_tasks_for_company: anon sem EXECUTE');

-- RLS das 3 tabelas continua intocada (§5/§9 do EXEC): zero grant de
-- SELECT direto novo, a policy existente é a mesma de sempre.
select ok(true, 'nenhuma alteração de RLS testada aqui por design (RLS de tasks/visits/deals fora de escopo deste lote)');

-- ══════════════════════════════════════════════════════════════════════
-- 2. SEM SESSÃO
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select * from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'anon (sem grant): permission denied');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. MANAGER — empresa SEMPRE da própria membership, parâmetro ignorado
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e9a20000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

select is(
  (select count(*)::int from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000001'::uuid)),
  1, 'Manager A: 1 task pendente da propria empresa (a concluida nunca aparece)');
select is(
  (select count(*)::int from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Manager A passando Company B como parametro: p_company_id IGNORADO, ainda recebe a propria empresa (A), nunca B');
select is(
  (select count(*)::int from public.list_platform_visits_for_company('e9a10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Manager A: visits da propria empresa (A), parametro Company B ignorado');
select is(
  (select count(*)::int from public.list_platform_deals_for_company('e9a10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Manager A: deals da propria empresa (A), parametro Company B ignorado');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. SELLER — mesma regra de Manager
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e9a20000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select is(
  (select count(*)::int from public.list_platform_tasks_for_company(null)),
  1, 'Seller A: 1 task pendente da propria empresa, mesmo com p_company_id null');
select is(
  (select count(*)::int from public.list_platform_visits_for_company('e9a10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Seller A: visits da propria empresa (A), parametro Company B ignorado');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. SUPER ADMIN — empresa explícita, isolamento real
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e9a20000-0000-0000-0000-000000000003'); -- Super Admin
set local role authenticated;

select is(
  (select count(*)::int from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000001'::uuid)),
  1, 'Super Admin + Company A explicita: 1 task pendente de A (a concluida nunca aparece)');
select is(
  (select count(*)::int from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Super Admin + Company B explicita: 1 task pendente de B, zero vazamento de A');
select is(
  (select title from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000001'::uuid)),
  'Task A pendente', 'Super Admin + Company A: conteudo real correto');

select is(
  (select count(*)::int from public.list_platform_visits_for_company('e9a10000-0000-0000-0000-000000000001'::uuid)),
  1, 'Super Admin + Company A: 1 visit de A');
select is(
  (select count(*)::int from public.list_platform_visits_for_company('e9a10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Super Admin + Company B: 1 visit de B, zero vazamento de A');

select is(
  (select count(*)::int from public.list_platform_deals_for_company('e9a10000-0000-0000-0000-000000000001'::uuid)),
  1, 'Super Admin + Company A: 1 deal de A');
select is(
  (select count(*)::int from public.list_platform_deals_for_company('e9a10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Super Admin + Company B: 1 deal de B, zero vazamento de A');

-- §19/§42: Company suspensa — Super Admin CONSEGUE ler (can_access_company
-- ja autoriza suspensa, mesma autoridade do V1).
select is(
  (select count(*)::int from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000003'::uuid)),
  1, 'Super Admin + Company suspensa: leitura permitida (mesma regra de can_access_company do V1)');
select is(
  (select count(*)::int from public.list_platform_visits_for_company('e9a10000-0000-0000-0000-000000000003'::uuid)),
  1, 'Super Admin + Company suspensa: visits tambem permitidas');
select is(
  (select count(*)::int from public.list_platform_deals_for_company('e9a10000-0000-0000-0000-000000000003'::uuid)),
  1, 'Super Admin + Company suspensa: deals tambem permitidos');

-- Sem companyId: deny.
select throws_ok(
  $$select * from public.list_platform_tasks_for_company(null)$$,
  '22023', null, 'Super Admin sem p_company_id: company_required');
select throws_ok(
  $$select * from public.list_platform_visits_for_company(null)$$,
  '22023', null, 'Super Admin sem p_company_id (visits): company_required');
select throws_ok(
  $$select * from public.list_platform_deals_for_company(null)$$,
  '22023', null, 'Super Admin sem p_company_id (deals): company_required');

-- Company inexistente: deny (can_access_company -> false).
select throws_ok(
  $$select * from public.list_platform_tasks_for_company('99999999-9999-9999-9999-999999999999'::uuid)$$,
  '42501', null, 'Super Admin + company inexistente: forbidden, nunca revela existencia');

-- Company cancelada: deny.
select throws_ok(
  $$select * from public.list_platform_tasks_for_company('e9a10000-0000-0000-0000-000000000004'::uuid)$$,
  '42501', null, 'Super Admin + company cancelada: forbidden (can_access_company nega cancelada)');
select throws_ok(
  $$select * from public.list_platform_visits_for_company('e9a10000-0000-0000-0000-000000000004'::uuid)$$,
  '42501', null, 'Super Admin + company cancelada (visits): forbidden');
select throws_ok(
  $$select * from public.list_platform_deals_for_company('e9a10000-0000-0000-0000-000000000004'::uuid)$$,
  '42501', null, 'Super Admin + company cancelada (deals): forbidden');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. PAYLOAD — mesmo shape ja consumido por fetchPendingTaskRows/
--    fetchVisibleVisitRows/fetchVisibleDealRows (§14 do PRECHECK):
--    RETURNS SETOF <table> garante por construção que o payload é
--    EXATAMENTE a linha real da tabela, nunca uma coluna a mais.
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select pg_get_function_result('public.list_platform_tasks_for_company(uuid)'::regprocedure)),
  'SETOF tasks', 'list_platform_tasks_for_company retorna SETOF public.tasks (mesma linha real, nunca um shape customizado)');
select is(
  (select pg_get_function_result('public.list_platform_visits_for_company(uuid)'::regprocedure)),
  'SETOF visits', 'list_platform_visits_for_company retorna SETOF public.visits');
select is(
  (select pg_get_function_result('public.list_platform_deals_for_company(uuid)'::regprocedure)),
  'SETOF deals', 'list_platform_deals_for_company retorna SETOF public.deals');

select * from finish();
rollback;
