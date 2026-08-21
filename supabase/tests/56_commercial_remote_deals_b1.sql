-- COMMERCIAL-REMOTE-DEALS-B1 — Deals ("Propostas") remoto: schema + RLS +
-- RPC. Prova: (1) deals/enums/checks/FKs/indexes exatamente como
-- desenhado; (2) RLS SELECT-only, escrita direta revogada de
-- anon/authenticated; (3) create_deal respeita Manager (empresa inteira,
-- responsável obrigatório, default do Lead) e Seller (sempre autoatribuído,
-- nunca escolhe outro); (4) approval threshold (<=5% open, >5%
-- pending_approval) é autoridade do backend; (5) decide_deal é Manager-only
-- e só válido a partir de pending_approval; (6) isolamento cross-company;
-- (7) concorrência otimista (version/expected_version/stale_write); (8)
-- actor/timestamp pair consistency e preservação de approval metadata na
-- transição para sold; (9) timeline sem duplicata; (10) anon nunca
-- executa. Roda como postgres. Rollback ao final — nenhum dado persiste.

begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ═══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('cd100000-0000-0000-0000-000000000001', 'D1 Deals Empresa A Ativa', 'ativa'),
  ('cd100000-0000-0000-0000-000000000002', 'D1 Deals Empresa B Ativa (outra)', 'ativa'),
  ('cd100000-0000-0000-0000-000000000003', 'D1 Deals Empresa C Suspensa', 'suspensa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'd1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'd1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'd1-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'd1-seller-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'd1-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'd1-seller-b1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'd1-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cd200000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'd1-nomembership@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('cd200000-0000-0000-0000-000000000001', 'Super Admin D1', 'd1-superadmin@test.local', true, 'super_admin'),
  ('cd200000-0000-0000-0000-000000000002', 'Manager A',      'd1-manager-a@test.local',  true, null),
  ('cd200000-0000-0000-0000-000000000003', 'Seller A1',      'd1-seller-a1@test.local',  true, null),
  ('cd200000-0000-0000-0000-000000000004', 'Seller A2',      'd1-seller-a2@test.local',  true, null),
  ('cd200000-0000-0000-0000-000000000005', 'Manager B',      'd1-manager-b@test.local',  true, null),
  ('cd200000-0000-0000-0000-000000000006', 'Seller B1',      'd1-seller-b1@test.local',  true, null),
  ('cd200000-0000-0000-0000-000000000007', 'Manager C',      'd1-manager-c@test.local',  true, null),
  ('cd200000-0000-0000-0000-000000000008', 'Sem Membership', 'd1-nomembership@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('cd300000-0000-0000-0000-000000000002', 'cd100000-0000-0000-0000-000000000001', 'cd200000-0000-0000-0000-000000000002', 'manager', true),
  ('cd300000-0000-0000-0000-000000000003', 'cd100000-0000-0000-0000-000000000001', 'cd200000-0000-0000-0000-000000000003', 'seller',  true),
  ('cd300000-0000-0000-0000-000000000004', 'cd100000-0000-0000-0000-000000000001', 'cd200000-0000-0000-0000-000000000004', 'seller',  true),
  ('cd300000-0000-0000-0000-000000000005', 'cd100000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000005', 'manager', true),
  ('cd300000-0000-0000-0000-000000000006', 'cd100000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000006', 'seller',  true),
  ('cd300000-0000-0000-0000-000000000007', 'cd100000-0000-0000-0000-000000000003', 'cd200000-0000-0000-0000-000000000007', 'manager', true);
-- cd200000-...-08 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('d1SellerA1',    'cd100000-0000-0000-0000-000000000001', 'Seller A1',       'D1-A1', 'cd200000-0000-0000-0000-000000000003', 'cd300000-0000-0000-0000-000000000003', true),
  ('d1SellerA2',    'cd100000-0000-0000-0000-000000000001', 'Seller A2',       'D1-A2', 'cd200000-0000-0000-0000-000000000004', 'cd300000-0000-0000-0000-000000000004', true),
  ('d1SellerA1Inx', 'cd100000-0000-0000-0000-000000000001', 'Seller A1 Inact', 'D1-A1I', null, null, false),
  ('d1SellerB1',    'cd100000-0000-0000-0000-000000000002', 'Seller B1',       'D1-B1', 'cd200000-0000-0000-0000-000000000006', 'cd300000-0000-0000-0000-000000000006', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('cd400000-0000-0000-0000-000000000001', 'cd100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('cd400000-0000-0000-0000-000000000002', 'cd100000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('cd500000-0000-0000-0000-000000000001', 'cd100000-0000-0000-0000-000000000001', 'Lead A1 Com Seller', '(11) 90000-9001', 'Onix',
   'cd400000-0000-0000-0000-000000000001', 'd1SellerA1'),
  ('cd500000-0000-0000-0000-000000000002', 'cd100000-0000-0000-0000-000000000002', 'Lead B1', '(11) 90000-9002', 'HB20',
   'cd400000-0000-0000-0000-000000000002', 'd1SellerB1'),
  ('cd500000-0000-0000-0000-000000000003', 'cd100000-0000-0000-0000-000000000001', 'Lead A2 Sem Seller', '(11) 90000-9003', 'HR-V',
   'cd400000-0000-0000-0000-000000000001', null);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('cd500000-0000-0000-0000-000000000004', 'cd100000-0000-0000-0000-000000000001', 'Lead A3 Arquivado', '(11) 90000-9004', 'Kicks',
   'cd400000-0000-0000-0000-000000000001', 'd1SellerA1', now());

-- ═══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public', 'deals', 'tabela public.deals existe');

select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'deal_status'),
  array['open','pending_approval','approved','rejected','sold']::text[],
  'deal_status: exatamente open/pending_approval/approved/rejected/sold, nesta ordem (sem lost/canceled/draft)');
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'deal_payment_method'),
  array['a_vista','financiamento_100','entrada_financiamento','troca']::text[],
  'deal_payment_method: exatamente a_vista/financiamento_100/entrada_financiamento/troca, nesta ordem');

select col_not_null('public', 'deals', 'company_id', 'company_id NOT NULL');
select col_not_null('public', 'deals', 'lead_id', 'lead_id NOT NULL (diferente de visits/tasks)');
select col_not_null('public', 'deals', 'client_name_snapshot', 'client_name_snapshot NOT NULL');
select col_not_null('public', 'deals', 'assigned_seller_id', 'assigned_seller_id NOT NULL');
select col_not_null('public', 'deals', 'vehicle', 'vehicle NOT NULL');
select col_not_null('public', 'deals', 'value_cents', 'value_cents NOT NULL');
select col_not_null('public', 'deals', 'discount_percent', 'discount_percent NOT NULL');
select col_not_null('public', 'deals', 'payment_method', 'payment_method NOT NULL');
select col_is_null('public', 'deals', 'down_payment_cents', 'down_payment_cents nullable');
select col_is_null('public', 'deals', 'installments', 'installments nullable');
select col_not_null('public', 'deals', 'note', 'note NOT NULL');
select col_default_is('public', 'deals', 'note', '', 'note default vazio');
select col_not_null('public', 'deals', 'status', 'status NOT NULL');
select col_default_is('public', 'deals', 'status', 'open', 'status default open (create_deal sempre recalcula)');
select col_not_null('public', 'deals', 'created_by', 'created_by NOT NULL (diferente de visits/tasks)');
select col_not_null('public', 'deals', 'updated_by', 'updated_by NOT NULL (diferente de visits/tasks)');
select col_is_null('public', 'deals', 'approved_by', 'approved_by nullable');
select col_is_null('public', 'deals', 'approved_at', 'approved_at nullable');
select col_is_null('public', 'deals', 'rejected_by', 'rejected_by nullable');
select col_is_null('public', 'deals', 'rejected_at', 'rejected_at nullable');
select col_not_null('public', 'deals', 'version', 'version NOT NULL');
select col_default_is('public', 'deals', 'version', '1', 'version default 1');

select has_check('public', 'deals', 'deals: possui pelo menos um CHECK');
select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.deals'::regclass and contype = 'c') >= 7,
  'deals: pelo menos 7 CHECK constraints (vehicle, value, down_payment, discount, version, approved_pair, rejected_pair, decision_consistency)');

select ok(
  (select confdeltype from pg_constraint where conname = 'deals_company_lead_fk') = 'r',
  'deals_company_lead_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'deals_company_seller_fk') = 'r',
  'deals_company_seller_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'deals_created_by_fk') = 'r',
  'deals_created_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'deals_updated_by_fk') = 'r',
  'deals_updated_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'deals_approved_by_fk') = 'r',
  'deals_approved_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'deals_rejected_by_fk') = 'r',
  'deals_rejected_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname like 'deals_company_id%') = 'c',
  'deals.company_id -> companies(id): ON DELETE CASCADE');

select has_index('public', 'deals', 'deals_company_status_created_idx', 'index (company_id, status, created_at) existe');
select has_index('public', 'deals', 'deals_company_seller_status_created_idx', 'index (company_id, assigned_seller_id, status, created_at) existe');
select has_index('public', 'deals', 'deals_company_lead_idx', 'index (company_id, lead_id) existe');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_deal','decide_deal')),
  2, 'as 2 RPCs de Deals existem, uma unica assinatura cada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_deal','decide_deal') and p.prosecdef),
  2, 'as 2 RPCs sao SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_deal','decide_deal')
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  2, 'as 2 RPCs tem search_path configurado explicitamente');

-- Nenhum update_deal / mark_deal_sold / sell_deal / close_deal criado.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('update_deal','mark_deal_sold','sell_deal','close_deal')),
  0, 'nenhuma RPC update_deal/mark_deal_sold/sell_deal/close_deal foi criada neste B1');

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SECURITY / GRANTS
-- ═══════════════════════════════════════════════════════════════════════

select ok(
  (select relrowsecurity from pg_class where oid = 'public.deals'::regclass),
  'RLS habilitado em public.deals');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'deals' and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1, 'authenticated: SELECT concedido em deals');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'deals' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'authenticated: nenhum grant direto de INSERT/UPDATE/DELETE em deals');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'deals' and grantee = 'anon'),
  0, 'anon: nenhum grant em deals');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'create_deal' and grantee = 'authenticated'),
  1, 'create_deal: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'decide_deal' and grantee = 'authenticated'),
  1, 'decide_deal: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name in ('create_deal','decide_deal') and grantee = 'anon'),
  0, 'nenhuma das 2 RPCs: anon tem EXECUTE');

-- ═══════════════════════════════════════════════════════════════════════
-- 3. MANAGER A (empresa CDA1 ativa) — CREATE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;

-- Lead com Seller: default automático quando nenhum seller informado.
-- Desconto 3 (<=5) -> open.
select ok(
  (select d.id from public.create_deal(
    'cd500000-0000-0000-0000-000000000001', 'Onix', 12000000, 3::smallint, 'financiamento_100'::public.deal_payment_method) d) is not null,
  'Manager: create_deal com Lead-com-Seller, sem seller explicito, funciona');
select is(
  (select d.assigned_seller_id from public.deals d where d.lead_id = 'cd500000-0000-0000-0000-000000000001'),
  'd1SellerA1', 'Manager: create_deal sem seller explicito usa o Seller do Lead');
select is(
  (select d.status from public.deals d where d.lead_id = 'cd500000-0000-0000-0000-000000000001'),
  'open'::public.deal_status, 'Manager: discount 3 (<=5) -> status open');
select is(
  (select d.client_name_snapshot from public.deals d where d.lead_id = 'cd500000-0000-0000-0000-000000000001'),
  'Lead A1 Com Seller', 'Manager: client_name_snapshot resolvido do Lead pelo backend (nunca recebido do client)');
select is(
  (select d.version from public.deals d where d.lead_id = 'cd500000-0000-0000-0000-000000000001'),
  1, 'deal inicial: version 1');
select is(
  (select d.created_by = d.updated_by and d.created_by is not null from public.deals d where d.lead_id = 'cd500000-0000-0000-0000-000000000001'),
  true, 'deal inicial: created_by = updated_by = actor, ambos preenchidos');
select is(
  (select d.approved_by is null and d.approved_at is null and d.rejected_by is null and d.rejected_at is null
     from public.deals d where d.lead_id = 'cd500000-0000-0000-0000-000000000001'),
  true, 'deal inicial (open): approved/rejected pairs todos NULL');

-- Desconto 6 (>5) -> pending_approval.
select v.id as deal_pending_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Civic', 15000000, 6::smallint, 'a_vista'::public.deal_payment_method) v \gset
select is(
  (select d.status from public.deals d where d.id = :'deal_pending_id'),
  'pending_approval'::public.deal_status, 'Manager: discount 6 (>5) -> status pending_approval');

-- Lead sem Seller: sem seller explicito -> seller_required.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000003', 'HR-V', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method)$$,
  'seller_required', 'Manager: create_deal em Lead sem Seller, sem seller explicito, e negado');

-- Lead arquivado -> lead_archived.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000004', 'Kicks', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'lead_archived', 'Manager: create_deal em Lead arquivado e negado');

-- Lead de outra empresa -> lead_not_found.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000002', 'HB20', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'lead_not_found', 'Manager: create_deal com Lead de outra empresa e negado');

-- Lead inexistente -> lead_not_found.
select throws_ok(
  $$select public.create_deal('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'lead_not_found', 'Manager: create_deal com Lead inexistente e negado');

-- Seller de outra empresa -> seller_not_found.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerB1')$$,
  'seller_not_found', 'Manager: create_deal para Seller de outra empresa e negado');

-- Seller inativo -> seller_not_found.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1Inx')$$,
  'seller_not_found', 'Manager: create_deal para Seller inativo e negado');

-- vehicle vazio/so-espacos -> invalid_vehicle.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', '   ', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'invalid_vehicle', 'Manager: create_deal com vehicle so-espacos e negado');

-- value_cents <= 0 -> invalid_value.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 0, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'invalid_value', 'Manager: create_deal com value_cents = 0 e negado');
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', -100, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'invalid_value', 'Manager: create_deal com value_cents negativo e negado');

-- discount fora de 0..10 -> invalid_discount.
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, -1::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'invalid_discount', 'Manager: create_deal com discount negativo e negado');
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 11::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'invalid_discount', 'Manager: create_deal com discount > 10 e negado');

-- payment_method invalido: rejeitado pelo proprio tipo do Postgres (22P02).
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'boleto')$$,
  '22P02', null, 'create_deal com payment_method fora do enum e rejeitado pelo tipo (nunca vira valor livre)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SELLER A1 (empresa CDA1 ativa) — CREATE / autoatribuicao
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000003');
set local role authenticated;

select is(
  (select d.assigned_seller_id from public.create_deal(
    'cd500000-0000-0000-0000-000000000001', 'Polo', 9000000, 2::smallint, 'entrada_financiamento'::public.deal_payment_method) d),
  'd1SellerA1', 'Seller: create_deal sem seller explicito normaliza para o proprio seller');
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Polo', 9000000, 2::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$,
  'forbidden', 'Seller: create_deal atribuindo a outro Seller e negado');

-- Deal para uso no isolamento RLS (Seller A2).
reset role;
select pg_temp.as_user('cd200000-0000-0000-0000-000000000004');
set local role authenticated;
select d.id as deal_a2_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Kicks', 8000000, 1::smallint, 'troca'::public.deal_payment_method) d \gset
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RLS — SELECT
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000002'); -- Manager A
set local role authenticated;
select ok(
  (select count(*)::int from public.deals) >= 3,
  'Manager A: enxerga todos os Deals da empresa (company-wide)');
select is(
  (select count(*)::int from public.deals where id = :'deal_a2_id'),
  1, 'Manager A: enxerga tambem o Deal atribuido a Seller A2 (mesma empresa)');
reset role;

select pg_temp.as_user('cd200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select is(
  (select count(*)::int from public.deals where id = :'deal_a2_id'),
  0, 'Seller A1: NAO enxerga o Deal atribuido a Seller A2 (own-only)');
select ok(
  (select count(*)::int from public.deals where assigned_seller_id = 'd1SellerA1') >= 2,
  'Seller A1: enxerga os proprios Deals');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. DECIDE_DEAL — Manager
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000003'); -- Seller
set local role authenticated;
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'approved')$$, :'deal_pending_id'),
  'forbidden', 'Seller: decide_deal e negado (Manager only), mesmo sendo o assigned_seller');
reset role;

select pg_temp.as_user('cd200000-0000-0000-0000-000000000002'); -- Manager
set local role authenticated;

select (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Proposta criada') as tl_created_count \gset
select ok(
  :tl_created_count >= 1, 'timeline: pelo menos 1 evento "Proposta criada" ja registrado pelas criacoes anteriores');

select ok(
  (select d.status from public.decide_deal(:'deal_pending_id', 1, 'approved') d) = 'approved',
  'Manager: decide_deal(approved) muda pending_approval -> approved');
select is(
  (select d.approved_by = 'cd200000-0000-0000-0000-000000000002' and d.approved_at is not null
     and d.rejected_by is null and d.rejected_at is null and d.updated_by = 'cd200000-0000-0000-0000-000000000002'
     from public.deals d where d.id = :'deal_pending_id'),
  true, 'decide_deal(approved): actor/timestamp corretos, rejected pair permanece NULL');
select is(
  (select d.version from public.deals d where d.id = :'deal_pending_id'),
  2, 'decide_deal(approved): version incrementou exatamente 1 (trigger, nunca manual)');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Proposta aprovada'),
  1, 'timeline: exatamente 1 evento "Proposta aprovada"');

-- Re-decidir um Deal ja approved -> invalid_status_transition.
select throws_ok(
  format($$select public.decide_deal(%L, 2, 'approved')$$, :'deal_pending_id'),
  'invalid_status_transition', 'Manager: decide_deal sobre Deal ja approved e negado (nao re-decide)');
select throws_ok(
  format($$select public.decide_deal(%L, 2, 'rejected')$$, :'deal_pending_id'),
  'invalid_status_transition', 'Manager: decide_deal(rejected) sobre Deal ja approved tambem e negado');

-- open -> decide e negado (nunca esteve em pending_approval).
select v.id as deal_open_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Onix 2', 9500000, 0::smallint, 'a_vista'::public.deal_payment_method) v \gset
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'approved')$$, :'deal_open_id'),
  'invalid_status_transition', 'Manager: decide_deal sobre Deal open (nunca pending_approval) e negado');

-- reject: pending_approval -> rejected.
select v.id as deal_reject_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Corolla', 14000000, 8::smallint, 'financiamento_100'::public.deal_payment_method) v \gset
select ok(
  (select d.status from public.decide_deal(:'deal_reject_id', 1, 'rejected') d) = 'rejected',
  'Manager: decide_deal(rejected) muda pending_approval -> rejected');
select is(
  (select d.rejected_by = 'cd200000-0000-0000-0000-000000000002' and d.rejected_at is not null
     and d.approved_by is null and d.approved_at is null
     from public.deals d where d.id = :'deal_reject_id'),
  true, 'decide_deal(rejected): actor/timestamp corretos, approved pair permanece NULL');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Proposta recusada'),
  1, 'timeline: exatamente 1 evento "Proposta recusada"');

-- rejected e terminal: nenhuma nova decisao.
select throws_ok(
  format($$select public.decide_deal(%L, 2, 'approved')$$, :'deal_reject_id'),
  'invalid_status_transition', 'Manager: decide_deal sobre Deal rejected (terminal) e negado');

-- p_decision fora de approved/rejected -> invalid_status_transition.
select v.id as deal_baddecision_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Compass', 16000000, 7::smallint, 'a_vista'::public.deal_payment_method) v \gset
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'sold')$$, :'deal_baddecision_id'),
  'invalid_status_transition', 'Manager: decide_deal com p_decision fora de approved/rejected e negado');

-- deal inexistente / de outra empresa -> deal_not_found (verificado na secao 8, apos Manager B existir).

-- ═══════════════════════════════════════════════════════════════════════
-- 7. STALE_WRITE (test-only: version bumpada fora do RPC, mantendo status)
-- ═══════════════════════════════════════════════════════════════════════

-- deal_baddecision_id ainda esta pending_approval, version 1. Bump direto
-- (como postgres, fora de qualquer RPC) simula uma corrida real sem
-- precisar de update_deal (que nao existe neste B1).
reset role;
update public.deals set note = 'bump de teste' where id = :'deal_baddecision_id';
select is(
  (select d.version from public.deals d where d.id = :'deal_baddecision_id'),
  2, 'fixture: version bumpada para 2 fora de qualquer RPC (simula corrida)');

select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'approved')$$, :'deal_baddecision_id'),
  'stale_write', 'Manager: decide_deal com expected_version desatualizada (1, real=2) e negado');
select ok(
  (select d.status from public.decide_deal(:'deal_baddecision_id', 2, 'approved') d) = 'approved',
  'Manager: decide_deal com expected_version correta (2) funciona normalmente');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. TENANCY / CROSS-COMPANY / EMPRESA NAO-ATIVA / SEM MEMBERSHIP / SUPER ADMIN
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000005'); -- Manager B (CDA2 ativa, outra empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.deals where id in (:'deal_pending_id', :'deal_a2_id', :'deal_open_id')),
  0, 'Manager B (CDA2): nenhum Deal de CDA1 e visivel (isolamento por company_id)');
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'approved')$$, :'deal_open_id'),
  'deal_not_found', 'Manager B: decide_deal num Deal de outra empresa e negado como deal_not_found');
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'lead_not_found', 'Manager B: create_deal com Lead de outra empresa e negado (lead_not_found, isolamento)');
reset role;

select pg_temp.as_user('cd200000-0000-0000-0000-000000000007'); -- Manager C (CDA3 suspensa)
set local role authenticated;
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'forbidden', 'Manager C (empresa suspensa): create_deal negado');
reset role;

select pg_temp.as_user('cd200000-0000-0000-0000-000000000008'); -- Sem Membership
set local role authenticated;
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method)$$,
  'forbidden', 'Profile sem membership ativa: create_deal negado');
reset role;

select pg_temp.as_user('cd200000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$,
  'forbidden', 'Super Admin: create_deal negado (Deals nao tem superficie de Super Admin neste B1)');
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'approved')$$, :'deal_open_id'),
  'forbidden', 'Super Admin: decide_deal negado');
select is(
  (select count(*)::int from public.deals),
  0, 'Super Admin: SELECT direto em deals nao enxerga nenhuma linha (sem policy propria)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. INTEGRIDADE DE DADOS / TERMINAL CONSISTENCY (direto, como postgres)
-- ═══════════════════════════════════════════════════════════════════════

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', '   ', 10000000, 3, 'a_vista', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: vehicle so-espacos viola deals_vehicle_ck');

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 0, 3, 'a_vista', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: value_cents = 0 viola deals_value_ck');

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 11, 'a_vista', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: discount_percent 11 viola deals_discount_ck');

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, down_payment_cents, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', -1, 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: down_payment_cents negativo viola deals_down_payment_ck');

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, approved_by, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'approved', null, 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: status approved sem approved_by viola deals_decision_consistency_ck');

select throws_ok(
  format($$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, approved_by, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'approved', %L, 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
    'cd200000-0000-0000-0000-000000000002'),
  '23514', null, 'insert direto: approved_by preenchido sem approved_at viola deals_approved_pair_ck');

select throws_ok(
  format($$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, rejected_by, rejected_at, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'sold', %L, now(), 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
    'cd200000-0000-0000-0000-000000000002'),
  '23514', null, 'insert direto: status sold com rejected pair preenchido viola deals_decision_consistency_ck (sold nunca carrega rejection)');

-- sold vindo de OPEN (approval pair NULL) -- deve ser aceito. INSERT ...
-- RETURNING precisa ser o statement de topo (nao pode ir dentro de um WITH
-- data-modifying aninhado numa subquery escalar) -- captura via \gset, mesmo
-- idioma psql ja usado para create_visit/create_deal acima.
insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3::smallint, 'a_vista', 'sold', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')
returning id as deal_sold_from_open_id \gset
select ok(:'deal_sold_from_open_id' is not null,
  'insert direto: status sold com approval pair NULL (veio de open) e aceito');

-- sold vindo de APPROVED (approval pair PRESENTE, preservado) -- deve ser aceito.
insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, approved_by, approved_at, created_by, updated_by)
values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3::smallint, 'a_vista', 'sold', 'cd200000-0000-0000-0000-000000000002', now(), 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')
returning id as deal_sold_from_approved_id \gset
select ok(:'deal_sold_from_approved_id' is not null,
  'insert direto: status sold com approval pair PRESENTE (preservado de approved) e aceito — nunca apagado na transicao futura');

-- Deal sold: decide_deal negado (invalid_status_transition), fixture estrutural direto (sem RPC publica de sold).
insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3::smallint, 'a_vista', 'sold', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')
returning id as deal_sold_id \gset
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'approved')$$, :'deal_sold_id'),
  'invalid_status_transition', 'Manager: decide_deal sobre Deal sold (terminal, so alcancavel via fixture) e negado');
reset role;

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23503', null, 'insert direto: lead_id inexistente/de outra empresa viola deals_company_lead_fk');

-- ═══════════════════════════════════════════════════════════════════════
-- 10. ANON — nunca executa nada
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select count(*) from public.deals$$, '42501', null, 'anon: SELECT direto em deals falha');
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method)$$,
  '42501', null, 'anon: create_deal falha (sem EXECUTE)');
select throws_ok(
  format($$select public.decide_deal(%L, 1, 'approved')$$, :'deal_open_id'),
  '42501', null, 'anon: decide_deal falha (sem EXECUTE)');
reset role;

select * from finish();
rollback;
