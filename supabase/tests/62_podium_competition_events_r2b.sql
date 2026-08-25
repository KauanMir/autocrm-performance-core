-- PODIUM-COMPETITION-R2B-B1-EXEC — seller_competition_events +
-- _rank_company_sellers + register_sale ampliado + list_my_unseen_
-- competition_events + mark_competition_events_seen
-- (20260825130000_podium_competition_events_r2b.sql).
--
-- Todos os fixtures de "sold_at" usam offsets RELATIVOS a now() (nunca uma
-- data calendário fixa) — register_sale calcula o mês oficial a partir de
-- now() at time zone companies.timezone, então qualquer literal fixo
-- quebraria em outro mês. now() garantidamente cai dentro do próprio mês
-- civil corrente, então offsets de minutos/horas/dias pequenos permanecem
-- dentro do mesmo mês; offsets de vários meses ficam garantidamente fora.
--
-- LIMITAÇÃO CONHECIDA (documentada, não escondida — §42 do EXEC): os casos
-- literais "primeiro/último dia do mês" não são testáveis aqui sem um
-- mecanismo de override de clock dentro de uma function SECURITY DEFINER
-- (fora de escopo deste lote). Em vez disso, a fórmula do boundary é
-- verificada por comparação com a MESMA expressão SQL (date_trunc(...) at
-- time zone tz) — correta para qualquer dia em que o teste rodar,
-- inclusive se coincidir com uma virada de mês.
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
-- FIXTURES — companies/profiles/memberships/sellers/pipeline compartilhados
-- ═══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('e9100000-0000-0000-0000-000000000010', 'R2B RK1 4-para-3',        null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000020', 'R2B RK2 4-para-2',        null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000030', 'R2B RK3 4-para-1',        null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000040', 'R2B RK4 2-para-1',        null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000050', 'R2B Mesma Posicao',       null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000060', 'R2B Primeira Venda Mes',  null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000070', 'R2B Offboarded Guard',    null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000080', 'R2B Isolation A',         null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-000000000090', 'R2B Isolation B',         null, null, 'America/Sao_Paulo', 'ativa'),
  ('e9100000-0000-0000-0000-0000000000a0', 'R2B Timezone NY',         null, null, 'America/New_York',  'ativa');

-- ── auth.users / profiles / memberships / sellers por empresa ──────────
-- Convenção de id: <company_suffix><role_slot>, mantendo hex válido.

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'r2b-rk1-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'r2b-rk1-target@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 'r2b-rk2-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000022', 'authenticated', 'authenticated', 'r2b-rk2-target@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000031', 'authenticated', 'authenticated', 'r2b-rk3-target@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000041', 'authenticated', 'authenticated', 'r2b-rk4-target@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000051', 'authenticated', 'authenticated', 'r2b-same-leader@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000061', 'authenticated', 'authenticated', 'r2b-first-b@test.local',     now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000071', 'authenticated', 'authenticated', 'r2b-off-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000081', 'authenticated', 'authenticated', 'r2b-isoA-manager@test.local',now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000082', 'authenticated', 'authenticated', 'r2b-isoA-target@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000083', 'authenticated', 'authenticated', 'r2b-isoA-other@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-000000000091', 'authenticated', 'authenticated', 'r2b-isoB-seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'r2b-ny-manager@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9200000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'r2b-ny-target@test.local',   now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e9200000-0000-0000-0000-000000000011', 'RK1 Manager',   'r2b-rk1-manager@test.local', true, null),
  ('e9200000-0000-0000-0000-000000000012', 'RK1 Target',    'r2b-rk1-target@test.local',  true, null),
  ('e9200000-0000-0000-0000-000000000021', 'RK2 Manager',   'r2b-rk2-manager@test.local', true, null),
  ('e9200000-0000-0000-0000-000000000022', 'RK2 Target',    'r2b-rk2-target@test.local',  true, null),
  ('e9200000-0000-0000-0000-000000000031', 'RK3 Target',    'r2b-rk3-target@test.local',  true, null),
  ('e9200000-0000-0000-0000-000000000041', 'RK4 Target',    'r2b-rk4-target@test.local',  true, null),
  ('e9200000-0000-0000-0000-000000000051', 'Same Leader',   'r2b-same-leader@test.local', true, null),
  ('e9200000-0000-0000-0000-000000000061', 'First B',       'r2b-first-b@test.local',     true, null),
  ('e9200000-0000-0000-0000-000000000071', 'Off Manager',   'r2b-off-manager@test.local', true, null),
  ('e9200000-0000-0000-0000-000000000081', 'IsoA Manager',  'r2b-isoA-manager@test.local',true, null),
  ('e9200000-0000-0000-0000-000000000082', 'IsoA Target',   'r2b-isoA-target@test.local', true, null),
  ('e9200000-0000-0000-0000-000000000083', 'IsoA Other',    'r2b-isoA-other@test.local',  true, null),
  ('e9200000-0000-0000-0000-000000000091', 'IsoB Seller',   'r2b-isoB-seller@test.local', true, null),
  ('e9200000-0000-0000-0000-0000000000a1', 'NY Manager',    'r2b-ny-manager@test.local',  true, null),
  ('e9200000-0000-0000-0000-0000000000a2', 'NY Target',     'r2b-ny-target@test.local',   true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('e9300000-0000-0000-0000-000000000011', 'e9100000-0000-0000-0000-000000000010', 'e9200000-0000-0000-0000-000000000011', 'manager', true),
  ('e9300000-0000-0000-0000-000000000012', 'e9100000-0000-0000-0000-000000000010', 'e9200000-0000-0000-0000-000000000012', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000021', 'e9100000-0000-0000-0000-000000000020', 'e9200000-0000-0000-0000-000000000021', 'manager', true),
  ('e9300000-0000-0000-0000-000000000022', 'e9100000-0000-0000-0000-000000000020', 'e9200000-0000-0000-0000-000000000022', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000031', 'e9100000-0000-0000-0000-000000000030', 'e9200000-0000-0000-0000-000000000031', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000041', 'e9100000-0000-0000-0000-000000000040', 'e9200000-0000-0000-0000-000000000041', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000051', 'e9100000-0000-0000-0000-000000000050', 'e9200000-0000-0000-0000-000000000051', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000061', 'e9100000-0000-0000-0000-000000000060', 'e9200000-0000-0000-0000-000000000061', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000071', 'e9100000-0000-0000-0000-000000000070', 'e9200000-0000-0000-0000-000000000071', 'manager', true),
  ('e9300000-0000-0000-0000-000000000081', 'e9100000-0000-0000-0000-000000000080', 'e9200000-0000-0000-0000-000000000081', 'manager', true),
  ('e9300000-0000-0000-0000-000000000082', 'e9100000-0000-0000-0000-000000000080', 'e9200000-0000-0000-0000-000000000082', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000083', 'e9100000-0000-0000-0000-000000000080', 'e9200000-0000-0000-0000-000000000083', 'seller',  true),
  ('e9300000-0000-0000-0000-000000000091', 'e9100000-0000-0000-0000-000000000090', 'e9200000-0000-0000-0000-000000000091', 'seller',  true),
  ('e9300000-0000-0000-0000-0000000000a1', 'e9100000-0000-0000-0000-0000000000a0', 'e9200000-0000-0000-0000-0000000000a1', 'manager', true),
  ('e9300000-0000-0000-0000-0000000000a2', 'e9100000-0000-0000-0000-0000000000a0', 'e9200000-0000-0000-0000-0000000000a2', 'seller',  true);

-- sellers: RK1 (Target + 3 rivais A/B/C), RK2 (Target + A/B/C), RK3 (Target
-- + B/C/D), RK4 (Target + Leader), Same (Leader + Rival), First (A/B),
-- Offboard guard (1 seller ja inativo), Isolation A (Target/Other),
-- Isolation B (Seller), Timezone NY (Target).
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('rk1Target', 'e9100000-0000-0000-0000-000000000010', 'RK1 Target', 'T', 'e9200000-0000-0000-0000-000000000012', 'e9300000-0000-0000-0000-000000000012', true),
  ('rk1A',      'e9100000-0000-0000-0000-000000000010', 'RK1 A',      'A', null, null, true),
  ('rk1B',      'e9100000-0000-0000-0000-000000000010', 'RK1 B',      'B', null, null, true),
  ('rk1C',      'e9100000-0000-0000-0000-000000000010', 'RK1 C',      'C', null, null, true),

  ('rk2Target', 'e9100000-0000-0000-0000-000000000020', 'RK2 Target', 'T', 'e9200000-0000-0000-0000-000000000022', 'e9300000-0000-0000-0000-000000000022', true),
  ('rk2A',      'e9100000-0000-0000-0000-000000000020', 'RK2 A',      'A', null, null, true),
  ('rk2B',      'e9100000-0000-0000-0000-000000000020', 'RK2 B',      'B', null, null, true),
  ('rk2C',      'e9100000-0000-0000-0000-000000000020', 'RK2 C',      'C', null, null, true),

  ('rk3Target', 'e9100000-0000-0000-0000-000000000030', 'RK3 Target', 'T', 'e9200000-0000-0000-0000-000000000031', 'e9300000-0000-0000-0000-000000000031', true),
  ('rk3B',      'e9100000-0000-0000-0000-000000000030', 'RK3 B',      'B', null, null, true),
  ('rk3C',      'e9100000-0000-0000-0000-000000000030', 'RK3 C',      'C', null, null, true),
  ('rk3D',      'e9100000-0000-0000-0000-000000000030', 'RK3 D',      'D', null, null, true),

  ('rk4Target', 'e9100000-0000-0000-0000-000000000040', 'RK4 Target', 'T', 'e9200000-0000-0000-0000-000000000041', 'e9300000-0000-0000-0000-000000000041', true),
  ('rk4Leader', 'e9100000-0000-0000-0000-000000000040', 'RK4 Leader', 'L', null, null, true),

  ('sameLeader', 'e9100000-0000-0000-0000-000000000050', 'Same Leader', 'L', 'e9200000-0000-0000-0000-000000000051', 'e9300000-0000-0000-0000-000000000051', true),
  ('sameRival',  'e9100000-0000-0000-0000-000000000050', 'Same Rival',  'R', null, null, true),

  ('firstA', 'e9100000-0000-0000-0000-000000000060', 'First A', 'A', null, null, true),
  ('firstB', 'e9100000-0000-0000-0000-000000000060', 'First B', 'B', 'e9200000-0000-0000-0000-000000000061', 'e9300000-0000-0000-0000-000000000061', true),

  ('offSeller', 'e9100000-0000-0000-0000-000000000070', 'Off Seller', 'O', null, null, false),

  ('isoATarget', 'e9100000-0000-0000-0000-000000000080', 'IsoA Target', 'T', 'e9200000-0000-0000-0000-000000000082', 'e9300000-0000-0000-0000-000000000082', true),
  ('isoAOther',  'e9100000-0000-0000-0000-000000000080', 'IsoA Other',  'O', 'e9200000-0000-0000-0000-000000000083', 'e9300000-0000-0000-0000-000000000083', true),

  ('isoBSeller', 'e9100000-0000-0000-0000-000000000090', 'IsoB Seller', 'S', 'e9200000-0000-0000-0000-000000000091', 'e9300000-0000-0000-0000-000000000091', true),

  ('nyTarget', 'e9100000-0000-0000-0000-0000000000a0', 'NY Target', 'T', 'e9200000-0000-0000-0000-0000000000a2', 'e9300000-0000-0000-0000-0000000000a2', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order)
  select gen_random_uuid(), c.id, 'new', 'Novo', 0 from public.companies c
   where c.id in (
     'e9100000-0000-0000-0000-000000000010','e9100000-0000-0000-0000-000000000020',
     'e9100000-0000-0000-0000-000000000030','e9100000-0000-0000-0000-000000000040',
     'e9100000-0000-0000-0000-000000000050','e9100000-0000-0000-0000-000000000060',
     'e9100000-0000-0000-0000-000000000070','e9100000-0000-0000-0000-000000000080',
     'e9100000-0000-0000-0000-000000000090','e9100000-0000-0000-0000-0000000000a0'
   );

-- 1 lead reaproveitado por seller (varias Deals podem compartilhar) — leads
-- só precisam existir para satisfazer a FK de deals, nunca lidos pela
-- lógica de ranking. Um lead por Seller com Deal nesta suite.
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id)
  select gen_random_uuid(), s.company_id, s.name, '(11) 90000-0000', 'Onix', ps.id, s.id
    from public.sellers s
    join public.pipeline_stages ps on ps.company_id = s.company_id
   where s.id in ('rk1Target','rk1A','rk1B','rk1C','rk2Target','rk2A','rk2B','rk2C',
                  'rk3Target','rk3B','rk3C','rk3D','rk4Target','rk4Leader',
                  'sameLeader','sameRival','firstA','firstB','offSeller',
                  'isoATarget','isoAOther','nyTarget');

-- ── Sales pré-existentes (fixture direta, fora de register_sale) ───────
-- Todas usam offsets relativos a now() — nunca uma data calendário fixa
-- (ver comentário do topo do arquivo). Reaproveita o mesmo lead do Seller
-- (1 lead : N deals/sales) e cria uma Deal 'sold' síncrona a cada Sale
-- (mesmo padrão do fixture do arquivo 61) só para satisfazer a FK
-- sales_company_deal_fk — nenhuma dessas Deals é lida pela lógica sob
-- teste.
do $$
declare
  rec record;
  v_deal_id uuid;
begin
  -- RK1: A=6 vendas, B=5, C=2 vendas + 3 visitas completed, Target=2
  -- vendas + 0 visitas (perde o desempate pra C) — old_rank Target=4.
  for rec in
    select l.company_id, l.id as lead_id, l.name as lead_name, l.seller_id, x.cnt
      from (values ('rk1A', 6), ('rk1B', 5), ('rk1C', 2), ('rk1Target', 2)) as x(seller_id, cnt)
      join public.leads l on l.seller_id = x.seller_id
  loop
    for i in 1..rec.cnt loop
      insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status)
        values (gen_random_uuid(), rec.company_id, rec.lead_id, rec.lead_name, rec.seller_id, 'Onix', 100000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000011', 'e9200000-0000-0000-0000-000000000011', 'sold')
        returning id into v_deal_id;
      insert into public.sales (company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
        values (rec.company_id, v_deal_id, rec.lead_id, rec.seller_id, 100000, 'a_vista', 'e9200000-0000-0000-0000-000000000011', now() - (i || ' days')::interval);
    end loop;
  end loop;
end $$;

insert into public.visits (id, company_id, client_name, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_by, closed_at)
  select gen_random_uuid(), 'e9100000-0000-0000-0000-000000000010', 'Visita RK1C', 'rk1C', array['Onix'],
         now() - interval '2 days', 'completed', 'sold', 'e9200000-0000-0000-0000-000000000011', now() - interval '2 days'
  from generate_series(1,3);

do $$
declare
  rec record;
  v_deal_id uuid;
begin
  -- RK2: A=5 vendas (rank1 intocavel). B/C/Target = 0 vendas, desempatados
  -- por visitas (B=2, C=1, Target=0) -> Target ranca 4o entre o trio zerado.
  for rec in
    select l.company_id, l.id as lead_id, l.name as lead_name, l.seller_id, x.cnt
      from (values ('rk2A', 5)) as x(seller_id, cnt)
      join public.leads l on l.seller_id = x.seller_id
  loop
    for i in 1..rec.cnt loop
      insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status)
        values (gen_random_uuid(), rec.company_id, rec.lead_id, rec.lead_name, rec.seller_id, 'Onix', 100000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000021', 'e9200000-0000-0000-0000-000000000021', 'sold')
        returning id into v_deal_id;
      insert into public.sales (company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
        values (rec.company_id, v_deal_id, rec.lead_id, rec.seller_id, 100000, 'a_vista', 'e9200000-0000-0000-0000-000000000021', now() - (i || ' days')::interval);
    end loop;
  end loop;
end $$;

insert into public.visits (id, company_id, client_name, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_by, closed_at) values
  (gen_random_uuid(), 'e9100000-0000-0000-0000-000000000020', 'Visita RK2B1', 'rk2B', array['Onix'], now() - interval '1 day', 'completed', 'sold', 'e9200000-0000-0000-0000-000000000021', now() - interval '1 day'),
  (gen_random_uuid(), 'e9100000-0000-0000-0000-000000000020', 'Visita RK2B2', 'rk2B', array['Onix'], now() - interval '1 day', 'completed', 'sold', 'e9200000-0000-0000-0000-000000000021', now() - interval '1 day'),
  (gen_random_uuid(), 'e9100000-0000-0000-0000-000000000020', 'Visita RK2C1', 'rk2C', array['Onix'], now() - interval '1 day', 'completed', 'sold', 'e9200000-0000-0000-0000-000000000021', now() - interval '1 day');

do $$
declare
  rec record;
  v_deal_id uuid;
begin
  -- RK3: 4-way tie em 2 vendas cada (B/C/D/Target) desempatada por
  -- MAX(sold_at) ASC — B mais antigo (rank1) ... Target mais recente
  -- (rank4). Target sobe pra rank1 com 1 venda nova (count=3, unico > 2).
  for rec in
    select l.company_id, l.id as lead_id, l.name as lead_name, l.seller_id, x.ts
      from (values
        ('rk3B', now() - interval '3 hours'),
        ('rk3C', now() - interval '2 hours'),
        ('rk3D', now() - interval '1 hour'),
        ('rk3Target', now() - interval '30 minutes')
      ) as x(seller_id, ts)
      join public.leads l on l.seller_id = x.seller_id
  loop
    for i in 1..2 loop
      insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status)
        values (gen_random_uuid(), rec.company_id, rec.lead_id, rec.lead_name, rec.seller_id, 'Onix', 100000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000031', 'e9200000-0000-0000-0000-000000000031', 'sold')
        returning id into v_deal_id;
      -- a 2a venda de cada seller carrega o timestamp "definidor" do
      -- desempate (MAX(sold_at) do grupo); a 1a fica ainda mais no passado
      -- pra nao virar o MAX.
      insert into public.sales (company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
        values (rec.company_id, v_deal_id, rec.lead_id, rec.seller_id, 100000, 'a_vista', 'e9200000-0000-0000-0000-000000000031',
                case when i = 2 then rec.ts else rec.ts - interval '10 days' end);
    end loop;
  end loop;
end $$;

do $$
declare
  rec record;
  v_deal_id uuid;
begin
  -- RK4: Leader e Target empatados em 2 vendas cada, Leader com
  -- MAX(sold_at) mais antigo (vence o desempate, rank1); Target rank2.
  -- Target sobe pra rank1 com 1 venda nova (count=3 > Leader=2).
  for rec in
    select l.company_id, l.id as lead_id, l.name as lead_name, l.seller_id, x.ts
      from (values
        ('rk4Leader', now() - interval '2 hours'),
        ('rk4Target', now() - interval '1 hour')
      ) as x(seller_id, ts)
      join public.leads l on l.seller_id = x.seller_id
  loop
    for i in 1..2 loop
      insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status)
        values (gen_random_uuid(), rec.company_id, rec.lead_id, rec.lead_name, rec.seller_id, 'Onix', 100000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000041', 'e9200000-0000-0000-0000-000000000041', 'sold')
        returning id into v_deal_id;
      insert into public.sales (company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
        values (rec.company_id, v_deal_id, rec.lead_id, rec.seller_id, 100000, 'a_vista', 'e9200000-0000-0000-0000-000000000041',
                case when i = 2 then rec.ts else rec.ts - interval '10 days' end);
    end loop;
  end loop;
end $$;

do $$
declare
  rec record;
  v_deal_id uuid;
begin
  -- Same: Leader=5 vendas (rank1), Rival=1 venda (rank2) — gap grande de
  -- proposito pra Leader vendendo de novo continuar rank1 (mesma posicao).
  for rec in
    select l.company_id, l.id as lead_id, l.name as lead_name, l.seller_id, x.cnt
      from (values ('sameLeader', 5), ('sameRival', 1)) as x(seller_id, cnt)
      join public.leads l on l.seller_id = x.seller_id
  loop
    for i in 1..rec.cnt loop
      insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status)
        values (gen_random_uuid(), rec.company_id, rec.lead_id, rec.lead_name, rec.seller_id, 'Onix', 100000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000051', 'e9200000-0000-0000-0000-000000000051', 'sold')
        returning id into v_deal_id;
      insert into public.sales (company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at)
        values (rec.company_id, v_deal_id, rec.lead_id, rec.seller_id, 100000, 'a_vista', 'e9200000-0000-0000-0000-000000000051', now() - (i || ' days')::interval);
    end loop;
  end loop;
end $$;

-- First: A e B ambos com 0 vendas neste mes (empresa "First" nunca vendeu
-- ainda) — A com mais visitas (rank1 tecnico), B sem nenhuma (rank2
-- tecnico). B registra a 1a venda da empresa -> competition_started=true.
insert into public.visits (id, company_id, client_name, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_by, closed_at) values
  (gen_random_uuid(), 'e9100000-0000-0000-0000-000000000060', 'Visita FirstA', 'firstA', array['Onix'], now() - interval '1 day', 'completed', 'sold', 'e9200000-0000-0000-0000-000000000061', now() - interval '1 day');

-- Deals OPEN (para os register_sale reais que os testes abaixo disparam):
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status) values
  ('e9600000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-000000000010', (select id from public.leads where seller_id = 'rk1Target'), 'RK1 Target', 'rk1Target', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000012', 'e9200000-0000-0000-0000-000000000012', 'open'),
  ('e9600000-0000-0000-0000-000000000002', 'e9100000-0000-0000-0000-000000000020', (select id from public.leads where seller_id = 'rk2Target'), 'RK2 Target', 'rk2Target', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000021', 'e9200000-0000-0000-0000-000000000021', 'open'),
  ('e9600000-0000-0000-0000-000000000003', 'e9100000-0000-0000-0000-000000000030', (select id from public.leads where seller_id = 'rk3Target'), 'RK3 Target', 'rk3Target', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000031', 'e9200000-0000-0000-0000-000000000031', 'open'),
  ('e9600000-0000-0000-0000-000000000004', 'e9100000-0000-0000-0000-000000000040', (select id from public.leads where seller_id = 'rk4Target'), 'RK4 Target', 'rk4Target', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000041', 'e9200000-0000-0000-0000-000000000041', 'open'),
  ('e9600000-0000-0000-0000-000000000005', 'e9100000-0000-0000-0000-000000000050', (select id from public.leads where seller_id = 'sameLeader'), 'Same Leader', 'sameLeader', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000051', 'e9200000-0000-0000-0000-000000000051', 'open'),
  ('e9600000-0000-0000-0000-000000000006', 'e9100000-0000-0000-0000-000000000060', (select id from public.leads where seller_id = 'firstB'), 'First B', 'firstB', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000061', 'e9200000-0000-0000-0000-000000000061', 'open'),
  ('e9600000-0000-0000-0000-000000000007', 'e9100000-0000-0000-0000-000000000070', (select id from public.leads where seller_id = 'offSeller'), 'Off Seller', 'offSeller', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000071', 'e9200000-0000-0000-0000-000000000071', 'open'),
  ('e9600000-0000-0000-0000-000000000008', 'e9100000-0000-0000-0000-000000000080', (select id from public.leads where seller_id = 'isoATarget'), 'IsoA Target', 'isoATarget', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-000000000081', 'e9200000-0000-0000-0000-000000000081', 'open'),
  ('e9600000-0000-0000-0000-000000000009', 'e9100000-0000-0000-0000-0000000000a0', (select id from public.leads where seller_id = 'nyTarget'), 'NY Target', 'nyTarget', 'Onix', 150000, 0, 'a_vista', 'e9200000-0000-0000-0000-0000000000a1', 'e9200000-0000-0000-0000-0000000000a1', 'open');

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO / SEGURANÇA — _rank_company_sellers, tabela, 2 RPCs novas
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = '_rank_company_sellers' and pronamespace = 'public'::regnamespace),
  1, '_rank_company_sellers existe exatamente uma vez');
select is(
  has_function_privilege('authenticated', 'public._rank_company_sellers(uuid,timestamptz,timestamptz)', 'EXECUTE'),
  false, '_rank_company_sellers: authenticated SEM EXECUTE (funcao interna, nunca chamada direto pelo client)');

select has_table('public', 'seller_competition_events', 'tabela seller_competition_events existe');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.seller_competition_events'::regclass),
  'seller_competition_events: RLS habilitada');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'seller_competition_events'),
  0, 'seller_competition_events: ZERO policies (mesmo padrao de audit_log/company_memberships — acesso so via RPC)');
select is(
  has_table_privilege('authenticated', 'public.seller_competition_events', 'SELECT'),
  false, 'authenticated SEM SELECT direto na tabela');
select is(
  has_table_privilege('authenticated', 'public.seller_competition_events', 'INSERT'),
  false, 'authenticated SEM INSERT direto');
select is(
  has_table_privilege('authenticated', 'public.seller_competition_events', 'UPDATE'),
  false, 'authenticated SEM UPDATE direto');
select is(
  has_table_privilege('authenticated', 'public.seller_competition_events', 'DELETE'),
  false, 'authenticated SEM DELETE direto');
select is(
  has_table_privilege('anon', 'public.seller_competition_events', 'SELECT'),
  false, 'anon SEM SELECT direto');

select col_not_null('public', 'seller_competition_events', 'company_id', 'company_id NOT NULL');
select col_not_null('public', 'seller_competition_events', 'seller_id', 'seller_id NOT NULL');
select col_not_null('public', 'seller_competition_events', 'actor_profile_id', 'actor_profile_id NOT NULL');
select col_not_null('public', 'seller_competition_events', 'source_sale_id', 'source_sale_id NOT NULL');
select col_not_null('public', 'seller_competition_events', 'old_rank', 'old_rank NOT NULL');
select col_not_null('public', 'seller_competition_events', 'new_rank', 'new_rank NOT NULL');
select col_is_null('public', 'seller_competition_events', 'related_seller_id', 'related_seller_id nullable (NULL quando competition_started)');
select col_is_null('public', 'seller_competition_events', 'seen_at', 'seen_at nullable (NULL = ainda nao visto)');

select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.seller_competition_events'::regclass and contype = 'u' and conkey = array[
    (select attnum from pg_attribute where attrelid = 'public.seller_competition_events'::regclass and attname = 'source_sale_id')
  ]) = 1,
  'source_sale_id: UNIQUE (idempotencia estrutural — uma Sale nunca produz 2 eventos)');

select is(
  (select count(*)::int from pg_proc where proname = 'list_my_unseen_competition_events' and pronamespace = 'public'::regnamespace),
  1, 'list_my_unseen_competition_events existe');
select is(
  has_function_privilege('authenticated', 'public.list_my_unseen_competition_events()', 'EXECUTE'),
  true, 'list_my_unseen_competition_events: authenticated COM EXECUTE');
select is(
  has_function_privilege('anon', 'public.list_my_unseen_competition_events()', 'EXECUTE'),
  false, 'list_my_unseen_competition_events: anon SEM EXECUTE');

select is(
  (select count(*)::int from pg_proc where proname = 'mark_competition_events_seen' and pronamespace = 'public'::regnamespace),
  1, 'mark_competition_events_seen existe');
select is(
  has_function_privilege('authenticated', 'public.mark_competition_events_seen(uuid[])', 'EXECUTE'),
  true, 'mark_competition_events_seen: authenticated COM EXECUTE');

-- ══════════════════════════════════════════════════════════════════════
-- 2. 4º → 3º (RK1) — Seller registra a PRÓPRIA venda; cobre também
--    idempotência (retry na mesma Deal) e actor==beneficiary.
-- ══════════════════════════════════════════════════════════════════════

-- Pre-condicoes usam _rank_company_sellers diretamente (funcao interna,
-- sem EXECUTE para authenticated de proposito — §5 do EXEC) — rodam como
-- postgres, ANTES do role switch para o ator real do teste.
select is(
  (select rank from public._rank_company_sellers('e9100000-0000-0000-0000-000000000010', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month') where seller_id = 'rk1Target'),
  4, 'pre-condicao: RK1 Target comeca em 4o lugar');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000012'); -- RK1 Target (seller)
set local role authenticated;

select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000001'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'RK1: Target registra a propria venda com sucesso');
reset role;

-- seller_competition_events NAO tem SELECT para authenticated de proposito
-- (§19 do EXEC — so via RPC) — asserts diretas na tabela rodam como
-- postgres (reset role acima), nunca como o ator do teste.
select is(
  (select count(*)::int from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  1, 'RK1: exatamente 1 evento criado para esta Sale');
select is(
  (select old_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  4, 'RK1: old_rank = 4');
select is(
  (select new_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  3, 'RK1: new_rank = 3 (4o -> 3o)');
select is(
  (select seller_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  'rk1Target', 'RK1: beneficiario correto');
select is(
  (select actor_profile_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  'e9200000-0000-0000-0000-000000000012'::uuid, 'RK1: actor == beneficiario (Seller registrou a propria venda)');
select is(
  (select related_seller_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  'rk1C', 'RK1: related_seller = quem ocupava a posicao 3 ANTES da venda (rk1C)');
select is(
  (select competition_started from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  false, 'RK1: competition_started = false (empresa ja tinha vendas no mes)');
select is(
  (select sale_count from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  3, 'RK1: sale_count snapshot pos-venda = 3');

-- Idempotência / retry: a MESMA Deal já está 'sold' — uma segunda chamada
-- falha (deal_closed), nunca cria uma segunda Sale nem um segundo evento.
select pg_temp.as_user('e9200000-0000-0000-0000-000000000012'); -- RK1 Target (seller)
set local role authenticated;
select throws_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000001'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'P0001', 'deal_closed', 'RK1: retry na mesma Deal falha em deal_closed');
reset role;
select is(
  (select count(*)::int from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001'),
  1, 'RK1: ainda existe SOMENTE 1 Sale para esta Deal apos o retry');
select is(
  (select count(*)::int from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001')),
  1, 'RK1: ainda existe SOMENTE 1 evento apos o retry (nenhuma duplicidade)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. 4º → 2º (RK2) — Manager registra a venda PARA o Seller (actor !=
--    beneficiary), related_seller correto.
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('e9100000-0000-0000-0000-000000000020', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month') where seller_id = 'rk2Target'),
  4, 'pre-condicao: RK2 Target comeca em 4o lugar');
select is(
  (select rank from public._rank_company_sellers('e9100000-0000-0000-0000-000000000020', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month') where seller_id = 'rk2B'),
  2, 'pre-condicao: RK2 B ocupa a 2a posicao antes da venda');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000021'); -- RK2 Manager
set local role authenticated;

select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000002'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'RK2: Manager registra a venda de Target com sucesso');
reset role;

select is(
  (select old_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000002')),
  4, 'RK2: old_rank = 4');
select is(
  (select new_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000002')),
  2, 'RK2: new_rank = 2 (4o -> 2o)');
select is(
  (select seller_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000002')),
  'rk2Target', 'RK2: beneficiario = Target (nunca o Manager)');
select is(
  (select actor_profile_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000002')),
  'e9200000-0000-0000-0000-000000000021'::uuid, 'RK2: actor = Manager real (distinto do beneficiario)');
select is(
  (select related_seller_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000002')),
  'rk2B', 'RK2: related_seller = quem ocupava a posicao 2 ANTES (rk2B)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. 4º → 1º (RK3) — empate real de 4 sellers em vendas, quebrado por
--    MAX(sold_at); Target ultrapassa todos com 1 nova venda.
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('e9100000-0000-0000-0000-000000000030', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month') where seller_id = 'rk3Target'),
  4, 'pre-condicao: RK3 Target comeca em 4o (empate de 4, perde o desempate)');
select is(
  (select rank from public._rank_company_sellers('e9100000-0000-0000-0000-000000000030', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month') where seller_id = 'rk3B'),
  1, 'pre-condicao: RK3 B lidera o empate (MAX(sold_at) mais antigo)');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000031'); -- RK3 Target (seller)
set local role authenticated;

select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000003'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'RK3: Target registra a propria venda com sucesso');
reset role;

select is(
  (select old_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000003')),
  4, 'RK3: old_rank = 4');
select is(
  (select new_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000003')),
  1, 'RK3: new_rank = 1 (4o -> 1o, ultrapassa o empate inteiro)');
select is(
  (select related_seller_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000003')),
  'rk3B', 'RK3: related_seller = antigo lider (rk3B)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. 2º → 1º (RK4)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('e9100000-0000-0000-0000-000000000040', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month') where seller_id = 'rk4Target'),
  2, 'pre-condicao: RK4 Target comeca em 2o (empatado, perde o desempate pro Leader)');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000041'); -- RK4 Target (seller)
set local role authenticated;

select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000004'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'RK4: Target registra a propria venda com sucesso');
reset role;

select is(
  (select old_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000004')),
  2, 'RK4: old_rank = 2');
select is(
  (select new_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000004')),
  1, 'RK4: new_rank = 1 (2o -> 1o)');
select is(
  (select related_seller_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000004')),
  'rk4Leader', 'RK4: related_seller = antigo lider (rk4Leader)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. MESMA POSIÇÃO → ZERO EVENTO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select rank from public._rank_company_sellers('e9100000-0000-0000-0000-000000000050', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month') where seller_id = 'sameLeader'),
  1, 'pre-condicao: Same Leader ja e 1o (folga grande)');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000051'); -- Same Leader (seller)
set local role authenticated;

select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000005'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'Same: Leader registra mais uma venda (permanece 1o)');
reset role;

select is(
  (select count(*)::int from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000005')),
  0, 'Same: ZERO evento quando new_rank = old_rank (nenhuma melhora real)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. PRIMEIRA VENDA DA EMPRESA NO MÊS (competition_started)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.sales where company_id = 'e9100000-0000-0000-0000-000000000060'
     and sold_at >= date_trunc('month', now()) and sold_at <= date_trunc('month', now()) + interval '1 month'),
  0, 'pre-condicao: empresa First nao tem NENHUMA venda no mes oficial ainda');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000061'); -- First B (seller)
set local role authenticated;

select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000006'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'First: B registra a 1a venda da empresa no mes');
reset role;

select is(
  (select competition_started from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000006')),
  true, 'First: competition_started = true');
select is(
  (select related_seller_id from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000006')),
  null, 'First: related_seller_id NULL quando competition_started (nao existe "quem eu ultrapassei")');
select is(
  (select new_rank from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000006')),
  1, 'First: new_rank = 1 (unico com venda real no mes)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. OFFBOARDED SELLER (guarda defensiva) — Sale continua sendo criada
--    normalmente; evento e OMITIDO (beneficiario fora do roster ativo,
--    old_rank/new_rank vem NULL de _rank_company_sellers).
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select is_active from public.sellers where id = 'offSeller'),
  false, 'pre-condicao: offSeller esta inativo (fora do roster de _rank_company_sellers)');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000071'); -- Off Manager
set local role authenticated;

select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000007'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'Offboard: Manager registra a venda normalmente (Sale nunca bloqueada pela camada competitiva)');
reset role;

select is(
  (select status from public.deals where id = 'e9600000-0000-0000-0000-000000000007'),
  'sold'::public.deal_status, 'Offboard: Deal virou sold normalmente');
select is(
  (select count(*)::int from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000007')),
  0, 'Offboard: ZERO evento (beneficiario fora do roster ativo — guarda defensiva, nunca quebra a venda)');

reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 9. PERÍODO MENSAL — fórmula do boundary (companies.timezone), nunca UTC
--    puro/browser timezone (ver limitação documentada no topo do arquivo)
-- ══════════════════════════════════════════════════════════════════════

select ok(
  (select period_start from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001'))
  = (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
  'period_start = inicio do mes civil em America/Sao_Paulo (formula exata, DST-safe)');
select ok(
  (select period_end from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000001'))
  = ((date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo'),
  'period_end = inicio do PROXIMO mes civil em America/Sao_Paulo');

-- Timezone diferente por empresa: America/New_York tem offset distinto de
-- America/Sao_Paulo — o boundary calculado deve usar o timezone DA
-- EMPRESA, nunca um valor global/UTC puro.
select pg_temp.as_user('e9200000-0000-0000-0000-0000000000a2'); -- NY Target (seller)
set local role authenticated;
select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000009'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'NY: Target registra a 1a venda da empresa (competition_started, timezone America/New_York)');
reset role;
select ok(
  (select period_start from public.seller_competition_events where source_sale_id = (select id from public.sales where deal_id = 'e9600000-0000-0000-0000-000000000009'))
  = (date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York'),
  'NY: period_start usa o timezone DA EMPRESA (America/New_York), nao um valor global');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 10. list_my_unseen_competition_events — isolamento e papéis
-- ══════════════════════════════════════════════════════════════════════

-- IsoA Target registra a PRIMEIRA venda da empresa Isolation A no mes
-- (isoAOther nunca vendeu) — competition_started=true, new_rank=1,
-- evento garantido para os testes de isolamento/mark_seen abaixo.
select pg_temp.as_user('e9200000-0000-0000-0000-000000000082'); -- IsoA Target (seller)
set local role authenticated;
select lives_ok(
  $$select public.register_sale('e9600000-0000-0000-0000-000000000008'::uuid, 1, 90000, 'a_vista'::public.deal_payment_method)$$,
  'IsoA: Target registra a 1a venda da empresa (competition_started)');
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  1, 'IsoA Target: ve exatamente 1 evento unseen (o proprio)');
reset role;

select pg_temp.as_user('e9200000-0000-0000-0000-000000000083'); -- IsoA Other (outro Seller da MESMA empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'IsoA Other: NAO ve o evento do colega (isolamento por Seller, mesma empresa)');
reset role;

select pg_temp.as_user('e9200000-0000-0000-0000-000000000081'); -- IsoA Manager
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'IsoA Manager: NUNCA recebe comemoracao pessoal (conjunto vazio, nunca erro)');
reset role;

select pg_temp.as_user('e9200000-0000-0000-0000-000000000091'); -- IsoB Seller (OUTRA empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'IsoB Seller (outra empresa): NAO ve evento de IsoA (isolamento por company)');
reset role;

set local role anon;
select throws_ok(
  $$select * from public.list_my_unseen_competition_events()$$,
  '42501', null, 'anon: permission denied (sem EXECUTE)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 11. mark_competition_events_seen
-- ══════════════════════════════════════════════════════════════════════

-- Captura o id do evento como postgres (tabela sem SELECT p/ authenticated
-- — §19 do EXEC) ANTES de qualquer troca de role — \gset guarda em
-- :'iso_a_target_event_id', reutilizavel depois de qualquer set local role.
select id as iso_a_target_event_id from public.seller_competition_events where seller_id = 'isoATarget' \gset

select pg_temp.as_user('e9200000-0000-0000-0000-000000000083'); -- IsoA Other
set local role authenticated;
select is(
  (select public.mark_competition_events_seen(array[:'iso_a_target_event_id'::uuid])),
  0, 'IsoA Other: tenta marcar o evento do colega — 0 linhas afetadas (silenciosamente ignorado, nunca erro que vaze existencia)');
reset role;

select pg_temp.as_user('e9200000-0000-0000-0000-000000000081'); -- IsoA Manager
set local role authenticated;
select throws_ok(
  $$select public.mark_competition_events_seen(array['00000000-0000-0000-0000-000000000000'::uuid])$$,
  '42501', null, 'Manager: forbidden ao chamar mark_competition_events_seen (mutation, denial explicito)');
reset role;

select is(
  (select seen_at from public.seller_competition_events where seller_id = 'isoATarget'),
  null, 'pre-condicao: evento de IsoA Target ainda unseen');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000082'); -- IsoA Target (dono do evento)
set local role authenticated;
select is(
  (select public.mark_competition_events_seen(array[:'iso_a_target_event_id'::uuid])),
  1, 'IsoA Target: marca o PROPRIO evento — 1 linha afetada');
reset role;

select ok(
  (select seen_at from public.seller_competition_events where seller_id = 'isoATarget') is not null,
  'seen_at preenchido de verdade (server-side, nunca so um flag local)');

select pg_temp.as_user('e9200000-0000-0000-0000-000000000082'); -- IsoA Target
set local role authenticated;
select is(
  (select count(*)::int from public.list_my_unseen_competition_events()),
  0, 'multi-device: segundo fetch (mesma sessao ou outro dispositivo) NAO retorna mais o evento ja visto');
-- segunda chamada de mark_seen no mesmo id: idempotente, 0 linhas (ja tinha seen_at)
select is(
  (select public.mark_competition_events_seen(array[:'iso_a_target_event_id'::uuid])),
  0, 'mark_seen chamado 2x no mesmo evento: 2a chamada afeta 0 linhas (ja estava visto)');
reset role;

select * from finish();
rollback;
