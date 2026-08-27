-- COMPETITION-V2-B1-EXEC-BACKEND — terceiro critério do ranking:
-- Agendamentos de visitas (scheduled_visit_count) +
-- seller_competition_events source_type='appointment' via create_visit.
-- Migration 20260828100000_competition_v2_appointment_criterion.sql.
--
-- GRUPO 1 (ranking math): inserts diretos, timestamps FIXOS (abril/2026),
-- list_company_seller_leaderboard(range fixo) — determinístico.
-- scheduled_visit_count NÃO tem filtro de status e usa created_at; as
-- fixtures "completed" do GRUPO 1 usam created_at em MARÇO para não poluir
-- a contagem de agendamentos de abril.
-- GRUPO 2 (movement/event): offsets RELATIVOS a now() + RPC create_visit /
-- update_visit. LIMITAÇÃO CONHECIDA (igual a 62/63): "primeira hora do
-- mês" não é testável sem override de clock.
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

create or replace function pg_temp.official_start() returns timestamptz as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
$$ language sql;
create or replace function pg_temp.official_end() returns timestamptz as $$
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo';
$$ language sql;

create or replace function pg_temp.apr(p_sel text)
returns table (sc int, cvc int, svc int, rk int) as $$
  select l.sale_count, l.completed_visit_count, l.scheduled_visit_count, l.rank
    from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz,
                                                '2026-04-30 23:59:59.999999+00'::timestamptz, null) l
   where l.seller_id = p_sel;
$$ language sql;
-- Manager context: company derivada da membership do jwt -> p_company_id NULL.
create or replace function pg_temp.off_svc(p_sel text) returns int as $$
  select l.scheduled_visit_count
    from public.list_company_seller_leaderboard(pg_temp.official_start(), pg_temp.official_end(), null) l
   where l.seller_id = p_sel;
$$ language sql;
create or replace function pg_temp.off_rank(p_sel text) returns int as $$
  select l.rank
    from public.list_company_seller_leaderboard(pg_temp.official_start(), pg_temp.official_end(), null) l
   where l.seller_id = p_sel;
$$ language sql;
create or replace function pg_temp.evt_count(p_company uuid, p_seller text default null, p_source text default null) returns int as $$
  select count(*)::int from public.seller_competition_events
   where company_id = p_company
     and (p_seller is null or seller_id = p_seller)
     and (p_source is null or source_type = p_source);
$$ language sql;

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════
select has_column('public', 'seller_competition_events', 'source_appointment_visit_id',
  'seller_competition_events.source_appointment_visit_id existe');
select col_is_null('public', 'seller_competition_events', 'source_appointment_visit_id',
  'source_appointment_visit_id é nullable');
select ok(
  (select count(*)::int from pg_constraint
    where conname = 'seller_competition_events_source_appointment_visit_id_uniq' and contype = 'u') = 1,
  'UNIQUE(source_appointment_visit_id) existe (idempotência)');
select ok(
  pg_get_function_result('public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid)'::regprocedure)
    like '%scheduled_visit_count integer%',
  'list_company_seller_leaderboard expõe scheduled_visit_count');
select ok(
  (select count(*) from pg_type t join pg_attribute a on a.attrelid = t.typrelid
     where t.typname = 'seller_rank_row' and a.attname = 'scheduled_visit_count' and not a.attisdropped) = 1,
  'seller_rank_row ganhou o atributo scheduled_visit_count');

-- ═══════════════════════════════════════════════════════════════════════
-- GRUPO 1 — RANKING MATH (abril/2026)
-- ═══════════════════════════════════════════════════════════════════════
insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('d7010000-0000-0000-0000-000000000001', 'D70 Rank',      null, null, 'America/Sao_Paulo', 'ativa'),
  ('d7010000-0000-0000-0000-000000000002', 'D70 Isolation', null, null, 'America/Sao_Paulo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'd7020000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'd70-manager@t.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd7020000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'd70-seller-a@t.local',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd7020000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'd70-superadmin@t.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd7020000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'd70-iso-manager@t.local',now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('d7020000-0000-0000-0000-000000000001', 'D70 Manager',    'd70-manager@t.local',    true, null),
  ('d7020000-0000-0000-0000-000000000002', 'D70 Seller A',   'd70-seller-a@t.local',   true, null),
  ('d7020000-0000-0000-0000-000000000003', 'D70 Super Admin','d70-superadmin@t.local', true, 'super_admin'),
  ('d7020000-0000-0000-0000-000000000004', 'D70 Iso Manager','d70-iso-manager@t.local',true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('d7030000-0000-0000-0000-000000000001', 'd7010000-0000-0000-0000-000000000001', 'd7020000-0000-0000-0000-000000000001', 'manager', true),
  ('d7030000-0000-0000-0000-000000000002', 'd7010000-0000-0000-0000-000000000001', 'd7020000-0000-0000-0000-000000000002', 'seller',  true),
  ('d7030000-0000-0000-0000-000000000004', 'd7010000-0000-0000-0000-000000000002', 'd7020000-0000-0000-0000-000000000004', 'manager', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('d70sA',  'd7010000-0000-0000-0000-000000000001', 'D70 A', 'A', 'd7020000-0000-0000-0000-000000000002', 'd7030000-0000-0000-0000-000000000002', true),
  ('d70sB',  'd7010000-0000-0000-0000-000000000001', 'D70 B', 'B', null, null, true),
  ('d70sC',  'd7010000-0000-0000-0000-000000000001', 'D70 C', 'C', null, null, true),
  ('d70sD',  'd7010000-0000-0000-0000-000000000001', 'D70 D', 'D', null, null, true),
  ('d70sE',  'd7010000-0000-0000-0000-000000000001', 'D70 E', 'E', null, null, true),
  ('d70sF',  'd7010000-0000-0000-0000-000000000001', 'D70 F', 'F', null, null, true),
  ('d70sG',  'd7010000-0000-0000-0000-000000000001', 'D70 G', 'G', null, null, true),
  ('d70sBd', 'd7010000-0000-0000-0000-000000000001', 'D70 Bd', 'B', null, null, true),
  ('d70sZ1', 'd7010000-0000-0000-0000-000000000001', 'D70 Zero Twin', 'Z', null, null, true),
  ('d70sZ2', 'd7010000-0000-0000-0000-000000000001', 'D70 Zero Twin', 'Z', null, null, true),
  ('d70sInactive', 'd7010000-0000-0000-0000-000000000001', 'D70 Inactive', 'X', null, null, false),
  ('d70IsoSeller', 'd7010000-0000-0000-0000-000000000002', 'D70 Iso Seller', 'I', null, null, true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('d7040000-0000-0000-0000-000000000001', 'd7010000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('d7040000-0000-0000-0000-000000000002', 'd7010000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('d7050000-0000-0000-0000-000000000001', 'd7010000-0000-0000-0000-000000000001', 'D70 Lead',     '(11) 90000-7001', 'Onix', 'd7040000-0000-0000-0000-000000000001', 'd70sA'),
  ('d7050000-0000-0000-0000-000000000002', 'd7010000-0000-0000-0000-000000000002', 'D70 Iso Lead', '(11) 90000-7002', 'Onix', 'd7040000-0000-0000-0000-000000000002', 'd70IsoSeller');

insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
select ('d7060000-0000-0000-0000-0000000000'||sfx)::uuid, 'd7010000-0000-0000-0000-000000000001',
       'd7050000-0000-0000-0000-000000000001', 'L', sel, 'Onix', 100000, 0, 'a_vista', 'sold',
       'd7020000-0000-0000-0000-000000000001', 'd7020000-0000-0000-0000-000000000001'
from (values ('a1','d70sA'),('a2','d70sA'),('a3','d70sA'),('b1','d70sB'),('b2','d70sB'),('b3','d70sB'),
             ('c1','d70sC'),('c2','d70sC'),('d1','d70sD'),('d2','d70sD'),('e1','d70sE'),('f1','d70sF'),('c9','d70sG')) as t(sfx, sel);

insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
select ('d7070000-0000-0000-0000-0000000000'||sfx)::uuid, 'd7010000-0000-0000-0000-000000000001',
       ('d7060000-0000-0000-0000-0000000000'||sfx)::uuid, 'd7050000-0000-0000-0000-000000000001',
       sel, 100000, 'a_vista', 'd7020000-0000-0000-0000-000000000001', sat::timestamptz
from (values
  ('a1','d70sA','2026-04-05 12:00:00+00'),('a2','d70sA','2026-04-10 12:00:00+00'),('a3','d70sA','2026-04-15 12:00:00+00'),
  ('b1','d70sB','2026-04-06 12:00:00+00'),('b2','d70sB','2026-04-11 12:00:00+00'),('b3','d70sB','2026-04-20 12:00:00+00'),
  ('c1','d70sC','2026-04-07 12:00:00+00'),('c2','d70sC','2026-04-12 12:00:00+00'),
  ('d1','d70sD','2026-04-08 12:00:00+00'),('d2','d70sD','2026-04-13 12:00:00+00'),
  ('e1','d70sE','2026-04-09 12:00:00+00'),('f1','d70sF','2026-04-10 12:00:00+00'),('c9','d70sG','2026-04-05 12:00:00+00')
) as t(sfx, sel, sat);

insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, outcome, note, closed_by, closed_at, created_at)
select ('d7080000-0000-0000-0000-0000000000'||sfx)::uuid, 'd7010000-0000-0000-0000-000000000001',
       'd7050000-0000-0000-0000-000000000001', sel, array['Onix'], '2026-04-02 10:00:00+00', 'completed', 'sold', '',
       'd7020000-0000-0000-0000-000000000001', cat::timestamptz, '2026-03-15 09:00:00+00'
from (values ('c1','d70sC','2026-04-02 14:00:00+00'),('c2','d70sC','2026-04-03 14:00:00+00'),
             ('d1','d70sD','2026-04-02 15:00:00+00'),('e1','d70sE','2026-04-02 16:00:00+00'),
             ('f1','d70sF','2026-04-02 17:00:00+00'),('c9','d70sG','2026-04-02 18:00:00+00')) as t(sfx, sel, cat);

insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, note, created_by, updated_by, created_at, closed_at, closed_by)
select ('d7090000-0000-0000-0000-0000000000'||sfx)::uuid, 'd7010000-0000-0000-0000-000000000001',
       'd7050000-0000-0000-0000-000000000001', sel, array['Onix'], sat::timestamptz, st::public.visit_status, '',
       'd7020000-0000-0000-0000-000000000001', 'd7020000-0000-0000-0000-000000000001', cat::timestamptz,
       case when st = 'canceled' then (cat::timestamptz + interval '1 day') else null end,
       case when st = 'canceled' then 'd7020000-0000-0000-0000-000000000001'::uuid else null end
from (values
  ('e1','d70sE','scheduled','2026-04-20 10:00:00+00','2026-04-04 09:00:00+00'),
  ('e2','d70sE','confirmed','2026-04-21 10:00:00+00','2026-04-06 09:00:00+00'),
  ('e3','d70sE','scheduled','2026-05-15 10:00:00+00','2026-04-10 09:00:00+00'),
  ('e4','d70sE','canceled','2026-04-24 10:00:00+00','2026-04-08 09:00:00+00'),
  ('f1','d70sF','scheduled','2026-04-22 10:00:00+00','2026-04-05 09:00:00+00'),
  ('c9','d70sG','scheduled','2026-04-23 10:00:00+00','2026-04-05 09:30:00+00'),
  ('d1','d70sD','canceled','2026-04-25 10:00:00+00','2026-04-09 09:00:00+00')
) as t(sfx, sel, st, sat, cat);

insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, note, created_by, updated_by, created_at, closed_at, closed_by)
select ('d7090000-0000-0000-0000-0000000000'||sfx)::uuid, 'd7010000-0000-0000-0000-000000000001',
       'd7050000-0000-0000-0000-000000000001', 'd70sBd', array['Onix'], '2026-04-15 10:00:00+00', 'scheduled', '',
       'd7020000-0000-0000-0000-000000000001', 'd7020000-0000-0000-0000-000000000001', cat::timestamptz, null, null
from (values ('b1','2026-04-01 00:00:00+00'),('b2','2026-04-30 23:59:59.999999+00'),
             ('b3','2026-03-31 23:59:59.999999+00'),('b4','2026-05-01 00:00:00.000001+00')) as t(sfx, cat);

insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, note, created_by, updated_by, created_at, closed_at, closed_by) values
  ('d7090000-0000-0000-0000-00000000fa01', 'd7010000-0000-0000-0000-000000000002', 'd7050000-0000-0000-0000-000000000002', 'd70IsoSeller', array['Onix'], '2026-04-10 10:00:00+00', 'scheduled', '', 'd7020000-0000-0000-0000-000000000004', 'd7020000-0000-0000-0000-000000000004', '2026-04-05 09:00:00+00', null, null),
  ('d7090000-0000-0000-0000-00000000fb01', 'd7010000-0000-0000-0000-000000000001', 'd7050000-0000-0000-0000-000000000001', 'd70sInactive', array['Onix'], '2026-04-10 10:00:00+00', 'scheduled', '', 'd7020000-0000-0000-0000-000000000001', 'd7020000-0000-0000-0000-000000000001', '2026-04-05 09:00:00+00', null, null);

select pg_temp.as_user('d7020000-0000-0000-0000-000000000001');

select is((select svc from pg_temp.apr('d70sC')), 0, 'C: 0 agendamentos (completed com created_at março não contam)');
select is((select svc from pg_temp.apr('d70sD')), 1, '(G) D: visita apenas CANCELADA continua contando — svc=1');
select is((select svc from pg_temp.apr('d70sE')), 4, 'E: 4 agendamentos (scheduled+confirmed+maio-por-created_at+canceled)');
select is((select svc from pg_temp.apr('d70sF')), 1, 'F: 1 agendamento');
select is((select svc from pg_temp.apr('d70sG')), 1, 'G: 1 agendamento');
select is((select svc from pg_temp.apr('d70sBd')), 2,
  '(L)(M) boundary: created_at == start E == end contam (>=/<=, inclusivo); 1us fora não -> Bd=2');

select ok((select rk from pg_temp.apr('d70sA')) < (select rk from pg_temp.apr('d70sC')), '(A) A (3 vendas) acima de C (2)');
select ok((select rk from pg_temp.apr('d70sB')) < (select rk from pg_temp.apr('d70sC')), '(A) B (3 vendas) acima de C (2)');

select is((select cvc from pg_temp.apr('d70sC')), 2, 'C: 2 visitas realizadas');
select is((select cvc from pg_temp.apr('d70sD')), 1, 'D: 1 visita realizada');
select ok((select rk from pg_temp.apr('d70sC')) < (select rk from pg_temp.apr('d70sD')),
  '(B) Sales 2=2 -> mais completed Visits vence: C acima de D (D tem svc=1 > C svc=0, mas critério 2 decide antes)');

select ok((select rk from pg_temp.apr('d70sE')) < (select rk from pg_temp.apr('d70sF')),
  '(C) E/F: 1 venda + 1 visita cada -> mais scheduled Visits vence: E (4) acima de F (1)');

select ok((select rk from pg_temp.apr('d70sG')) < (select rk from pg_temp.apr('d70sF')),
  '(D) F/G empatados nos 3 critérios (1/1/1) -> first-to-reach: G (05/04) acima de F (10/04)');
select ok((select rk from pg_temp.apr('d70sA')) < (select rk from pg_temp.apr('d70sB')),
  '(D) A/B (3/0/0) -> A (última venda 15/04) acima de B (20/04)');

select is((select svc from pg_temp.apr('d70sZ1')), 0, 'Z1: 0/0/0');
select is((select svc from pg_temp.apr('d70sZ2')), 0, 'Z2: 0/0/0');
select ok((select rk from pg_temp.apr('d70sZ1')) < (select rk from pg_temp.apr('d70sZ2')),
  '(E) Z1 acima de Z2: label idêntico + tudo empatado -> desempate FINAL por seller_id ASC');

select is(
  (select count(*)::int from (
     select rank from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz, '2026-04-30 23:59:59.999999+00'::timestamptz, null)
      group by rank having count(*) > 1) dup),
  0, 'posições SEMPRE únicas (row_number) mesmo com 3 critérios');

select is((select count(*)::int from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz, '2026-04-30 23:59:59.999999+00'::timestamptz, null) where seller_id = 'd70sInactive'),
  0, '(J) seller inativo com agendamento em abril NUNCA aparece no roster');
select is((select count(*)::int from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz, '2026-04-30 23:59:59.999999+00'::timestamptz, null) where seller_id = 'd70IsoSeller'),
  0, '(K) agendamento de outra empresa não entra no ranking da D70 Rank');

select is((select scheduled_visit_count from public.list_company_seller_leaderboard('2026-05-01 00:00:00+00'::timestamptz, '2026-05-31 23:59:59.999999+00'::timestamptz, null) where seller_id = 'd70sE'),
  0, '(H) visita created_at abril / scheduled_at maio NÃO conta em maio (created_at é autoridade)');

select pg_temp.as_user('d7020000-0000-0000-0000-000000000001');
create temp table _mgr_board as select seller_id, sale_count, completed_visit_count, scheduled_visit_count, rank
  from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz, '2026-04-30 23:59:59.999999+00'::timestamptz, null);
select pg_temp.as_user('d7020000-0000-0000-0000-000000000002');
create temp table _sel_board as select seller_id, sale_count, completed_visit_count, scheduled_visit_count, rank
  from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz, '2026-04-30 23:59:59.999999+00'::timestamptz, null);
select is((select count(*)::int from ((table _mgr_board except table _sel_board) union all (table _sel_board except table _mgr_board)) d),
  0, '(T) Manager e Seller da mesma empresa recebem EXATAMENTE o mesmo ranking');

select pg_temp.as_user('d7020000-0000-0000-0000-000000000003');
create temp table _sa_board as select seller_id, sale_count, completed_visit_count, scheduled_visit_count, rank
  from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz, '2026-04-30 23:59:59.999999+00'::timestamptz, 'd7010000-0000-0000-0000-000000000001'::uuid);
select is((select count(*)::int from ((table _mgr_board except table _sa_board) union all (table _sa_board except table _mgr_board)) d),
  0, '(U) Super Admin contextual vê o MESMO ranking que o Manager da empresa');
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-04-01 00:00:00+00'::timestamptz, '2026-04-30 23:59:59.999999+00'::timestamptz, null)$$,
  '42501', null, '(U) Super Admin SEM p_company_id: forbidden (auth inalterada)');

set local role anon;
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-04-01'::timestamptz, '2026-04-30'::timestamptz, null)$$,
  '42501', null, 'anon sem grant: permission denied (grants inalterados)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- GRUPO 2 — MOVEMENT / EVENT via create_visit / update_visit
-- ═══════════════════════════════════════════════════════════════════════
insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('d7110000-0000-0000-0000-000000000001', 'D70 MoveRise',   null, null, 'America/Sao_Paulo', 'ativa'),
  ('d7110000-0000-0000-0000-000000000002', 'D70 MoveNoop',   null, null, 'America/Sao_Paulo', 'ativa'),
  ('d7110000-0000-0000-0000-000000000003', 'D70 NoSaleGuard',null, null, 'America/Sao_Paulo', 'ativa'),
  ('d7110000-0000-0000-0000-000000000004', 'D70 Reassign',   null, null, 'America/Sao_Paulo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', em, now(), now(), now()
from (values ('d7120000-0000-0000-0000-000000000011','d70-rise-mgr@t.local'),
             ('d7120000-0000-0000-0000-000000000021','d70-noop-mgr@t.local'),
             ('d7120000-0000-0000-0000-000000000031','d70-guard-mgr@t.local'),
             ('d7120000-0000-0000-0000-000000000041','d70-reassign-mgr@t.local')) as t(id, em);
insert into public.profiles (id, name, email, is_active, platform_role)
select id::uuid, nm, em, true, null from (values
  ('d7120000-0000-0000-0000-000000000011','Rise Mgr','d70-rise-mgr@t.local'),
  ('d7120000-0000-0000-0000-000000000021','Noop Mgr','d70-noop-mgr@t.local'),
  ('d7120000-0000-0000-0000-000000000031','Guard Mgr','d70-guard-mgr@t.local'),
  ('d7120000-0000-0000-0000-000000000041','Reassign Mgr','d70-reassign-mgr@t.local')) as t(id, nm, em);
insert into public.company_memberships (id, company_id, profile_id, role, is_active)
select mid::uuid, cid::uuid, pid::uuid, 'manager', true from (values
  ('d7130000-0000-0000-0000-000000000011','d7110000-0000-0000-0000-000000000001','d7120000-0000-0000-0000-000000000011'),
  ('d7130000-0000-0000-0000-000000000021','d7110000-0000-0000-0000-000000000002','d7120000-0000-0000-0000-000000000021'),
  ('d7130000-0000-0000-0000-000000000031','d7110000-0000-0000-0000-000000000003','d7120000-0000-0000-0000-000000000031'),
  ('d7130000-0000-0000-0000-000000000041','d7110000-0000-0000-0000-000000000004','d7120000-0000-0000-0000-000000000041')) as t(mid, cid, pid);
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active)
select sid, cid::uuid, nm, 'x', null, null, true from (values
  ('d70riseAhead','d7110000-0000-0000-0000-000000000001','Rise Ahead'),
  ('d70riseTrail','d7110000-0000-0000-0000-000000000001','Rise Trail'),
  ('d70noopAhead','d7110000-0000-0000-0000-000000000002','Noop Ahead'),
  ('d70noopTrail','d7110000-0000-0000-0000-000000000002','Noop Trail'),
  ('d70guardS','d7110000-0000-0000-0000-000000000003','Guard S'),
  ('d70reAhead','d7110000-0000-0000-0000-000000000004','Re Ahead'),
  ('d70reTrail','d7110000-0000-0000-0000-000000000004','Re Trail'),
  ('d70reThird','d7110000-0000-0000-0000-000000000004','Re Third')) as t(sid, cid, nm);
insert into public.pipeline_stages (id, company_id, code, name, sort_order)
select sgid::uuid, cid::uuid, 'new', 'Novo', 0 from (values
  ('d7140000-0000-0000-0000-000000000001','d7110000-0000-0000-0000-000000000001'),
  ('d7140000-0000-0000-0000-000000000002','d7110000-0000-0000-0000-000000000002'),
  ('d7140000-0000-0000-0000-000000000003','d7110000-0000-0000-0000-000000000003'),
  ('d7140000-0000-0000-0000-000000000004','d7110000-0000-0000-0000-000000000004')) as t(sgid, cid);
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('d7150000-0000-0000-0000-000000000011', 'd7110000-0000-0000-0000-000000000001', 'Rise Lead',  '(11) 90000-8011', 'Onix', 'd7140000-0000-0000-0000-000000000001', 'd70riseAhead'),
  ('d7150000-0000-0000-0000-000000000021', 'd7110000-0000-0000-0000-000000000002', 'Noop Lead',  '(11) 90000-8021', 'Onix', 'd7140000-0000-0000-0000-000000000002', 'd70noopAhead'),
  ('d7150000-0000-0000-0000-000000000041', 'd7110000-0000-0000-0000-000000000004', 'Re Lead',    '(11) 90000-8041', 'Onix', 'd7140000-0000-0000-0000-000000000004', 'd70reAhead');

insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
select did::uuid, cid::uuid, lid::uuid, 'L', sel, 'Onix', 100000, 0, 'a_vista', 'sold', mgr::uuid, mgr::uuid from (values
  ('d7160000-0000-0000-0000-0000000000fa','d7110000-0000-0000-0000-000000000001','d7150000-0000-0000-0000-000000000011','d70riseAhead','d7120000-0000-0000-0000-000000000011'),
  ('d7160000-0000-0000-0000-0000000000fb','d7110000-0000-0000-0000-000000000001','d7150000-0000-0000-0000-000000000011','d70riseTrail','d7120000-0000-0000-0000-000000000011'),
  ('d7160000-0000-0000-0000-0000000000fc','d7110000-0000-0000-0000-000000000002','d7150000-0000-0000-0000-000000000021','d70noopAhead','d7120000-0000-0000-0000-000000000021'),
  ('d7160000-0000-0000-0000-0000000000fd','d7110000-0000-0000-0000-000000000004','d7150000-0000-0000-0000-000000000041','d70reAhead','d7120000-0000-0000-0000-000000000041'),
  ('d7160000-0000-0000-0000-0000000000fe','d7110000-0000-0000-0000-000000000004','d7150000-0000-0000-0000-000000000041','d70reTrail','d7120000-0000-0000-0000-000000000041')
) as t(did, cid, lid, sel, mgr);

insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
select ('d7170000'||substr(did, 9))::uuid, cid::uuid, did::uuid, lid::uuid, sel, 100000, 'a_vista', mgr::uuid, now() - off
from (values
  ('d7160000-0000-0000-0000-0000000000fa','d7110000-0000-0000-0000-000000000001','d7150000-0000-0000-0000-000000000011','d70riseAhead','d7120000-0000-0000-0000-000000000011', interval '3 hours'),
  ('d7160000-0000-0000-0000-0000000000fb','d7110000-0000-0000-0000-000000000001','d7150000-0000-0000-0000-000000000011','d70riseTrail','d7120000-0000-0000-0000-000000000011', interval '2 hours'),
  ('d7160000-0000-0000-0000-0000000000fc','d7110000-0000-0000-0000-000000000002','d7150000-0000-0000-0000-000000000021','d70noopAhead','d7120000-0000-0000-0000-000000000021', interval '2 hours'),
  ('d7160000-0000-0000-0000-0000000000fd','d7110000-0000-0000-0000-000000000004','d7150000-0000-0000-0000-000000000041','d70reAhead','d7120000-0000-0000-0000-000000000041', interval '3 hours'),
  ('d7160000-0000-0000-0000-0000000000fe','d7110000-0000-0000-0000-000000000004','d7150000-0000-0000-0000-000000000041','d70reTrail','d7120000-0000-0000-0000-000000000041', interval '2 hours')
) as t(did, cid, lid, sel, mgr, off);

insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, outcome, note, closed_by, closed_at, created_at) values
  ('d7180000-0000-0000-0000-0000000000fa', 'd7110000-0000-0000-0000-000000000001', 'd7150000-0000-0000-0000-000000000011', 'd70riseAhead', array['Onix'], now() - interval '6 hours', 'completed', 'sold', '', 'd7120000-0000-0000-0000-000000000011', now() - interval '5 hours', pg_temp.official_start() - interval '5 days'),
  ('d7180000-0000-0000-0000-0000000000fb', 'd7110000-0000-0000-0000-000000000001', 'd7150000-0000-0000-0000-000000000011', 'd70riseTrail', array['Onix'], now() - interval '6 hours', 'completed', 'sold', '', 'd7120000-0000-0000-0000-000000000011', now() - interval '5 hours', pg_temp.official_start() - interval '5 days'),
  ('d7180000-0000-0000-0000-0000000000e1', 'd7110000-0000-0000-0000-000000000004', 'd7150000-0000-0000-0000-000000000041', 'd70reAhead', array['Onix'], now() - interval '6 hours', 'completed', 'sold', '', 'd7120000-0000-0000-0000-000000000041', now() - interval '5 hours', pg_temp.official_start() - interval '5 days'),
  ('d7180000-0000-0000-0000-0000000000e2', 'd7110000-0000-0000-0000-000000000004', 'd7150000-0000-0000-0000-000000000041', 'd70reTrail', array['Onix'], now() - interval '6 hours', 'completed', 'sold', '', 'd7120000-0000-0000-0000-000000000041', now() - interval '5 hours', pg_temp.official_start() - interval '5 days');

-- ── (N)(F)(S)(Q)(11)(R) RISE ─────────────────────────────────────────
select pg_temp.as_user('d7120000-0000-0000-0000-000000000011');
select ok(pg_temp.off_rank('d70riseAhead')
        < pg_temp.off_rank('d70riseTrail'),
  '(N pre) antes do agendamento: Ahead acima de Trail (1/1/0 cada, first-to-reach)');

create temp table _rise_v as
  select (public.create_visit((now() + interval '2 days')::timestamptz, array['Onix'], null, 'Rise Client', 'd70riseTrail', '')).id as vid;

select is(pg_temp.off_svc('d70riseTrail'), 1,
  '(F) create_visit aumentou scheduled_visit_count de Trail para 1');
select ok(pg_temp.off_rank('d70riseTrail')
        < pg_temp.off_rank('d70riseAhead'),
  '(N) novo agendamento DESEMPATA o 3o critério: Trail sobe e passa Ahead');
select is(pg_temp.evt_count('d7110000-0000-0000-0000-000000000001','d70riseTrail','appointment'), 1,
  '(N) exatamente 1 evento source_type=appointment para Trail');
select is(
  (select array[old_rank, new_rank]::int[] from public.seller_competition_events
    where company_id = 'd7110000-0000-0000-0000-000000000001' and seller_id = 'd70riseTrail' and source_type = 'appointment'),
  array[2,1]::int[], '(N) evento appointment: old_rank=2 -> new_rank=1');
select is(
  (select competition_started from public.seller_competition_events
    where seller_id = 'd70riseTrail' and source_type = 'appointment'),
  false, '(N) evento appointment nunca é competition_started');
select is(
  (select source_appointment_visit_id is not null and source_sale_id is null and source_visit_id is null
     from public.seller_competition_events where seller_id = 'd70riseTrail' and source_type = 'appointment'),
  true, '(11) XOR: appointment usa SÓ source_appointment_visit_id');
select is(
  (select source_appointment_visit_id from public.seller_competition_events
    where seller_id = 'd70riseTrail' and source_type = 'appointment'),
  (select vid from _rise_v), '(Q) source_appointment_visit_id = id da Visit recém-criada');
select is(pg_temp.evt_count('d7110000-0000-0000-0000-000000000001','d70riseAhead',null), 0,
  '(S) Ahead (ultrapassado) NÃO recebe nenhum evento — zero evento negativo');
select throws_ok(
  $$insert into public.seller_competition_events
      (company_id, seller_id, actor_profile_id, source_type, source_appointment_visit_id, event_type,
       old_rank, new_rank, sale_count, competition_started, period_start, period_end)
    select company_id, seller_id, actor_profile_id, 'appointment', source_appointment_visit_id, 'rank_up',
       old_rank, new_rank, sale_count, false, period_start, period_end
      from public.seller_competition_events
     where seller_id = 'd70riseTrail' and source_type = 'appointment'$$,
  '23505', null, '(Q) INSERT com source_appointment_visit_id repetido viola UNIQUE');
select lives_ok(
  $$insert into public.seller_competition_events
      (company_id, seller_id, actor_profile_id, source_type, source_visit_id, event_type,
       old_rank, new_rank, sale_count, competition_started, period_start, period_end)
    select 'd7110000-0000-0000-0000-000000000001', 'd70riseTrail', 'd7120000-0000-0000-0000-000000000011',
       'visit', (select vid from _rise_v), 'rank_up', 3, 2, 1, false, period_start, period_end
      from public.seller_competition_events where seller_id = 'd70riseTrail' and source_type = 'appointment' limit 1$$,
  '(R) a MESMA visita aceita 1 evento appointment + 1 evento visit (sources distintas)');
select is(
  (select count(*)::int from public.seller_competition_events
    where source_appointment_visit_id = (select vid from _rise_v) or source_visit_id = (select vid from _rise_v)),
  2, '(R) exatamente 2 eventos referenciam a mesma visita: 1 appointment + 1 visit');
select is(
  (select count(*)::int from public.seller_competition_events
    where source_appointment_visit_id = (select vid from _rise_v) and source_visit_id = (select vid from _rise_v)),
  0, '(R) nenhuma linha mistura as duas sources (XOR estrito)');

-- ── (O) MoveNoop ────────────────────────────────────────────────────
select pg_temp.as_user('d7120000-0000-0000-0000-000000000021');
select is(pg_temp.off_rank('d70noopAhead'), 1, '(O pre) Ahead (1 venda) rank 1');
select lives_ok(
  $$select public.create_visit((now() + interval '2 days')::timestamptz, array['Onix'], null, 'Noop Client', 'd70noopTrail', '')$$,
  '(O) create_visit para Trail (0 venda) executa');
select is(pg_temp.evt_count('d7110000-0000-0000-0000-000000000002',null,'appointment'), 0,
  '(O) Trail continua rank 2 (Ahead tem venda) — agendamento não muda rank -> NENHUM evento appointment');

-- ── (P) NoSaleGuard ─────────────────────────────────────────────────
select pg_temp.as_user('d7120000-0000-0000-0000-000000000031');
select lives_ok(
  $$select public.create_visit((now() + interval '2 days')::timestamptz, array['Onix'], null, 'Guard Client', 'd70guardS', '')$$,
  '(P) create_visit numa empresa SEM nenhuma Sale no mês oficial executa normalmente');
select is(pg_temp.evt_count('d7110000-0000-0000-0000-000000000003',null,null), 0,
  '(P) empresa sem Sale no mês oficial: create_visit NUNCA gera seller_competition_events (guard preservado, igual register_visit_result)');

-- ── (I) Reassign: move o count entre Sellers, mas NÃO cria evento ────
select pg_temp.as_user('d7120000-0000-0000-0000-000000000041');
-- Ahead 1/1/0 (venda now-3h) rank1, Trail 1/1/0 (venda now-2h) rank2, Third 0/0/0 rank3.
create temp table _re_v as
  select (public.create_visit((now() + interval '2 days')::timestamptz, array['Onix'], null, 'Re Client', 'd70reThird', '')).id as vid;
select is(pg_temp.off_svc('d70reThird'), 1,
  '(I pre) agendamento criado para Third -> svc(Third)=1');
select is(pg_temp.evt_count('d7110000-0000-0000-0000-000000000004',null,'appointment'), 0,
  '(I pre) Third em 0/0/1 não passou ninguém -> nenhum evento appointment');

select lives_ok(
  $$select public.update_visit((select vid from _re_v), 1, (now() + interval '3 days')::timestamptz, array['Onix'], '', 'd70reTrail')$$,
  '(I) update_visit reatribui o agendamento de Third para Trail');
select is(pg_temp.off_svc('d70reThird'), 0,
  '(I) reassignment REMOVEU o count de Third (svc=0)');
select is(pg_temp.off_svc('d70reTrail'), 1,
  '(I) reassignment MOVEU o count para Trail (svc=1) — ranking real muda na próxima consulta');
select ok(pg_temp.off_rank('d70reTrail')
        < pg_temp.off_rank('d70reAhead'),
  '(I) Trail (agora 1/1/1) passou Ahead (1/1/0) pelo 3o critério — ranking reflete a reatribuição');
select is(pg_temp.evt_count('d7110000-0000-0000-0000-000000000004',null,null), 0,
  '(I) update_visit (reassignment) NÃO cria NENHUM seller_competition_events — sem celebração por ação administrativa do Manager');

select lives_ok(
  $$select public.update_visit((select vid from _re_v), 2, (now() + interval '9 days')::timestamptz, array['Onix'], '', 'd70reTrail')$$,
  '(H) update_visit muda scheduled_at (reschedule)');
select is(pg_temp.off_svc('d70reTrail'), 1,
  '(H) reschedule (scheduled_at mudou) NÃO altera scheduled_visit_count — created_at é a autoridade');
select is(pg_temp.evt_count('d7110000-0000-0000-0000-000000000004',null,null), 0,
  '(H) reschedule via update_visit continua sem gerar nenhum evento competitivo');

select * from finish();
rollback;
