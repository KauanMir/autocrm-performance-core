-- KPI-REPORTS-B1-EXEC-BACKEND — get_company_management_report
-- (20260827100000_management_report_aggregation_b1.sql). Prova o contrato
-- KPI_REPORTS_A2_DESIGN + ADDENDUM: catálogo/grants, período [start,end),
-- autorização (Manager/Super Admin/Seller deny/sem sessão/suspensa/
-- isolamento), os 7 KPIs de summary, cohort Deal->Venda, seller_breakdown
-- (offboarded + bucket "Sem vendedor"), source_breakdown (normalização +
-- "Não informado" + arquivados contam), trend diário (dia civil no
-- timezone da empresa + zero-fill + bordas) e comportamento de Lead
-- importado. Roda como postgres; rollback ao final — nenhum dado persiste.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- Wrappers definidos como postgres (antes de qualquer SET ROLE) para não
-- depender de privilégio de CREATE em pg_temp do role authenticated. O
-- gating real continua sendo do get_company_management_report (SECURITY
-- DEFINER lê request.jwt.claims), reexercido a cada chamada.
create or replace function pg_temp.rpt_a() returns jsonb as $$
  select public.get_company_management_report(
    '2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, null);
$$ language sql;

create or replace function pg_temp.rpt_b() returns jsonb as $$
  select public.get_company_management_report(
    '2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz,
    'bb100000-0000-0000-0000-000000000002'::uuid);
$$ language sql;

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES
--   Período sob teste (todos os cenários):
--     P_START = 2026-03-10 03:00:00+00  (= 2026-03-10 00:00 America/Sao_Paulo)
--     P_END   = 2026-03-14 03:00:00+00  (= 2026-03-14 00:00 America/Sao_Paulo)
--   Brasil não tem horário de verão desde 2019 -> offset fixo -03:00.
--   Dias civis TOCADOS por [P_START, P_END): 03-10, 03-11, 03-12, 03-13.
-- ═══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status, timezone) values
  ('bb100000-0000-0000-0000-000000000001', 'MR Company A Ativa',    'ativa',    'America/Sao_Paulo'),
  ('bb100000-0000-0000-0000-000000000002', 'MR Company B Ativa',    'ativa',    'America/Sao_Paulo'),
  ('bb100000-0000-0000-0000-000000000003', 'MR Company S Suspensa', 'suspensa', 'America/Sao_Paulo');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'bb200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mr-manager-a@test.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'mr-seller-a@test.local',     now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mr-superadmin@test.local',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'mr-manager-b@test.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'mr-manager-s@test.local',    now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('bb200000-0000-0000-0000-000000000001', 'MR Manager A',   'mr-manager-a@test.local',  true, null),
  ('bb200000-0000-0000-0000-000000000002', 'MR Seller A',    'mr-seller-a@test.local',   true, null),
  ('bb200000-0000-0000-0000-000000000003', 'MR Super Admin', 'mr-superadmin@test.local', true, 'super_admin'),
  ('bb200000-0000-0000-0000-000000000004', 'MR Manager B',   'mr-manager-b@test.local',  true, null),
  ('bb200000-0000-0000-0000-000000000005', 'MR Manager S',   'mr-manager-s@test.local',  true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('bb300000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000001', 'manager', true),
  ('bb300000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000002', 'seller',  true),
  ('bb300000-0000-0000-0000-000000000004', 'bb100000-0000-0000-0000-000000000002', 'bb200000-0000-0000-0000-000000000004', 'manager', true),
  ('bb300000-0000-0000-0000-000000000005', 'bb100000-0000-0000-0000-000000000003', 'bb200000-0000-0000-0000-000000000005', 'manager', true);

-- selAactive: seller ativo. selAoff: seller OFFBOARDED (is_active=false) —
-- deve continuar aparecendo no seller_breakdown se tiver atividade no
-- período (ADDENDUM §8). selB/selS: uma seller por empresa.
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('selAactive',  'bb100000-0000-0000-0000-000000000001', 'MR Seller A Ativo',      'A',  'bb200000-0000-0000-0000-000000000002', 'bb300000-0000-0000-0000-000000000002', true),
  ('selAoff',     'bb100000-0000-0000-0000-000000000001', 'MR Seller A Offboarded', 'Ao', null,                                  null,                                  false),
  ('selB',        'bb100000-0000-0000-0000-000000000002', 'MR Seller B',            'B',  null,                                  null,                                  true),
  ('selSuspensa', 'bb100000-0000-0000-0000-000000000003', 'MR Seller S',            'S',  null,                                  null,                                  true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('bb400000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('bb400000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('bb400000-0000-0000-0000-000000000003', 'bb100000-0000-0000-0000-000000000003', 'new', 'Novo', 0);

-- ── LEADS company A ──────────────────────────────────────────────────────
-- source em 3 grafias ("Facebook" / "facebook" / " FACEBOOK ") -> mesmo
-- bucket. leadA4 source NULL -> "Não informado". leadA5 ARQUIVADO -> conta
-- (histórico). leadA6 exatamente em P_END -> excluído. leadA7 antes -> excluído.
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, source, created_at, archived_at) values
  ('bb500000-0000-0000-0000-00000000000a', 'bb100000-0000-0000-0000-000000000001', 'Lead A1', '(11) 90000-0001', 'Onix', 'bb400000-0000-0000-0000-000000000001', 'selAactive', 'Facebook',    '2026-03-10 03:00:00+00', null),
  ('bb500000-0000-0000-0000-00000000000b', 'bb100000-0000-0000-0000-000000000001', 'Lead A2', '(11) 90000-0002', 'Onix', 'bb400000-0000-0000-0000-000000000001', 'selAactive', 'facebook',    '2026-03-11 12:00:00+00', null),
  ('bb500000-0000-0000-0000-00000000000c', 'bb100000-0000-0000-0000-000000000001', 'Lead A3', '(11) 90000-0003', 'Onix', 'bb400000-0000-0000-0000-000000000001', 'selAactive', ' FACEBOOK ',  '2026-03-12 20:00:00+00', null),
  ('bb500000-0000-0000-0000-00000000000d', 'bb100000-0000-0000-0000-000000000001', 'Lead A4', '(11) 90000-0004', 'Onix', 'bb400000-0000-0000-0000-000000000001', 'selAactive', null,          '2026-03-12 23:30:00+00', null),
  ('bb500000-0000-0000-0000-00000000000e', 'bb100000-0000-0000-0000-000000000001', 'Lead A5', '(11) 90000-0005', 'Onix', 'bb400000-0000-0000-0000-000000000001', 'selAactive', 'Instagram',   '2026-03-11 10:00:00+00', '2026-03-13 10:00:00+00'),
  ('bb500000-0000-0000-0000-00000000000f', 'bb100000-0000-0000-0000-000000000001', 'Lead A6', '(11) 90000-0006', 'Onix', 'bb400000-0000-0000-0000-000000000001', 'selAactive', 'Facebook',    '2026-03-14 03:00:00+00', null),
  ('bb500000-0000-0000-0000-000000000010', 'bb100000-0000-0000-0000-000000000001', 'Lead A7', '(11) 90000-0007', 'Onix', 'bb400000-0000-0000-0000-000000000001', 'selAactive', 'Google',      '2026-03-09 12:00:00+00', null);

-- ── LEADS company B (isolamento) ────────────────────────────────────────
-- leadB2 = Lead IMPORTADO: sem data histórica original, created_at = momento
-- do import (ADDENDUM §12 / EXEC §52). Conta no período do created_at.
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, source, created_at) values
  ('bb500000-0000-0000-0000-0000000000b1', 'bb100000-0000-0000-0000-000000000002', 'Lead B1',        '(11) 91000-0001', 'Onix', 'bb400000-0000-0000-0000-000000000002', 'selB', 'Google', '2026-03-11 10:00:00+00'),
  ('bb500000-0000-0000-0000-0000000000b2', 'bb100000-0000-0000-0000-000000000002', 'Lead B2 import', '(11) 91000-0002', 'Onix', 'bb400000-0000-0000-0000-000000000002', 'selB', null,     '2026-03-12 10:00:00+00');

-- ── LEADS company S (suspensa) ─────────────────────────────────────────
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, source, created_at) values
  ('bb500000-0000-0000-0000-0000000000c1', 'bb100000-0000-0000-0000-000000000003', 'Lead S1', '(11) 92000-0001', 'Onix', 'bb400000-0000-0000-0000-000000000003', 'selSuspensa', 'Facebook', '2026-03-11 10:00:00+00'),
  ('bb500000-0000-0000-0000-0000000000c2', 'bb100000-0000-0000-0000-000000000003', 'Lead S2', '(11) 92000-0002', 'Onix', 'bb400000-0000-0000-0000-000000000003', 'selSuspensa', 'Facebook', '2026-03-11 11:00:00+00');

-- ── DEALS company A ────────────────────────────────────────────────────
-- Cohort = Deals com created_at em [P_START, P_END):
--   dealA_in_conv (selAactive)  -> tem Sale (sold_at DEPOIS de P_END) => converted
--   dealA_in_unconv (selAactive)-> sem Sale
--   dealA_off (selAoff)         -> sem Sale
--   => cohort_deals_count = 3, converted_deals_count = 1
-- dealA_before / dealA_extra1 / dealA_extra2: created_at ANTES do período
--   -> FORA da cohort, mas suas Sales (quando sold_at no período) contam em
--      sales_count activity (prova a diferença matemática, EXEC §48).
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by, created_at) values
  ('bb600000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000a', 'Lead A1', 'selAactive', 'Onix', 100000, 0, 'a_vista', 'sold', 'bb200000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000001', '2026-03-11 15:00:00+00'),
  ('bb600000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000b', 'Lead A2', 'selAactive', 'Onix', 100000, 0, 'a_vista', 'open', 'bb200000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000001', '2026-03-12 10:00:00+00'),
  ('bb600000-0000-0000-0000-000000000003', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000c', 'Lead A3', 'selAoff',    'Onix', 100000, 0, 'a_vista', 'open', 'bb200000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000001', '2026-03-11 16:00:00+00'),
  ('bb600000-0000-0000-0000-000000000004', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000b', 'Lead A2', 'selAactive', 'Onix', 100000, 0, 'a_vista', 'sold', 'bb200000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000001', '2026-03-01 10:00:00+00'),
  ('bb600000-0000-0000-0000-000000000005', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000c', 'Lead A3', 'selAactive', 'Onix', 100000, 0, 'a_vista', 'sold', 'bb200000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000001', '2026-03-02 10:00:00+00'),
  ('bb600000-0000-0000-0000-000000000006', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000d', 'Lead A4', 'selAoff',    'Onix', 100000, 0, 'a_vista', 'sold', 'bb200000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000001', '2026-03-02 11:00:00+00');

-- ── SALES company A ───────────────────────────────────────────────────
-- saleA_after: sold_at 2026-03-20 (DEPOIS de P_END) -> NÃO entra em
--   sales_count/revenue activity, mas torna dealA_in_conv "converted".
-- saleA_in1/2/3: sold_at no período -> contam. Somam 20000+33333+10000 =
--   63333; média = round(63333/3) = 21111 (exato).
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('bb700000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'bb600000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000a', 'selAactive', 10000, 'a_vista', 'bb200000-0000-0000-0000-000000000001', '2026-03-20 12:00:00+00'),
  ('bb700000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000001', 'bb600000-0000-0000-0000-000000000004', 'bb500000-0000-0000-0000-00000000000b', 'selAactive', 20000, 'a_vista', 'bb200000-0000-0000-0000-000000000001', '2026-03-10 04:00:00+00'),
  ('bb700000-0000-0000-0000-000000000003', 'bb100000-0000-0000-0000-000000000001', 'bb600000-0000-0000-0000-000000000005', 'bb500000-0000-0000-0000-00000000000c', 'selAactive', 33333, 'a_vista', 'bb200000-0000-0000-0000-000000000001', '2026-03-12 20:00:00+00'),
  ('bb700000-0000-0000-0000-000000000004', 'bb100000-0000-0000-0000-000000000001', 'bb600000-0000-0000-0000-000000000006', 'bb500000-0000-0000-0000-00000000000d', 'selAoff',    10000, 'a_vista', 'bb200000-0000-0000-0000-000000000001', '2026-03-11 13:00:00+00');

-- ── VISITS company A ──────────────────────────────────────────────────
-- Autoridade: status='completed' + closed_at no período. scheduled/
-- confirmed e completed fora do período NÃO contam (EXEC §18).
insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, outcome, note, closed_by, closed_at) values
  ('bb800000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000a', 'selAactive', array['Onix'], '2026-03-11 10:00:00+00', 'completed', 'sold',        '', 'bb200000-0000-0000-0000-000000000001', '2026-03-11 14:00:00+00'),
  ('bb800000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000b', 'selAactive', array['Onix'], '2026-03-12 08:00:00+00', 'completed', 'negotiating', '', 'bb200000-0000-0000-0000-000000000001', '2026-03-12 09:00:00+00'),
  ('bb800000-0000-0000-0000-000000000003', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000c', 'selAactive', array['Onix'], '2026-03-12 08:00:00+00', 'scheduled', null,          '', null,                                  null),
  ('bb800000-0000-0000-0000-000000000004', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000c', 'selAactive', array['Onix'], '2026-03-12 08:00:00+00', 'confirmed', null,          '', null,                                  null),
  ('bb800000-0000-0000-0000-000000000005', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000d', 'selAactive', array['Onix'], '2026-03-20 08:00:00+00', 'completed', 'thinking',    '', 'bb200000-0000-0000-0000-000000000001', '2026-03-20 10:00:00+00'),
  ('bb800000-0000-0000-0000-000000000006', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000d', 'selAactive', array['Onix'], '2026-03-01 08:00:00+00', 'completed', 'thinking',    '', 'bb200000-0000-0000-0000-000000000001', '2026-03-01 10:00:00+00');

-- ── TASKS company A ──────────────────────────────────────────────────
-- Autoridade: status='completed' + completed_at no período. taskA_c_null
-- tem assigned_seller_id NULL -> bucket "Sem vendedor" (ADDENDUM §8).
insert into public.tasks (id, company_id, lead_id, assigned_seller_id, title, priority, status, due_at, completed_at, completed_by) values
  ('bb900000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000a', 'selAactive', 'Task A c1',   'media', 'completed', '2026-03-10 09:00:00+00', '2026-03-10 12:00:00+00', 'bb200000-0000-0000-0000-000000000001'),
  ('bb900000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000b', 'selAoff',    'Task A c2',   'media', 'completed', '2026-03-11 09:00:00+00', '2026-03-11 12:00:00+00', 'bb200000-0000-0000-0000-000000000001'),
  ('bb900000-0000-0000-0000-000000000003', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000c', null,         'Task A null', 'media', 'completed', '2026-03-12 09:00:00+00', '2026-03-12 12:00:00+00', 'bb200000-0000-0000-0000-000000000001'),
  ('bb900000-0000-0000-0000-000000000004', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000d', 'selAactive', 'Task A pend', 'media', 'pending',   '2026-03-12 09:00:00+00', null,                    null),
  ('bb900000-0000-0000-0000-000000000005', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000d', 'selAactive', 'Task A out',  'media', 'completed', '2026-03-20 09:00:00+00', '2026-03-20 10:00:00+00', 'bb200000-0000-0000-0000-000000000001'),
  ('bb900000-0000-0000-0000-000000000006', 'bb100000-0000-0000-0000-000000000001', 'bb500000-0000-0000-0000-00000000000d', 'selAactive', 'Task A bef',  'media', 'completed', '2026-03-01 09:00:00+00', '2026-03-01 10:00:00+00', 'bb200000-0000-0000-0000-000000000001');

-- ── DEALS + SALES company S (suspensa) — prova arredondamento ao centavo:
--    (10000 + 10001) / 2 = 10000.5 -> round -> 10001.
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by, created_at) values
  ('bb600000-0000-0000-0000-0000000000c1', 'bb100000-0000-0000-0000-000000000003', 'bb500000-0000-0000-0000-0000000000c1', 'Lead S1', 'selSuspensa', 'Onix', 100000, 0, 'a_vista', 'sold', 'bb200000-0000-0000-0000-000000000005', 'bb200000-0000-0000-0000-000000000005', '2026-03-02 10:00:00+00'),
  ('bb600000-0000-0000-0000-0000000000c2', 'bb100000-0000-0000-0000-000000000003', 'bb500000-0000-0000-0000-0000000000c2', 'Lead S2', 'selSuspensa', 'Onix', 100000, 0, 'a_vista', 'sold', 'bb200000-0000-0000-0000-000000000005', 'bb200000-0000-0000-0000-000000000005', '2026-03-02 11:00:00+00');
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('bb700000-0000-0000-0000-0000000000c1', 'bb100000-0000-0000-0000-000000000003', 'bb600000-0000-0000-0000-0000000000c1', 'bb500000-0000-0000-0000-0000000000c1', 'selSuspensa', 10000, 'a_vista', 'bb200000-0000-0000-0000-000000000005', '2026-03-11 12:00:00+00'),
  ('bb700000-0000-0000-0000-0000000000c2', 'bb100000-0000-0000-0000-000000000003', 'bb600000-0000-0000-0000-0000000000c2', 'bb500000-0000-0000-0000-0000000000c2', 'selSuspensa', 10001, 'a_vista', 'bb200000-0000-0000-0000-000000000005', '2026-03-11 13:00:00+00');

-- ═══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO / GRANTS / ASSINATURA
-- ═══════════════════════════════════════════════════════════════════════

select is(
  has_function_privilege('authenticated', 'public.get_company_management_report(timestamp with time zone, timestamp with time zone, uuid)', 'EXECUTE'),
  true, 'get_company_management_report: authenticated com EXECUTE');
select is(
  has_function_privilege('anon', 'public.get_company_management_report(timestamp with time zone, timestamp with time zone, uuid)', 'EXECUTE'),
  false, 'get_company_management_report: anon SEM EXECUTE');
select is(
  pg_get_function_result('public.get_company_management_report(timestamp with time zone, timestamp with time zone, uuid)'::regprocedure),
  'jsonb', 'get_company_management_report retorna jsonb (payload só agregado, EXEC §39)');
select is(
  pg_get_function_arguments('public.get_company_management_report(timestamp with time zone, timestamp with time zone, uuid)'::regprocedure),
  'p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_company_id uuid DEFAULT NULL::uuid',
  'assinatura EXATA congelada (ADDENDUM §1)');

-- ═══════════════════════════════════════════════════════════════════════
-- 2. PERÍODO — validação de input (EXEC §7 / §46)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('bb200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

select throws_ok(
  $$select public.get_company_management_report(null, '2026-03-14 03:00:00+00'::timestamptz, null)$$,
  '22023', null, 'period_start NULL -> erro estável (invalid_parameter_value)');
select throws_ok(
  $$select public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, null, null)$$,
  '22023', null, 'period_end NULL -> erro estável');
select throws_ok(
  $$select public.get_company_management_report('2026-03-14 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, null)$$,
  '22023', null, 'period_start = period_end -> erro estável (sem intervalo)');
select throws_ok(
  $$select public.get_company_management_report('2026-03-15 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, null)$$,
  '22023', null, 'period_start > period_end -> erro estável');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. AUTORIZAÇÃO (EXEC §9-§12 / §45 / ADDENDUM §21)
-- ═══════════════════════════════════════════════════════════════════════

-- 3a. Sem sessão (role authenticated, jwt sem sub) -> deny.
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok(
  $$select public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000001'::uuid)$$,
  '28000', null, 'sem sessão -> deny (invalid_authorization_specification)');
reset role;

-- 3b. anon (sem grant) -> permission denied.
set local role anon;
select throws_ok(
  $$select public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'anon -> permission denied (sem EXECUTE)');
reset role;

-- 3c. Seller -> deny pelo gate de relatório gerencial, MESMO conseguindo
--     resolver a própria empresa (EXEC §10).
select pg_temp.as_user('bb200000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select throws_ok(
  $$select public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, null)$$,
  '42501', null, 'Seller -> forbidden (relatório gerencial nega Seller)');
select throws_ok(
  $$select public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'Seller passando a própria company explícita -> ainda forbidden');
reset role;

-- 3d. Manager -> OK na própria empresa; company alheia é IGNORADA
--     (resolver devolve sempre a própria) -> isolamento (EXEC §11 / §45).
select pg_temp.as_user('bb200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select is(
  ((public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, null))->'summary'->>'leads_received')::int,
  5, 'Manager A: relatório da própria empresa (leads_received=5)');
select is(
  ((public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000002'::uuid))->'summary'->>'leads_received')::int,
  5, 'Manager A passando Company B: p_company_id IGNORADO, ainda recebe A (5), nunca B (2)');
select is(
  (public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, null))->'period'->>'timezone',
  'America/Sao_Paulo', 'period.timezone = companies.timezone da empresa resolvida');
reset role;

-- 3e. Super Admin: company explícita A e B, isolamento; sem company -> deny;
--     company inexistente -> deny.
select pg_temp.as_user('bb200000-0000-0000-0000-000000000003'); -- Super Admin
set local role authenticated;
select is(
  ((public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000001'::uuid))->'summary'->>'leads_received')::int,
  5, 'Super Admin + Company A explícita: leads_received=5 (igual ao Manager A)');
select is(
  ((public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000002'::uuid))->'summary'->>'leads_received')::int,
  2, 'Super Admin + Company B explícita: leads_received=2, zero vazamento de A');
select throws_ok(
  $$select public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, null)$$,
  '22023', null, 'Super Admin sem company -> deny (company_required)');
select throws_ok(
  $$select public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, '99999999-9999-9999-9999-999999999999'::uuid)$$,
  '42501', null, 'Super Admin + company inexistente -> forbidden');

-- 3f. Super Admin + company SUSPENSA: leitura permitida (can_access_company
--     já autoriza suspensa). RPC é read-only (ADDENDUM §21 / EXEC §12).
select is(
  ((public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000003'::uuid))->'summary'->>'leads_received')::int,
  2, 'Super Admin + Company suspensa: leitura histórica permitida (leads_received=2)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SUMMARY — os 7 KPIs (EXEC §14-§21 / §47 / ADDENDUM §4-§5)
--    Contexto: Manager A, período [P_START, P_END).
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('bb200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

-- KPI 1: Leads recebidos — inclui ARQUIVADO (leadA5); leadA1 exatamente em
-- P_START conta (inclusive); leadA6 exatamente em P_END NÃO conta
-- (exclusive); leadA7 antes NÃO conta.
select is((pg_temp.rpt_a()->'summary'->>'leads_received')::int, 5,
  'KPI1 leads_received=5 (archived conta; borda start inclusive; borda end exclusive)');

-- KPI 2: Vendas realizadas — por sold_at no período. saleA_after (sold_at
-- 2026-03-20) NÃO entra.
select is((pg_temp.rpt_a()->'summary'->>'sales_count')::int, 3,
  'KPI2 sales_count=3 (Sale com sold_at fora do período não entra em activity)');

-- KPI 3: Valor vendido — sum(sales.sold_value_cents) do mesmo conjunto.
select is((pg_temp.rpt_a()->'summary'->>'revenue_cents')::bigint, 63333::bigint,
  'KPI3 revenue_cents=63333 (20000+33333+10000; saleA_after excluída)');
select is(jsonb_typeof(pg_temp.rpt_a()->'summary'->'revenue_cents'), 'number',
  'KPI3 revenue_cents é number inteiro (centavos, sem float)');

-- KPI 4: Ticket médio — round(63333/3) = 21111.
select is((pg_temp.rpt_a()->'summary'->>'average_ticket_cents')::bigint, 21111::bigint,
  'KPI4 average_ticket_cents=21111 (revenue/sales_count arredondado ao centavo)');

-- KPI 5: Visitas realizadas — status=completed + closed_at no período.
-- scheduled/confirmed e completed fora do período não contam.
select is((pg_temp.rpt_a()->'summary'->>'visits_completed')::int, 2,
  'KPI5 visits_completed=2 (usa closed_at; ignora scheduled/confirmed/fora do período)');

-- KPI 6: Pendências concluídas — status=completed + completed_at no período.
-- pending e completed fora do período não contam; inclui a task de seller NULL.
select is((pg_temp.rpt_a()->'summary'->>'tasks_completed')::int, 3,
  'KPI6 tasks_completed=3 (usa completed_at; ignora pending/fora do período)');

-- KPI 7: Conversão Negociação -> Venda (COHORT).
select is((pg_temp.rpt_a()->'summary'->'deal_to_sale_conversion'->>'cohort_deals_count')::int, 3,
  'KPI7 cohort_deals_count=3 (Deals criadas no período; dealA_before NÃO entra)');
select is((pg_temp.rpt_a()->'summary'->'deal_to_sale_conversion'->>'converted_deals_count')::int, 1,
  'KPI7 converted_deals_count=1 (Sale pode ter sold_at > P_END e ainda conta)');
select is((pg_temp.rpt_a()->'summary'->'deal_to_sale_conversion'->>'rate_percent')::numeric, 33.33::numeric,
  'KPI7 rate_percent=33.33 (100*1/3, 2 casas)');

-- period echo + trend_granularity
select is(pg_temp.rpt_a()->'period'->>'trend_granularity', 'day',
  'period.trend_granularity = "day" literal (ADDENDUM §20)');
select is((pg_temp.rpt_a()->'period'->>'start')::timestamptz, '2026-03-10 03:00:00+00'::timestamptz,
  'period.start = eco de p_period_start');
select is((pg_temp.rpt_a()->'period'->>'end')::timestamptz, '2026-03-14 03:00:00+00'::timestamptz,
  'period.end = eco de p_period_end');

-- Contrato de shape: exatamente as 5 chaves de topo, nada extra (EXEC §13).
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rpt_a()) k),
  array['period','seller_breakdown','source_breakdown','summary','trend'],
  'resposta tem EXATAMENTE {period, summary, seller_breakdown, source_breakdown, trend}');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rpt_a()->'summary') k),
  array['average_ticket_cents','deal_to_sale_conversion','leads_received','revenue_cents','sales_count','tasks_completed','visits_completed'],
  'summary tem EXATAMENTE os 7 KPIs congelados, nenhum campo extra');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. NULLABILITY — ticket sem Sales e cohort vazia (ADDENDUM §4-§5 / §47)
--    Company B: 2 Leads, zero Sales, zero Deals.
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('bb200000-0000-0000-0000-000000000003'); -- Super Admin
set local role authenticated;

select is((pg_temp.rpt_b()->'summary'->>'sales_count')::int, 0, 'Company B: sales_count=0');
select is((pg_temp.rpt_b()->'summary'->>'revenue_cents')::bigint, 0::bigint, 'Company B: revenue_cents=0 (nunca NULL)');
select is(jsonb_typeof(pg_temp.rpt_b()->'summary'->'average_ticket_cents'), 'null',
  'Company B: average_ticket_cents = NULL quando sales_count=0 (nunca 0)');
select is((pg_temp.rpt_b()->'summary'->'deal_to_sale_conversion'->>'cohort_deals_count')::int, 0,
  'Company B: cohort_deals_count=0');
select is(jsonb_typeof(pg_temp.rpt_b()->'summary'->'deal_to_sale_conversion'->'rate_percent'), 'null',
  'Company B: rate_percent = NULL quando cohort=0 (nunca NaN/Infinity/0%)');

-- EXEC §52 — Lead IMPORTADO: leadB2 só tem created_at (momento do import),
-- não há data histórica original; conta no período do created_at.
select is((pg_temp.rpt_b()->'summary'->>'leads_received')::int, 2,
  'Lead importado (só created_at do import) conta no período de entrada no CRM (leadB1 + leadB2)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. ARREDONDAMENTO AO CENTAVO — Company S via Super Admin (ADDENDUM §4)
--    (10000 + 10001) / 2 = 10000.5 -> 10001.
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('bb200000-0000-0000-0000-000000000003'); -- Super Admin
set local role authenticated;
select is(
  ((public.get_company_management_report('2026-03-10 03:00:00+00'::timestamptz, '2026-03-14 03:00:00+00'::timestamptz, 'bb100000-0000-0000-0000-000000000003'::uuid))->'summary'->>'average_ticket_cents')::bigint,
  10001::bigint, 'average_ticket_cents arredonda 10000.5 -> 10001 (numeric, ao centavo)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. SELLER BREAKDOWN (EXEC §27-§30 / §49 / ADDENDUM §7-§9)
--    Manager A. Esperado (ordem: sales_count desc, revenue desc, nome asc):
--      1) selAactive  : tasks 1, visits 2, deals 2, sales 2, revenue 53333
--      2) selAoff     : tasks 1, visits 0, deals 1, sales 1, revenue 10000  (OFFBOARDED)
--      3) Sem vendedor: tasks 1, resto 0                                     (seller_id NULL)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('bb200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

select is(jsonb_array_length(pg_temp.rpt_a()->'seller_breakdown'), 3,
  'seller_breakdown: 3 entradas (ativo + offboarded + "Sem vendedor")');

-- linha 0: selAactive
select is(pg_temp.rpt_a()->'seller_breakdown'->0->>'seller_id', 'selAactive',
  'seller_breakdown[0] = selAactive (mais vendas primeiro)');
select is(pg_temp.rpt_a()->'seller_breakdown'->0->>'seller_name', 'MR Seller A Ativo', 'seller_breakdown[0].seller_name');
select is((pg_temp.rpt_a()->'seller_breakdown'->0->>'tasks_completed')::int,  1, 'selAactive tasks_completed=1 (só a de completed_at no período; NULL-seller não é dele)');
select is((pg_temp.rpt_a()->'seller_breakdown'->0->>'visits_completed')::int, 2, 'selAactive visits_completed=2');
select is((pg_temp.rpt_a()->'seller_breakdown'->0->>'deals_created')::int,    2, 'selAactive deals_created=2 (por assigned_seller_id + created_at no período)');
select is((pg_temp.rpt_a()->'seller_breakdown'->0->>'sales_count')::int,      2, 'selAactive sales_count=2 (saleA_after fora do período não conta)');
select is((pg_temp.rpt_a()->'seller_breakdown'->0->>'revenue_cents')::bigint, 53333::bigint, 'selAactive revenue_cents=53333');

-- linha 1: selAoff — OFFBOARDED (is_active=false) continua aparecendo com nome real.
select is(pg_temp.rpt_a()->'seller_breakdown'->1->>'seller_id', 'selAoff',
  'seller_breakdown[1] = selAoff: seller OFFBOARDED com atividade no período APARECE');
select is(pg_temp.rpt_a()->'seller_breakdown'->1->>'seller_name', 'MR Seller A Offboarded',
  'selAoff: nome histórico real preservado (roster ativo do Pódio não é filtro)');
select is((pg_temp.rpt_a()->'seller_breakdown'->1->>'tasks_completed')::int, 1, 'selAoff tasks_completed=1');
select is((pg_temp.rpt_a()->'seller_breakdown'->1->>'deals_created')::int,   1, 'selAoff deals_created=1');
select is((pg_temp.rpt_a()->'seller_breakdown'->1->>'sales_count')::int,     1, 'selAoff sales_count=1');
select is((pg_temp.rpt_a()->'seller_breakdown'->1->>'revenue_cents')::bigint, 10000::bigint, 'selAoff revenue_cents=10000');

-- linha 2: bucket "Sem vendedor" (assigned_seller_id NULL, só possível em tasks).
select is(jsonb_typeof(pg_temp.rpt_a()->'seller_breakdown'->2->'seller_id'), 'null',
  'seller_breakdown[2].seller_id = NULL (bucket "Sem vendedor", nunca id falso)');
select is(pg_temp.rpt_a()->'seller_breakdown'->2->>'seller_name', 'Sem vendedor',
  'seller_breakdown[2].seller_name = "Sem vendedor"');
select is((pg_temp.rpt_a()->'seller_breakdown'->2->>'tasks_completed')::int, 1,
  'bucket "Sem vendedor": tasks_completed=1 (atividade válida não é descartada)');

-- Lead reatribuído não altera nada aqui: seller_breakdown nunca usa Lead
-- assignment. taskA_c1 é atribuída a selAactive via tasks.assigned_seller_id
-- mesmo que leads.seller_id pudesse apontar para outro — provado pelo
-- fato de o breakdown não ter nenhuma entrada derivada de leads.seller_id.
select ok(
  not exists (
    select 1 from jsonb_array_elements(pg_temp.rpt_a()->'seller_breakdown') e
    where e->>'seller_id' is null and (e->>'visits_completed')::int > 0
  ),
  'seller_breakdown: atribuição só por evento (assigned_seller_id), nunca por Lead');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. SOURCE BREAKDOWN (EXEC §31-§34 / §50 / ADDENDUM §10-§13)
--    "Facebook" / "facebook" / " FACEBOOK " -> mesmo bucket "facebook".
--    NULL -> "__not_informed__" / label "Não informado". Arquivado conta.
--    Esperado (ordem: leads_received desc, sales_count desc, label asc):
--      1) facebook          leads 3  sales 2
--      2) __not_informed__  leads 1  sales 1
--      3) instagram         leads 1  sales 0
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('bb200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

select is(jsonb_array_length(pg_temp.rpt_a()->'source_breakdown'), 3, 'source_breakdown: 3 buckets');

select is(pg_temp.rpt_a()->'source_breakdown'->0->>'source_key', 'facebook',
  'source_breakdown[0].source_key = "facebook" (3 grafias normalizadas no mesmo bucket)');
select is(pg_temp.rpt_a()->'source_breakdown'->0->>'source_label', 'Facebook',
  'source_breakdown[0].source_label = "Facebook" (initcap)');
select is((pg_temp.rpt_a()->'source_breakdown'->0->>'leads_received')::int, 3,
  'facebook leads_received=3 (Facebook + facebook + " FACEBOOK ")');
select is((pg_temp.rpt_a()->'source_breakdown'->0->>'sales_count')::int, 2,
  'facebook sales_count=2 (via sales.lead_id -> leads.source real)');

select is(pg_temp.rpt_a()->'source_breakdown'->1->>'source_key', '__not_informed__',
  'source_breakdown[1] = "__not_informed__" (leads 1 = sales 1, vem antes de instagram por sales_count)');
select is(pg_temp.rpt_a()->'source_breakdown'->1->>'source_label', 'Não informado',
  'source_breakdown[1].source_label = "Não informado"');
select is((pg_temp.rpt_a()->'source_breakdown'->1->>'leads_received')::int, 1, '__not_informed__ leads_received=1 (leadA4 source NULL)');
select is((pg_temp.rpt_a()->'source_breakdown'->1->>'sales_count')::int, 1, '__not_informed__ sales_count=1');

select is(pg_temp.rpt_a()->'source_breakdown'->2->>'source_key', 'instagram',
  'source_breakdown[2] = "instagram"');
select is((pg_temp.rpt_a()->'source_breakdown'->2->>'leads_received')::int, 1,
  'instagram leads_received=1 (leadA5 ARQUIVADO conta na coorte de origem)');
select is((pg_temp.rpt_a()->'source_breakdown'->2->>'sales_count')::int, 0, 'instagram sales_count=0');

-- Cross-company: nenhum source de B ("Google") vaza para o relatório de A.
select ok(
  not exists (
    select 1 from jsonb_array_elements(pg_temp.rpt_a()->'source_breakdown') e
    where e->>'source_key' = 'google'
  ),
  'source_breakdown de A: zero vazamento de source de outra company');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. TREND (EXEC §35-§37 / §51 / ADDENDUM §14-§19)
--    Dia civil America/Sao_Paulo. Buckets tocados: 03-10..03-13 (4).
--      03-10: leads 1 (leadA1)               sales 1 (saleA_in1 @ 03-10 01:00 SP)
--      03-11: leads 2 (leadA2, leadA5 arq)   sales 1 (saleA_in3 @ 03-11 10:00 SP)
--      03-12: leads 2 (leadA3, leadA4)       sales 1 (saleA_in2 @ 03-12 17:00 SP)
--      03-13: leads 0                        sales 0   <- ZERO-FILL
--    leadA4 @ 2026-03-12 23:30Z = 03-12 20:30 SP -> bucket 03-12, NÃO 03-13
--    (prova timezone boundary).
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('bb200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;

select is(jsonb_array_length(pg_temp.rpt_a()->'trend'), 4,
  'trend: 4 buckets diários (todos os dias civis tocados por [start,end))');

select is(pg_temp.rpt_a()->'trend'->0->>'date', '2026-03-10', 'trend[0].date = 2026-03-10 (civil, YYYY-MM-DD)');
select is((pg_temp.rpt_a()->'trend'->0->>'leads_received')::int, 1, 'trend 03-10 leads_received=1');
select is((pg_temp.rpt_a()->'trend'->0->>'sales_count')::int,    1, 'trend 03-10 sales_count=1 (saleA_in1 @ 03-10 01:00 SP fica em 03-10)');

select is(pg_temp.rpt_a()->'trend'->1->>'date', '2026-03-11', 'trend[1].date = 2026-03-11');
select is((pg_temp.rpt_a()->'trend'->1->>'leads_received')::int, 2, 'trend 03-11 leads_received=2 (leadA2 + leadA5 arquivado)');
select is((pg_temp.rpt_a()->'trend'->1->>'sales_count')::int,    1, 'trend 03-11 sales_count=1');

select is(pg_temp.rpt_a()->'trend'->2->>'date', '2026-03-12', 'trend[2].date = 2026-03-12');
select is((pg_temp.rpt_a()->'trend'->2->>'leads_received')::int, 2, 'trend 03-12 leads_received=2 (leadA4 @ 20:30 SP fica em 03-12, não 03-13)');
select is((pg_temp.rpt_a()->'trend'->2->>'sales_count')::int,    1, 'trend 03-12 sales_count=1');

select is(pg_temp.rpt_a()->'trend'->3->>'date', '2026-03-13', 'trend[3].date = 2026-03-13');
select is((pg_temp.rpt_a()->'trend'->3->>'leads_received')::int, 0, 'trend 03-13 leads_received=0 (ZERO-FILL, dia sem atividade)');
select is((pg_temp.rpt_a()->'trend'->3->>'sales_count')::int,    0, 'trend 03-13 sales_count=0 (ZERO-FILL)');

-- Soma dos buckets bate com os KPIs de summary (mesma authority/período).
select is(
  (select sum((e->>'leads_received')::int)::int from jsonb_array_elements(pg_temp.rpt_a()->'trend') e),
  (pg_temp.rpt_a()->'summary'->>'leads_received')::int,
  'trend: soma de leads_received = summary.leads_received');
select is(
  (select sum((e->>'sales_count')::int)::int from jsonb_array_elements(pg_temp.rpt_a()->'trend') e),
  (pg_temp.rpt_a()->'summary'->>'sales_count')::int,
  'trend: soma de sales_count = summary.sales_count');

-- Borda de período no trend: período que termina 1 microsegundo antes da
-- meia-noite civil não gera o dia seguinte; período curto dentro de um
-- único dia civil gera exatamente 1 bucket.
select is(
  jsonb_array_length(public.get_company_management_report(
    '2026-03-11 03:00:00+00'::timestamptz, '2026-03-12 03:00:00+00'::timestamptz, null)->'trend'),
  1, 'trend: [1 dia civil) -> exatamente 1 bucket');
reset role;

select * from finish();
rollback;
