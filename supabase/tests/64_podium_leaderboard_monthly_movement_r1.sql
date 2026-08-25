-- PODIUM-MOVEMENT-R1-B1-EXEC — list_company_seller_leaderboard ganha
-- movement_positions_gained/movement_happened_at
-- (20260825150000_podium_leaderboard_monthly_movement_r1.sql). Cobre a
-- semântica congelada no PRECHECK (PODIUM-MOVEMENT-R1-A1): último evento
-- elegível do mês oficial, nunca soma; competition_started sempre exclui;
-- evento de mês anterior nunca conta; seen_at é irrelevante; Sale e Visit
-- contam igualmente; nenhuma coluna privada de evento é exposta; Manager
-- e Seller recebem o mesmo agregado; isolamento por empresa.
--
-- Eventos inseridos DIRETAMENTE (mesma técnica de
-- 63_podium_competition_visit_events_r2c.sql para os testes de
-- constraint): o que está sob teste aqui é a AGREGAÇÃO SQL nova
-- (movement CTE), não o cálculo de old_rank/new_rank a partir de
-- Sale/Visit reais — isso já está coberto por 62/63. Timestamps de
-- "dentro do mês oficial" e "mês anterior" usam a MESMA fórmula
-- timezone-aware da RPC (date_trunc('month', now() at time zone tz) at
-- time zone tz), nunca um offset fixo em dias — lição documentada em
-- 63_podium_competition_visit_events_r2c.sql após o bug de fronteira de
-- fuso encontrado naquele EXEC.
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
  ('c9400000-0000-0000-0000-000000000001', 'C64 Movement Co',    null, null, 'America/Sao_Paulo', 'ativa'),
  ('c9400000-0000-0000-0000-000000000002', 'C64 Movement Outra', null, null, 'America/Sao_Paulo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c9420000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c64-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c9420000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c64-seller-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c9420000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'c64-manager-outra@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('c9420000-0000-0000-0000-000000000001', 'C64 Manager',   'c64-manager@test.local',   true, null),
  ('c9420000-0000-0000-0000-000000000002', 'C64 Seller A',  'c64-seller-a@test.local',  true, null),
  ('c9420000-0000-0000-0000-000000000003', 'C64 Manager Outra', 'c64-manager-outra@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('c9430000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001', 'c9420000-0000-0000-0000-000000000001', 'manager', true),
  ('c9430000-0000-0000-0000-000000000002', 'c9400000-0000-0000-0000-000000000001', 'c9420000-0000-0000-0000-000000000002', 'seller',  true);

-- Roster: mA (2 eventos Sale este mes), mB (1 evento Visit este mes), mC
-- (competition_started=true), mD (evento real, mas do mes ANTERIOR), mE
-- (zero eventos). mF em OUTRA empresa (isolamento).
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('m64A', 'c9400000-0000-0000-0000-000000000001', 'C64 Seller A', 'A', 'c9420000-0000-0000-0000-000000000002', 'c9430000-0000-0000-0000-000000000002', true),
  ('m64B', 'c9400000-0000-0000-0000-000000000001', 'C64 Seller B', 'B', null, null, true),
  ('m64C', 'c9400000-0000-0000-0000-000000000001', 'C64 Seller C', 'C', null, null, true),
  ('m64D', 'c9400000-0000-0000-0000-000000000001', 'C64 Seller D', 'D', null, null, true),
  ('m64E', 'c9400000-0000-0000-0000-000000000001', 'C64 Seller E', 'E', null, null, true),
  ('m64F', 'c9400000-0000-0000-0000-000000000002', 'C64 Seller F', 'F', null, null, true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('c9440000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001', 'new', 'Novo', 0);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('c9450000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001', 'Lead M64', '(11) 90000-0001', 'Onix', 'c9440000-0000-0000-0000-000000000001', 'm64A');

-- 4 Deals distintas (1 por Sale, source_sale_id é UNIQUE) — mA-evento1,
-- mA-evento2, mC (competition_started), mD (mes anterior).
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status) values
  ('c9460000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001', 'c9450000-0000-0000-0000-000000000001', 'Lead M64', 'm64A', 'Onix', 100000, 0, 'a_vista', 'c9420000-0000-0000-0000-000000000001', 'c9420000-0000-0000-0000-000000000001', 'sold'),
  ('c9460000-0000-0000-0000-000000000002', 'c9400000-0000-0000-0000-000000000001', 'c9450000-0000-0000-0000-000000000001', 'Lead M64', 'm64A', 'Onix', 100000, 0, 'a_vista', 'c9420000-0000-0000-0000-000000000001', 'c9420000-0000-0000-0000-000000000001', 'sold'),
  ('c9460000-0000-0000-0000-000000000003', 'c9400000-0000-0000-0000-000000000001', 'c9450000-0000-0000-0000-000000000001', 'Lead M64', 'm64C', 'Onix', 100000, 0, 'a_vista', 'c9420000-0000-0000-0000-000000000001', 'c9420000-0000-0000-0000-000000000001', 'sold'),
  ('c9460000-0000-0000-0000-000000000004', 'c9400000-0000-0000-0000-000000000001', 'c9450000-0000-0000-0000-000000000001', 'Lead M64', 'm64D', 'Onix', 100000, 0, 'a_vista', 'c9420000-0000-0000-0000-000000000001', 'c9420000-0000-0000-0000-000000000001', 'sold');

insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('c9470000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001', 'c9460000-0000-0000-0000-000000000001', 'c9450000-0000-0000-0000-000000000001', 'm64A', 100000, 'a_vista', 'c9420000-0000-0000-0000-000000000001', now()),
  ('c9470000-0000-0000-0000-000000000002', 'c9400000-0000-0000-0000-000000000001', 'c9460000-0000-0000-0000-000000000002', 'c9450000-0000-0000-0000-000000000001', 'm64A', 100000, 'a_vista', 'c9420000-0000-0000-0000-000000000001', now()),
  ('c9470000-0000-0000-0000-000000000003', 'c9400000-0000-0000-0000-000000000001', 'c9460000-0000-0000-0000-000000000003', 'c9450000-0000-0000-0000-000000000001', 'm64C', 100000, 'a_vista', 'c9420000-0000-0000-0000-000000000001', now()),
  ('c9470000-0000-0000-0000-000000000004', 'c9400000-0000-0000-0000-000000000001', 'c9460000-0000-0000-0000-000000000004', 'c9450000-0000-0000-0000-000000000001', 'm64D', 100000, 'a_vista', 'c9420000-0000-0000-0000-000000000001', now());

-- 1 Visit (mB) — source_type='visit', sem deal/lead necessários.
insert into public.visits (id, company_id, client_name, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_by, closed_at) values
  ('c9480000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001', 'Visita M64 B', 'm64B', array['Onix'], now(), 'completed', 'sold', 'c9420000-0000-0000-0000-000000000001', now());

-- ══════════════════════════════════════════════════════════════════════
-- EVENTOS — inseridos diretamente (postgres bypassa RLS), timestamps
-- SEMPRE via a mesma fórmula timezone-aware da RPC.
-- ══════════════════════════════════════════════════════════════════════

-- mA: 2 eventos Sale este mês — 5º→4º (1h após o início do mês oficial),
-- depois 4º→2º (2h após). Movement esperado: o SEGUNDO (delta=2), nunca a
-- soma (delta=3) nem o primeiro (delta=1).
insert into public.seller_competition_events
  (company_id, seller_id, actor_profile_id, source_type, source_sale_id, old_rank, new_rank, sale_count, competition_started, period_start, period_end, created_at)
values
  ('c9400000-0000-0000-0000-000000000001', 'm64A', 'c9420000-0000-0000-0000-000000000001', 'sale', 'c9470000-0000-0000-0000-000000000001',
   5, 4, 1, false,
   date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 hour'),
  ('c9400000-0000-0000-0000-000000000001', 'm64A', 'c9420000-0000-0000-0000-000000000001', 'sale', 'c9470000-0000-0000-0000-000000000002',
   4, 2, 2, false,
   date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '2 hours');

-- mB: 1 evento Visit este mês — 3º→1º. Prova que source_type='visit'
-- conta igualmente a 'sale' para o agregado.
insert into public.seller_competition_events
  (company_id, seller_id, actor_profile_id, source_type, source_visit_id, old_rank, new_rank, sale_count, competition_started, period_start, period_end, created_at)
values
  ('c9400000-0000-0000-0000-000000000001', 'm64B', 'c9420000-0000-0000-0000-000000000001', 'visit', 'c9480000-0000-0000-0000-000000000001',
   3, 1, 0, false,
   date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 hour');

-- mC: evento competition_started=true este mês (old_rank=new_rank=6,
-- ordenação técnica entre zerados) — NUNCA deve virar movement (§5/§13).
insert into public.seller_competition_events
  (company_id, seller_id, actor_profile_id, source_type, source_sale_id, old_rank, new_rank, sale_count, competition_started, period_start, period_end, created_at)
values
  ('c9400000-0000-0000-0000-000000000001', 'm64C', 'c9420000-0000-0000-0000-000000000001', 'sale', 'c9470000-0000-0000-0000-000000000003',
   6, 6, 1, true,
   date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 hour');

-- mD: evento real (5º→3º, competition_started=false) mas datado do MÊS
-- ANTERIOR (15 dias antes do início do mês oficial corrente — sempre cai
-- no mês anterior, nunca um offset que possa ficar ambíguo perto de uma
-- fronteira). §6/§14: histórico persiste, mas não conta como movement
-- atual.
insert into public.seller_competition_events
  (company_id, seller_id, actor_profile_id, source_type, source_sale_id, old_rank, new_rank, sale_count, competition_started, period_start, period_end, created_at)
values
  ('c9400000-0000-0000-0000-000000000001', 'm64D', 'c9420000-0000-0000-0000-000000000001', 'sale', 'c9470000-0000-0000-0000-000000000004',
   5, 3, 1, false,
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month') at time zone 'America/Sao_Paulo',
   date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '15 days');

-- mF: evento este mês em OUTRA empresa (isolamento) — actor dedicado
-- (profile/membership própria da Empresa Outra), nunca o mesmo profile do
-- Manager da Empresa 1 (company_memberships_profile_single_active_uidx só
-- permite 1 membership ATIVA por profile em toda a plataforma).
insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('c9430000-0000-0000-0000-000000000003', 'c9400000-0000-0000-0000-000000000002', 'c9420000-0000-0000-0000-000000000003', 'manager', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('c9440000-0000-0000-0000-000000000002', 'c9400000-0000-0000-0000-000000000002', 'new', 'Novo', 0);
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('c9450000-0000-0000-0000-000000000002', 'c9400000-0000-0000-0000-000000000002', 'Lead M64 Outra', '(11) 90000-0002', 'Onix', 'c9440000-0000-0000-0000-000000000002', 'm64F');
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status) values
  ('c9460000-0000-0000-0000-000000000005', 'c9400000-0000-0000-0000-000000000002', 'c9450000-0000-0000-0000-000000000002', 'Lead M64 Outra', 'm64F', 'Onix', 100000, 0, 'a_vista', 'c9420000-0000-0000-0000-000000000003', 'c9420000-0000-0000-0000-000000000003', 'sold');
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('c9470000-0000-0000-0000-000000000005', 'c9400000-0000-0000-0000-000000000002', 'c9460000-0000-0000-0000-000000000005', 'c9450000-0000-0000-0000-000000000002', 'm64F', 100000, 'a_vista', 'c9420000-0000-0000-0000-000000000003', now());
insert into public.seller_competition_events
  (company_id, seller_id, actor_profile_id, source_type, source_sale_id, old_rank, new_rank, sale_count, competition_started, period_start, period_end, created_at)
values
  ('c9400000-0000-0000-0000-000000000002', 'm64F', 'c9420000-0000-0000-0000-000000000003', 'sale', 'c9470000-0000-0000-0000-000000000005',
   4, 1, 1, false,
   date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo',
   (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 hour');

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO — novas colunas presentes, nenhuma coluna privada exposta
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select bool_or(argname in ('movement_positions_gained', 'movement_happened_at'))
     from unnest((select proargnames from pg_proc where oid = 'public.list_company_seller_leaderboard(timestamptz,timestamptz,uuid)'::regprocedure)) as argname),
  true, 'list_company_seller_leaderboard expoe movement_positions_gained/movement_happened_at');

select is(
  (select bool_or(argname in ('event_id', 'id', 'seen_at', 'actor_profile_id', 'source_sale_id', 'source_visit_id', 'source_type', 'related_seller_id', 'related_seller_label', 'competition_started', 'old_rank', 'new_rank'))
     from unnest((select proargnames from pg_proc where oid = 'public.list_company_seller_leaderboard(timestamptz,timestamptz,uuid)'::regprocedure)) as argname),
  false, 'list_company_seller_leaderboard NUNCA expoe colunas privadas de evento (seen_at/actor/source ids/related seller/old_rank/new_rank brutos)');

-- Regressão (§9/§30): seller_competition_events continua fechada.
select is(has_table_privilege('authenticated', 'public.seller_competition_events', 'SELECT'), false, 'authenticated ainda sem SELECT direto em seller_competition_events');
select is(has_table_privilege('anon', 'public.seller_competition_events', 'SELECT'), false, 'anon ainda sem SELECT direto em seller_competition_events');

-- ══════════════════════════════════════════════════════════════════════
-- 2. SEMÂNTICA DE MOVEMENT (§32 do EXEC)
-- ══════════════════════════════════════════════════════════════════════

-- created_at do evento mais recente de mA, capturado como postgres (§
-- lição de 62/63: qualquer leitura direta de seller_competition_events
-- precisa rodar fora do role authenticated, mesmo dentro de uma subquery
-- de comparação) ANTES de logar como Manager.
select created_at as ma_event2_created_at from public.seller_competition_events where source_sale_id = 'c9470000-0000-0000-0000-000000000002' \gset

select pg_temp.as_user('c9420000-0000-0000-0000-000000000001'); -- Manager
set local role authenticated;

select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64A'),
  2, 'mA: dois eventos Sale este mes (5o->4o, 4o->2o) -> movement = 2 (do evento MAIS RECENTE, nunca 3 acumulado)');
select is(
  (select movement_happened_at from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64A'),
  :'ma_event2_created_at'::timestamptz,
  'mA: movement_happened_at bate com o created_at do evento MAIS RECENTE (4o->2o), nunca do primeiro');

select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64B'),
  2, 'mB: evento Visit este mes (3o->1o) conta igual a um evento Sale -> movement = 2');

select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64C'),
  null, 'mC: unico evento e competition_started=true -> movement NULL (nunca deriva de ordenacao tecnica entre zerados)');

select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64D'),
  null, 'mD: evento real existe mas e do mes ANTERIOR -> movement NULL (historico persiste, nao conta como atual)');

select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64E'),
  null, 'mE: zero eventos -> movement NULL (nunca 0, nunca "-")');

select ok(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64A') > 0,
  'movement_positions_gained nunca e zero nem negativo quando presente');

-- ══════════════════════════════════════════════════════════════════════
-- 3. SEEN INDEPENDENCE (§13)
-- ══════════════════════════════════════════════════════════════════════

reset role;
update public.seller_competition_events set seen_at = now() where source_sale_id = 'c9470000-0000-0000-0000-000000000002';
select pg_temp.as_user('c9420000-0000-0000-0000-000000000001');
set local role authenticated;

select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64A'),
  2, 'evento marcado como visto (seen_at preenchido) continua gerando o MESMO movement -- seen_at e irrelevante para o agregado');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. MANAGER == SELLER (mesmo agregado) + ISOLAMENTO DE EMPRESA (§33)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c9420000-0000-0000-0000-000000000001'); -- Manager
set local role authenticated;
select movement_positions_gained as manager_movement_a from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64A' \gset
reset role;

select pg_temp.as_user('c9420000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64A'),
  :manager_movement_a::int,
  'Seller recebe EXATAMENTE o mesmo movement agregado que o Manager para o mesmo colega (m64A)');
select is(
  (select movement_positions_gained from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64B'),
  2, 'Seller enxerga o movement agregado de OUTRO seller (m64B) -- agregado publico dentro da empresa, nunca o evento pessoal dele');
select is(
  (select count(*)::int from public.list_company_seller_leaderboard(now() - interval '2 years', now() + interval '2 years', null) where seller_id = 'm64F'),
  0, 'isolamento de empresa: seller de OUTRA empresa (m64F) nunca aparece no leaderboard desta empresa, seu movement nunca vaza');
reset role;

select * from finish();
rollback;
