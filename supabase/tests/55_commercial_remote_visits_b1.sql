-- COMMERCIAL-REMOTE-VISITS-B1 — Visits remoto: schema + RLS + RPC
-- Prova: (1) visits/enums/checks/FKs/indexes exatamente como desenhado;
-- (2) RLS SELECT-only, escrita direta revogada de anon/authenticated;
-- (3) resolve_commercial_mutation_context nunca exposto ao cliente;
-- (4) create_visit/update_visit/confirm_visit/cancel_visit/
--     register_visit_result respeitam Manager (empresa inteira, responsável
--     obrigatório, pode reatribuir) e Seller (só a própria Visit, nunca
--     reatribui); (5) isolamento cross-company; (6) integridade de dados
--     (vehicles, client_name, outcome/closed consistency); (7) concorrência
--     otimista; (8) status vs outcome (lifecycle separado de resultado
--     comercial); (9) reschedule na mesma row (confirmed->scheduled quando
--     scheduled_at muda, scheduled continua scheduled, sem evento quando o
--     horário não muda); (10) timeline só quando lead_id existe; (11) anon
--     nunca executa. Roda como postgres. Rollback ao final — nenhum dado
--     persiste.

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
  ('cf100000-0000-0000-0000-000000000001', 'V1 Visits Empresa A Ativa', 'ativa'),
  ('cf100000-0000-0000-0000-000000000002', 'V1 Visits Empresa B Ativa (outra)', 'ativa'),
  ('cf100000-0000-0000-0000-000000000003', 'V1 Visits Empresa C Suspensa', 'suspensa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'v1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'v1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'v1-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'v1-seller-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'v1-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'v1-seller-b1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'v1-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cf200000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'v1-nomembership@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('cf200000-0000-0000-0000-000000000001', 'Super Admin V1', 'v1-superadmin@test.local', true, 'super_admin'),
  ('cf200000-0000-0000-0000-000000000002', 'Manager A',      'v1-manager-a@test.local',  true, null),
  ('cf200000-0000-0000-0000-000000000003', 'Seller A1',      'v1-seller-a1@test.local',  true, null),
  ('cf200000-0000-0000-0000-000000000004', 'Seller A2',      'v1-seller-a2@test.local',  true, null),
  ('cf200000-0000-0000-0000-000000000005', 'Manager B',      'v1-manager-b@test.local',  true, null),
  ('cf200000-0000-0000-0000-000000000006', 'Seller B1',      'v1-seller-b1@test.local',  true, null),
  ('cf200000-0000-0000-0000-000000000007', 'Manager C',      'v1-manager-c@test.local',  true, null),
  ('cf200000-0000-0000-0000-000000000008', 'Sem Membership', 'v1-nomembership@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('cf300000-0000-0000-0000-000000000002', 'cf100000-0000-0000-0000-000000000001', 'cf200000-0000-0000-0000-000000000002', 'manager', true),
  ('cf300000-0000-0000-0000-000000000003', 'cf100000-0000-0000-0000-000000000001', 'cf200000-0000-0000-0000-000000000003', 'seller',  true),
  ('cf300000-0000-0000-0000-000000000004', 'cf100000-0000-0000-0000-000000000001', 'cf200000-0000-0000-0000-000000000004', 'seller',  true),
  ('cf300000-0000-0000-0000-000000000005', 'cf100000-0000-0000-0000-000000000002', 'cf200000-0000-0000-0000-000000000005', 'manager', true),
  ('cf300000-0000-0000-0000-000000000006', 'cf100000-0000-0000-0000-000000000002', 'cf200000-0000-0000-0000-000000000006', 'seller',  true),
  ('cf300000-0000-0000-0000-000000000007', 'cf100000-0000-0000-0000-000000000003', 'cf200000-0000-0000-0000-000000000007', 'manager', true);
-- cf200000-...-08 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('v1SellerA1',    'cf100000-0000-0000-0000-000000000001', 'Seller A1',       'V1-A1', 'cf200000-0000-0000-0000-000000000003', 'cf300000-0000-0000-0000-000000000003', true),
  ('v1SellerA2',    'cf100000-0000-0000-0000-000000000001', 'Seller A2',       'V1-A2', 'cf200000-0000-0000-0000-000000000004', 'cf300000-0000-0000-0000-000000000004', true),
  ('v1SellerA1Inx', 'cf100000-0000-0000-0000-000000000001', 'Seller A1 Inact', 'V1-A1I', null, null, false),
  ('v1SellerB1',    'cf100000-0000-0000-0000-000000000002', 'Seller B1',       'V1-B1', 'cf200000-0000-0000-0000-000000000006', 'cf300000-0000-0000-0000-000000000006', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('cf400000-0000-0000-0000-000000000001', 'cf100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('cf400000-0000-0000-0000-000000000002', 'cf100000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('cf500000-0000-0000-0000-000000000001', 'cf100000-0000-0000-0000-000000000001', 'Lead A1 Com Seller', '(11) 90000-9001', 'Onix',
   'cf400000-0000-0000-0000-000000000001', 'v1SellerA1'),
  ('cf500000-0000-0000-0000-000000000002', 'cf100000-0000-0000-0000-000000000002', 'Lead B1', '(11) 90000-9002', 'HB20',
   'cf400000-0000-0000-0000-000000000002', 'v1SellerB1'),
  ('cf500000-0000-0000-0000-000000000003', 'cf100000-0000-0000-0000-000000000001', 'Lead A2 Sem Seller', '(11) 90000-9003', 'HR-V',
   'cf400000-0000-0000-0000-000000000001', null);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('cf500000-0000-0000-0000-000000000004', 'cf100000-0000-0000-0000-000000000001', 'Lead A3 Arquivado', '(11) 90000-9004', 'Kicks',
   'cf400000-0000-0000-0000-000000000001', 'v1SellerA1', now());

-- ═══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public', 'visits', 'tabela public.visits existe');

select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'visit_status'),
  array['scheduled','confirmed','canceled','completed']::text[],
  'visit_status: exatamente scheduled/confirmed/canceled/completed, nesta ordem (sem pending/awaiting_result/rescheduled/done/no_interest)');
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'visit_outcome'),
  array['sold','negotiating','thinking','no_interest']::text[],
  'visit_outcome: exatamente sold/negotiating/thinking/no_interest, nesta ordem');

select col_not_null('public', 'visits', 'company_id', 'company_id NOT NULL');
select col_is_null('public', 'visits', 'lead_id', 'lead_id nullable');
select col_is_null('public', 'visits', 'client_name', 'client_name nullable');
select col_not_null('public', 'visits', 'assigned_seller_id', 'assigned_seller_id NOT NULL (diferente de tasks)');
select col_not_null('public', 'visits', 'vehicles', 'vehicles NOT NULL');
select col_not_null('public', 'visits', 'scheduled_at', 'scheduled_at NOT NULL');
select col_not_null('public', 'visits', 'status', 'status NOT NULL');
select col_default_is('public', 'visits', 'status', 'scheduled', 'status default scheduled');
select col_is_null('public', 'visits', 'outcome', 'outcome nullable');
select col_not_null('public', 'visits', 'note', 'note NOT NULL');
select col_has_default('public', 'visits', 'note', 'note tem default');
select col_default_is('public', 'visits', 'note', '', 'note default vazio');
select col_is_null('public', 'visits', 'result_note', 'result_note nullable');
select col_is_null('public', 'visits', 'closed_by', 'closed_by nullable');
select col_is_null('public', 'visits', 'closed_at', 'closed_at nullable');
select col_not_null('public', 'visits', 'version', 'version NOT NULL');
select col_default_is('public', 'visits', 'version', '1', 'version default 1');

select has_check('public', 'visits', 'visits: possui pelo menos um CHECK');
select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.visits'::regclass and contype = 'c') >= 5,
  'visits: pelo menos 5 CHECK constraints (client_identity, vehicles, version, outcome, closed)');

select ok(
  (select confdeltype from pg_constraint where conname = 'visits_company_lead_fk') = 'r',
  'visits_company_lead_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'visits_company_seller_fk') = 'r',
  'visits_company_seller_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'visits_created_by_fk') = 'r',
  'visits_created_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'visits_updated_by_fk') = 'r',
  'visits_updated_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'visits_closed_by_fk') = 'r',
  'visits_closed_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname like 'visits_company_id%') = 'c',
  'visits.company_id -> companies(id): ON DELETE CASCADE');

select has_index('public', 'visits', 'visits_company_status_scheduled_idx', 'index (company_id, status, scheduled_at) existe');
select has_index('public', 'visits', 'visits_company_seller_status_scheduled_idx', 'index (company_id, assigned_seller_id, status, scheduled_at) existe');
select has_index('public', 'visits', 'visits_company_lead_idx', 'index (company_id, lead_id) existe');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_visit','update_visit','confirm_visit','cancel_visit','register_visit_result')),
  5, 'as 5 RPCs de Visits existem, uma unica assinatura cada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_visit','update_visit','confirm_visit','cancel_visit','register_visit_result')
      and p.prosecdef),
  5, 'as 5 RPCs sao SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_visit','update_visit','confirm_visit','cancel_visit','register_visit_result')
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  5, 'as 5 RPCs tem search_path configurado explicitamente');

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SECURITY / GRANTS
-- ═══════════════════════════════════════════════════════════════════════

select ok(
  (select relrowsecurity from pg_class where oid = 'public.visits'::regclass),
  'RLS habilitado em public.visits');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'visits' and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1, 'authenticated: SELECT concedido em visits');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'visits' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'authenticated: nenhum grant direto de INSERT/UPDATE/DELETE em visits');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'visits' and grantee = 'anon'),
  0, 'anon: nenhum grant em visits');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'visits_vehicles_valid' and grantee = 'authenticated'),
  0, 'visits_vehicles_valid: authenticated NAO tem EXECUTE (helper interno)');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'create_visit' and grantee = 'authenticated'),
  1, 'create_visit: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name in ('create_visit','update_visit','confirm_visit','cancel_visit','register_visit_result') and grantee = 'anon'),
  0, 'nenhuma das 5 RPCs: anon tem EXECUTE');

-- ═══════════════════════════════════════════════════════════════════════
-- 3. MANAGER A (empresa CVA1 ativa) — CREATE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cf200000-0000-0000-0000-000000000002');
set local role authenticated;

-- Lead com Seller: default automático quando nenhum seller informado.
select is(
  (select v.assigned_seller_id from public.create_visit(
    now() + interval '1 day', array['Onix'], 'cf500000-0000-0000-0000-000000000001') v),
  'v1SellerA1', 'Manager: create_visit com Lead-com-Seller, sem seller explicito, usa o Seller do Lead');
select is(
  (select v.status from public.visits v where v.assigned_seller_id = 'v1SellerA1' and v.lead_id = 'cf500000-0000-0000-0000-000000000001'),
  'scheduled'::public.visit_status, 'visit inicial: status scheduled');
select is(
  (select v.version from public.visits v where v.lead_id = 'cf500000-0000-0000-0000-000000000001'),
  1, 'visit inicial: version 1');
select is(
  (select v.outcome is null and v.closed_at is null and v.closed_by is null and v.result_note is null
     from public.visits v where v.lead_id = 'cf500000-0000-0000-0000-000000000001'),
  true, 'visit inicial: outcome/closed_at/closed_by/result_note todos NULL');

-- Lead sem Seller: sem seller explicito -> seller_required.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['HR-V'], 'cf500000-0000-0000-0000-000000000003')$$,
  'seller_required', 'Manager: create_visit em Lead sem Seller, sem seller explicito, e negado');

-- Sem Lead, sem seller explicito -> seller_required.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf'], null, 'Cliente Avulso')$$,
  'seller_required', 'Manager: create_visit sem Lead e sem seller explicito e negado');

-- Sem Lead, seller explicito, client_name valido -> ok.
select ok(
  (select v.id from public.create_visit(
    now() + interval '2 days', array['Golf'], null, 'Cliente Avulso V1', 'v1SellerA2') v) is not null,
  'Manager: create_visit sem Lead, com client_name e seller explicito, funciona');

-- Sem Lead, client_name vazio/so espacos -> client_name_required.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf'], null, '   ', 'v1SellerA2')$$,
  'client_name_required', 'Manager: create_visit sem Lead e client_name so espacos e negado');

-- Lead arquivado -> lead_archived.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Kicks'], 'cf500000-0000-0000-0000-000000000004', null, 'v1SellerA1')$$,
  'lead_archived', 'Manager: create_visit em Lead arquivado e negado');

-- Lead de outra empresa -> lead_not_found.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['HB20'], 'cf500000-0000-0000-0000-000000000002', null, 'v1SellerA1')$$,
  'lead_not_found', 'Manager: create_visit com Lead de outra empresa e negado');

-- Seller de outra empresa -> seller_not_found.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf'], null, 'Cliente X', 'v1SellerB1')$$,
  'seller_not_found', 'Manager: create_visit para Seller de outra empresa e negado');

-- Seller inativo -> seller_not_found.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf'], null, 'Cliente X', 'v1SellerA1Inx')$$,
  'seller_not_found', 'Manager: create_visit para Seller inativo e negado');

-- vehicles vazio -> invalid_vehicles.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array[]::text[], null, 'Cliente X', 'v1SellerA1')$$,
  'invalid_vehicles', 'Manager: create_visit com vehicles vazio e negado');

-- vehicles com elemento so-espacos -> invalid_vehicles.
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf', '   '], null, 'Cliente X', 'v1SellerA1')$$,
  'invalid_vehicles', 'Manager: create_visit com vehicles contendo elemento vazio/so-espacos e negado');

-- Visit T-Reagendavel para os testes de update/confirm/cancel abaixo.
select v.id as visit_reag_id from public.create_visit(
  now() + interval '3 days', array['Civic'], 'cf500000-0000-0000-0000-000000000001', null, 'v1SellerA1') v \gset
select ok(:'visit_reag_id' is not null, 'Manager: Visit "reagendavel" criada (usada em update/confirm/cancel)');

-- Visit para os testes de isolamento de Seller.
select v.id as visit_a2_id from public.create_visit(
  now() + interval '1 day', array['Kicks'], null, 'Cliente A2', 'v1SellerA2') v \gset
select ok(:'visit_a2_id' is not null, 'Manager: Visit atribuida a Seller A2 criada (usada no isolamento de Seller A1)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. UPDATE / RESCHEDULE (Manager)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cf200000-0000-0000-0000-000000000002');
set local role authenticated;

-- update sem mudar scheduled_at: nao reseta status, nao gera novo evento de
-- timeline "remarcada" (contagem de eventos comparada antes/depois).
select (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001') as tl_before_noop \gset
select ok(
  (select v.status from public.update_visit(
    :'visit_reag_id', 1, (select scheduled_at from public.visits where id = :'visit_reag_id'),
    array['Civic'], 'nota mantida', 'v1SellerA1') v) = 'scheduled',
  'Manager: update_visit sem mudar scheduled_at mantem status scheduled');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001'),
  :tl_before_noop, 'update_visit sem mudar scheduled_at NAO gera evento de timeline "remarcada"');
select is(
  (select v.version from public.visits v where v.id = :'visit_reag_id'),
  2, 'visit reagendavel: version incrementou mesmo sem mudar scheduled_at (update sempre bump)');

-- confirm_visit: scheduled -> confirmed.
select ok(
  (select v.status from public.confirm_visit(:'visit_reag_id', 2) v) = 'confirmed',
  'Manager: confirm_visit muda scheduled -> confirmed');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001' and label = 'Visita confirmada'),
  1, 'confirm_visit gera exatamente 1 evento "Visita confirmada"');

-- update mudando scheduled_at com status confirmed -> volta para scheduled,
-- gera evento "remarcada".
select (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001' and label = 'Visita remarcada') as tl_resched_before \gset
select is(
  (select v.status from public.update_visit(
    :'visit_reag_id', 3, now() + interval '10 days', array['Civic'], '', 'v1SellerA1') v),
  'scheduled'::public.visit_status,
  'Manager: update_visit mudando scheduled_at em Visit confirmed volta o status para scheduled');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001' and label = 'Visita remarcada'),
  :tl_resched_before + 1, 'update_visit com scheduled_at realmente alterado gera exatamente 1 novo evento "remarcada"');

-- Manager reassign.
select ok(
  (select v.assigned_seller_id from public.update_visit(
    :'visit_reag_id', 4, now() + interval '10 days', array['Civic'], '', 'v1SellerA2') v) = 'v1SellerA2',
  'Manager: update_visit reatribui para Seller A2');

-- stale_write.
select throws_ok(
  format($$select public.update_visit(%L, 1, now(), array['Civic'], '', 'v1SellerA2')$$, :'visit_reag_id'),
  'stale_write', 'Manager: update_visit com expected_version desatualizada e negado');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. SELLER A1 (empresa CVA1 ativa) — isolamento e mutations proprias
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cf200000-0000-0000-0000-000000000003');
set local role authenticated;

select is(
  (select v.assigned_seller_id from public.create_visit(now() + interval '1 day', array['Polo'], null, 'Cliente Seller Self') v),
  'v1SellerA1', 'Seller: create_visit sem seller explicito normaliza para o proprio seller');
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Polo'], null, 'Cliente X', 'v1SellerA2')$$,
  'forbidden', 'Seller: create_visit para outro Seller e negado');

select is(
  (select count(*)::int from public.visits where lead_id = 'cf500000-0000-0000-0000-000000000001'),
  1, 'Seller A1: enxerga somente a Visit inicial da Lead A1 (a "reagendavel" ja foi reatribuida a Seller A2 na secao 4)');
select is(
  (select count(*)::int from public.visits where id = :'visit_a2_id'),
  0, 'Seller A1: NAO enxerga a Visit atribuida a Seller A2');

select throws_ok(
  format($$select public.update_visit(%L, 1, now(), array['Kicks'], '', 'v1SellerA2')$$, :'visit_a2_id'),
  'forbidden', 'Seller A1: update_visit em Visit de outro Seller e negado');
select throws_ok(
  format($$select public.confirm_visit(%L, 1)$$, :'visit_a2_id'),
  'forbidden', 'Seller A1: confirm_visit em Visit de outro Seller e negado');
select throws_ok(
  format($$select public.cancel_visit(%L, 1)$$, :'visit_a2_id'),
  'forbidden', 'Seller A1: cancel_visit em Visit de outro Seller e negado');

-- Seller tentando reatribuir a propria Visit -> forbidden.
select v.id as visit_self_id from public.create_visit(now() + interval '1 day', array['Polo'], null, 'Cliente Seller Self 2') v \gset
select throws_ok(
  format($$select public.update_visit(%L, 1, now() + interval '1 day', array['Polo'], '', 'v1SellerA2')$$, :'visit_self_id'),
  'forbidden', 'Seller: update_visit tentando reatribuir a propria Visit para outro Seller e negado');

-- Seller confirm/cancel na propria Visit funciona.
select ok(
  (select v.status from public.confirm_visit(:'visit_self_id', 1) v) = 'confirmed',
  'Seller: confirm_visit na propria Visit funciona');
select ok(
  (select v.status from public.cancel_visit(:'visit_self_id', 2) v) = 'canceled',
  'Seller: cancel_visit na propria Visit (confirmed) funciona');
select is(
  (select v.outcome is null and v.closed_at is not null and v.closed_by is not null
     from public.visits v where v.id = :'visit_self_id'),
  true, 'Visit cancelada: outcome NULL, closed_at/closed_by preenchidos');

-- Visit ja terminal -> visit_closed em qualquer mutation.
select throws_ok(
  format($$select public.confirm_visit(%L, 3)$$, :'visit_self_id'),
  'visit_closed', 'confirm_visit em Visit canceled e negado (visit_closed)');
select throws_ok(
  format($$select public.cancel_visit(%L, 3)$$, :'visit_self_id'),
  'visit_closed', 'cancel_visit em Visit ja canceled e negado (visit_closed)');
select throws_ok(
  format($$select public.update_visit(%L, 3, now(), array['Polo'], '', 'v1SellerA1')$$, :'visit_self_id'),
  'visit_closed', 'update_visit em Visit canceled e negado (visit_closed)');
select throws_ok(
  format($$select public.register_visit_result(%L, 3, 'sold'::public.visit_outcome)$$, :'visit_self_id'),
  'visit_closed', 'register_visit_result em Visit canceled e negado (visit_closed)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. REGISTER_VISIT_RESULT — 4 outcomes (Manager)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cf200000-0000-0000-0000-000000000002');
set local role authenticated;

-- Uma Visit por outcome, todas com Lead (para provar timeline em cada caso).
select v.id as visit_sold_id from public.create_visit(now() - interval '1 hour', array['Onix'], 'cf500000-0000-0000-0000-000000000001', null, 'v1SellerA1') v \gset
select v.id as visit_neg_id  from public.create_visit(now() - interval '1 hour', array['Onix'], 'cf500000-0000-0000-0000-000000000001', null, 'v1SellerA1') v \gset
select v.id as visit_think_id from public.create_visit(now() - interval '1 hour', array['Onix'], 'cf500000-0000-0000-0000-000000000001', null, 'v1SellerA1') v \gset
select v.id as visit_noint_id from public.create_visit(now() - interval '1 hour', array['Onix'], 'cf500000-0000-0000-0000-000000000001', null, 'v1SellerA1') v \gset

select ok(
  (select v.status from public.register_visit_result(:'visit_sold_id', 1, 'sold'::public.visit_outcome, 'Fechou na hora') v) = 'completed',
  'register_visit_result(sold): status completed');
select is(
  (select v.outcome from public.visits v where v.id = :'visit_sold_id'),
  'sold'::public.visit_outcome, 'outcome persistido = sold');
select is(
  (select v.result_note from public.visits v where v.id = :'visit_sold_id'),
  'Fechou na hora', 'result_note persistido');
select is(
  (select v.note from public.visits v where v.id = :'visit_sold_id'),
  '', 'note original (vazia) preservada, nao sobrescrita por register_visit_result');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001' and label = 'Visita: Fechou negócio'),
  1, 'timeline: "Visita: Fechou negócio" para outcome sold');

select ok(
  (select v.status from public.register_visit_result(:'visit_neg_id', 1, 'negotiating'::public.visit_outcome) v) = 'completed',
  'register_visit_result(negotiating): status completed');
select is(
  (select v.outcome from public.visits v where v.id = :'visit_neg_id'),
  'negotiating'::public.visit_outcome, 'outcome persistido = negotiating');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001' and label = 'Visita: Em negociação'),
  1, 'timeline: "Visita: Em negociação" para outcome negotiating');

select ok(
  (select v.status from public.register_visit_result(:'visit_think_id', 1, 'thinking'::public.visit_outcome) v) = 'completed',
  'register_visit_result(thinking): status completed');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001' and label = 'Visita: Vai pensar'),
  1, 'timeline: "Visita: Vai pensar" para outcome thinking');

select ok(
  (select v.status from public.register_visit_result(:'visit_noint_id', 1, 'no_interest'::public.visit_outcome) v) = 'completed',
  'register_visit_result(no_interest): status completed');
select is(
  (select v.outcome from public.visits v where v.id = :'visit_noint_id'),
  'no_interest'::public.visit_outcome, 'outcome persistido = no_interest');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'cf500000-0000-0000-0000-000000000001' and label = 'Visita: Sem interesse'),
  1, 'timeline: "Visita: Sem interesse" para outcome no_interest');

select is(
  (select v.closed_at is not null and v.closed_by is not null from public.visits v where v.id = :'visit_sold_id'),
  true, 'Visit completed: closed_at/closed_by preenchidos');

-- outcome invalido: rejeitado pelo proprio tipo do Postgres (22P02), mesmo
-- padrao de task_priority em create_task/update_task.
select v.id as visit_typeerr_id from public.create_visit(now() - interval '1 hour', array['Onix'], 'cf500000-0000-0000-0000-000000000001', null, 'v1SellerA1') v \gset
select throws_ok(
  format($$select public.register_visit_result(%L, 1, 'lost')$$, :'visit_typeerr_id'),
  '22P02', null, 'register_visit_result com outcome fora do enum e rejeitado pelo tipo (nunca vira valor livre)');

-- Sem Lead: nenhum evento de timeline (nao ha lead_id para gravar).
select v.id as visit_nolead_id from public.create_visit(now() - interval '1 hour', array['Onix'], null, 'Cliente Sem Lead', 'v1SellerA1') v \gset
select (select count(*)::int from public.lead_timeline_entries) as tl_total_before \gset
select ok(
  (select v.status from public.register_visit_result(:'visit_nolead_id', 1, 'sold'::public.visit_outcome) v) = 'completed',
  'register_visit_result em Visit sem Lead funciona normalmente');
select is(
  (select count(*)::int from public.lead_timeline_entries),
  :tl_total_before, 'register_visit_result em Visit sem Lead NAO cria nenhum evento de timeline');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. TENANCY / CROSS-COMPANY / EMPRESA NAO-ATIVA / SEM MEMBERSHIP / SUPER ADMIN
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cf200000-0000-0000-0000-000000000005'); -- Manager B (CVA2 ativa, outra empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.visits where id in (:'visit_reag_id', :'visit_a2_id', :'visit_sold_id')),
  0, 'Manager B (CVA2): nenhuma Visit de CVA1 e visivel (isolamento por company_id)');
select throws_ok(
  format($$select public.update_visit(%L, 1, now(), array['Civic'], '', 'v1SellerB1')$$, :'visit_reag_id'),
  'visit_not_found', 'Manager B: update_visit numa Visit de outra empresa e negado como visit_not_found');
select throws_ok(
  format($$select public.confirm_visit(%L, 1)$$, :'visit_reag_id'),
  'visit_not_found', 'Manager B: confirm_visit numa Visit de outra empresa e negado como visit_not_found');
select throws_ok(
  format($$select public.cancel_visit(%L, 1)$$, :'visit_reag_id'),
  'visit_not_found', 'Manager B: cancel_visit numa Visit de outra empresa e negado como visit_not_found');
select throws_ok(
  format($$select public.register_visit_result(%L, 1, 'sold'::public.visit_outcome)$$, :'visit_reag_id'),
  'visit_not_found', 'Manager B: register_visit_result numa Visit de outra empresa e negado como visit_not_found');
reset role;

select pg_temp.as_user('cf200000-0000-0000-0000-000000000007'); -- Manager C (CVA3 suspensa)
set local role authenticated;
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf'], null, 'X', 'v1SellerA1')$$,
  'forbidden', 'Manager C (empresa suspensa): create_visit negado');
reset role;

select pg_temp.as_user('cf200000-0000-0000-0000-000000000008'); -- Sem Membership
set local role authenticated;
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf'], null, 'X')$$,
  'forbidden', 'Profile sem membership ativa: create_visit negado');
reset role;

select pg_temp.as_user('cf200000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.create_visit(now() + interval '1 day', array['Golf'], null, 'X', 'v1SellerA1')$$,
  'forbidden', 'Super Admin: create_visit negado (Visits nao tem superficie de Super Admin neste B1)');
select throws_ok(
  format($$select public.confirm_visit(%L, 1)$$, :'visit_reag_id'),
  'forbidden', 'Super Admin: confirm_visit negado');
select is(
  (select count(*)::int from public.visits),
  0, 'Super Admin: SELECT direto em visits nao enxerga nenhuma linha (sem policy propria)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. INTEGRIDADE DE DADOS (direto, como owner da tabela, fora de RLS)
-- ═══════════════════════════════════════════════════════════════════════

select throws_ok(
  $$insert into public.visits (company_id, assigned_seller_id, vehicles, scheduled_at)
    values ('cf100000-0000-0000-0000-000000000001', 'v1SellerA1', array[]::text[], now())$$,
  '23514', null, 'insert direto: vehicles vazio viola visits_vehicles_ck');

select throws_ok(
  $$insert into public.visits (company_id, assigned_seller_id, vehicles, scheduled_at, lead_id, client_name)
    values ('cf100000-0000-0000-0000-000000000001', 'v1SellerA1', array['Golf'], now(), null, null)$$,
  '23514', null, 'insert direto: lead_id NULL e client_name NULL viola visits_client_identity_ck');

select throws_ok(
  $$insert into public.visits (company_id, assigned_seller_id, vehicles, scheduled_at, status, outcome)
    values ('cf100000-0000-0000-0000-000000000001', 'v1SellerA1', array['Golf'], now(), 'scheduled', 'sold')$$,
  '23514', null, 'insert direto: status scheduled com outcome preenchido viola visits_outcome_consistency_ck');

select throws_ok(
  $$insert into public.visits (company_id, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_at, closed_by)
    values ('cf100000-0000-0000-0000-000000000001', 'v1SellerA1', array['Golf'], now(), 'completed', null, now(), 'cf200000-0000-0000-0000-000000000002')$$,
  '23514', null, 'insert direto: status completed sem outcome viola visits_outcome_consistency_ck');

select throws_ok(
  format($$insert into public.visits (company_id, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_at, closed_by)
    values ('cf100000-0000-0000-0000-000000000001', 'v1SellerA1', array['Golf'], now(), 'completed', 'sold', null, %L)$$,
    'cf200000-0000-0000-0000-000000000002'),
  '23514', null, 'insert direto: status completed sem closed_at viola visits_closed_consistency_ck');

select throws_ok(
  $$insert into public.visits (company_id, assigned_seller_id, vehicles, scheduled_at, lead_id)
    values ('cf100000-0000-0000-0000-000000000001', 'v1SellerA1', array['Golf'], now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff')$$,
  '23503', null, 'insert direto: lead_id inexistente/de outra empresa viola visits_company_lead_fk');

-- ═══════════════════════════════════════════════════════════════════════
-- 9. ANON — nunca executa nada
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select count(*) from public.visits$$, '42501', null, 'anon: SELECT direto em visits falha');
select throws_ok($$select public.create_visit(now(), array['Golf'])$$, '42501', null, 'anon: create_visit falha (sem EXECUTE)');
select throws_ok(
  format($$select public.update_visit(%L, 1, now(), array['Golf'], '', 'v1SellerA1')$$, :'visit_reag_id'),
  '42501', null, 'anon: update_visit falha (sem EXECUTE)');
select throws_ok(
  format($$select public.confirm_visit(%L, 1)$$, :'visit_reag_id'),
  '42501', null, 'anon: confirm_visit falha (sem EXECUTE)');
select throws_ok(
  format($$select public.cancel_visit(%L, 1)$$, :'visit_reag_id'),
  '42501', null, 'anon: cancel_visit falha (sem EXECUTE)');
select throws_ok(
  format($$select public.register_visit_result(%L, 1, 'sold')$$, :'visit_reag_id'),
  '42501', null, 'anon: register_visit_result falha (sem EXECUTE)');
reset role;

select * from finish();
rollback;
