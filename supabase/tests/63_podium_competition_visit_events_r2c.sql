-- PODIUM-COMPETITION-R2C-B1-EXEC — eventos reais de melhora de ranking
-- causados por Visit completed (register_visit_result ampliado, mesma
-- tabela seller_competition_events do R2B com source_type/source_visit_id
-- novos). Todos os "sold_at"/"closed_at" de fixture usam offsets
-- relativos a now() (nunca data calendário fixa) — mesmo motivo do
-- arquivo 62: o mês oficial é calculado a partir de now() at time zone
-- companies.timezone.
--
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

insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('ea100000-0000-0000-0000-000000000001', 'R2C VR1 4-para-3',   null, null, 'America/Sao_Paulo', 'ativa'),
  ('ea100000-0000-0000-0000-000000000002', 'R2C VR2 3-para-2',   null, null, 'America/Sao_Paulo', 'ativa'),
  ('ea100000-0000-0000-0000-000000000003', 'R2C VR3 2-para-1',   null, null, 'America/Sao_Paulo', 'ativa'),
  ('ea100000-0000-0000-0000-000000000004', 'R2C Mesma Posicao',  null, null, 'America/Sao_Paulo', 'ativa'),
  ('ea100000-0000-0000-0000-000000000005', 'R2C Zero Sales',     null, null, 'America/Sao_Paulo', 'ativa'),
  ('ea100000-0000-0000-0000-000000000006', 'R2C Isolation A',    null, null, 'America/Sao_Paulo', 'ativa'),
  ('ea100000-0000-0000-0000-000000000007', 'R2C Isolation B',    null, null, 'America/Sao_Paulo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'r2c-vr1-target@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 'r2c-vr2-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000022', 'authenticated', 'authenticated', 'r2c-vr2-target@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000031', 'authenticated', 'authenticated', 'r2c-vr3-target@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000041', 'authenticated', 'authenticated', 'r2c-same-target@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000051', 'authenticated', 'authenticated', 'r2c-zero-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000061', 'authenticated', 'authenticated', 'r2c-isoA-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000062', 'authenticated', 'authenticated', 'r2c-isoA-target@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000063', 'authenticated', 'authenticated', 'r2c-isoA-other@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ea200000-0000-0000-0000-000000000071', 'authenticated', 'authenticated', 'r2c-isoB-seller@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('ea200000-0000-0000-0000-000000000011', 'VR1 Target',    'r2c-vr1-target@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000021', 'VR2 Manager',   'r2c-vr2-manager@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000022', 'VR2 Target',    'r2c-vr2-target@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000031', 'VR3 Target',    'r2c-vr3-target@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000041', 'Same Target',   'r2c-same-target@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000051', 'Zero A',        'r2c-zero-a@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000061', 'IsoA Manager',  'r2c-isoA-manager@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000062', 'IsoA Target',   'r2c-isoA-target@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000063', 'IsoA Other',    'r2c-isoA-other@test.local', true, null),
  ('ea200000-0000-0000-0000-000000000071', 'IsoB Seller',   'r2c-isoB-seller@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('ea300000-0000-0000-0000-000000000011', 'ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-000000000011', 'seller',  true),
  ('ea300000-0000-0000-0000-000000000021', 'ea100000-0000-0000-0000-000000000002', 'ea200000-0000-0000-0000-000000000021', 'manager', true),
  ('ea300000-0000-0000-0000-000000000022', 'ea100000-0000-0000-0000-000000000002', 'ea200000-0000-0000-0000-000000000022', 'seller',  true),
  ('ea300000-0000-0000-0000-000000000031', 'ea100000-0000-0000-0000-000000000003', 'ea200000-0000-0000-0000-000000000031', 'seller',  true),
  ('ea300000-0000-0000-0000-000000000041', 'ea100000-0000-0000-0000-000000000004', 'ea200000-0000-0000-0000-000000000041', 'seller',  true),
  ('ea300000-0000-0000-0000-000000000051', 'ea100000-0000-0000-0000-000000000005', 'ea200000-0000-0000-0000-000000000051', 'seller',  true),
  ('ea300000-0000-0000-0000-000000000061', 'ea100000-0000-0000-0000-000000000006', 'ea200000-0000-0000-0000-000000000061', 'manager', true),
  ('ea300000-0000-0000-0000-000000000062', 'ea100000-0000-0000-0000-000000000006', 'ea200000-0000-0000-0000-000000000062', 'seller',  true),
  ('ea300000-0000-0000-0000-000000000063', 'ea100000-0000-0000-0000-000000000006', 'ea200000-0000-0000-0000-000000000063', 'seller',  true),
  ('ea300000-0000-0000-0000-000000000071', 'ea100000-0000-0000-0000-000000000007', 'ea200000-0000-0000-0000-000000000071', 'seller',  true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('vr1A',      'ea100000-0000-0000-0000-000000000001', 'VR1 A',      'A', null, null, true),
  ('vr1B',      'ea100000-0000-0000-0000-000000000001', 'VR1 B',      'B', null, null, true),
  ('vr1C',      'ea100000-0000-0000-0000-000000000001', 'VR1 C',      'C', null, null, true),
  ('vr1Target', 'ea100000-0000-0000-0000-000000000001', 'VR1 Target', 'T', 'ea200000-0000-0000-0000-000000000011', 'ea300000-0000-0000-0000-000000000011', true),

  ('vr2A',      'ea100000-0000-0000-0000-000000000002', 'VR2 A',      'A', null, null, true),
  ('vr2B',      'ea100000-0000-0000-0000-000000000002', 'VR2 B',      'B', null, null, true),
  ('vr2Target', 'ea100000-0000-0000-0000-000000000002', 'VR2 Target', 'T', 'ea200000-0000-0000-0000-000000000022', 'ea300000-0000-0000-0000-000000000022', true),

  ('vr3Leader', 'ea100000-0000-0000-0000-000000000003', 'VR3 Leader', 'L', null, null, true),
  ('vr3Target', 'ea100000-0000-0000-0000-000000000003', 'VR3 Target', 'T', 'ea200000-0000-0000-0000-000000000031', 'ea300000-0000-0000-0000-000000000031', true),

  ('sameTarget', 'ea100000-0000-0000-0000-000000000004', 'Same Target', 'T', 'ea200000-0000-0000-0000-000000000041', 'ea300000-0000-0000-0000-000000000041', true),
  ('sameRival',  'ea100000-0000-0000-0000-000000000004', 'Same Rival',  'R', null, null, true),

  ('zeroA', 'ea100000-0000-0000-0000-000000000005', 'Zero A', 'A', 'ea200000-0000-0000-0000-000000000051', 'ea300000-0000-0000-0000-000000000051', true),
  ('zeroB', 'ea100000-0000-0000-0000-000000000005', 'Zero B', 'B', null, null, true),

  ('isoATarget', 'ea100000-0000-0000-0000-000000000006', 'IsoA Target', 'T', 'ea200000-0000-0000-0000-000000000062', 'ea300000-0000-0000-0000-000000000062', true),
  ('isoAOther',  'ea100000-0000-0000-0000-000000000006', 'IsoA Other',  'O', 'ea200000-0000-0000-0000-000000000063', 'ea300000-0000-0000-0000-000000000063', true),
  ('isoALeader', 'ea100000-0000-0000-0000-000000000006', 'IsoA Leader', 'L', null, null, true),

  ('isoBSeller', 'ea100000-0000-0000-0000-000000000007', 'IsoB Seller', 'S', 'ea200000-0000-0000-0000-000000000071', 'ea300000-0000-0000-0000-000000000071', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order)
  select gen_random_uuid(), c.id, 'new', 'Novo', 0 from public.companies c
   where c.id in (
     'ea100000-0000-0000-0000-000000000001','ea100000-0000-0000-0000-000000000002',
     'ea100000-0000-0000-0000-000000000003','ea100000-0000-0000-0000-000000000004',
     'ea100000-0000-0000-0000-000000000005','ea100000-0000-0000-0000-000000000006',
     'ea100000-0000-0000-0000-000000000007'
   );

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id)
  select gen_random_uuid(), s.company_id, s.name, '(11) 90000-0000', 'Onix', ps.id, s.id
    from public.sellers s
    join public.pipeline_stages ps on ps.company_id = s.company_id
   where s.id in ('vr1A','vr1B','vr1C','vr1Target','vr2A','vr2B','vr2Target',
                  'vr3Leader','vr3Target','sameTarget','sameRival','zeroA','zeroB',
                  'isoATarget','isoAOther','isoALeader');

-- ── Sales pré-existentes (satisfaz "empresa ja tem >=1 Sale no mes") ────
do $$
declare
  rec record;
  v_deal_id uuid;
begin
  for rec in
    select l.company_id, l.id as lead_id, l.name as lead_name, l.seller_id, x.cnt, x.actor
      from (values
        ('vr1A', 5, 'ea200000-0000-0000-0000-000000000011'::uuid),
        ('vr1B', 2, 'ea200000-0000-0000-0000-000000000011'::uuid),
        ('vr1C', 2, 'ea200000-0000-0000-0000-000000000011'::uuid),
        ('vr1Target', 2, 'ea200000-0000-0000-0000-000000000011'::uuid),
        ('vr2A', 5, 'ea200000-0000-0000-0000-000000000021'::uuid),
        ('vr2B', 2, 'ea200000-0000-0000-0000-000000000021'::uuid),
        ('vr2Target', 2, 'ea200000-0000-0000-0000-000000000021'::uuid),
        ('vr3Leader', 2, 'ea200000-0000-0000-0000-000000000031'::uuid),
        ('vr3Target', 2, 'ea200000-0000-0000-0000-000000000031'::uuid),
        ('sameTarget', 5, 'ea200000-0000-0000-0000-000000000041'::uuid),
        ('sameRival', 1, 'ea200000-0000-0000-0000-000000000041'::uuid),
        ('isoATarget', 2, 'ea200000-0000-0000-0000-000000000061'::uuid),
        ('isoALeader', 2, 'ea200000-0000-0000-0000-000000000061'::uuid)
      ) as x(seller_id, cnt, actor)
      join public.leads l on l.seller_id = x.seller_id
  loop
    for i in 1..rec.cnt loop
      insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status)
        values (gen_random_uuid(), rec.company_id, rec.lead_id, rec.lead_name, rec.seller_id, 'Onix', 100000, 0, 'a_vista', rec.actor, rec.actor, 'sold')
        returning id into v_deal_id;
      insert into public.sales (company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
        values (rec.company_id, v_deal_id, rec.lead_id, rec.seller_id, 100000, 'a_vista', rec.actor, now() - (i || ' days')::interval);
    end loop;
  end loop;
end $$;

-- ── Visits completed pré-existentes (estabelece o ranking "antes") ──────
-- VR1: B=4 visitas, C=2 visitas, Target=2 visitas + MAX(sold_at) mais
-- recente que C (perde o desempate) -> Target comeca em 4o.
-- VR2: B=2 visitas, Target=2 visitas + sold_at mais recente -> Target 3o.
-- VR3: Leader=2 visitas, Target=2 visitas + sold_at mais recente -> Target 2o.
do $$
declare
  rec record;
  v_ts timestamptz := now() - interval '5 days';
begin
  for rec in
    select l.company_id, l.id as lead_id, l.name as lead_name, l.seller_id, x.cnt, x.actor
      from (values
        ('vr1B', 4, 'ea200000-0000-0000-0000-000000000011'::uuid),
        ('vr1C', 2, 'ea200000-0000-0000-0000-000000000011'::uuid),
        ('vr1Target', 2, 'ea200000-0000-0000-0000-000000000011'::uuid),
        ('vr2B', 2, 'ea200000-0000-0000-0000-000000000021'::uuid),
        ('vr2Target', 2, 'ea200000-0000-0000-0000-000000000021'::uuid),
        ('vr3Leader', 2, 'ea200000-0000-0000-0000-000000000031'::uuid),
        ('vr3Target', 2, 'ea200000-0000-0000-0000-000000000031'::uuid)
      ) as x(seller_id, cnt, actor)
      join public.leads l on l.seller_id = x.seller_id
  loop
    for i in 1..rec.cnt loop
      insert into public.visits (id, company_id, lead_id, client_name, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_by, closed_at)
        values (gen_random_uuid(), rec.company_id, rec.lead_id, rec.lead_name, rec.seller_id, array['Onix'],
                v_ts - interval '1 hour', 'completed', 'thinking', rec.actor, v_ts - interval '1 hour');
    end loop;
  end loop;
end $$;

-- Desempate fino: precisamos que vr1C/vr2B/vr3Leader tenham SOLD_AT (nao
-- closed_at de visita) mais antigo que vr1Target/vr2Target/vr3Target, pra
-- que o EMPATE de sale_count+visit_count antes da Visit ao vivo seja
-- resolvido a favor do rival (Target comeca ATRAS, nao empatado por
-- coincidencia de insercao). O loop de Sales acima ja insere na ordem
-- alfabetica dos nomes dentro do array — vr1C vem antes de vr1Target,
-- entao os sold_at de vr1C sao mais antigos (i=1..2 dias atras, mesma
-- janela) que os de vr1Target somente se a ORDEM de insercao dos pares
-- (seller,cnt) no VALUES favorecer isso. Para garantir isso de forma
-- explicita e independente da ordem do loop, atualizamos os sold_at do
-- "vencedor do empate" para serem estritamente mais antigos.
-- IMPORTANTE: nunca usar um offset fixo tipo "- interval '30 days'" aqui —
-- dependendo do dia do mes em que o teste roda, isso empurra a venda pro
-- MES ANTERIOR, saindo da janela do mes oficial (_rank_company_sellers
-- filtra sold_at pelo periodo corrente) e zerando o sale_count do
-- "vencedor do desempate" por engano (achado real ao depurar este
-- arquivo). (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') e sempre o primeiro instante do
-- mes oficial corrente — garantidamente dentro do periodo E mais antigo
-- que qualquer "now() - poucos dias" usado para os demais sellers.
update public.sales set sold_at = (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 hour'
 where assigned_seller_id in ('vr1C', 'vr2B', 'vr3Leader')
   and company_id in ('ea100000-0000-0000-0000-000000000001','ea100000-0000-0000-0000-000000000002','ea100000-0000-0000-0000-000000000003');

-- Visits OPEN (scheduled) — a Visit real completada por cada teste abaixo.
-- COMPETITION-V2-B1: created_at explícito no MÊS OFICIAL ANTERIOR. A partir
-- do V2, visits.created_at no mês oficial corrente conta como
-- scheduled_visit_count (3o critério de _rank_company_sellers). Estes
-- fixtures existem só para serem CONCLUÍDOS (2o critério, closed_at) —
-- datá-los no mês anterior mantém o cenário de "a conclusão é o que move o
-- rank", que é o que este arquivo (eventos de Visit concluída) testa.
-- scheduled_visit_count tem cobertura própria em
-- 70_podium_competition_scheduled_visits_v2.sql.
insert into public.visits (id, company_id, lead_id, client_name, assigned_seller_id, vehicles, scheduled_at, status, created_at) values
  ('ea600000-0000-0000-0000-000000000001', 'ea100000-0000-0000-0000-000000000001', (select id from public.leads where seller_id = 'vr1Target'), 'VR1 Target', 'vr1Target', array['Onix'], now() + interval '1 hour', 'scheduled', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '5 days'),
  ('ea600000-0000-0000-0000-000000000002', 'ea100000-0000-0000-0000-000000000002', (select id from public.leads where seller_id = 'vr2Target'), 'VR2 Target', 'vr2Target', array['Onix'], now() + interval '1 hour', 'scheduled', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '5 days'),
  ('ea600000-0000-0000-0000-000000000003', 'ea100000-0000-0000-0000-000000000003', (select id from public.leads where seller_id = 'vr3Target'), 'VR3 Target', 'vr3Target', array['Onix'], now() + interval '1 hour', 'scheduled', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '5 days'),
  ('ea600000-0000-0000-0000-000000000004', 'ea100000-0000-0000-0000-000000000004', (select id from public.leads where seller_id = 'sameTarget'), 'Same Target', 'sameTarget', array['Onix'], now() + interval '1 hour', 'scheduled', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '5 days'),
  ('ea600000-0000-0000-0000-000000000005', 'ea100000-0000-0000-0000-000000000005', (select id from public.leads where seller_id = 'zeroA'), 'Zero A', 'zeroA', array['Onix'], now() + interval '1 hour', 'scheduled', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '5 days'),
  ('ea600000-0000-0000-0000-000000000006', 'ea100000-0000-0000-0000-000000000006', (select id from public.leads where seller_id = 'isoATarget'), 'IsoA Target', 'isoATarget', array['Onix'], now() + interval '1 hour', 'scheduled', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '5 days');

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO / SCHEMA — source_type/source_visit_id/XOR/unique
-- ══════════════════════════════════════════════════════════════════════

select has_column('public', 'seller_competition_events', 'source_type', 'coluna source_type existe');
select has_column('public', 'seller_competition_events', 'source_visit_id', 'coluna source_visit_id existe');
select col_is_null('public', 'seller_competition_events', 'source_sale_id', 'source_sale_id agora e nullable');

select ok(
  (select count(*)::int from pg_constraint where conname = 'seller_competition_events_source_type_ck') = 1,
  'CHECK source_type in (sale,visit) existe');
select ok(
  (select count(*)::int from pg_constraint where conname = 'seller_competition_events_source_xor_ck') = 1,
  'CHECK XOR (exatamente uma origem) existe');
select ok(
  (select count(*)::int from pg_constraint where conname = 'seller_competition_events_source_visit_id_uniq' and contype = 'u') = 1,
  'UNIQUE(source_visit_id) existe (idempotencia)');

select is(
  (select count(*)::int from pg_proc where proname = '_lock_company_and_resolve_official_period' and pronamespace = 'public'::regnamespace),
  1, '_lock_company_and_resolve_official_period existe (helper compartilhado)');
select is(
  has_function_privilege('authenticated', 'public._lock_company_and_resolve_official_period(uuid)', 'EXECUTE'),
  false, '_lock_company_and_resolve_official_period: authenticated SEM EXECUTE (interna)');

-- XOR ao vivo: tentar inserir um evento com as duas origens preenchidas
-- (ou nenhuma) deve violar a constraint.
select throws_ok(
  $$insert into public.seller_competition_events (company_id, seller_id, actor_profile_id, source_type, source_sale_id, source_visit_id, old_rank, new_rank, sale_count, period_start, period_end)
    values ('ea100000-0000-0000-0000-000000000001', 'vr1A', 'ea200000-0000-0000-0000-000000000011', 'sale',
            (select id from public.sales where assigned_seller_id = 'vr1A' limit 1),
            'ea600000-0000-0000-0000-000000000001', 2, 1, 5, now(), now() + interval '1 month')$$,
  '23514', null, 'XOR: source_sale_id E source_visit_id preenchidos ao mesmo tempo -> violacao');
select throws_ok(
  $$insert into public.seller_competition_events (company_id, seller_id, actor_profile_id, source_type, old_rank, new_rank, sale_count, period_start, period_end)
    values ('ea100000-0000-0000-0000-000000000001', 'vr1A', 'ea200000-0000-0000-0000-000000000011', 'sale', 2, 1, 5, now(), now() + interval '1 month')$$,
  '23514', null, 'XOR: nenhuma origem preenchida -> violacao');

-- ══════════════════════════════════════════════════════════════════════
-- 2. VR1: Visit 4º → 3º — Seller conclui a PRÓPRIA Visit
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('ea100000-0000-0000-0000-000000000001', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 month') where seller_id = 'vr1Target'),
  4, 'pre-condicao VR1: Target comeca em 4o');

select pg_temp.as_user('ea200000-0000-0000-0000-000000000011'); -- VR1 Target (seller)
set local role authenticated;
select lives_ok(
  $$select public.register_visit_result('ea600000-0000-0000-0000-000000000001'::uuid, 1, 'thinking'::public.visit_outcome, '')$$,
  'VR1: Target conclui a propria Visit com sucesso');
reset role;

select is(
  (select count(*)::int from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  1, 'VR1: exatamente 1 evento criado para esta Visit');
select is(
  (select source_type from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  'visit', 'VR1: source_type = visit');
select is(
  (select source_sale_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  null, 'VR1: source_sale_id NULL');
select is(
  (select old_rank from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  4, 'VR1: old_rank = 4');
select is(
  (select new_rank from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  3, 'VR1: new_rank = 3 (4o -> 3o)');
select is(
  (select seller_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  'vr1Target', 'VR1: beneficiario correto');
select is(
  (select actor_profile_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  'ea200000-0000-0000-0000-000000000011'::uuid, 'VR1: actor == beneficiario (Seller concluiu a propria Visit)');
select is(
  (select related_seller_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  'vr1C', 'VR1: related_seller = quem ocupava a posicao 3 ANTES (vr1C)');
select is(
  (select event_type from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  'rank_up', 'VR1: event_type = rank_up (mesmo tipo do R2B, nenhum tipo novo)');
select is(
  (select competition_started from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  false, 'VR1: competition_started sempre false para origem Visit');

-- §14 do EXEC — evento de Visit usa o MESMO mês oficial (companies.timezone),
-- nunca UTC puro/timezone do browser/período visual do Pódio. Fórmula
-- exata comparada, mesmo padrão do arquivo 62.
select ok(
  (select period_start from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001')
  = (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
  'VR1: period_start do evento de Visit = inicio do mes civil em America/Sao_Paulo (formula exata)');
select ok(
  (select period_end from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001')
  = ((date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo'),
  'VR1: period_end do evento de Visit = inicio do PROXIMO mes civil em America/Sao_Paulo');

-- Retry / idempotência: a Visit já está completed — segunda chamada falha.
select pg_temp.as_user('ea200000-0000-0000-0000-000000000011');
set local role authenticated;
select throws_ok(
  $$select public.register_visit_result('ea600000-0000-0000-0000-000000000001'::uuid, 1, 'thinking'::public.visit_outcome, '')$$,
  'P0001', 'visit_closed', 'VR1: retry na mesma Visit falha em visit_closed');
reset role;
select is(
  (select count(*)::int from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000001'),
  1, 'VR1: ainda existe SOMENTE 1 evento apos o retry');

-- ══════════════════════════════════════════════════════════════════════
-- 3. VR2: Visit 3º → 2º — Manager conclui a Visit DE OUTRO Seller
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('ea100000-0000-0000-0000-000000000002', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 month') where seller_id = 'vr2Target'),
  3, 'pre-condicao VR2: Target comeca em 3o');

select pg_temp.as_user('ea200000-0000-0000-0000-000000000021'); -- VR2 Manager
set local role authenticated;
select lives_ok(
  $$select public.register_visit_result('ea600000-0000-0000-0000-000000000002'::uuid, 1, 'thinking'::public.visit_outcome, '')$$,
  'VR2: Manager conclui a Visit de Target com sucesso');
reset role;

select is(
  (select old_rank from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000002'),
  3, 'VR2: old_rank = 3');
select is(
  (select new_rank from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000002'),
  2, 'VR2: new_rank = 2 (3o -> 2o)');
select is(
  (select seller_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000002'),
  'vr2Target', 'VR2: beneficiario = Target (nunca o Manager)');
select is(
  (select actor_profile_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000002'),
  'ea200000-0000-0000-0000-000000000021'::uuid, 'VR2: actor = Manager real (distinto do beneficiario)');
select is(
  (select related_seller_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000002'),
  'vr2B', 'VR2: related_seller = quem ocupava a posicao 2 ANTES (vr2B)');

-- ══════════════════════════════════════════════════════════════════════
-- 4. VR3: Visit 2º → 1º
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('ea100000-0000-0000-0000-000000000003', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 month') where seller_id = 'vr3Target'),
  2, 'pre-condicao VR3: Target comeca em 2o');

select pg_temp.as_user('ea200000-0000-0000-0000-000000000031'); -- VR3 Target (seller)
set local role authenticated;
select lives_ok(
  $$select public.register_visit_result('ea600000-0000-0000-0000-000000000003'::uuid, 1, 'thinking'::public.visit_outcome, '')$$,
  'VR3: Target conclui a propria Visit com sucesso');
reset role;

select is(
  (select old_rank from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000003'),
  2, 'VR3: old_rank = 2');
select is(
  (select new_rank from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000003'),
  1, 'VR3: new_rank = 1 (2o -> 1o)');
select is(
  (select related_seller_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000003'),
  'vr3Leader', 'VR3: related_seller = antigo lider');

-- ══════════════════════════════════════════════════════════════════════
-- 5. MESMA POSIÇÃO → ZERO EVENTO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('ea100000-0000-0000-0000-000000000004', (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 month') where seller_id = 'sameTarget'),
  1, 'pre-condicao Same: Target ja e 1o (folga grande)');

select pg_temp.as_user('ea200000-0000-0000-0000-000000000041'); -- Same Target (seller)
set local role authenticated;
select lives_ok(
  $$select public.register_visit_result('ea600000-0000-0000-0000-000000000004'::uuid, 1, 'thinking'::public.visit_outcome, '')$$,
  'Same: Target conclui mais uma Visit (permanece 1o)');
reset role;

select is(
  (select count(*)::int from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000004'),
  0, 'Same: ZERO evento quando new_rank = old_rank');

-- ══════════════════════════════════════════════════════════════════════
-- 6. EMPRESA ZERO SALES + VISIT COMPLETED → ZERO EVENTO (§15 CRÍTICO)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.sales where company_id = 'ea100000-0000-0000-0000-000000000005'),
  0, 'pre-condicao Zero: empresa nao tem NENHUMA Sale (nem neste nem em outro mes)');

select pg_temp.as_user('ea200000-0000-0000-0000-000000000051'); -- Zero A (seller)
set local role authenticated;
select lives_ok(
  $$select public.register_visit_result('ea600000-0000-0000-0000-000000000005'::uuid, 1, 'thinking'::public.visit_outcome, '')$$,
  'Zero: A conclui a Visit normalmente (Visit sempre completa)');
reset role;

select is(
  (select status from public.visits where id = 'ea600000-0000-0000-0000-000000000005'),
  'completed'::public.visit_status, 'Zero: Visit virou completed normalmente');
select is(
  (select count(*)::int from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000005'),
  0, 'Zero: ZERO evento (empresa sem nenhuma Sale no mes oficial — sem disputa ativa)');

-- ══════════════════════════════════════════════════════════════════════
-- 7. list_my_unseen_competition_events — source_type + isolamento
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ea200000-0000-0000-0000-000000000061'); -- IsoA Manager
set local role authenticated;
select lives_ok(
  $$select public.register_visit_result('ea600000-0000-0000-0000-000000000006'::uuid, 1, 'thinking'::public.visit_outcome, '')$$,
  'IsoA: Manager conclui a Visit de Target com sucesso');
reset role;

select id as iso_a_target_visit_event_id from public.seller_competition_events where source_visit_id = 'ea600000-0000-0000-0000-000000000006' \gset

select pg_temp.as_user('ea200000-0000-0000-0000-000000000062'); -- IsoA Target (seller, dono do evento)
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events() where source_type = 'visit'),
  1, 'IsoA Target: ve exatamente 1 evento unseen de origem visit');
select is(
  (select source_type from public.list_my_unseen_competition_events() where id = :'iso_a_target_visit_event_id'::uuid),
  'visit', 'IsoA Target: list_my_unseen_competition_events devolve source_type=visit corretamente');
reset role;

select pg_temp.as_user('ea200000-0000-0000-0000-000000000063'); -- IsoA Other
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'IsoA Other: NAO ve o evento do colega');
reset role;

select pg_temp.as_user('ea200000-0000-0000-0000-000000000061'); -- IsoA Manager
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'IsoA Manager: NUNCA recebe comemoracao pessoal, mesmo tendo sido o ATOR do evento');
reset role;

select pg_temp.as_user('ea200000-0000-0000-0000-000000000071'); -- IsoB Seller (outra empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'IsoB Seller (outra empresa): NAO ve evento de IsoA (isolamento por company)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. mark_competition_events_seen — inalterado, funciona igual p/ Visit
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ea200000-0000-0000-0000-000000000062'); -- IsoA Target
set local role authenticated;
select is(
  (select public.mark_competition_events_seen(array[:'iso_a_target_visit_event_id'::uuid])),
  1, 'mark_seen: IsoA Target marca o proprio evento de origem Visit — 1 linha afetada');
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'segundo fetch: NAO retorna mais o evento ja visto');
select is(
  (select public.mark_competition_events_seen(array[:'iso_a_target_visit_event_id'::uuid])),
  0, 'mark_seen chamado 2x no mesmo evento: 2a chamada afeta 0 linhas');
reset role;

select * from finish();
rollback;
