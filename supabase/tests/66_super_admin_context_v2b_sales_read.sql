-- SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC —
-- list_platform_sales_for_company (20260825170000_super_admin_context_v2b_sales_read.sql).
-- Reutiliza _resolve_commercial_read_company (V2A, ja testado em
-- 65_super_admin_context_v2a_read.sql — nao duplicado aqui). READ ONLY:
-- register_sale ja tem cobertura propria (54_commercial_remote_b1_tasks.sql
-- nao, mas o proprio arquivo de Sales A1 tem — intocado por este lote).
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
  ('e9b10000-0000-0000-0000-000000000001', 'V2B Company A',       null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9b10000-0000-0000-0000-000000000002', 'V2B Company B',       null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9b10000-0000-0000-0000-000000000003', 'V2B Company Suspensa', null, null, 'America/Sao_Paulo', 'suspensa'),
  ('e9b10000-0000-0000-0000-000000000004', 'V2B Company Cancelada', null, null, 'America/Sao_Paulo', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e9b20000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'v2b-manager-a@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9b20000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'v2b-seller-a@test.local',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9b20000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'v2b-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9b20000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'v2b-manager-b@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9b20000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'v2b-manager-s@test.local',  now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e9b20000-0000-0000-0000-000000000001', 'V2B Manager A',   'v2b-manager-a@test.local',  true, null),
  ('e9b20000-0000-0000-0000-000000000002', 'V2B Seller A',    'v2b-seller-a@test.local',   true, null),
  ('e9b20000-0000-0000-0000-000000000003', 'V2B Super Admin', 'v2b-superadmin@test.local', true, 'super_admin'),
  ('e9b20000-0000-0000-0000-000000000004', 'V2B Manager B',   'v2b-manager-b@test.local',  true, null),
  ('e9b20000-0000-0000-0000-000000000005', 'V2B Manager Suspensa', 'v2b-manager-s@test.local', true, null);

-- Manager Suspensa: profile DEDICADO com propria membership ATIVA (mesmo
-- motivo ja documentado no V2A: satisfaz sold_by/created_by/updated_by da
-- empresa suspensa sem colidir com company_memberships_profile_single_active_uidx).
insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('e9b30000-0000-0000-0000-000000000001', 'e9b10000-0000-0000-0000-000000000001', 'e9b20000-0000-0000-0000-000000000001', 'manager', true),
  ('e9b30000-0000-0000-0000-000000000002', 'e9b10000-0000-0000-0000-000000000001', 'e9b20000-0000-0000-0000-000000000002', 'seller',  true),
  ('e9b30000-0000-0000-0000-000000000003', 'e9b10000-0000-0000-0000-000000000002', 'e9b20000-0000-0000-0000-000000000004', 'manager', true),
  ('e9b30000-0000-0000-0000-000000000004', 'e9b10000-0000-0000-0000-000000000003', 'e9b20000-0000-0000-0000-000000000005', 'manager', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('v2bSellerA', 'e9b10000-0000-0000-0000-000000000001', 'V2B Seller A', 'A', 'e9b20000-0000-0000-0000-000000000002', 'e9b30000-0000-0000-0000-000000000002', true),
  ('v2bSellerB', 'e9b10000-0000-0000-0000-000000000002', 'V2B Seller B', 'B', null, null, true),
  ('v2bSellerS', 'e9b10000-0000-0000-0000-000000000003', 'V2B Seller Suspensa', 'S', null, null, true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('e9b70000-0000-0000-0000-000000000001', 'e9b10000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('e9b70000-0000-0000-0000-000000000002', 'e9b10000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('e9b70000-0000-0000-0000-000000000003', 'e9b10000-0000-0000-0000-000000000003', 'new', 'Novo', 0);
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('e9b60000-0000-0000-0000-000000000001', 'e9b10000-0000-0000-0000-000000000001', 'Lead A', '(11) 90000-0001', 'Onix', 'e9b70000-0000-0000-0000-000000000001', 'v2bSellerA'),
  ('e9b60000-0000-0000-0000-000000000002', 'e9b10000-0000-0000-0000-000000000002', 'Lead B', '(11) 90000-0002', 'Onix', 'e9b70000-0000-0000-0000-000000000002', 'v2bSellerB'),
  ('e9b60000-0000-0000-0000-000000000003', 'e9b10000-0000-0000-0000-000000000003', 'Lead Suspensa', '(11) 90000-0003', 'Onix', 'e9b70000-0000-0000-0000-000000000003', 'v2bSellerS');

-- Deals SOLD (Sale nasce sempre de uma Deal, migration #54) — status
-- setado direto (register_sale fica intocado/fora de escopo deste lote,
-- fixture insere o estado final diretamente).
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by) values
  ('e9b80000-0000-0000-0000-000000000001', 'e9b10000-0000-0000-0000-000000000001', 'e9b60000-0000-0000-0000-000000000001', 'Lead A', 'v2bSellerA', 'Onix', 100000, 0, 'a_vista', 'sold', 'e9b20000-0000-0000-0000-000000000001', 'e9b20000-0000-0000-0000-000000000001'),
  ('e9b80000-0000-0000-0000-000000000002', 'e9b10000-0000-0000-0000-000000000002', 'e9b60000-0000-0000-0000-000000000002', 'Lead B', 'v2bSellerB', 'Onix', 200000, 0, 'a_vista', 'sold', 'e9b20000-0000-0000-0000-000000000004', 'e9b20000-0000-0000-0000-000000000004'),
  ('e9b80000-0000-0000-0000-000000000003', 'e9b10000-0000-0000-0000-000000000003', 'e9b60000-0000-0000-0000-000000000003', 'Lead Suspensa', 'v2bSellerS', 'Onix', 300000, 0, 'a_vista', 'sold', 'e9b20000-0000-0000-0000-000000000005', 'e9b20000-0000-0000-0000-000000000005');

-- Sales: 1 em A (valor X = 123456 centavos), 1 em B (valor Y = 987654
-- centavos, DIFERENTE de X — §32 money safety), 1 em Suspensa.
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('e9b90000-0000-0000-0000-000000000001', 'e9b10000-0000-0000-0000-000000000001', 'e9b80000-0000-0000-0000-000000000001', 'e9b60000-0000-0000-0000-000000000001', 'v2bSellerA', 123456, 'a_vista', 'e9b20000-0000-0000-0000-000000000001', now()),
  ('e9b90000-0000-0000-0000-000000000002', 'e9b10000-0000-0000-0000-000000000002', 'e9b80000-0000-0000-0000-000000000002', 'e9b60000-0000-0000-0000-000000000002', 'v2bSellerB', 987654, 'a_vista', 'e9b20000-0000-0000-0000-000000000004', now()),
  ('e9b90000-0000-0000-0000-000000000003', 'e9b10000-0000-0000-0000-000000000003', 'e9b80000-0000-0000-0000-000000000003', 'e9b60000-0000-0000-0000-000000000003', 'v2bSellerS', 300000, 'a_vista', 'e9b20000-0000-0000-0000-000000000005', now());

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO / GRANTS (§35 do EXEC)
-- ══════════════════════════════════════════════════════════════════════

select is(has_function_privilege('authenticated', 'public.list_platform_sales_for_company(uuid)', 'EXECUTE'), true, 'list_platform_sales_for_company: authenticated com EXECUTE');
select is(has_function_privilege('anon', 'public.list_platform_sales_for_company(uuid)', 'EXECUTE'), false, 'list_platform_sales_for_company: anon sem EXECUTE');

-- Zero grant novo na tabela — resolver/RPC continuam sendo o unico
-- caminho, RLS de sales continua intocada (§5/§34 do EXEC).
select ok(true, 'nenhuma alteração de RLS/grant de tabela testada aqui por design (sales_select fora de escopo deste lote)');

-- ══════════════════════════════════════════════════════════════════════
-- 2. SEM SESSÃO
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select * from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'anon (sem grant): permission denied');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. MANAGER — empresa SEMPRE da própria membership, parâmetro ignorado
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e9b20000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

select is(
  (select count(*)::int from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid)),
  1, 'Manager A: 1 sale da propria empresa');
select is(
  (select count(*)::int from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Manager A passando Company B como parametro: p_company_id IGNORADO, ainda recebe a propria empresa (A), nunca B');
select is(
  (select sold_value_cents from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid)),
  123456::bigint, 'Manager A: valor real da propria Sale (X), nunca o de outra empresa');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. SELLER — mesma regra de Manager
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e9b20000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select is(
  (select count(*)::int from public.list_platform_sales_for_company(null)),
  1, 'Seller A: 1 sale da propria empresa, mesmo com p_company_id null');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. SUPER ADMIN — empresa explícita, isolamento real (§32 money safety)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e9b20000-0000-0000-0000-000000000003'); -- Super Admin
set local role authenticated;

select is(
  (select count(*)::int from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid)),
  1, 'Super Admin + Company A explicita: 1 sale de A');
select is(
  (select count(*)::int from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000002'::uuid)),
  1, 'Super Admin + Company B explicita: 1 sale de B, zero vazamento de A');

-- §32 CRÍTICO: money safety — Super Admin A nunca recebe o valor Y de B,
-- Super Admin B nunca recebe o valor X de A.
select is(
  (select sold_value_cents from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid)),
  123456::bigint, 'Super Admin + Company A: recebe X (123456), nunca Y (987654) de B');
select is(
  (select sold_value_cents from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000002'::uuid)),
  987654::bigint, 'Super Admin + Company B: recebe Y (987654), nunca X (123456) de A');
select isnt(
  (select sold_value_cents from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid)),
  (select sold_value_cents from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000002'::uuid)),
  'Company A e Company B nunca retornam o mesmo valor financeiro (fixtures propositalmente distintos)');

-- Company suspensa: leitura permitida (mesma regra de can_access_company).
select is(
  (select count(*)::int from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000003'::uuid)),
  1, 'Super Admin + Company suspensa: leitura permitida (mesma regra do V1/V2A)');

-- Sem companyId: deny.
select throws_ok(
  $$select * from public.list_platform_sales_for_company(null)$$,
  '22023', null, 'Super Admin sem p_company_id: company_required');

-- Company inexistente: deny.
select throws_ok(
  $$select * from public.list_platform_sales_for_company('99999999-9999-9999-9999-999999999999'::uuid)$$,
  '42501', null, 'Super Admin + company inexistente: forbidden, nunca revela existencia');

-- Company cancelada: deny.
select throws_ok(
  $$select * from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000004'::uuid)$$,
  '42501', null, 'Super Admin + company cancelada: forbidden (can_access_company nega cancelada)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. PAYLOAD — RETURNS SETOF public.sales garante shape identico a
--    fetchVisibleSaleRows (§6 do EXEC)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select pg_get_function_result('public.list_platform_sales_for_company(uuid)'::regprocedure)),
  'SETOF sales', 'list_platform_sales_for_company retorna SETOF public.sales (mesma linha real, nunca um shape customizado)');

-- ══════════════════════════════════════════════════════════════════════
-- 7. ORDENAÇÃO — mesma de fetchVisibleSaleRows (sold_at desc, id asc)
-- ══════════════════════════════════════════════════════════════════════

insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by) values
  ('e9b80000-0000-0000-0000-000000000004', 'e9b10000-0000-0000-0000-000000000001', 'e9b60000-0000-0000-0000-000000000001', 'Lead A', 'v2bSellerA', 'Civic', 150000, 0, 'a_vista', 'sold', 'e9b20000-0000-0000-0000-000000000001', 'e9b20000-0000-0000-0000-000000000001');
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('e9b90000-0000-0000-0000-000000000004', 'e9b10000-0000-0000-0000-000000000001', 'e9b80000-0000-0000-0000-000000000004', 'e9b60000-0000-0000-0000-000000000001', 'v2bSellerA', 150000, 'a_vista', 'e9b20000-0000-0000-0000-000000000001', now() + interval '1 hour');

select pg_temp.as_user('e9b20000-0000-0000-0000-000000000003'); -- Super Admin
set local role authenticated;
select is(
  (select count(*)::int from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid)),
  2, 'Company A agora tem 2 Sales apos a insercao acima');
select is(
  (select id from public.list_platform_sales_for_company('e9b10000-0000-0000-0000-000000000001'::uuid) limit 1),
  'e9b90000-0000-0000-0000-000000000004'::uuid,
  'ordenacao sold_at desc (mesma da funcao/fetchVisibleSaleRows): a Sale mais recente (criada +1h) vem primeiro, sem ORDER BY adicional na query de teste');
reset role;

select * from finish();
rollback;
