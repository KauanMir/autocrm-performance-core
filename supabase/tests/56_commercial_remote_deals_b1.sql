-- COMMERCIAL-REMOTE-DEALS-B1 — Negociações remoto: schema + RLS + RPC
-- (pivot de produto: sem approval workflow). Prova: (1) deals/enums/
-- checks/FKs/indexes exatamente como desenhado (open/lost/sold, sem
-- pending_approval/approved/rejected); (2) RLS SELECT-only, escrita direta
-- revogada de anon/authenticated; (3) create_deal sempre nasce open,
-- discount NUNCA controla lifecycle; (4) update_deal só quando open,
-- Manager (empresa inteira, pode reatribuir) e Seller (só a própria, nunca
-- reatribui), lead_id/client_name_snapshot imutáveis, Lead arquivado
-- bloqueia; (5) mark_deal_lost Manager/Seller, terminal, funciona mesmo com
-- Lead arquivado depois; (6) isolamento cross-company; (7) concorrência
-- otimista (version/expected_version/stale_write) em update_deal e
-- mark_deal_lost; (8) lost actor/timestamp pair consistency; (9) timeline
-- sem duplicata (create 1x, update comum 0x, reatribuição 1x, lost 1x);
-- (10) anon nunca executa. Roda como postgres. Rollback ao final — nenhum
-- dado persiste.

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
   'cd400000-0000-0000-0000-000000000001', null),
  ('cd500000-0000-0000-0000-000000000005', 'cd100000-0000-0000-0000-000000000001', 'Lead A5 Para Arquivar Depois', '(11) 90000-9005', 'Kicks',
   'cd400000-0000-0000-0000-000000000001', 'd1SellerA1');

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
  array['open','lost','sold']::text[],
  'deal_status: exatamente open/lost/sold, nesta ordem (sem pending_approval/approved/rejected/draft/canceled/thinking)');
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'deal_payment_method'),
  array['a_vista','financiamento_100','entrada_financiamento','troca']::text[],
  'deal_payment_method: exatamente a_vista/financiamento_100/entrada_financiamento/troca, nesta ordem (inalterado pelo pivot)');

select col_not_null('public', 'deals', 'company_id', 'company_id NOT NULL');
select col_not_null('public', 'deals', 'lead_id', 'lead_id NOT NULL');
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
select col_default_is('public', 'deals', 'status', 'open', 'status default open');
select col_not_null('public', 'deals', 'created_by', 'created_by NOT NULL');
select col_not_null('public', 'deals', 'updated_by', 'updated_by NOT NULL');
select col_is_null('public', 'deals', 'lost_by', 'lost_by nullable');
select col_is_null('public', 'deals', 'lost_at', 'lost_at nullable');
select has_column('public', 'deals', 'lost_by', 'coluna lost_by existe (novo lifecycle)');
select has_column('public', 'deals', 'lost_at', 'coluna lost_at existe (novo lifecycle)');
select hasnt_column('public', 'deals', 'approved_by', 'coluna approved_by NAO existe mais (approval workflow removido)');
select hasnt_column('public', 'deals', 'approved_at', 'coluna approved_at NAO existe mais');
select hasnt_column('public', 'deals', 'rejected_by', 'coluna rejected_by NAO existe mais');
select hasnt_column('public', 'deals', 'rejected_at', 'coluna rejected_at NAO existe mais');
select col_not_null('public', 'deals', 'version', 'version NOT NULL');
select col_default_is('public', 'deals', 'version', '1', 'version default 1');

select has_check('public', 'deals', 'deals: possui pelo menos um CHECK');
select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.deals'::regclass and contype = 'c') >= 6,
  'deals: pelo menos 6 CHECK constraints (vehicle, value, down_payment, discount, version, lost_pair, lost_consistency)');

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
  (select confdeltype from pg_constraint where conname = 'deals_lost_by_fk') = 'r',
  'deals_lost_by_fk: ON DELETE RESTRICT (novo lifecycle)');
select ok(
  (select confdeltype from pg_constraint where conname like 'deals_company_id%') = 'c',
  'deals.company_id -> companies(id): ON DELETE CASCADE');

select has_index('public', 'deals', 'deals_company_status_created_idx', 'index (company_id, status, created_at) existe');
select has_index('public', 'deals', 'deals_company_seller_status_created_idx', 'index (company_id, assigned_seller_id, status, created_at) existe');
select has_index('public', 'deals', 'deals_company_lead_idx', 'index (company_id, lead_id) existe');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_deal','update_deal','mark_deal_lost')),
  3, 'as 3 RPCs de Deals existem, uma unica assinatura cada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_deal','update_deal','mark_deal_lost') and p.prosecdef),
  3, 'as 3 RPCs sao SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_deal','update_deal','mark_deal_lost')
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  3, 'as 3 RPCs tem search_path configurado explicitamente');

-- Nenhum vestigio funcional do workflow de aprovacao antigo.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('decide_deal','mark_deal_sold','sell_deal','close_deal')),
  0, 'nenhuma RPC decide_deal/mark_deal_sold/sell_deal/close_deal existe (approval workflow removido, sold sem RPC publica)');

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
    where routine_schema = 'public' and routine_name in ('create_deal','update_deal','mark_deal_lost') and grantee = 'authenticated'),
  3, 'as 3 RPCs: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name in ('create_deal','update_deal','mark_deal_lost') and grantee = 'anon'),
  0, 'nenhuma das 3 RPCs: anon tem EXECUTE');

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CREATE — discount nunca controla lifecycle
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000002'); -- Manager A
set local role authenticated;

-- Discount 0, 5, 6, 10 -> sempre open (prova explicita: discount nao afeta status).
select v.id as deal_disc0_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Onix', 12000000, 0::smallint, 'financiamento_100'::public.deal_payment_method) v \gset
select v.id as deal_disc5_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Civic', 13000000, 5::smallint, 'financiamento_100'::public.deal_payment_method) v \gset
select v.id as deal_disc6_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Corolla', 14000000, 6::smallint, 'a_vista'::public.deal_payment_method) v \gset
select v.id as deal_disc10_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Compass', 16000000, 10::smallint, 'troca'::public.deal_payment_method) v \gset

select is(
  (select array_agg(d.status order by d.discount_percent) from public.deals d
    where d.id in (:'deal_disc0_id', :'deal_disc5_id', :'deal_disc6_id', :'deal_disc10_id')),
  array['open','open','open','open']::public.deal_status[],
  'DISCOUNT DOES NOT CONTROL LIFECYCLE: discount 0/5/6/10 resultam TODOS em status open');

select is(
  (select d.client_name_snapshot from public.deals d where d.id = :'deal_disc0_id'),
  'Lead A1 Com Seller', 'create_deal: client_name_snapshot resolvido do Lead pelo backend');
select is(
  (select d.assigned_seller_id from public.deals d where d.id = :'deal_disc0_id'),
  'd1SellerA1', 'create_deal: sem seller explicito usa o Seller do Lead');
select is(
  (select d.version from public.deals d where d.id = :'deal_disc0_id'),
  1, 'deal inicial: version 1');
select is(
  (select d.lost_by is null and d.lost_at is null from public.deals d where d.id = :'deal_disc0_id'),
  true, 'deal inicial (open): lost pair NULL');

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
  '22P02', null, 'create_deal com payment_method fora do enum e rejeitado pelo tipo');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SELLER A1 — CREATE / autoatribuicao
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;

select is(
  (select d.assigned_seller_id from public.create_deal(
    'cd500000-0000-0000-0000-000000000001', 'Polo', 9000000, 2::smallint, 'entrada_financiamento'::public.deal_payment_method) d),
  'd1SellerA1', 'Seller: create_deal sem seller explicito normaliza para o proprio seller');
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Polo', 9000000, 2::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$,
  'forbidden', 'Seller: create_deal atribuindo a outro Seller e negado');

-- Deal propria do Seller A1 para os testes de update/lost abaixo.
select v.id as deal_a1_own_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Civic Own', 11000000, 3::smallint, 'a_vista'::public.deal_payment_method) v \gset

reset role;

-- Deal do Seller A2 para uso no isolamento RLS.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000004'); -- Seller A2
set local role authenticated;
select d.id as deal_a2_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000001', 'Kicks A2', 8000000, 1::smallint, 'troca'::public.deal_payment_method) d \gset
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
-- 6. UPDATE_DEAL
-- ═══════════════════════════════════════════════════════════════════════

-- Seller: cross-seller e negado.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select throws_ok(
  format($$select public.update_deal(%L, 1, 'Kicks', 8500000, 2::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$, :'deal_a2_id'),
  'forbidden', 'Seller A1: update_deal em Deal de outro Seller e negado');
reset role;

-- Seller: pode atualizar a propria, mas nao pode reatribuir.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok(
  format($$select public.update_deal(%L, 1, 'Civic Own v2', 11500000, 4::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$, :'deal_a1_own_id'),
  'forbidden', 'Seller A1: update_deal tentando reatribuir a propria Deal para outro Seller e negado');

select (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001') as tl_before_update \gset
select is(
  (select d.vehicle from public.update_deal(
    :'deal_a1_own_id', 1, 'Civic Own v2', 11500000, 4::smallint, 'a_vista'::public.deal_payment_method, 200000, '48x', 'nota atualizada', 'd1SellerA1') d),
  'Civic Own v2', 'Seller A1: update_deal na propria Deal (mesmo seller) funciona');
select is(
  (select d.value_cents = 11500000 and d.discount_percent = 4 and d.down_payment_cents = 200000
     and d.installments = '48x' and d.note = 'nota atualizada'
     from public.deals d where d.id = :'deal_a1_own_id'),
  true, 'update_deal: todos os campos editaveis persistidos corretamente');
select is(
  (select d.version from public.deals d where d.id = :'deal_a1_own_id'),
  2, 'update_deal: version incrementou exatamente 1 (trigger, nunca manual)');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001'),
  :tl_before_update, 'update_deal SEM reatribuicao NAO gera nenhum evento de timeline (evita poluir)');
reset role;

-- Manager: pode atualizar Deal da company e reatribuir.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Responsável alterado') as tl_reassign_before \gset
select is(
  (select d.assigned_seller_id from public.update_deal(
    :'deal_a1_own_id', 2, 'Civic Own v3', 12000000, 5::smallint, 'financiamento_100'::public.deal_payment_method, null, null, '', 'd1SellerA2') d),
  'd1SellerA2', 'Manager: update_deal reatribui para Seller A2');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Responsável alterado'),
  :tl_reassign_before + 1, 'update_deal COM reatribuicao real gera exatamente 1 evento "Responsável alterado"');

-- Reatribuir para o MESMO seller nao gera novo evento.
select is(
  (select d.assigned_seller_id from public.update_deal(
    :'deal_a1_own_id', 3, 'Civic Own v3', 12000000, 5::smallint, 'financiamento_100'::public.deal_payment_method, null, null, '', 'd1SellerA2') d),
  'd1SellerA2', 'Manager: update_deal informando o MESMO seller atual funciona');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Responsável alterado'),
  :tl_reassign_before + 1, 'update_deal reatribuindo para o MESMO seller NAO gera novo evento');

-- Manager: seller inexistente/inativo -> seller_not_found.
select throws_ok(
  format($$select public.update_deal(%L, 4, 'Civic', 12000000, 5::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1Inx')$$, :'deal_a1_own_id'),
  'seller_not_found', 'Manager: update_deal reatribuindo para Seller inativo e negado');

-- stale_write.
select throws_ok(
  format($$select public.update_deal(%L, 1, 'Civic', 12000000, 5::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$, :'deal_a1_own_id'),
  'stale_write', 'Manager: update_deal com expected_version desatualizada e negado');

-- validacoes de negocio tambem valem em update.
select throws_ok(
  format($$select public.update_deal(%L, 4, '   ', 12000000, 5::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$, :'deal_a1_own_id'),
  'invalid_vehicle', 'update_deal: vehicle so-espacos e negado');
select throws_ok(
  format($$select public.update_deal(%L, 4, 'Civic', 0, 5::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$, :'deal_a1_own_id'),
  'invalid_value', 'update_deal: value_cents = 0 e negado');
select throws_ok(
  format($$select public.update_deal(%L, 4, 'Civic', 12000000, 11::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA2')$$, :'deal_a1_own_id'),
  'invalid_discount', 'update_deal: discount > 10 e negado');

reset role;

-- update_deal em Deal com Lead arquivado -> lead_archived.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select v.id as deal_will_archive_id from public.create_deal(
  'cd500000-0000-0000-0000-000000000005', 'Kicks Archive Test', 9000000, 2::smallint, 'a_vista'::public.deal_payment_method) v \gset
reset role;
update public.leads set archived_at = now() where id = 'cd500000-0000-0000-0000-000000000005';
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.update_deal(%L, 1, 'Kicks', 9500000, 2::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$, :'deal_will_archive_id'),
  'lead_archived', 'Manager: update_deal em Deal cujo Lead foi arquivado depois e negado');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. MARK_DEAL_LOST
-- ═══════════════════════════════════════════════════════════════════════

-- Seller: cross-seller e negado.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select throws_ok(
  format($$select public.mark_deal_lost(%L, 1)$$, :'deal_a2_id'),
  'forbidden', 'Seller A1: mark_deal_lost em Deal de outro Seller e negado');
reset role;

-- Seller: marca a propria Deal como lost.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000003');
set local role authenticated;
select (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Negociação perdida') as tl_lost_before \gset
select ok(
  (select d.status from public.mark_deal_lost(:'deal_disc0_id', 1) d) = 'lost',
  'Seller: mark_deal_lost na propria Deal muda open -> lost');
select is(
  (select d.lost_by = 'cd200000-0000-0000-0000-000000000003' and d.lost_at is not null and d.updated_by = 'cd200000-0000-0000-0000-000000000003'
     from public.deals d where d.id = :'deal_disc0_id'),
  true, 'mark_deal_lost: actor/timestamp corretos');
select is(
  (select d.version from public.deals d where d.id = :'deal_disc0_id'),
  2, 'mark_deal_lost: version incrementou exatamente 1');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cd500000-0000-0000-0000-000000000001' and label = 'Negociação perdida'),
  :tl_lost_before + 1, 'timeline: exatamente 1 novo evento "Negociação perdida"');

-- lost e terminal: update/lost seguinte -> deal_closed.
select throws_ok(
  format($$select public.mark_deal_lost(%L, 2)$$, :'deal_disc0_id'),
  'deal_closed', 'Seller: mark_deal_lost sobre Deal ja lost (terminal) e negado');
select throws_ok(
  format($$select public.update_deal(%L, 2, 'Onix', 12500000, 1::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$, :'deal_disc0_id'),
  'deal_closed', 'Seller: update_deal sobre Deal ja lost (terminal) e negado');
reset role;

-- Manager: marca Deal de qualquer Seller da company como lost.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select ok(
  (select d.status from public.mark_deal_lost(:'deal_disc5_id', 1) d) = 'lost',
  'Manager: mark_deal_lost em Deal de qualquer Seller da company funciona');
select is(
  (select d.lost_by from public.deals d where d.id = :'deal_disc5_id'),
  'cd200000-0000-0000-0000-000000000002', 'Manager: lost_by = actor Manager');

-- Teste de stale_write em mark_deal_lost: bump fora do RPC, mantendo status open.
reset role;
update public.deals set note = 'bump de teste' where id = :'deal_disc6_id';
select is(
  (select d.version from public.deals d where d.id = :'deal_disc6_id'),
  2, 'fixture: version bumpada para 2 fora de qualquer RPC (simula corrida)');
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.mark_deal_lost(%L, 1)$$, :'deal_disc6_id'),
  'stale_write', 'Manager: mark_deal_lost com expected_version desatualizada (1, real=2) e negado');
select ok(
  (select d.status from public.mark_deal_lost(:'deal_disc6_id', 2) d) = 'lost',
  'Manager: mark_deal_lost com expected_version correta (2) funciona');
reset role;

-- mark_deal_lost funciona mesmo com Lead arquivado depois.
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select ok(
  (select d.status from public.mark_deal_lost(:'deal_will_archive_id', 1) d) = 'lost',
  'Manager: mark_deal_lost em Deal cujo Lead foi arquivado depois AINDA funciona (fechamento nao exige reativar Lead)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. LOST CONSTRAINT (direto, como postgres)
-- ═══════════════════════════════════════════════════════════════════════

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, lost_by, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'open', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: status open com lost_by preenchido viola deals_lost_consistency_ck');

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'lost', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: status lost sem lost_by viola deals_lost_consistency_ck');

select throws_ok(
  format($$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, lost_by, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'sold', %L, 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
    'cd200000-0000-0000-0000-000000000002'),
  '23514', null, 'insert direto: status sold com lost_by preenchido viola deals_lost_consistency_ck (sold nunca carrega lost metadata)');

select throws_ok(
  format($$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, lost_by, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', %L, 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
    'cd200000-0000-0000-0000-000000000002'),
  '23514', null, 'insert direto: lost_by preenchido sem lost_at viola deals_lost_pair_ck');

-- sold: aceito com lost pair NULL (unico caminho compativel, pois nenhum RPC
-- deste lote alcanca sold e nao existe mais metadata de approval a preservar).
insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
values ('cd100000-0000-0000-0000-000000000001', 'cd500000-0000-0000-0000-000000000001', 'X', 'd1SellerA1', 'Golf', 10000000, 3::smallint, 'a_vista', 'sold', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')
returning id as deal_sold_id \gset
select ok(:'deal_sold_id' is not null, 'insert direto: status sold com lost pair NULL e aceito');

-- Deal sold: update/lost negados (terminal, so alcancavel via fixture).
select pg_temp.as_user('cd200000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.mark_deal_lost(%L, 1)$$, :'deal_sold_id'),
  'deal_closed', 'Manager: mark_deal_lost sobre Deal sold (terminal) e negado');
select throws_ok(
  format($$select public.update_deal(%L, 1, 'Golf', 10500000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$, :'deal_sold_id'),
  'deal_closed', 'Manager: update_deal sobre Deal sold (terminal) e negado');
reset role;

select throws_ok(
  $$insert into public.deals (company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by)
    values ('cd100000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'X', 'd1SellerA1', 'Golf', 10000000, 3, 'a_vista', 'cd200000-0000-0000-0000-000000000002', 'cd200000-0000-0000-0000-000000000002')$$,
  '23503', null, 'insert direto: lead_id inexistente/de outra empresa viola deals_company_lead_fk');

-- ═══════════════════════════════════════════════════════════════════════
-- 9. TENANCY / CROSS-COMPANY / EMPRESA NAO-ATIVA / SEM MEMBERSHIP / SUPER ADMIN
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cd200000-0000-0000-0000-000000000005'); -- Manager B (CDA2 ativa, outra empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.deals where id in (:'deal_a2_id', :'deal_a1_own_id', :'deal_disc10_id')),
  0, 'Manager B (CDA2): nenhum Deal de CDA1 e visivel (isolamento por company_id)');
select throws_ok(
  format($$select public.mark_deal_lost(%L, 1)$$, :'deal_disc10_id'),
  'deal_not_found', 'Manager B: mark_deal_lost num Deal de outra empresa e negado como deal_not_found');
select throws_ok(
  format($$select public.update_deal(%L, 1, 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$, :'deal_disc10_id'),
  'deal_not_found', 'Manager B: update_deal num Deal de outra empresa e negado como deal_not_found');
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
  format($$select public.mark_deal_lost(%L, 1)$$, :'deal_disc10_id'),
  'forbidden', 'Super Admin: mark_deal_lost negado');
select is(
  (select count(*)::int from public.deals),
  0, 'Super Admin: SELECT direto em deals nao enxerga nenhuma linha (sem policy propria)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. ANON — nunca executa nada
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select count(*) from public.deals$$, '42501', null, 'anon: SELECT direto em deals falha');
select throws_ok(
  $$select public.create_deal('cd500000-0000-0000-0000-000000000001', 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method)$$,
  '42501', null, 'anon: create_deal falha (sem EXECUTE)');
select throws_ok(
  format($$select public.update_deal(%L, 1, 'Golf', 10000000, 3::smallint, 'a_vista'::public.deal_payment_method, null, null, '', 'd1SellerA1')$$, :'deal_disc10_id'),
  '42501', null, 'anon: update_deal falha (sem EXECUTE)');
select throws_ok(
  format($$select public.mark_deal_lost(%L, 1)$$, :'deal_disc10_id'),
  '42501', null, 'anon: mark_deal_lost falha (sem EXECUTE)');
reset role;

select * from finish();
rollback;
