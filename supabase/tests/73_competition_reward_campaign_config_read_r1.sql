-- COMPETITION-REWARDS-V1-B1-R1-EXEC — get_competition_reward_campaign.
-- Migration 20260831100000_competition_reward_campaign_config_read.sql.
--
-- Leitura da configuração de UMA reward campaign (mês corrente OU futuro)
-- para o editor do Manager. Todos os meses aqui são RELATIVOS a now()
-- (pg_temp.cur_month() / pg_temp.next_month()) — timezone civil
-- America/Sao_Paulo, sem DST.
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

create or replace function pg_temp.next_month() returns date as $$
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month')::date;
$$ language sql;

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO / SEGURANÇA
-- ═══════════════════════════════════════════════════════════════════════
select has_function('public', 'get_competition_reward_campaign', array['date','uuid'],
  'get_competition_reward_campaign(date, uuid) existe');
select ok(
  has_function_privilege('authenticated', 'public.get_competition_reward_campaign(date,uuid)', 'EXECUTE'),
  'authenticated COM EXECUTE em get_competition_reward_campaign');
select ok(
  not has_function_privilege('anon', 'public.get_competition_reward_campaign(date,uuid)', 'EXECUTE'),
  'anon SEM EXECUTE em get_competition_reward_campaign');

-- RPCs irmãs NÃO tocadas (continuam existindo exatamente uma vez cada)
select is((select count(*)::int from pg_proc
  where proname = 'get_competition_rewards_overview' and pronamespace = 'public'::regnamespace), 1,
  'get_competition_rewards_overview intacta (1 definição)');
select is((select count(*)::int from pg_proc
  where proname = 'upsert_competition_reward_campaign' and pronamespace = 'public'::regnamespace), 1,
  'upsert_competition_reward_campaign intacta (1 definição)');
select is((select count(*)::int from pg_proc
  where proname = 'list_competition_reward_history' and pronamespace = 'public'::regnamespace), 1,
  'list_competition_reward_history intacta (1 definição)');
select is((select count(*)::int from pg_proc
  where proname = '_finalize_due_competition_reward_months' and pronamespace = 'public'::regnamespace), 1,
  '_finalize_due_competition_reward_months intacta (1 definição)');

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES — 2 empresas, Manager A, Manager B, Seller (cia A), Super Admin
-- ═══════════════════════════════════════════════════════════════════════
insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('dc010000-0000-0000-0000-000000000001', 'DC Config A', null, null, 'America/Sao_Paulo', 'ativa'),
  ('dc010000-0000-0000-0000-000000000002', 'DC Config B', null, null, 'America/Sao_Paulo', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', em, now(), now(), now()
from (values
  ('dc020000-0000-0000-0000-000000000001', 'dc-mgrA@t.local'),
  ('dc020000-0000-0000-0000-000000000002', 'dc-mgrB@t.local'),
  ('dc020000-0000-0000-0000-000000000003', 'dc-selA@t.local'),
  ('dc020000-0000-0000-0000-000000000004', 'dc-sa@t.local')) as t(id, em);

insert into public.profiles (id, name, email, is_active, platform_role)
select id::uuid, nm, em, true, pr::public.platform_role from (values
  ('dc020000-0000-0000-0000-000000000001', 'DC Manager A', 'dc-mgrA@t.local', null),
  ('dc020000-0000-0000-0000-000000000002', 'DC Manager B', 'dc-mgrB@t.local', null),
  ('dc020000-0000-0000-0000-000000000003', 'DC Seller A',  'dc-selA@t.local', null),
  ('dc020000-0000-0000-0000-000000000004', 'DC Super Adm', 'dc-sa@t.local',   'super_admin')) as t(id, nm, em, pr);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('dc030000-0000-0000-0000-000000000001', 'dc010000-0000-0000-0000-000000000001', 'dc020000-0000-0000-0000-000000000001', 'manager', true),
  ('dc030000-0000-0000-0000-000000000002', 'dc010000-0000-0000-0000-000000000002', 'dc020000-0000-0000-0000-000000000002', 'manager', true),
  ('dc030000-0000-0000-0000-000000000003', 'dc010000-0000-0000-0000-000000000001', 'dc020000-0000-0000-0000-000000000003', 'seller',  true);

-- ═══════════════════════════════════════════════════════════════════════
-- Manager A cria as campanhas via a RPC de escrita real (contrato B1).
--   mês CORRENTE  → published, 3 tiers (valor / texto / valor+texto),
--                   passados FORA de ordem no array (pos 3, 1, 2).
--   mês SEGUINTE  → draft, 1 tier (valor).
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('dc020000-0000-0000-0000-000000000001');
select lives_ok(format(
  $$select public.upsert_competition_reward_campaign(%L::date, 'published', 'Campanha Corrente',
      '[{"position":3,"amount_cents":10000,"reward_text":"Bonus"},
        {"position":1,"amount_cents":50000},
        {"position":2,"reward_text":"Folga"}]'::jsonb)$$, pg_temp.cur_month()),
  'Manager A cria/publica a campanha do mês corrente (tiers fora de ordem)');
select lives_ok(format(
  $$select public.upsert_competition_reward_campaign(%L::date, 'draft', 'Proximo Mes',
      '[{"position":1,"amount_cents":99999}]'::jsonb)$$, pg_temp.next_month()),
  'Manager A cria a campanha (draft) do mês seguinte');

-- ═══════════════════════════════════════════════════════════════════════
-- §4/§7 — Manager lê a campanha do mês CORRENTE (published)
-- ═══════════════════════════════════════════════════════════════════════
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #>> '{campaign,status}',
  'published', 'mês corrente: status published devolvido ao Manager');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #>> '{campaign,title}',
  'Campanha Corrente', 'mês corrente: title devolvido');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #>> '{month_start}',
  pg_temp.cur_month()::text, 'mês corrente: month_start ecoado no topo do payload');
select ok(
  (public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,published_at}') is not null
  and (public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,published_at}') <> 'null'::jsonb,
  'mês corrente: published_at preenchido (campanha publicada)');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #>> '{campaign,timezone}',
  'America/Sao_Paulo', 'mês corrente: timezone congelada devolvida');
select ok(
  (public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,updated_at}') is not null,
  'mês corrente: updated_at presente no payload do editor');

-- §8 — tiers SEMPRE ORDER BY position ASC (mesmo tendo sido gravados fora de ordem)
select is(
  (select array_agg((t->>'position')::int order by ord)
     from jsonb_array_elements(public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,tiers}')
          with ordinality as x(t, ord)),
  array[1,2,3], 'mês corrente: tiers devolvidos em ordem de position (1,2,3)');

-- §11 do B2 / R1 §7 — money + text preservados por posição
select is(
  (public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,tiers}' -> 0 ->> 'amount_cents')::bigint,
  50000::bigint, 'tier pos 1: amount_cents = 50000 (inteiro preservado)');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,tiers}' -> 0 -> 'reward_text',
  'null'::jsonb, 'tier pos 1: reward_text null (só valor)');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,tiers}' -> 1 -> 'amount_cents',
  'null'::jsonb, 'tier pos 2: amount_cents null (só texto)');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,tiers}' -> 1 ->> 'reward_text',
  'Folga', 'tier pos 2: reward_text = Folga');
select is(
  (public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,tiers}' -> 2 ->> 'amount_cents')::bigint,
  10000::bigint, 'tier pos 3: amount_cents = 10000 (valor + texto juntos)');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign,tiers}' -> 2 ->> 'reward_text',
  'Bonus', 'tier pos 3: reward_text = Bonus');

-- §12 — esta RPC NÃO é a Home: sem rank / my_reward / last_result no payload
select ok(
  not (public.get_competition_reward_campaign(pg_temp.cur_month(), null) ? 'my_rank')
  and not (public.get_competition_reward_campaign(pg_temp.cur_month(), null) ? 'last_result')
  and not (public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign}' ? 'my_reward'),
  'payload de configuração NÃO carrega rank / my_reward / last_result');

-- ═══════════════════════════════════════════════════════════════════════
-- §14 — Manager lê a campanha do mês SEGUINTE (draft) — o furo que o R1 fecha
-- ═══════════════════════════════════════════════════════════════════════
select is(
  public.get_competition_reward_campaign(pg_temp.next_month(), null) #>> '{campaign,status}',
  'draft', 'mês seguinte: campanha DRAFT devolvida ao Manager');
select is(
  (public.get_competition_reward_campaign(pg_temp.next_month(), null) #> '{campaign,tiers}' -> 0 ->> 'amount_cents')::bigint,
  99999::bigint, 'mês seguinte: tier do draft recarregado (99999) — editor consegue reabrir');
select is(
  public.get_competition_reward_campaign(pg_temp.next_month(), null) #> '{campaign,published_at}',
  'null'::jsonb, 'mês seguinte (draft): published_at null');

-- mês seguinte agora PUBLICADO — continua legível pelo editor
select lives_ok(format(
  $$select public.upsert_competition_reward_campaign(%L::date, 'published', 'Proximo Mes',
      '[{"position":1,"amount_cents":99999},{"position":2,"reward_text":"Vale"}]'::jsonb)$$, pg_temp.next_month()),
  'Manager A publica antecipadamente a campanha do mês seguinte');
select is(
  public.get_competition_reward_campaign(pg_temp.next_month(), null) #>> '{campaign,status}',
  'published', 'mês seguinte: campanha PUBLISHED devolvida ao Manager');
select is(
  jsonb_array_length(public.get_competition_reward_campaign(pg_temp.next_month(), null) #> '{campaign,tiers}'),
  2, 'mês seguinte: tiers substituídos atomicamente (2) e recarregados');

-- ═══════════════════════════════════════════════════════════════════════
-- §4 — campanha inexistente → shape vazio, NUNCA erro
-- ═══════════════════════════════════════════════════════════════════════
select is(
  public.get_competition_reward_campaign((pg_temp.next_month() + interval '1 month')::date, null),
  jsonb_build_object('month_start', (pg_temp.next_month() + interval '1 month')::date, 'campaign', null),
  'mês futuro sem campanha → { month_start, campaign: null } (sem erro)');
select is(
  public.get_competition_reward_campaign((pg_temp.next_month() + interval '1 month')::date, null) #> '{campaign}',
  'null'::jsonb, 'mês futuro sem campanha: campaign = null');

-- ═══════════════════════════════════════════════════════════════════════
-- §9 — mês anterior ao corrente → month_closed
-- ═══════════════════════════════════════════════════════════════════════
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, null)$$,
    (pg_temp.cur_month() - interval '1 month')::date),
  '22023', null, 'mês encerrado (< corrente) → month_closed (editor não carrega passado)');

-- ═══════════════════════════════════════════════════════════════════════
-- §10 — month_start inválido (não é dia 1) e null
-- ═══════════════════════════════════════════════════════════════════════
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, null)$$,
    (pg_temp.cur_month() + interval '14 days')::date),
  '22023', null, 'month_start que não é o primeiro dia do mês → invalid_month');
select throws_ok(
  $$select public.get_competition_reward_campaign(null::date, null)$$,
  '22023', null, 'month_start null → invalid_month');

-- ═══════════════════════════════════════════════════════════════════════
-- §13 — isolamento entre empresas
-- ═══════════════════════════════════════════════════════════════════════
-- Manager B (cia B, sem campanha nenhuma) lê a PRÓPRIA empresa → vazio
select pg_temp.as_user('dc020000-0000-0000-0000-000000000002');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), null) #> '{campaign}',
  'null'::jsonb, 'Manager B só enxerga a própria empresa (sem campanha → null)');
-- Manager B tentando apontar p_company_id para a cia A → forbidden
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, 'dc010000-0000-0000-0000-000000000001'::uuid)$$, pg_temp.cur_month()),
  '42501', null, 'Manager B NÃO lê a cia A via p_company_id (forbidden, §13)');
-- Manager A passando o próprio company_id no guard → OK (idempotente)
select pg_temp.as_user('dc020000-0000-0000-0000-000000000001');
select is(
  public.get_competition_reward_campaign(pg_temp.cur_month(), 'dc010000-0000-0000-0000-000000000001'::uuid) #>> '{campaign,status}',
  'published', 'Manager A pode passar o PRÓPRIO company_id no guard (sem efeito)');

-- ═══════════════════════════════════════════════════════════════════════
-- §5 — Seller NÃO usa esta RPC para descobrir premiação (nem futura)
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('dc020000-0000-0000-0000-000000000003');
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, null)$$, pg_temp.cur_month()),
  '42501', null, 'Seller → forbidden no mês corrente');
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, null)$$, pg_temp.next_month()),
  '42501', null, 'Seller → forbidden no mês futuro (não vaza premiação antes da hora)');

-- ═══════════════════════════════════════════════════════════════════════
-- §6 — Super Admin (global e contextual) → forbidden em V1
-- ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('dc020000-0000-0000-0000-000000000004');
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, null)$$, pg_temp.cur_month()),
  '42501', null, 'Super Admin global → forbidden');
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, 'dc010000-0000-0000-0000-000000000001'::uuid)$$, pg_temp.cur_month()),
  '42501', null, 'Super Admin contextual (p_company_id) → forbidden (sem editor SA V1)');

-- ═══════════════════════════════════════════════════════════════════════
-- auth — não autenticado / anon
-- ═══════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', null, true);
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, null)$$, pg_temp.cur_month()),
  '28000', null, 'sem auth → invalid_authorization_specification');

set local role anon;
select throws_ok(
  format($$select public.get_competition_reward_campaign(%L::date, null)$$, pg_temp.cur_month()),
  '42501', null, 'anon sem grant → permission denied');
reset role;

select * from finish();
rollback;
