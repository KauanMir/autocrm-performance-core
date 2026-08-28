-- COMPETITION-BOUNDARY-HALFOPEN-B1-EXEC — contrato SEMI-ABERTO [start, end)
-- das janelas da competição. Migration 20260830100000_competition_halfopen_boundaries.sql.
--
-- start INCLUSIVO (>=), end EXCLUSIVO (<). period_end é o início do
-- período seguinte; um evento exatamente em period_end pertence unicamente
-- ao período seguinte — nunca a dois, nunca a nenhum.
--
-- Janelas civis America/Sao_Paulo (UTC-3, sem DST), fixas e passadas:
--   junho : [2026-06-01 03:00:00+00, 2026-07-01 03:00:00+00)
--   julho : [2026-07-01 03:00:00+00, 2026-08-01 03:00:00+00)
-- 2026-07-01 03:00:00+00 é SIMULTANEAMENTE fim de junho e início de julho.
--
-- _rank_company_sellers / _rank_company_sellers_snapshot são funções
-- internas — chamadas direto aqui (como no pgTAP 62), rodando como postgres.
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

-- helpers de leitura do ranking direto
create or replace function pg_temp.rk(p_company uuid, p_start timestamptz, p_end timestamptz, p_sel text)
returns table (sc int, cvc int, svc int, rnk int) as $$
  select r.sale_count, r.completed_visit_count, r.scheduled_visit_count, r.rank
    from public._rank_company_sellers(p_company, p_start, p_end) r
   where r.seller_id = p_sel;
$$ language sql;

create or replace function pg_temp.snap(p_company uuid, p_start timestamptz, p_end timestamptz, p_sel text)
returns table (sc int, cvc int, svc int, rnk int) as $$
  select r.sale_count, r.completed_visit_count, r.scheduled_visit_count, r.rank
    from public._rank_company_sellers_snapshot(p_company, p_start, p_end) r
   where r.seller_id = p_sel;
$$ language sql;

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES — d90: ranking direto (junho x julho x fronteira)
-- ═══════════════════════════════════════════════════════════════════════
insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('d9010000-0000-0000-0000-000000000001', 'D90 HalfOpen', null, null, 'America/Sao_Paulo', 'ativa'),
  ('d9010000-0000-0000-0000-000000000002', 'D91 RewardBoundary A', null, null, 'America/Sao_Paulo', 'ativa'),
  ('d9010000-0000-0000-0000-000000000003', 'D91 RewardBoundary B', null, null, 'America/Sao_Paulo', 'ativa'),
  ('d9010000-0000-0000-0000-000000000004', 'D92 MovementBoundary', null, null, 'America/Sao_Paulo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', em, now(), now(), now()
from (values
  ('d9020000-0000-0000-0000-000000000001', 'd90-mgr@t.local'),
  ('d9020000-0000-0000-0000-000000000002', 'd91a-mgr@t.local'),
  ('d9020000-0000-0000-0000-000000000003', 'd91b-mgr@t.local'),
  ('d9020000-0000-0000-0000-000000000004', 'd92-mgr@t.local')) as t(id, em);

insert into public.profiles (id, name, email, is_active, platform_role)
select id::uuid, nm, em, true, null from (values
  ('d9020000-0000-0000-0000-000000000001', 'D90 Mgr',  'd90-mgr@t.local'),
  ('d9020000-0000-0000-0000-000000000002', 'D91a Mgr', 'd91a-mgr@t.local'),
  ('d9020000-0000-0000-0000-000000000003', 'D91b Mgr', 'd91b-mgr@t.local'),
  ('d9020000-0000-0000-0000-000000000004', 'D92 Mgr',  'd92-mgr@t.local')) as t(id, nm, em);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('d9030000-0000-0000-0000-000000000001', 'd9010000-0000-0000-0000-000000000001', 'd9020000-0000-0000-0000-000000000001', 'manager', true),
  ('d9030000-0000-0000-0000-000000000002', 'd9010000-0000-0000-0000-000000000002', 'd9020000-0000-0000-0000-000000000002', 'manager', true),
  ('d9030000-0000-0000-0000-000000000003', 'd9010000-0000-0000-0000-000000000003', 'd9020000-0000-0000-0000-000000000003', 'manager', true),
  ('d9030000-0000-0000-0000-000000000004', 'd9010000-0000-0000-0000-000000000004', 'd9020000-0000-0000-0000-000000000004', 'manager', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('d90X', 'd9010000-0000-0000-0000-000000000001', 'D90 X', 'X', null, null, true),
  ('d90Y', 'd9010000-0000-0000-0000-000000000001', 'D90 Y', 'Y', null, null, true),
  ('d90Z', 'd9010000-0000-0000-0000-000000000001', 'D90 Z', 'Z', null, null, true),
  ('d90P', 'd9010000-0000-0000-0000-000000000001', 'D90 P', 'P', null, null, true),
  ('d90Q', 'd9010000-0000-0000-0000-000000000001', 'D90 Q', 'Q', null, null, true),
  ('d91aS', 'd9010000-0000-0000-0000-000000000002', 'D91a S', 'S', null, null, true),
  ('d91bS', 'd9010000-0000-0000-0000-000000000003', 'D91b S', 'S', null, null, true),
  ('d92A', 'd9010000-0000-0000-0000-000000000004', 'D92 A', 'A', null, null, true),
  ('d92B', 'd9010000-0000-0000-0000-000000000004', 'D92 B', 'B', null, null, true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order)
select sg::uuid, c::uuid, 'new', 'Novo', 0 from (values
  ('d9040000-0000-0000-0000-000000000001', 'd9010000-0000-0000-0000-000000000001'),
  ('d9040000-0000-0000-0000-000000000002', 'd9010000-0000-0000-0000-000000000002'),
  ('d9040000-0000-0000-0000-000000000003', 'd9010000-0000-0000-0000-000000000003'),
  ('d9040000-0000-0000-0000-000000000004', 'd9010000-0000-0000-0000-000000000004')) as t(sg, c);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('d9050000-0000-0000-0000-000000000001', 'd9010000-0000-0000-0000-000000000001', 'D90 Lead', '(11) 90000-1001', 'Onix', 'd9040000-0000-0000-0000-000000000001', 'd90X'),
  ('d9050000-0000-0000-0000-000000000002', 'd9010000-0000-0000-0000-000000000002', 'D91a Lead', '(11) 90000-1002', 'Onix', 'd9040000-0000-0000-0000-000000000002', 'd91aS'),
  ('d9050000-0000-0000-0000-000000000003', 'd9010000-0000-0000-0000-000000000003', 'D91b Lead', '(11) 90000-1003', 'Onix', 'd9040000-0000-0000-0000-000000000003', 'd91bS'),
  ('d9050000-0000-0000-0000-000000000004', 'd9010000-0000-0000-0000-000000000004', 'D92 Lead', '(11) 90000-1004', 'Onix', 'd9040000-0000-0000-0000-000000000004', 'd92A');

-- d90 deals + sales. Datas-chave:
--  d90X: S1 @ 2026-06-01 03:00:00+00 (== junho.start), S2 @ 2026-07-01 03:00:00+00 (== junho.end == julho.start)
--  d90P: 1 venda 2026-06-15 (meio de junho)
--  d90Q: 1 venda 2026-06-10 (meio de junho) + 1 venda @ 2026-07-01 03:00:00+00 (fronteira)
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by)
select ('d9060000-0000-0000-0000-0000000000'||sfx)::uuid, 'd9010000-0000-0000-0000-000000000001',
       'd9050000-0000-0000-0000-000000000001', 'L', sel, 'Onix', 100000, 0, 'a_vista', 'sold',
       'd9020000-0000-0000-0000-000000000001', 'd9020000-0000-0000-0000-000000000001'
from (values ('d1','d90X'),('d2','d90X'),('e1','d90P'),('f1','d90Q'),('f2','d90Q')) as t(sfx, sel);

insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
select ('d9070000-0000-0000-0000-0000000000'||sfx)::uuid, 'd9010000-0000-0000-0000-000000000001',
       ('d9060000-0000-0000-0000-0000000000'||sfx)::uuid, 'd9050000-0000-0000-0000-000000000001',
       sel, 100000, 'a_vista', 'd9020000-0000-0000-0000-000000000001', sat::timestamptz
from (values
  ('d1','d90X','2026-06-01 03:00:00+00'),
  ('d2','d90X','2026-07-01 03:00:00+00'),
  ('e1','d90P','2026-06-15 12:00:00+00'),
  ('f1','d90Q','2026-06-10 12:00:00+00'),
  ('f2','d90Q','2026-07-01 03:00:00+00')
) as t(sfx, sel, sat);

-- d90Y: visita CONCLUÍDA com closed_at == 2026-07-01 03:00:00+00 (created_at em maio p/ não poluir svc)
insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, outcome, note, closed_by, closed_at, created_at) values
  ('d9080000-0000-0000-0000-0000000000a1', 'd9010000-0000-0000-0000-000000000001', 'd9050000-0000-0000-0000-000000000001', 'd90Y', array['Onix'], '2026-06-20 10:00:00+00', 'completed', 'sold', '', 'd9020000-0000-0000-0000-000000000001', '2026-07-01 03:00:00+00', '2026-05-20 09:00:00+00');

-- d90Z: agendamento com created_at == 2026-07-01 03:00:00+00
insert into public.visits (id, company_id, lead_id, assigned_seller_id, vehicles, scheduled_at, status, note, created_by, updated_by, created_at) values
  ('d9080000-0000-0000-0000-0000000000a2', 'd9010000-0000-0000-0000-000000000001', 'd9050000-0000-0000-0000-000000000001', 'd90Z', array['Onix'], '2026-07-10 10:00:00+00', 'scheduled', '', 'd9020000-0000-0000-0000-000000000001', 'd9020000-0000-0000-0000-000000000001', '2026-07-01 03:00:00+00');

-- ═══════════════════════════════════════════════════════════════════════
-- §17 START INCLUSIVO — timestamp == period_start CONTA
-- ═══════════════════════════════════════════════════════════════════════
select is((select sc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90X')),
  1, 'Sale exatamente em period_start (junho.start) CONTA em junho');
select is((select cvc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00','d90Y')),
  1, 'completed Visit com closed_at == period_start (julho.start) CONTA em julho');
select is((select svc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00','d90Z')),
  1, 'scheduled Visit com created_at == period_start (julho.start) CONTA em julho');

-- ═══════════════════════════════════════════════════════════════════════
-- §18 END EXCLUSIVO — timestamp == period_end NÃO conta no período anterior
--      e CONTA quando o próximo período usa esse timestamp como start
-- ═══════════════════════════════════════════════════════════════════════
select is((select sc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90X')),
  1, 'Sale @ junho.end (2026-07-01 03:00) NÃO conta em junho — d90X tem só 1 venda de junho, não 2');
select is((select sc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00','d90X')),
  1, 'a MESMA Sale @ 2026-07-01 03:00 conta em julho');
select is((select cvc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90Y')),
  0, 'completed Visit com closed_at == junho.end NÃO conta em junho');
select is((select svc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90Z')),
  0, 'scheduled Visit com created_at == junho.end NÃO conta em junho');

-- ═══════════════════════════════════════════════════════════════════════
-- §19 DOUBLE-COUNT — o registro na fronteira aparece EXATAMENTE UMA VEZ
-- ═══════════════════════════════════════════════════════════════════════
select is(
  (select coalesce((select sc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90Q')),0)
        + coalesce((select sc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00','d90Q')),0)),
  2, 'd90Q tem 2 vendas distintas (uma no meio de junho, uma na fronteira) → junho + julho = 2, nunca 3');
select is((select sc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90Q')),
  1, 'd90Q em junho: só a venda do meio do mês (a da fronteira ficou para julho)');
select is((select sc from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00','d90Q')),
  1, 'd90Q em julho: só a venda da fronteira (contada UMA vez)');

-- ═══════════════════════════════════════════════════════════════════════
-- §20 RANK — evento no próximo month-start não altera o rank do mês anterior
-- ═══════════════════════════════════════════════════════════════════════
-- Junho: d90X / d90Q / d90P todos com 1 venda; desempate por last_sale_at ASC
-- (X 06-01 < Q 06-10 < P 06-15).
select ok(
  (select rnk from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90X'))
  < (select rnk from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90Q')),
  'junho: d90X acima de d90Q (last_sale_at 06-01 < 06-10)');
select ok(
  (select rnk from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90Q'))
  < (select rnk from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90P')),
  'junho: d90Q acima de d90P (last_sale_at 06-10 < 06-15) — a venda de fronteira de Q NÃO muda isso');
select is((select rnk from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00','d90Q')),
  2, 'junho: rank de d90Q é 2 (inalterado pela venda no próximo month-start)');
select ok(
  (select rnk from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00','d90Q'))
  < (select rnk from pg_temp.rk('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00','d90P')),
  'julho: d90Q (1 venda de fronteira) agora acima de d90P (0) — a fronteira PODE mudar o rank do próximo mês');

-- ═══════════════════════════════════════════════════════════════════════
-- §4 SNAPSHOT concorda com o LIVE (mesma semântica [start,end))
-- ═══════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from (
     (select * from public._rank_company_sellers('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00')
      except
      select * from public._rank_company_sellers_snapshot('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00'))
     union all
     (select * from public._rank_company_sellers_snapshot('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00')
      except
      select * from public._rank_company_sellers('d9010000-0000-0000-0000-000000000001','2026-06-01 03:00:00+00','2026-07-01 03:00:00+00'))
   ) d),
  0, 'junho: _rank_company_sellers e _rank_company_sellers_snapshot retornam EXATAMENTE o mesmo (roster todo ativo)');
select is(
  (select count(*)::int from (
     (select * from public._rank_company_sellers('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00')
      except
      select * from public._rank_company_sellers_snapshot('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00'))
     union all
     (select * from public._rank_company_sellers_snapshot('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00')
      except
      select * from public._rank_company_sellers('d9010000-0000-0000-0000-000000000001','2026-07-01 03:00:00+00','2026-08-01 03:00:00+00'))
   ) d),
  0, 'julho: live e snapshot concordam na fronteira');

-- ═══════════════════════════════════════════════════════════════════════
-- §25 REWARD FINALIZER — Sale exatamente em period_end NÃO premia o mês
-- ═══════════════════════════════════════════════════════════════════════
-- Campanha publicada de JUNHO/2026 (mês passado) para a cia d91a.
-- Única Sale: 2026-07-01 03:00:00+00 (== junho.end) -> pertence a julho.
insert into public.competition_reward_campaigns
  (id, company_id, month_start, timezone, status, title, created_by_profile_id, published_at, published_by_profile_id)
values
  ('d9090000-0000-0000-0000-000000000002', 'd9010000-0000-0000-0000-000000000002', '2026-06-01', 'America/Sao_Paulo', 'published', 'Junho A', 'd9020000-0000-0000-0000-000000000002', now(), 'd9020000-0000-0000-0000-000000000002'),
  ('d9090000-0000-0000-0000-000000000003', 'd9010000-0000-0000-0000-000000000003', '2026-06-01', 'America/Sao_Paulo', 'published', 'Junho B', 'd9020000-0000-0000-0000-000000000003', now(), 'd9020000-0000-0000-0000-000000000003');
insert into public.competition_reward_tiers (campaign_id, position, amount_cents, reward_text) values
  ('d9090000-0000-0000-0000-000000000002', 1, 50000, null),
  ('d9090000-0000-0000-0000-000000000003', 1, 50000, null);

insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by) values
  ('d9060000-0000-0000-0000-0000000000a1', 'd9010000-0000-0000-0000-000000000002', 'd9050000-0000-0000-0000-000000000002', 'L', 'd91aS', 'Onix', 100000, 0, 'a_vista', 'sold', 'd9020000-0000-0000-0000-000000000002', 'd9020000-0000-0000-0000-000000000002'),
  ('d9060000-0000-0000-0000-0000000000b1', 'd9010000-0000-0000-0000-000000000003', 'd9050000-0000-0000-0000-000000000003', 'L', 'd91bS', 'Onix', 100000, 0, 'a_vista', 'sold', 'd9020000-0000-0000-0000-000000000003', 'd9020000-0000-0000-0000-000000000003');
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('d9070000-0000-0000-0000-0000000000a1', 'd9010000-0000-0000-0000-000000000002', 'd9060000-0000-0000-0000-0000000000a1', 'd9050000-0000-0000-0000-000000000002', 'd91aS', 100000, 'a_vista', 'd9020000-0000-0000-0000-000000000002', '2026-07-01 03:00:00+00'),
  ('d9070000-0000-0000-0000-0000000000b1', 'd9010000-0000-0000-0000-000000000003', 'd9060000-0000-0000-0000-0000000000b1', 'd9050000-0000-0000-0000-000000000003', 'd91bS', 100000, 'a_vista', 'd9020000-0000-0000-0000-000000000003', '2026-06-01 03:00:00+00');

select pg_temp.as_user('d9020000-0000-0000-0000-000000000002');
select is(jsonb_array_length(public.list_competition_reward_history(null)), 1, 'd91a: junho fecha (campanha publicada)');
select is((select had_competition from public.competition_months where company_id = 'd9010000-0000-0000-0000-000000000002'),
  false, '§25: Sale @ 2026-07-01 03:00 (junho.end) NÃO premia junho — had_competition=false');
select is((select count(*)::int from public.competition_month_rows mr
   join public.competition_months m on m.id = mr.competition_month_id
   where m.company_id = 'd9010000-0000-0000-0000-000000000002'),
  0, '§25: junho de d91a sem linhas de standings, sem vencedor');

-- ═══════════════════════════════════════════════════════════════════════
-- §26 REWARD FINALIZER — Sale exatamente em period_start participa/premia
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('d9020000-0000-0000-0000-000000000003');
select is(jsonb_array_length(public.list_competition_reward_history(null)), 1, 'd91b: junho fecha');
select is((select had_competition from public.competition_months where company_id = 'd9010000-0000-0000-0000-000000000003'),
  true, '§26: Sale @ 2026-06-01 03:00 (junho.start) premia junho — had_competition=true');
select is((select mr.rank from public.competition_month_rows mr
   join public.competition_months m on m.id = mr.competition_month_id
   where m.company_id = 'd9010000-0000-0000-0000-000000000003' and mr.seller_id = 'd91bS'),
  1, '§26: d91bS entra no snapshot de junho como rank 1');
select is((select mr.reward_amount_cents from public.competition_month_rows mr
   join public.competition_months m on m.id = mr.competition_month_id
   where m.company_id = 'd9010000-0000-0000-0000-000000000003' and mr.seller_id = 'd91bS'),
  50000::bigint, '§26: prêmio do tier pos 1 copiado no snapshot');

-- ═══════════════════════════════════════════════════════════════════════
-- §24 MOVEMENT — competition_event exatamente em official_period_end
--      pertence ao movimento do PRÓXIMO mês, não deste
-- ═══════════════════════════════════════════════════════════════════════
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, status, created_by, updated_by) values
  ('d9060000-0000-0000-0000-0000000000c1', 'd9010000-0000-0000-0000-000000000004', 'd9050000-0000-0000-0000-000000000004', 'L', 'd92A', 'Onix', 100000, 0, 'a_vista', 'sold', 'd9020000-0000-0000-0000-000000000004', 'd9020000-0000-0000-0000-000000000004'),
  ('d9060000-0000-0000-0000-0000000000c2', 'd9010000-0000-0000-0000-000000000004', 'd9050000-0000-0000-0000-000000000004', 'L', 'd92B', 'Onix', 100000, 0, 'a_vista', 'sold', 'd9020000-0000-0000-0000-000000000004', 'd9020000-0000-0000-0000-000000000004');
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('d9070000-0000-0000-0000-0000000000c1', 'd9010000-0000-0000-0000-000000000004', 'd9060000-0000-0000-0000-0000000000c1', 'd9050000-0000-0000-0000-000000000004', 'd92A', 100000, 'a_vista', 'd9020000-0000-0000-0000-000000000004', now() - interval '3 days'),
  ('d9070000-0000-0000-0000-0000000000c2', 'd9010000-0000-0000-0000-000000000004', 'd9060000-0000-0000-0000-0000000000c2', 'd9050000-0000-0000-0000-000000000004', 'd92B', 100000, 'a_vista', 'd9020000-0000-0000-0000-000000000004', now() - interval '2 days');

-- E1: movimento de d92A com created_at == official_start() → DENTRO da janela oficial
-- E2: movimento de d92B com created_at == official_end() (próximo month-start) → FORA
insert into public.seller_competition_events
  (company_id, seller_id, actor_profile_id, source_type, source_sale_id, event_type,
   old_rank, new_rank, sale_count, competition_started, period_start, period_end, created_at)
values
  ('d9010000-0000-0000-0000-000000000004', 'd92A', 'd9020000-0000-0000-0000-000000000004', 'sale', 'd9070000-0000-0000-0000-0000000000c1', 'rank_up',
   2, 1, 1, false, pg_temp.official_start(), pg_temp.official_end(), pg_temp.official_start()),
  ('d9010000-0000-0000-0000-000000000004', 'd92B', 'd9020000-0000-0000-0000-000000000004', 'sale', 'd9070000-0000-0000-0000-0000000000c2', 'rank_up',
   2, 1, 1, false, pg_temp.official_end(), pg_temp.official_end() + interval '1 month', pg_temp.official_end());

select pg_temp.as_user('d9020000-0000-0000-0000-000000000004');
select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(
     '2026-06-01 03:00:00+00'::timestamptz, '2026-07-01 03:00:00+00'::timestamptz, null) where seller_id = 'd92A'),
  1, '§24: evento com created_at == official_period_start entra no movimento do mês corrente');
select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(
     '2026-06-01 03:00:00+00'::timestamptz, '2026-07-01 03:00:00+00'::timestamptz, null) where seller_id = 'd92B'),
  null, '§24: evento com created_at == official_period_end NÃO entra no movimento deste mês (é do próximo)');

select * from finish();
rollback;
