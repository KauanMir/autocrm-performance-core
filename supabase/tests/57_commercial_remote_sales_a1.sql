-- COMMERCIAL-REMOTE-SALES-A1 — Vendas remoto: schema + RLS + RPC register_sale.
-- Prova: (1) sales/enums/checks/FKs/indexes exatamente como desenhado, sem
-- sale_status; (2) RLS SELECT-only, escrita direta revogada de anon/
-- authenticated; (3) register_sale: Deal OPEN -> Sale persistida + Deal
-- SOLD, atômico, company_id/lead_id/assigned_seller_id sempre copiados da
-- Deal (nunca do cliente); (4) Manager (qualquer Deal da company) e Seller
-- (só a própria); (5) isolamento cross-company; (6) Deal lost/sold já
-- fechada -> deal_closed, nenhuma segunda Sale; (7) stale_write; (8)
-- sold_value_cents/payment_method inválidos rejeitados; (9) timeline exatos
-- 1 evento "Venda registrada"; (10) RLS SELECT (Manager company-wide,
-- Seller own-only); (11) anon nunca executa; (12) mark_deal_sold NÃO
-- existe. resolve_commercial_mutation_context já é totalmente coberto pela
-- suíte de Deals (56) e reutilizado sem alteração — não reexercitado aqui
-- em toda a superfície (suspensa/sem membership/Super Admin), só o
-- necessário para provar que register_sale usa o mesmo resolver.
-- Roda como postgres. Rollback ao final — nenhum dado persiste.

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
  ('ca100000-0000-0000-0000-000000000001', 'S1 Sales Empresa A Ativa', 'ativa'),
  ('ca100000-0000-0000-0000-000000000002', 'S1 Sales Empresa B Ativa (outra)', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's1-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's1-seller-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's1-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's1-seller-b1@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('ca200000-0000-0000-0000-000000000001', 'Manager A',  's1-manager-a@test.local',  true, null),
  ('ca200000-0000-0000-0000-000000000002', 'Seller A1',  's1-seller-a1@test.local',  true, null),
  ('ca200000-0000-0000-0000-000000000003', 'Seller A2',  's1-seller-a2@test.local',  true, null),
  ('ca200000-0000-0000-0000-000000000004', 'Manager B',  's1-manager-b@test.local',  true, null),
  ('ca200000-0000-0000-0000-000000000005', 'Seller B1',  's1-seller-b1@test.local',  true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('ca300000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000001', 'manager', true),
  ('ca300000-0000-0000-0000-000000000002', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000002', 'seller',  true),
  ('ca300000-0000-0000-0000-000000000003', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000003', 'seller',  true),
  ('ca300000-0000-0000-0000-000000000004', 'ca100000-0000-0000-0000-000000000002', 'ca200000-0000-0000-0000-000000000004', 'manager', true),
  ('ca300000-0000-0000-0000-000000000005', 'ca100000-0000-0000-0000-000000000002', 'ca200000-0000-0000-0000-000000000005', 'seller',  true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('s1SellerA1', 'ca100000-0000-0000-0000-000000000001', 'Seller A1', 'S1-A1', 'ca200000-0000-0000-0000-000000000002', 'ca300000-0000-0000-0000-000000000002', true),
  ('s1SellerA2', 'ca100000-0000-0000-0000-000000000001', 'Seller A2', 'S1-A2', 'ca200000-0000-0000-0000-000000000003', 'ca300000-0000-0000-0000-000000000003', true),
  ('s1SellerB1', 'ca100000-0000-0000-0000-000000000002', 'Seller B1', 'S1-B1', 'ca200000-0000-0000-0000-000000000005', 'ca300000-0000-0000-0000-000000000005', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('ca400000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('ca400000-0000-0000-0000-000000000002', 'ca100000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('ca500000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', 'Lead A1', '(11) 90001-0001', 'Onix', 'ca400000-0000-0000-0000-000000000001', 's1SellerA1'),
  ('ca500000-0000-0000-0000-000000000002', 'ca100000-0000-0000-0000-000000000001', 'Lead A2', '(11) 90001-0002', 'HR-V', 'ca400000-0000-0000-0000-000000000001', 's1SellerA2'),
  ('ca500000-0000-0000-0000-000000000003', 'ca100000-0000-0000-0000-000000000002', 'Lead B1', '(11) 90001-0003', 'HB20', 'ca400000-0000-0000-0000-000000000002', 's1SellerB1');

-- ═══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public', 'sales', 'tabela public.sales existe');

select ok(
  (select count(*)::int from pg_constraint where conname = 'deals_id_company_uidx' and contype = 'u') = 1,
  'deals: unique (company_id, id) adicionada (habilita FK composta de sales, aditivo puro)');

select col_not_null('public', 'sales', 'company_id', 'company_id NOT NULL');
select col_not_null('public', 'sales', 'deal_id', 'deal_id NOT NULL');
select col_not_null('public', 'sales', 'lead_id', 'lead_id NOT NULL');
select col_not_null('public', 'sales', 'assigned_seller_id', 'assigned_seller_id NOT NULL');
select col_not_null('public', 'sales', 'sold_value_cents', 'sold_value_cents NOT NULL');
select col_not_null('public', 'sales', 'payment_method', 'payment_method NOT NULL');
select col_not_null('public', 'sales', 'sold_by', 'sold_by NOT NULL');
select col_not_null('public', 'sales', 'sold_at', 'sold_at NOT NULL');
select col_not_null('public', 'sales', 'created_at', 'created_at NOT NULL');
select hasnt_column('public', 'sales', 'status', 'coluna status NAO existe (Sale nasce final, sem sale_status neste V1)');
select hasnt_column('public', 'sales', 'version', 'coluna version NAO existe (Sale e imutavel, sem concorrencia otimista propria)');
select hasnt_column('public', 'sales', 'vehicle', 'coluna vehicle NAO existe (acessivel via FK deal_id, nunca duplicada)');

select has_check('public', 'sales', 'sales: possui pelo menos um CHECK');
select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.sales'::regclass and contype = 'c') >= 1,
  'sales: pelo menos 1 CHECK constraint (sold_value_cents > 0)');

select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.sales'::regclass and contype = 'u' and conkey = array[
    (select attnum from pg_attribute where attrelid = 'public.sales'::regclass and attname = 'deal_id')
  ]) = 1,
  'sales_deal_id_uniq: UNIQUE(deal_id) existe — uma Deal produz no maximo uma Sale');

select ok(
  (select confdeltype from pg_constraint where conname = 'sales_company_deal_fk') = 'r',
  'sales_company_deal_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'sales_company_lead_fk') = 'r',
  'sales_company_lead_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'sales_company_seller_fk') = 'r',
  'sales_company_seller_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'sales_sold_by_fk') = 'r',
  'sales_sold_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname like 'sales_company_id%') = 'c',
  'sales.company_id -> companies(id): ON DELETE CASCADE');

select has_index('public', 'sales', 'sales_company_sold_at_idx', 'index (company_id, sold_at) existe');
select has_index('public', 'sales', 'sales_company_seller_sold_at_idx', 'index (company_id, assigned_seller_id, sold_at) existe');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_sale'),
  1, 'register_sale existe, uma unica assinatura');
select ok(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_sale'),
  'register_sale e SECURITY DEFINER');
select ok(
  (select exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_sale'),
  'register_sale tem search_path configurado explicitamente');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('mark_deal_sold','sell_deal','close_deal','update_sale','cancel_sale','delete_sale','restore_sale')),
  0, 'nenhuma RPC mark_deal_sold/sell_deal/close_deal/update_sale/cancel_sale/delete_sale/restore_sale existe (register_sale e a UNICA autoridade open->sold, Sale imutavel)');

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SECURITY / GRANTS
-- ═══════════════════════════════════════════════════════════════════════

select ok(
  (select relrowsecurity from pg_class where oid = 'public.sales'::regclass),
  'RLS habilitado em public.sales');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sales' and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1, 'authenticated: SELECT concedido em sales');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sales' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'authenticated: nenhum grant direto de INSERT/UPDATE/DELETE em sales');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sales' and grantee = 'anon'),
  0, 'anon: nenhum grant em sales');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'register_sale' and grantee = 'authenticated'),
  1, 'register_sale: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'register_sale' and grantee = 'anon'),
  0, 'register_sale: anon NAO tem EXECUTE');

-- ═══════════════════════════════════════════════════════════════════════
-- 3. MANAGER — register_sale em Deal OPEN da company
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

select v.id as deal_mgr_id from public.create_deal(
  'ca500000-0000-0000-0000-000000000001', 'Golf GTI', 12000000, 0::smallint, 'financiamento_100'::public.deal_payment_method) v \gset

select (select count(*)::int from public.lead_timeline_entries where lead_id = 'ca500000-0000-0000-0000-000000000001' and label = 'Venda registrada') as tl_before_mgr \gset

select is(
  (select d.status from public.register_sale(:'deal_mgr_id', 1, 11500000, 'a_vista'::public.deal_payment_method) d),
  'sold'::public.deal_status, 'Manager: register_sale em Deal OPEN da company muda status para sold');
select is(
  (select d.version from public.deals d where d.id = :'deal_mgr_id'),
  2, 'register_sale: Deal.version incrementou exatamente 1 (mesmo trigger de sempre)');

select is(
  (select count(*)::int from public.sales where deal_id = :'deal_mgr_id'),
  1, 'register_sale: exatamente 1 Sale persistida para a Deal');
select is(
  (select s.company_id from public.sales s where s.deal_id = :'deal_mgr_id'),
  'ca100000-0000-0000-0000-000000000001', 'Sale.company_id copiado da Deal');
select is(
  (select s.lead_id from public.sales s where s.deal_id = :'deal_mgr_id'),
  'ca500000-0000-0000-0000-000000000001', 'Sale.lead_id copiado da Deal (nunca do cliente)');
select is(
  (select s.assigned_seller_id from public.sales s where s.deal_id = :'deal_mgr_id'),
  's1SellerA1', 'Sale.assigned_seller_id copiado da Deal (nunca do cliente)');
select is(
  (select s.sold_value_cents from public.sales s where s.deal_id = :'deal_mgr_id'),
  11500000::bigint, 'Sale.sold_value_cents = valor final enviado (pode divergir do value_cents da Deal)');
select is(
  (select s.payment_method from public.sales s where s.deal_id = :'deal_mgr_id'),
  'a_vista'::public.deal_payment_method, 'Sale.payment_method = forma final enviada');
select is(
  (select s.sold_by from public.sales s where s.deal_id = :'deal_mgr_id'),
  'ca200000-0000-0000-0000-000000000001', 'Sale.sold_by = ator (Manager A)');
select ok(
  (select s.sold_at is not null from public.sales s where s.deal_id = :'deal_mgr_id'),
  'Sale.sold_at preenchido pelo servidor');

select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'ca500000-0000-0000-0000-000000000001' and label = 'Venda registrada'),
  :tl_before_mgr + 1, 'timeline: exatamente 1 novo evento "Venda registrada"');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'ca500000-0000-0000-0000-000000000001' and label = 'Deal atualizada'),
  0, 'timeline: nenhum evento generico "Deal atualizada" (so o evento semantico previsto)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SELLER — own-only
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000002'); -- Seller A1
set local role authenticated;
select v.id as deal_a1_id from public.create_deal(
  'ca500000-0000-0000-0000-000000000001', 'Civic', 9000000, 0::smallint, 'a_vista'::public.deal_payment_method) v \gset
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000003'); -- Seller A2
set local role authenticated;
select v.id as deal_a2_id from public.create_deal(
  'ca500000-0000-0000-0000-000000000002', 'HR-V', 8000000, 0::smallint, 'a_vista'::public.deal_payment_method) v \gset
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000002'); -- Seller A1
set local role authenticated;
select throws_ok(
  format($$select public.register_sale(%L, 1, 8500000, 'a_vista'::public.deal_payment_method)$$, :'deal_a2_id'),
  'forbidden', 'Seller A1: register_sale em Deal de outro Seller (mesma company) e negado');

select is(
  (select d.status from public.register_sale(:'deal_a1_id', 1, 9200000, 'entrada_financiamento'::public.deal_payment_method) d),
  'sold'::public.deal_status, 'Seller A1: register_sale na propria Deal OPEN funciona');
select is(
  (select s.assigned_seller_id from public.sales s where s.deal_id = :'deal_a1_id'),
  's1SellerA1', 'Sale (Seller): assigned_seller_id = o proprio Seller');
select is(
  (select s.sold_by from public.sales s where s.deal_id = :'deal_a1_id'),
  'ca200000-0000-0000-0000-000000000002', 'Sale (Seller): sold_by = ator Seller');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. CROSS-COMPANY
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000004'); -- Manager B (outra company)
set local role authenticated;
select throws_ok(
  format($$select public.register_sale(%L, 1, 8500000, 'a_vista'::public.deal_payment_method)$$, :'deal_a2_id'),
  'deal_not_found', 'Manager B: register_sale num Deal de outra empresa e negado como deal_not_found (isolamento)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. DEAL JA FECHADA — lost / sold (nenhuma segunda Sale)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000003'); -- Seller A2
set local role authenticated;
select ok(
  (select d.status from public.mark_deal_lost(:'deal_a2_id', 1) d) = 'lost',
  'fixture: Deal A2 marcada como lost (para provar register_sale bloqueado)');
select throws_ok(
  format($$select public.register_sale(%L, 2, 8500000, 'a_vista'::public.deal_payment_method)$$, :'deal_a2_id'),
  'deal_closed', 'register_sale em Deal LOST e negado (deal_closed)');
select is(
  (select count(*)::int from public.sales where deal_id = :'deal_a2_id'),
  0, 'Deal lost: nenhuma Sale foi criada');
reset role;

-- Deal ja SOLD (deal_a1_id, secao 4): segunda tentativa tambem deal_closed,
-- prova estrutural de "no maximo uma Sale por Deal" mesmo sob chamada
-- repetida.
select pg_temp.as_user('ca200000-0000-0000-0000-000000000002'); -- Seller A1
set local role authenticated;
select throws_ok(
  format($$select public.register_sale(%L, 2, 9999900, 'a_vista'::public.deal_payment_method)$$, :'deal_a1_id'),
  'deal_closed', 'register_sale em Deal ja SOLD e negado (deal_closed) — segunda tentativa nunca cria segunda Sale');
select is(
  (select count(*)::int from public.sales where deal_id = :'deal_a1_id'),
  1, 'Deal ja sold: continua exatamente 1 Sale (a segunda tentativa nao criou outra)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. STALE_WRITE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select v.id as deal_stale_id from public.create_deal(
  'ca500000-0000-0000-0000-000000000001', 'Corolla', 10000000, 0::smallint, 'a_vista'::public.deal_payment_method) v \gset

select throws_ok(
  format($$select public.register_sale(%L, 99, 10000000, 'a_vista'::public.deal_payment_method)$$, :'deal_stale_id'),
  'stale_write', 'register_sale com expected_version desatualizada e negado');
select is(
  (select count(*)::int from public.sales where deal_id = :'deal_stale_id'),
  0, 'stale_write: nenhuma Sale foi criada');
select is(
  (select d.status from public.deals d where d.id = :'deal_stale_id'),
  'open'::public.deal_status, 'stale_write: Deal permanece open');

-- ═══════════════════════════════════════════════════════════════════════
-- 8. VALORES/FORMA DE PAGAMENTO INVALIDOS
-- ═══════════════════════════════════════════════════════════════════════

select throws_ok(
  format($$select public.register_sale(%L, 1, 0, 'a_vista'::public.deal_payment_method)$$, :'deal_stale_id'),
  'invalid_value', 'sold_value_cents = 0 e negado');
select throws_ok(
  format($$select public.register_sale(%L, 1, -100, 'a_vista'::public.deal_payment_method)$$, :'deal_stale_id'),
  'invalid_value', 'sold_value_cents negativo e negado');
select throws_ok(
  format($$select public.register_sale(%L, 1, 10000000, null)$$, :'deal_stale_id'),
  'invalid_payment_method', 'payment_method NULL e negado');
select is(
  (select count(*)::int from public.sales where deal_id = :'deal_stale_id'),
  0, 'valores invalidos: nenhuma Sale foi criada');
select is(
  (select d.status from public.deals d where d.id = :'deal_stale_id'),
  'open'::public.deal_status, 'valores invalidos: Deal permanece open');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. RLS — SELECT
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ca200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select ok(
  (select count(*)::int from public.sales) >= 2,
  'Manager A: enxerga todas as Sales da empresa (company-wide)');
select is(
  (select count(*)::int from public.sales where deal_id = :'deal_a1_id'),
  1, 'Manager A: enxerga tambem a Sale do Seller A1 (mesma empresa)');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000002'); -- Seller A1
set local role authenticated;
select is(
  (select count(*)::int from public.sales where deal_id = :'deal_a1_id'),
  1, 'Seller A1: enxerga a propria Sale');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000003'); -- Seller A2
set local role authenticated;
select is(
  (select count(*)::int from public.sales where deal_id = :'deal_a1_id'),
  0, 'Seller A2: NAO enxerga a Sale do Seller A1 (own-only)');
reset role;

select pg_temp.as_user('ca200000-0000-0000-0000-000000000004'); -- Manager B
set local role authenticated;
select is(
  (select count(*)::int from public.sales where deal_id in (:'deal_mgr_id', :'deal_a1_id')),
  0, 'Manager B (outra empresa): nenhuma Sale de CS1 e visivel (isolamento por company_id)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. ANON — nunca executa
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select count(*) from public.sales$$, '42501', null, 'anon: SELECT direto em sales falha');
select throws_ok(
  format($$select public.register_sale(%L, 1, 10000000, 'a_vista'::public.deal_payment_method)$$, :'deal_stale_id'),
  '42501', null, 'anon: register_sale falha (sem EXECUTE)');
reset role;

select * from finish();
rollback;
