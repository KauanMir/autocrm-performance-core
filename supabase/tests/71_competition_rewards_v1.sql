-- COMPETITION-REWARDS-V1-B1-EXEC — premiação mensal opcional + snapshot
-- histórico da Competition V2. Migration 20260829100000_competition_rewards_v1.sql.
--
-- Determinismo: o "mês fechado" de teste é ABRIL/2026, com timestamps
-- FIXOS e fronteira civil America/Sao_Paulo (UTC-3, sem DST):
--   period_start = 2026-04-01 03:00:00+00
--   period_end   = 2026-05-01 03:00:00+00
-- Como esta migration é datada 2026-08-29, abril/2026 é SEMPRE um mês
-- passado em relação a now() — as campanhas publicadas de abril são
-- elegíveis para _finalize_due_competition_reward_months.
-- Já os testes de upsert_competition_reward_campaign usam mês
-- corrente/próximo/anterior RELATIVOS a now() (pg_temp.cur_month()).
--
-- Roda como postgres; identidade por pg_temp.as_user (SECURITY DEFINER
-- resolve por auth.uid()). set local role só nos testes de GRANT.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

create or replace function pg_temp.cur_month() returns date as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
$$ language sql;

-- linha do snapshot de abril, por empresa + seller
create or replace function pg_temp.mrow(p_company uuid, p_seller text)
returns table (rk int, amt bigint, txt text, nm text, sc int, cvc int, svc int, ack boolean) as $$
  select mr.rank, mr.reward_amount_cents, mr.reward_text, mr.seller_name_snapshot,
         mr.sale_count, mr.completed_visit_count, mr.scheduled_visit_count,
         mr.acknowledged_at is not null
    from public.competition_month_rows mr
    join public.competition_months m on m.id = mr.competition_month_id
   where m.company_id = p_company and m.month_start = '2026-04-01' and mr.seller_id = p_seller;
$$ language sql;

create or replace function pg_temp.months_count(p_company uuid) returns int as $$
  select count(*)::int from public.competition_months where company_id = p_company;
$$ language sql;

create or replace function pg_temp.rows_count(p_company uuid) returns int as $$
  select count(*)::int from public.competition_month_rows mr
    join public.competition_months m on m.id = mr.competition_month_id
   where m.company_id = p_company;
$$ language sql;

create or replace function pg_temp.april_month_id(p_company uuid) returns uuid as $$
  select id from public.competition_months where company_id = p_company and month_start = '2026-04-01';
$$ language sql;

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO / SEGURANÇA
-- ═══════════════════════════════════════════════════════════════════════
select has_table('public', 'competition_reward_campaigns', 'tabela competition_reward_campaigns existe');
select has_table('public', 'competition_reward_tiers', 'tabela competition_reward_tiers existe');
select has_table('public', 'competition_months', 'tabela competition_months existe');
select has_table('public', 'competition_month_rows', 'tabela competition_month_rows existe');

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('competition_reward_campaigns','competition_reward_tiers','competition_months','competition_month_rows')),
  'RLS habilitada nas 4 tabelas');
select ok(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname in ('competition_reward_campaigns','competition_reward_tiers','competition_months','competition_month_rows')) = 0,
  'ZERO policies nas 4 tabelas (acesso só via RPC SECURITY DEFINER)');
select ok(
  not has_table_privilege('authenticated', 'public.competition_reward_campaigns', 'SELECT')
  and not has_table_privilege('authenticated', 'public.competition_month_rows', 'SELECT'),
  'authenticated SEM privilégio direto de SELECT nas tabelas');

-- _rank_company_sellers NÃO foi tocada (baseline 62 depende da assinatura exata de 3 args)
select is(
  (select count(*)::int from pg_proc where proname = '_rank_company_sellers' and pronamespace = 'public'::regnamespace),
  1, '_rank_company_sellers continua existindo exatamente uma vez (assinatura de 3 args intacta)');
select is(
  pg_get_function_identity_arguments('public._rank_company_sellers(uuid,timestamptz,timestamptz)'::regprocedure),
  'p_company_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone',
  '_rank_company_sellers mantém exatamente (uuid, timestamptz, timestamptz)');
select is(
  has_function_privilege('authenticated', 'public._rank_company_sellers(uuid,timestamptz,timestamptz)', 'EXECUTE'),
  false, '_rank_company_sellers: authenticated segue SEM EXECUTE (função interna)');

-- funções irmãs/internas: sem grant
select is(
  has_function_privilege('authenticated', 'public._rank_company_sellers_snapshot(uuid,timestamptz,timestamptz)', 'EXECUTE'),
  false, '_rank_company_sellers_snapshot: função interna, authenticated SEM EXECUTE');
select is(
  has_function_privilege('authenticated', 'public._finalize_due_competition_reward_months(uuid)', 'EXECUTE'),
  false, '_finalize_due_competition_reward_months: função interna, authenticated SEM EXECUTE');

-- RPCs públicas: authenticated COM execute
select ok(has_function_privilege('authenticated', 'public.upsert_competition_reward_campaign(date,text,text,jsonb)', 'EXECUTE'),
  'upsert_competition_reward_campaign: authenticated COM EXECUTE');
select ok(has_function_privilege('authenticated', 'public.get_competition_rewards_overview(uuid)', 'EXECUTE'),
  'get_competition_rewards_overview: authenticated COM EXECUTE');
select ok(has_function_privilege('authenticated', 'public.list_competition_reward_history(uuid,int)', 'EXECUTE'),
  'list_competition_reward_history: authenticated COM EXECUTE');
select ok(has_function_privilege('authenticated', 'public.acknowledge_competition_month_result(uuid)', 'EXECUTE'),
  'acknowledge_competition_month_result: authenticated COM EXECUTE');

select ok((select count(*)::int from pg_constraint
  where conname = 'competition_reward_campaigns_company_month_uniq' and contype = 'u') = 1,
  'UNIQUE(company_id, month_start) em campaigns');
select ok((select count(*)::int from pg_constraint
  where conname = 'competition_reward_tiers_campaign_position_uniq' and contype = 'u') = 1,
  'UNIQUE(campaign_id, position) em tiers');
select ok((select count(*)::int from pg_constraint
  where conname = 'competition_months_company_month_uniq' and contype = 'u') = 1,
  'UNIQUE(company_id, month_start) em competition_months (idempotência do fecho)');

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ═══════════════════════════════════════════════════════════════════════
insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('d8010000-0000-0000-0000-000000000001', 'D80 Rewards',   null, null, 'America/Sao_Paulo', 'ativa'),
  ('d8010000-0000-0000-0000-000000000002', 'D80 Isolation', null, null, 'America/Sao_Paulo', 'ativa'),
  ('d8010000-0000-0000-0000-000000000003', 'D80 NoSale',    null, null, 'America/Sao_Paulo', 'ativa'),
  ('d8010000-0000-0000-0000-000000000004', 'D80 Reassign',  null, null, 'America/Sao_Paulo', 'ativa'),
  ('d8010000-0000-0000-0000-000000000005', 'D80 Trigger',   null, null, 'America/Sao_Paulo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', em, now(), now(), now()
from (values
  ('d8020000-0000-0000-0000-000000000001', 'd80-mgr1@t.local'),
  ('d8020000-0000-0000-0000-000000000002', 'd80-selE@t.local'),
  ('d8020000-0000-0000-0000-000000000003', 'd80-sa@t.local'),
  ('d8020000-0000-0000-0000-000000000004', 'd80-mgr2@t.local'),
  ('d8020000-0000-0000-0000-000000000005', 'd80-mgr3@t.local'),
  ('d8020000-0000-0000-0000-000000000006', 'd80-mgr4@t.local'),
  ('d8020000-0000-0000-0000-000000000007', 'd80-mgr5@t.local')) as t(id, em);

insert into public.profiles (id, name, email, is_active, platform_role)
select id::uuid, nm, em, true, pr::public.platform_role from (values
  ('d8020000-0000-0000-0000-000000000001', 'D80 Manager 1', 'd80-mgr1@t.local', null),
  ('d8020000-0000-0000-0000-000000000002', 'D80 Seller E',  'd80-selE@t.local', null),
  ('d8020000-0000-0000-0000-000000000003', 'D80 Super Adm', 'd80-sa@t.local',   'super_admin'),
  ('d8020000-0000-0000-0000-000000000004', 'D80 Manager 2', 'd80-mgr2@t.local', null),
  ('d8020000-0000-0000-0000-000000000005', 'D80 Manager 3', 'd80-mgr3@t.local', null),
  ('d8020000-0000-0000-0000-000000000006', 'D80 Manager 4', 'd80-mgr4@t.local', null),
  ('d8020000-0000-0000-0000-000000000007', 'D80 Manager 5', 'd80-mgr5@t.local', null)) as t(id, nm, em, pr);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('d8030000-0000-0000-0000-000000000001', 'd8010000-0000-0000-0000-000000000001', 'd8020000-0000-0000-0000-000000000001', 'manager', true),
  ('d8030000-0000-0000-0000-000000000002', 'd8010000-0000-0000-0000-000000000001', 'd8020000-0000-0000-0000-000000000002', 'seller',  true),
  ('d8030000-0000-0000-0000-000000000004', 'd8010000-0000-0000-0000-000000000002', 'd8020000-0000-0000-0000-000000000004', 'manager', true),
  ('d8030000-0000-0000-0000-000000000005', 'd8010000-0000-0000-0000-000000000003', 'd8020000-0000-0000-0000-000000000005', 'manager', true),
  ('d8030000-0000-0000-0000-000000000006', 'd8010000-0000-0000-0000-000000000004', 'd8020000-0000-0000-0000-000000000006', 'manager', true),
  ('d8030000-0000-0000-0000-000000000007', 'd8010000-0000-0000-0000-000000000005', 'd8020000-0000-0000-0000-000000000007', 'manager', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('d80sA',    'd8010000-0000-0000-0000-000000000001', 'D80 A', 'A', null, null, true),
  ('d80sB',    'd8010000-0000-0000-0000-000000000001', 'D80 B', 'B', null, null, true),
  ('d80sC',    'd8010000-0000-0000-0000-000000000001', 'D80 C', 'C', null, null, true),
  ('d80sD',    'd8010000-0000-0000-0000-000000000001', 'D80 D', 'D', null, null, false),
  ('d80sE',    'd8010000-0000-0000-0000-000000000001', 'D80 E', 'E', 'd8020000-0000-0000-0000-000000000002', 'd8030000-0000-0000-0000-000000000002', true),
  ('d80isoS',  'd8010000-0000-0000-0000-000000000002', 'D80 Iso S', 'I', null, null, true),
  ('d80noS',   'd8010000-0000-0000-0000-000000000003', 'D80 No S', 'N', null, null, true),
  ('d80reX',   'd8010000-0000-0000-0000-000000000004', 'D80 Re X', 'X', null, null, true),
  ('d80reY',   'd8010000-0000-0000-0000-000000000004', 'D80 Re Y', 'Y', null, null, true),
  ('d80trigS', 'd8010000-0000-0000-0000-000000000005', 'D80 Trig S', 'T', null, null, true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order)
select sg::uuid, c::uuid, 'new', 'Novo', 0 from (values
  ('d8040000-0000-0000-0000-000000000001', 'd8010000-0000-0000-0000-000000000001'),
  ('d8040000-0000-0000-0000-000000000002', 'd8010000-0000-0000-0000-000000000002'),
  ('d8040000-0000-0000-0000-000000000003', 'd8010000-0000-0000-0000-000000000003'),
  ('d8040000-0000-0000-0000-000000000004', 'd8010000-0000-0000-0000-000000000004'),
  ('d8040000-0000-0000-0000-000000000005', 'd8010000-0000-0000-0000-000000000005')) as t(sg, c);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('d8050000-0000-0000-0000-000000000001', 'd8010000-0000-0000-0000-000000000001', 'D80 Lead 1',   '(11) 90000-9001', 'Onix', 'd8040000-0000-0000-0000-000000000001', 'd80sA'),
  ('d8050000-0000-0000-0000-000000000002', 'd8010000-0000-0000-0000-000000000002', 'D80 Iso Lead', '(11) 90000-9002', 'Onix', 'd8040000-0000-0000-0000-000000000002', 'd80isoS'),
  ('d8050000-0000-0000-0000-000000000004', 'd8010000-0000-0000-0000-000000000004', 'D80 Re Lead',  '(11) 90000-9004', 'Onix', 'd8040000-0000-0000-0000-000000000004', 'd80reX'),
  ('d8050000-0000-0000-0000-000000000005', 'd8010000-0000-0000-0000-000000000005', 'D80 Trig Lead','(11) 90000-9005', 'Onix', 'd8040000-0000-0000-0000-000000000005', 'd80trigS');

-- Vendas de abril/2026 (sold_at dentro de [2026-04-01 03:00+00, 2026-05-01 03:00+00])
--  cia 1: A x3, B x2, C x1, D x1 (D inativo)   -> ranking: A(3) B(2) C(1,cv1) D(1,cv0) E(0)
--  cia 2 (iso): iso x1
--  cia 4 (reassign): reX x1
--  cia 5 (trigger): trigS x1
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
select ('d8060000-0000-0000-0000-0000000000'||sfx)::uuid, c::uuid, l::uuid, 'L', sel, 'Onix', 100000, 0, 'a_vista', 'sold', m::uuid, m::uuid
from (values
  ('a1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sA','d8020000-0000-0000-0000-000000000001'),
  ('a2','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sA','d8020000-0000-0000-0000-000000000001'),
  ('a3','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sA','d8020000-0000-0000-0000-000000000001'),
  ('b1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sB','d8020000-0000-0000-0000-000000000001'),
  ('b2','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sB','d8020000-0000-0000-0000-000000000001'),
  ('c1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sC','d8020000-0000-0000-0000-000000000001'),
  ('d1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sD','d8020000-0000-0000-0000-000000000001'),
  ('ea','d8010000-0000-0000-0000-000000000002','d8050000-0000-0000-0000-000000000002','d80isoS','d8020000-0000-0000-0000-000000000004'),
  ('fa','d8010000-0000-0000-0000-000000000004','d8050000-0000-0000-0000-000000000004','d80reX','d8020000-0000-0000-0000-000000000006'),
  ('fb','d8010000-0000-0000-0000-000000000005','d8050000-0000-0000-0000-000000000005','d80trigS','d8020000-0000-0000-0000-000000000007')
) as t(sfx, c, l, sel, m);

insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
select ('d8070000-0000-0000-0000-0000000000'||sfx)::uuid, c::uuid, ('d8060000-0000-0000-0000-0000000000'||sfx)::uuid, l::uuid,
       sel, 100000, 'a_vista', m::uuid, sat::timestamptz
from (values
  ('a1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sA','d8020000-0000-0000-0000-000000000001','2026-04-05 12:00:00+00'),
  ('a2','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sA','d8020000-0000-0000-0000-000000000001','2026-04-10 12:00:00+00'),
  ('a3','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sA','d8020000-0000-0000-0000-000000000001','2026-04-15 12:00:00+00'),
  ('b1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sB','d8020000-0000-0000-0000-000000000001','2026-04-06 12:00:00+00'),
  ('b2','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sB','d8020000-0000-0000-0000-000000000001','2026-04-11 12:00:00+00'),
  ('c1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sC','d8020000-0000-0000-0000-000000000001','2026-04-07 12:00:00+00'),
  ('d1','d8010000-0000-0000-0000-000000000001','d8050000-0000-0000-0000-000000000001','d80sD','d8020000-0000-0000-0000-000000000001','2026-04-08 12:00:00+00'),
  ('ea','d8010000-0000-0000-0000-000000000002','d8050000-0000-0000-0000-000000000002','d80isoS','d8020000-0000-0000-0000-000000000004','2026-04-09 12:00:00+00'),
  ('fa','d8010000-0000-0000-0000-000000000004','d8050000-0000-0000-0000-000000000004','d80reX','d8020000-0000-0000-0000-000000000006','2026-04-09 12:00:00+00'),
  ('fb','d8010000-0000-0000-0000-000000000005','d8050000-0000-0000-0000-000000000005','d80trigS','d8020000-0000-0000-0000-000000000007','2026-04-09 12:00:00+00')
) as t(sfx, c, l, sel, m, sat);

-- 1 visita realizada em abril para o C da cia 1 (desempata C > D no 2o critério).
-- created_at em MARÇO (como no teste 70): assim conta como visita realizada de
-- abril (closed_at) mas NÃO infla o scheduled_visit_count de abril (created_at).
insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, outcome, note, closed_by, closed_at, created_at) values
  ('d8080000-0000-0000-0000-0000000000c1', 'd8010000-0000-0000-0000-000000000001', 'd8050000-0000-0000-0000-000000000001', 'd80sC', array['Onix'], '2026-04-02 10:00:00+00', 'completed', 'sold', '', 'd8020000-0000-0000-0000-000000000001', '2026-04-03 14:00:00+00', '2026-03-20 09:00:00+00');

-- cia 4 (reassign): 1 agendamento de abril para reX, ainda 'scheduled' (created_at abril = autoridade)
insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, note, created_by, updated_by, created_at) values
  ('d8080000-0000-0000-0000-0000000000e1', 'd8010000-0000-0000-0000-000000000004', 'd8050000-0000-0000-0000-000000000004', 'd80reX', array['Onix'], '2026-04-20 10:00:00+00', 'scheduled', '', 'd8020000-0000-0000-0000-000000000006', 'd8020000-0000-0000-0000-000000000006', '2026-04-15 12:00:00+00');

-- Campanhas de ABRIL/2026 (mês passado), publicadas — INSERT direto: o RPC
-- upsert rejeita month_start < mês corrente por design.
insert into public.competition_reward_campaigns
  (id, company_id, month_start, timezone, status, title, created_by_profile_id, published_at, published_by_profile_id)
values
  ('d8090000-0000-0000-0000-000000000001', 'd8010000-0000-0000-0000-000000000001', '2026-04-01', 'America/Sao_Paulo', 'published', 'Abril D80', 'd8020000-0000-0000-0000-000000000001', now(), 'd8020000-0000-0000-0000-000000000001'),
  ('d8090000-0000-0000-0000-000000000002', 'd8010000-0000-0000-0000-000000000002', '2026-04-01', 'America/Sao_Paulo', 'published', 'Abril Iso', 'd8020000-0000-0000-0000-000000000004', now(), 'd8020000-0000-0000-0000-000000000004'),
  ('d8090000-0000-0000-0000-000000000003', 'd8010000-0000-0000-0000-000000000003', '2026-04-01', 'America/Sao_Paulo', 'published', 'Abril NoSale', 'd8020000-0000-0000-0000-000000000005', now(), 'd8020000-0000-0000-0000-000000000005'),
  ('d8090000-0000-0000-0000-000000000004', 'd8010000-0000-0000-0000-000000000004', '2026-04-01', 'America/Sao_Paulo', 'published', 'Abril Reassign', 'd8020000-0000-0000-0000-000000000006', now(), 'd8020000-0000-0000-0000-000000000006'),
  ('d8090000-0000-0000-0000-000000000005', 'd8010000-0000-0000-0000-000000000005', '2026-04-01', 'America/Sao_Paulo', 'published', 'Abril Trigger', 'd8020000-0000-0000-0000-000000000007', now(), 'd8020000-0000-0000-0000-000000000007');

-- Tiers da campanha da cia 1: pos1 = R$ 500,00 ; pos2 = só texto ; pos3 = R$ + texto
insert into public.competition_reward_tiers (campaign_id, position, amount_cents, reward_text) values
  ('d8090000-0000-0000-0000-000000000001', 1, 50000, null),
  ('d8090000-0000-0000-0000-000000000001', 2, null,  'Vale-compras R$200'),
  ('d8090000-0000-0000-0000-000000000001', 3, 10000, 'Bonus');
insert into public.competition_reward_tiers (campaign_id, position, amount_cents, reward_text) values
  ('d8090000-0000-0000-0000-000000000002', 1, 25000, null);

-- ═══════════════════════════════════════════════════════════════════════
-- upsert_competition_reward_campaign — auth + validação (mês corrente)
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d8020000-0000-0000-0000-000000000002'); -- Seller da cia 1
select throws_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'draft', 'X', '[]'::jsonb)$$, pg_temp.cur_month()),
  '42501', null, 'Seller NÃO cria/edita campanha (forbidden)');

select pg_temp.as_user('d8020000-0000-0000-0000-000000000001'); -- Manager da cia 1
select throws_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'draft', null, '[]'::jsonb)$$, (pg_temp.cur_month() - interval '1 month')::date),
  '22023', null, 'mês anterior ao corrente é rejeitado (month_closed)');
select throws_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'draft', null, '[{"position":11,"amount_cents":100}]'::jsonb)$$, pg_temp.cur_month()),
  '22023', null, 'posição 11 (> 10) rejeitada');
select throws_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'draft', null, '[{"position":1,"amount_cents":0}]'::jsonb)$$, pg_temp.cur_month()),
  '22023', null, 'amount_cents <= 0 rejeitado');
select throws_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'draft', null, '[{"position":1}]'::jsonb)$$, pg_temp.cur_month()),
  '22023', null, 'tier sem valor E sem texto rejeitado (empty_tier)');
select throws_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'banana', null, '[]'::jsonb)$$, pg_temp.cur_month()),
  '22023', null, 'status inválido rejeitado');

-- draft do mês corrente
select lives_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'draft', 'Campanha Corrente', '[{"position":1,"amount_cents":30000,"reward_text":"Troféu"}]'::jsonb)$$, pg_temp.cur_month()),
  'Manager cria draft do mês corrente (valor + texto juntos permitidos)');
select is(
  (select status from public.competition_reward_campaigns where company_id = 'd8010000-0000-0000-0000-000000000001' and month_start = pg_temp.cur_month()),
  'draft', 'campanha do mês corrente gravada como draft');
select is((select count(*)::int from public.competition_reward_tiers t
  join public.competition_reward_campaigns c on c.id = t.campaign_id
  where c.company_id = 'd8010000-0000-0000-0000-000000000001' and c.month_start = pg_temp.cur_month()),
  1, '1 tier gravado para a campanha corrente');

-- Seller NÃO vê draft no overview
select pg_temp.as_user('d8020000-0000-0000-0000-000000000002');
select is(
  coalesce(public.get_competition_rewards_overview(null) #> '{current_month,campaign}', 'null'::jsonb),
  'null'::jsonb, 'Seller NÃO enxerga campanha em draft do mês corrente');

-- publish (upsert no MESMO mês => UPDATE, não novo INSERT)
select pg_temp.as_user('d8020000-0000-0000-0000-000000000001');
select lives_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'published', 'Campanha Corrente', '[{"position":1,"amount_cents":40000},{"position":2,"reward_text":"Folga"}]'::jsonb)$$, pg_temp.cur_month()),
  'Manager publica a campanha do mês corrente');
select is((select count(*)::int from public.competition_reward_campaigns
  where company_id = 'd8010000-0000-0000-0000-000000000001' and month_start = pg_temp.cur_month()),
  1, 'UNIQUE(company_id, month_start): segundo upsert é UPDATE, não duplica');
select is((select status from public.competition_reward_campaigns
  where company_id = 'd8010000-0000-0000-0000-000000000001' and month_start = pg_temp.cur_month()),
  'published', 'status virou published');
select ok((select published_at is not null and published_by_profile_id = 'd8020000-0000-0000-0000-000000000001'
  from public.competition_reward_campaigns where company_id = 'd8010000-0000-0000-0000-000000000001' and month_start = pg_temp.cur_month()),
  'published_at / published_by preenchidos no publish');
select is((select count(*)::int from public.competition_reward_tiers t
  join public.competition_reward_campaigns c on c.id = t.campaign_id
  where c.company_id = 'd8010000-0000-0000-0000-000000000001' and c.month_start = pg_temp.cur_month()),
  2, 'tiers substituídos atomicamente (agora 2)');

-- Seller VÊ a campanha publicada do mês corrente
select pg_temp.as_user('d8020000-0000-0000-0000-000000000002');
select ok(
  (public.get_competition_rewards_overview(null) #> '{current_month,campaign}') is not null,
  'Seller enxerga a campanha PUBLICADA do mês corrente');
select is(
  (public.get_competition_rewards_overview(null) #>> '{current_month,campaign,status}'),
  'published', 'overview do Seller: campanha corrente = published');

-- ═══════════════════════════════════════════════════════════════════════
-- Super Admin — contextual vs global
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d8020000-0000-0000-0000-000000000003'); -- super admin (sem membership)
select is(public.get_competition_rewards_overview(null), '{}'::jsonb,
  'Super Admin global (sem p_company_id) → {}');
select is(public.list_competition_reward_history(null), '[]'::jsonb,
  'Super Admin global → histórico vazio');
select is(jsonb_typeof(public.get_competition_rewards_overview('d8010000-0000-0000-0000-000000000001')), 'object',
  'Super Admin contextual (com p_company_id) → objeto de gestão');

-- Manager de outra empresa NÃO acessa via p_company_id
select pg_temp.as_user('d8020000-0000-0000-0000-000000000004'); -- Manager cia 2
select throws_ok(
  $$select public.get_competition_rewards_overview('d8010000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Manager não usa p_company_id para espiar outra empresa (forbidden)');

-- ═══════════════════════════════════════════════════════════════════════
-- Finalização — abril/2026 da cia 1 (via list_competition_reward_history)
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d8020000-0000-0000-0000-000000000001'); -- Manager cia 1
select is(jsonb_array_length(public.list_competition_reward_history(null)), 1,
  'histórico da cia 1: exatamente 1 mês fechado (abril)');
select is(pg_temp.months_count('d8010000-0000-0000-0000-000000000001'), 1,
  'exatamente 1 competition_months de abril (fecho lazy on-read)');
select is((select had_competition from public.competition_months
  where company_id = 'd8010000-0000-0000-0000-000000000001' and month_start = '2026-04-01'),
  true, 'abril: had_competition = true (houve Sale)');
select is((select array[period_start, period_end]::timestamptz[] from public.competition_months
  where company_id = 'd8010000-0000-0000-0000-000000000001' and month_start = '2026-04-01'),
  array['2026-04-01 03:00:00+00','2026-05-01 03:00:00+00']::timestamptz[],
  'abril: boundary civil America/Sao_Paulo congelado (03:00Z .. 03:00Z)');
select is((select campaign_id from public.competition_months
  where company_id = 'd8010000-0000-0000-0000-000000000001' and month_start = '2026-04-01'),
  'd8090000-0000-0000-0000-000000000001'::uuid, 'competition_months aponta para a campanha publicada de abril');
select is(pg_temp.rows_count('d8010000-0000-0000-0000-000000000001'), 5,
  'abril: 5 linhas de standings (A,B,C,D,E) — D inativo permanece no snapshot');

-- ranking + snapshot de reward
select is((select rk from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sA')), 1, 'A (3 vendas) → rank 1');
select is((select amt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sA')), 50000::bigint, 'A: reward_amount_cents = 50000 (tier pos 1)');
select is((select txt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sA')), null, 'A: sem reward_text (tier pos 1 só valor)');
select is((select rk from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sB')), 2, 'B (2 vendas) → rank 2');
select is((select txt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sB')), 'Vale-compras R$200', 'B: reward_text do tier pos 2');
select is((select amt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sB')), null, 'B: tier pos 2 sem valor monetário');
select is((select rk from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sC')), 3, 'C (1 venda + 1 visita) → rank 3 (2o critério desempata C > D)');
select is((select amt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sC')), 10000::bigint, 'C: reward_amount_cents = 10000 (tier pos 3)');
select is((select txt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sC')), 'Bonus', 'C: reward_text = Bonus (tier pos 3)');
select is((select rk from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sD')), 4, 'D (inativo, 1 venda) → rank 4, presente no snapshot');
select is((select nm from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sD')), 'D80 D', 'D: seller_name_snapshot persistido');
select is((select amt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sD')), null, 'D: sem tier na posição 4 → reward_amount_cents null');
select is((select txt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sD')), null, 'D: sem tier na posição 4 → reward_text null');
select is((select array[sc, cvc, svc] from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sC')), array[1,1,0],
  'C: contagens congeladas (1 venda / 1 visita / 0 agendamentos)');

-- roster estendido: função irmã inclui inativo com atividade no período
select is(
  (select count(*)::int from public._rank_company_sellers_snapshot(
     'd8010000-0000-0000-0000-000000000001', '2026-04-01 03:00:00+00', '2026-05-01 03:00:00+00')
   where seller_id = 'd80sD'),
  1, '_rank_company_sellers_snapshot inclui Seller INATIVO que teve Sale no período');
select is(
  (select count(*)::int from public._rank_company_sellers(
     'd8010000-0000-0000-0000-000000000001', '2026-04-01 03:00:00+00', '2026-05-01 03:00:00+00')
   where seller_id = 'd80sD'),
  0, '_rank_company_sellers (roster ATUAL) NÃO inclui o Seller inativo — comportamento intacto');

-- idempotência
select is(jsonb_array_length(public.list_competition_reward_history(null)), 1, 'segunda leitura: ainda 1 mês (idempotente)');
select is(pg_temp.months_count('d8010000-0000-0000-0000-000000000001'), 1, 'idempotente: NÃO duplica competition_months');
select is(pg_temp.rows_count('d8010000-0000-0000-0000-000000000001'), 5, 'idempotente: NÃO duplica competition_month_rows');

-- Sales / Leads intactos
select is((select count(*)::int from public.sales where company_id = 'd8010000-0000-0000-0000-000000000001'), 7,
  'finalize NÃO apaga/reseta Sales (7 vendas de abril seguem lá)');
select is((select count(*)::int from public.leads where company_id = 'd8010000-0000-0000-0000-000000000001'), 1,
  'finalize NÃO apaga Leads');
select is((select count(*)::int from public.seller_competition_events where company_id = 'd8010000-0000-0000-0000-000000000001'), 0,
  'publicar/finalizar campanha NÃO gera seller_competition_events (competição segue dirigida por Sales)');

-- campanha de mês futuro não altera o snapshot fechado
select lives_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'published', 'Proximo Mes', '[{"position":1,"amount_cents":99999}]'::jsonb)$$, (pg_temp.cur_month() + interval '1 month')::date),
  'Manager publica campanha do mês SEGUINTE');
select is(pg_temp.rows_count('d8010000-0000-0000-0000-000000000001'), 5,
  'campanha de mês futuro NÃO altera o snapshot de abril (ainda 5 linhas)');
select is((select amt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sA')), 50000::bigint,
  'reward congelado de A permanece 50000 após editar/publicar outras campanhas');
select lives_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'published', 'Campanha Corrente v3', '[{"position":1,"amount_cents":1}]'::jsonb)$$, pg_temp.cur_month()),
  'Manager reedita a campanha do mês CORRENTE');
select is((select amt from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sA')), 50000::bigint,
  'reeditar a campanha corrente NÃO mexe no snapshot de abril');

-- ═══════════════════════════════════════════════════════════════════════
-- Isolamento de histórico entre empresas
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d8020000-0000-0000-0000-000000000004'); -- Manager cia 2
select is(jsonb_array_length(public.list_competition_reward_history(null)), 1,
  'Manager cia 2 vê só o próprio histórico (1 mês)');
select is(
  (select (elem->'rows'->0->>'seller_id') from jsonb_array_elements(public.list_competition_reward_history(null)) elem limit 1),
  'd80isoS', 'histórico da cia 2 contém apenas seller da cia 2');
select is(pg_temp.rows_count('d8010000-0000-0000-0000-000000000002'), 1,
  'cia 2: 1 linha de standings (só o iso seller)');

-- ═══════════════════════════════════════════════════════════════════════
-- Visibilidade do Seller no histórico (própria linha + Top 3)
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d8020000-0000-0000-0000-000000000002'); -- Seller E (rank 5 em abril)
select is(
  (select jsonb_array_length(elem->'rows') from jsonb_array_elements(public.list_competition_reward_history(null)) elem limit 1),
  4, 'Seller vê Top 3 + a própria linha = 4 (não vê rank 4 alheio)');
select is(
  (select count(*)::int from jsonb_array_elements(
     (select elem->'rows' from jsonb_array_elements(public.list_competition_reward_history(null)) elem limit 1)) r
   where (r->>'seller_id') = 'd80sD'),
  0, 'Seller NÃO enxerga a linha de rank 4 de outro Seller');
select is(
  (select count(*)::int from jsonb_array_elements(
     (select elem->'rows' from jsonb_array_elements(public.list_competition_reward_history(null)) elem limit 1)) r
   where (r->>'seller_id') = 'd80sE'),
  1, 'Seller enxerga a própria linha (rank 5) fora do Top 3');
select is(
  (public.get_competition_rewards_overview(null) #>> '{last_result,rank}'),
  '5', 'overview do Seller: last_result traz o rank do mês fechado não reconhecido');

-- ═══════════════════════════════════════════════════════════════════════
-- acknowledge_competition_month_result
-- ═══════════════════════════════════════════════════════════════════════
select is(public.acknowledge_competition_month_result(pg_temp.april_month_id('d8010000-0000-0000-0000-000000000001')), 1,
  'Seller reconhece a própria linha → 1 linha afetada');
select is(public.acknowledge_competition_month_result(pg_temp.april_month_id('d8010000-0000-0000-0000-000000000001')), 0,
  'ack idempotente → 0 na segunda chamada');
select is((select ack from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sE')), true,
  'acknowledged_at gravado na linha do Seller');
select is((select ack from pg_temp.mrow('d8010000-0000-0000-0000-000000000001','d80sA')), false,
  'ack NÃO tocou a linha de outro Seller');
select is((public.get_competition_rewards_overview(null) #> '{last_result}'), 'null'::jsonb,
  'após ack, overview do Seller não traz mais last_result pendente');

select pg_temp.as_user('d8020000-0000-0000-0000-000000000001'); -- Manager
select throws_ok(
  format($$select public.acknowledge_competition_month_result(%L::uuid)$$, pg_temp.april_month_id('d8010000-0000-0000-0000-000000000001')),
  '42501', null, 'Manager NÃO reconhece resultado (só Seller)');

-- ═══════════════════════════════════════════════════════════════════════
-- NoSale — campanha publicada, mês sem nenhuma Sale
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d8020000-0000-0000-0000-000000000005'); -- Manager cia 3
select is(jsonb_array_length(public.list_competition_reward_history(null)), 1,
  'NoSale: o mês fechado existe mesmo sem vendas (campanha publicada)');
select is((select had_competition from public.competition_months where company_id = 'd8010000-0000-0000-0000-000000000003'),
  false, 'NoSale: had_competition = false');
select is(pg_temp.rows_count('d8010000-0000-0000-0000-000000000003'), 0,
  'NoSale: ZERO linhas de standings, ZERO vencedor');

-- ═══════════════════════════════════════════════════════════════════════
-- update_visit no dia 1 do novo mês — finaliza o mês publicado ANTERIOR
-- ANTES de reatribuir (atribuição pré-reatribuição preservada)
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d8020000-0000-0000-0000-000000000006'); -- Manager cia 4
select is(pg_temp.months_count('d8010000-0000-0000-0000-000000000004'), 0,
  'Reassign: nada finalizado antes do update_visit');
select lives_ok(
  $$select public.update_visit('d8080000-0000-0000-0000-0000000000e1'::uuid, 1,
      '2026-04-20 10:00:00+00'::timestamptz, array['Onix'], '', 'd80reY')$$,
  'update_visit reatribui o agendamento de abril de reX para reY');
select is(pg_temp.months_count('d8010000-0000-0000-0000-000000000004'), 1,
  'update_visit disparou _finalize_due_competition_reward_months ANTES de reatribuir');
select is((select svc from pg_temp.mrow('d8010000-0000-0000-0000-000000000004','d80reX')), 1,
  'snapshot de abril congelou o agendamento no reX (atribuição pré-reatribuição)');
select is((select rk from pg_temp.mrow('d8010000-0000-0000-0000-000000000004','d80reX')), 1,
  'reX permanece rank 1 no snapshot de abril');
select is((select coalesce(svc, 0) from pg_temp.mrow('d8010000-0000-0000-0000-000000000004','d80reY')), 0,
  'reatribuição NÃO reescreveu histórico: reY não herdou o agendamento de abril no snapshot');
select is((select assigned_seller_id from public.visits where id = 'd8080000-0000-0000-0000-0000000000e1'),
  'd80reY', 'a reatribuição em si foi aplicada na Visit (contrato de update_visit intacto)');

-- ═══════════════════════════════════════════════════════════════════════
-- Trigger de defesa — desativar Seller finaliza o mês publicado pendente
-- ═══════════════════════════════════════════════════════════════════════
select is(pg_temp.months_count('d8010000-0000-0000-0000-000000000005'), 0,
  'Trigger: nada finalizado antes da desativação do Seller');
update public.sellers set is_active = false where id = 'd80trigS';
select is(pg_temp.months_count('d8010000-0000-0000-0000-000000000005'), 1,
  'desativar Seller dispara o fecho do mês publicado pendente (defesa em profundidade §30)');
select is((select rk from pg_temp.mrow('d8010000-0000-0000-0000-000000000005','d80trigS')), 1,
  'Seller desativado entra no snapshot que o próprio churn disparou');

-- ═══════════════════════════════════════════════════════════════════════
-- auth: não autenticado
-- ═══════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', null, true);
select throws_ok($$select public.get_competition_rewards_overview(null)$$, '28000', null,
  'get_competition_rewards_overview sem auth → invalid_authorization_specification');
select throws_ok(
  format($$select public.upsert_competition_reward_campaign(%L::date, 'draft', null, '[]'::jsonb)$$, pg_temp.cur_month()),
  '28000', null, 'upsert_competition_reward_campaign sem auth → invalid_authorization_specification');

set local role anon;
select throws_ok($$select public.list_competition_reward_history(null)$$, '42501', null,
  'anon sem grant: permission denied');
reset role;

select * from finish();
rollback;
