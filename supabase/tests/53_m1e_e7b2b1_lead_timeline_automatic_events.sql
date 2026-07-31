-- M1-E E7-B2-B1 — eventos automáticos e transacionais da timeline dentro
-- das 7 RPCs de mutation de Leads. Prova: (1) cada mutation bem-sucedida
-- grava exatamente uma entrada sanitizada; (2) nenhuma falha (forbidden/
-- not_found/archived/stale_write/stage_not_found/seller_not_found) grava
-- entrada; (3) no-op real (mesma etapa/mesmo vendedor/estado já alcançado)
-- não grava entrada falsa; (4) ator resolvido só pelo servidor (Manager/
-- Seller = profile real, Super Admin = NULL); (5) audit_log preservado;
-- (6) isolamento por empresa; (7) helper interno sem GRANT a
-- authenticated/anon; (8) add_lead_timeline_entry (nota manual) continua
-- funcionando. Rollback ao final — nenhum dado permanece.
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
  ('e7000000-0000-0000-0000-000000000001', 'E7B2B1 Empresa A', 'ativa'),
  ('e7000000-0000-0000-0000-000000000002', 'E7B2B1 Empresa B', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e7100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e7b2b1-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e7100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e7b2b1-seller1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e7100000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'e7b2b1-seller2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e7100000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'e7b2b1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e7100000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'e7b2b1-managerb@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e7100000-0000-0000-0000-000000000001', 'Gerente E7B2B1', 'e7b2b1-manager@test.local', true, null),
  ('e7100000-0000-0000-0000-000000000002', 'Vendedor Um E7B2B1', 'e7b2b1-seller1@test.local', true, null),
  ('e7100000-0000-0000-0000-000000000003', 'Vendedor Dois E7B2B1', 'e7b2b1-seller2@test.local', true, null),
  ('e7100000-0000-0000-0000-000000000004', 'Super Admin E7B2B1', 'e7b2b1-superadmin@test.local', true, 'super_admin'),
  ('e7100000-0000-0000-0000-000000000005', 'Gerente B E7B2B1', 'e7b2b1-managerb@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('e7200000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-000000000001', 'manager', true),
  ('e7200000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-000000000002', 'seller', true),
  ('e7200000-0000-0000-0000-000000000003', 'e7000000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-000000000005', 'manager', true);

-- membership_id (m1f_s1_01) é a cadeia REAL que
-- current_profile_seller_id_for_company usa para resolver o seller do
-- ator autenticado (sellers.membership_id -> company_memberships) — nunca
-- sellers.profile_id isoladamente. Seller1 precisa da FK preenchida para
-- criar/mover/aplicar evento como ator "seller" nestes testes; Seller2 é só
-- alvo de atribuição (nunca atua como Seller autenticado aqui), então não
-- precisa de membership_id.
insert into public.sellers (id, company_id, profile_id, membership_id, name, first_name, team, is_active) values
  ('e7b2b1-seller-1', 'e7000000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-000000000002', 'e7200000-0000-0000-0000-000000000002', 'Vendedor Um E7B2B1', 'Vendedor', 'Novos', true),
  ('e7b2b1-seller-2', 'e7000000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-000000000003', null, 'Vendedor Dois E7B2B1', 'Vendedor', 'Seminovos', true),
  ('e7b2b1-seller-inactive', 'e7000000-0000-0000-0000-000000000001', null, null, 'Vendedor Inativo E7B2B1', 'Vendedor', null, false);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('e7300000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('e7300000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000001', 'qualified', 'Qualificado', 1),
  ('e7300000-0000-0000-0000-000000000003', 'e7000000-0000-0000-0000-000000000001', 'negotiation', 'Em negociação', 2),
  ('e7300000-0000-0000-0000-000000000004', 'e7000000-0000-0000-0000-000000000001', 'visit_scheduled', 'Visita agendada', 3),
  ('e7300000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000001', 'closing', 'Fechamento', 4),
  ('e7300000-0000-0000-0000-000000000006', 'e7000000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

-- Leads fixture dedicados por cenário (evita interferência entre testes).
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('e7500000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Update OK',        '(11) 90000-1001', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000001', 'Update Stale',      '(11) 90000-1002', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000003', 'e7000000-0000-0000-0000-000000000001', 'Update Forbidden',  '(11) 90000-1003', 'Onix', 'e7300000-0000-0000-0000-000000000001', 'e7b2b1-seller-2'),
  ('e7500000-0000-0000-0000-000000000004', 'e7000000-0000-0000-0000-000000000001', 'Move OK',           '(11) 90000-1004', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000001', 'Move Same',         '(11) 90000-1005', 'Onix', 'e7300000-0000-0000-0000-000000000002', null),
  ('e7500000-0000-0000-0000-000000000006', 'e7000000-0000-0000-0000-000000000001', 'Move Stage404',     '(11) 90000-1006', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000007', 'e7000000-0000-0000-0000-000000000001', 'Move Stale',        '(11) 90000-1007', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000008', 'e7000000-0000-0000-0000-000000000001', 'Event Call',        '(11) 90000-1008', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000009', 'e7000000-0000-0000-0000-000000000001', 'Event Sale',        '(11) 90000-1009', 'Onix', 'e7300000-0000-0000-0000-000000000003', null),
  ('e7500000-0000-0000-0000-000000000010', 'e7000000-0000-0000-0000-000000000001', 'Event Archived',    '(11) 90000-1010', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000011', 'e7000000-0000-0000-0000-000000000001', 'Assign New',        '(11) 90000-1011', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000012', 'e7000000-0000-0000-0000-000000000001', 'Assign Remove',     '(11) 90000-1012', 'Onix', 'e7300000-0000-0000-0000-000000000001', 'e7b2b1-seller-1'),
  ('e7500000-0000-0000-0000-000000000013', 'e7000000-0000-0000-0000-000000000001', 'Assign NoOp',       '(11) 90000-1013', 'Onix', 'e7300000-0000-0000-0000-000000000001', 'e7b2b1-seller-1'),
  ('e7500000-0000-0000-0000-000000000014', 'e7000000-0000-0000-0000-000000000001', 'Assign NotFound',   '(11) 90000-1014', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000015', 'e7000000-0000-0000-0000-000000000001', 'Archive OK',        '(11) 90000-1015', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000017', 'e7000000-0000-0000-0000-000000000001', 'Assign Forbidden',  '(11) 90000-1017', 'Onix', 'e7300000-0000-0000-0000-000000000001', null),
  ('e7500000-0000-0000-0000-000000000018', 'e7000000-0000-0000-0000-000000000002', 'Cross Tenant',      '(11) 90000-1018', 'Onix', 'e7300000-0000-0000-0000-000000000006', null);

update public.leads set archived_at = now() where id = 'e7500000-0000-0000-0000-000000000010';

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('e7500000-0000-0000-0000-000000000016', 'e7000000-0000-0000-0000-000000000001', 'Unarchive OK', '(11) 90000-1016', 'Onix', 'e7300000-0000-0000-0000-000000000001', null, now());

-- ═══════════════════════════════════════════════════════════════════════
-- HELPER INTERNO — sem GRANT a authenticated/anon
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'record_lead_timeline_event'
      and grantee in ('authenticated', 'anon', 'PUBLIC')),
  0, 'record_lead_timeline_event: nenhum GRANT a authenticated/anon/PUBLIC');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_lead_timeline_event' and p.prosecdef),
  1, 'record_lead_timeline_event: SECURITY DEFINER');

-- Nenhuma das 7 assinaturas públicas mudou (mesmo número de argumentos de
-- antes — CREATE OR REPLACE, nunca DROP+CREATE).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('create_lead','update_lead','move_lead_to_stage','apply_lead_event',
       'assign_lead_seller','archive_lead','unarchive_lead')),
  7, 'as 7 RPCs de mutation continuam no catálogo, uma assinatura cada');

-- ═══════════════════════════════════════════════════════════════════════
-- A. CREATE_LEAD
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
create temp table t_created_mgr as
  select * from public.create_lead('Cliente Manager', '(11) 91111-0001', 'Golf');
reset role;

select is((select count(*)::int from public.lead_timeline_entries where lead_id = (select id from t_created_mgr)), 1,
  'create_lead (Manager): exatamente 1 entrada de timeline');
select is((select company_id from public.lead_timeline_entries where lead_id = (select id from t_created_mgr)),
  'e7000000-0000-0000-0000-000000000001'::uuid, 'create_lead: company_id correto');
select is((select label from public.lead_timeline_entries where lead_id = (select id from t_created_mgr)),
  'Lead criado', 'create_lead: label sanitizado');
select is((select actor_profile_id from public.lead_timeline_entries where lead_id = (select id from t_created_mgr)),
  'e7100000-0000-0000-0000-000000000001'::uuid, 'create_lead (Manager): actor = profile real');

select pg_temp.as_user('e7100000-0000-0000-0000-000000000002');
set local role authenticated;
create temp table t_created_seller as
  select * from public.create_lead('Cliente Seller', '(11) 91111-0002', 'Onix');
reset role;

select is((select actor_profile_id from public.lead_timeline_entries where lead_id = (select id from t_created_seller)),
  'e7100000-0000-0000-0000-000000000002'::uuid, 'create_lead (Seller): actor = profile real');

select pg_temp.as_user('e7100000-0000-0000-0000-000000000004');
set local role authenticated;
create temp table t_created_sa as
  select * from public.create_lead('Cliente SA', '(11) 91111-0003', 'Kicks', null, null, null, null,
    'e7000000-0000-0000-0000-000000000001');
reset role;

select is((select actor_profile_id from public.lead_timeline_entries where lead_id = (select id from t_created_sa)),
  null, 'create_lead (Super Admin): actor_profile_id NULL na timeline');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead' and entity_id = (select id::text from t_created_sa) and action = 'lead_created'),
  1, 'create_lead (Super Admin): audit_log continua registrando a autoria real, sem duplicar');

-- Falha (Seller tentando atribuir outro vendedor): nenhuma timeline.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.create_lead('Nunca Deveria Existir', '(11) 91111-0004', 'Onix', 'e7b2b1-seller-2')$$,
  'forbidden', 'Seller não pode criar lead atribuído a outro vendedor');
reset role;
select is(
  (select count(*)::int from public.lead_timeline_entries where label = 'Lead criado'),
  3, 'create_lead (forbidden): total de entradas "Lead criado" continua exatamente 3 (as 3 chamadas bem-sucedidas) — a tentativa recusada não criou uma quarta');

-- ═══════════════════════════════════════════════════════════════════════
-- B. UPDATE_LEAD
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.update_lead('e7500000-0000-0000-0000-000000000001', 1, 'Update OK Novo Nome', '(11) 90000-9001', 'Golf')$$,
  'update_lead (Manager): sucesso');
reset role;

select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000001'), 1,
  'update_lead: exatamente 1 entrada de timeline');
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000001'),
  'Dados do lead atualizados', 'update_lead: texto genérico sanitizado');
select ok(
  (select detail is null from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000001'),
  'update_lead: detail nulo (nunca telefone antes/depois)');
select is(
  (select count(*)::int from public.lead_timeline_entries
    where lead_id = 'e7500000-0000-0000-0000-000000000001' and (detail ilike '%90000%' or label ilike '%90000%')),
  0, 'update_lead: telefone nunca aparece na timeline');

-- stale_write: nenhuma entrada.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.update_lead('e7500000-0000-0000-0000-000000000002', 99, 'X', '(11) 1', 'Y')$$,
  'stale_write', 'update_lead: expectedVersion errado falha');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000002'), 0,
  'update_lead (stale_write): nenhuma entrada criada');

-- forbidden (Seller tentando atualizar lead de outro vendedor): nenhuma entrada.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.update_lead('e7500000-0000-0000-0000-000000000003', 1, 'X', '(11) 1', 'Y')$$,
  'forbidden', 'update_lead: Seller não atualiza lead de outro vendedor');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000003'), 0,
  'update_lead (forbidden): nenhuma entrada criada');

-- cross-tenant: Manager da empresa A não alcança lead da empresa B.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.update_lead('e7500000-0000-0000-0000-000000000018', 1, 'X', '(11) 1', 'Y')$$,
  'lead_not_found', 'update_lead: cross-tenant nunca encontra o lead de outra empresa');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000018'), 0,
  'update_lead (cross-tenant): nenhuma entrada criada na empresa B');

-- ═══════════════════════════════════════════════════════════════════════
-- C. MOVE_LEAD_TO_STAGE
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.move_lead_to_stage('e7500000-0000-0000-0000-000000000004', 'e7300000-0000-0000-0000-000000000002')$$,
  'move_lead_to_stage (Manager): sucesso, Novo -> Qualificado');
reset role;

select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000004'), 1,
  'move_lead_to_stage: exatamente 1 entrada');
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000004'),
  'Etapa alterada', 'move_lead_to_stage: label sanitizado');
select is((select detail from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000004'),
  'De Novo para Qualificado', 'move_lead_to_stage: detail com nomes humanos das etapas');
select is(
  (select count(*)::int from public.lead_timeline_entries
    where lead_id = 'e7500000-0000-0000-0000-000000000004'
      and (detail ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')),
  0, 'move_lead_to_stage: nenhum UUID no detail');

-- move para a MESMA etapa: nenhuma entrada nova.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.move_lead_to_stage('e7500000-0000-0000-0000-000000000005', 'e7300000-0000-0000-0000-000000000002')$$,
  'move_lead_to_stage: mover para a mesma etapa não falha (last-write-wins)');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000005'), 0,
  'move_lead_to_stage (mesma etapa): nenhuma entrada de timeline criada');

-- stage_not_found: nenhuma entrada.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.move_lead_to_stage('e7500000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000009999')$$,
  'stage_not_found', 'move_lead_to_stage: etapa inexistente falha');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000006'), 0,
  'move_lead_to_stage (stage_not_found): nenhuma entrada criada');

-- stale_write: nenhuma entrada.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.move_lead_to_stage('e7500000-0000-0000-0000-000000000007', 'e7300000-0000-0000-0000-000000000002', 99)$$,
  'stale_write', 'move_lead_to_stage: expectedVersion errado falha');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000007'), 0,
  'move_lead_to_stage (stale_write): nenhuma entrada criada');

-- ═══════════════════════════════════════════════════════════════════════
-- D. APPLY_LEAD_EVENT
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.apply_lead_event('e7500000-0000-0000-0000-000000000008', 'call_outcome_visit')$$,
  'apply_lead_event (call_outcome_visit): sucesso');
reset role;

select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000008'), 1,
  'apply_lead_event: exatamente 1 entrada');
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000008'),
  'Ligação registrada', 'apply_lead_event (call_outcome_visit): label sanitizado');
select is(
  (select count(*)::int from public.lead_timeline_entries
    where lead_id = 'e7500000-0000-0000-0000-000000000008'
      and (label ilike '%call_outcome%' or detail ilike '%call_outcome%')),
  0, 'apply_lead_event: código bruto do enum nunca aparece no texto');

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.apply_lead_event('e7500000-0000-0000-0000-000000000009', 'sale_registered')$$,
  'apply_lead_event (sale_registered): sucesso');
reset role;
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000009'),
  'Venda registrada', 'apply_lead_event (sale_registered): label distinto e sanitizado');

-- lead_archived: nenhuma entrada.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.apply_lead_event('e7500000-0000-0000-0000-000000000010', 'call_outcome_visit')$$,
  'lead_archived', 'apply_lead_event: lead arquivado falha');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000010'), 0,
  'apply_lead_event (lead_archived): nenhuma entrada criada');

-- ═══════════════════════════════════════════════════════════════════════
-- E. ASSIGN_LEAD_SELLER / REMOÇÃO
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.assign_lead_seller('e7500000-0000-0000-0000-000000000011', 'e7b2b1-seller-1', 1)$$,
  'assign_lead_seller: atribuição nova, sucesso');
reset role;

select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000011'), 1,
  'assign_lead_seller (atribuição): exatamente 1 entrada');
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000011'),
  'Responsável alterado', 'assign_lead_seller: label sanitizado');
select is((select detail from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000011'),
  'Atribuído a Vendedor Um E7B2B1', 'assign_lead_seller: detail com nome real do vendedor');
select is(
  (select count(*)::int from public.lead_timeline_entries
    where lead_id = 'e7500000-0000-0000-0000-000000000011' and detail ilike '%@%'),
  0, 'assign_lead_seller: nunca contém e-mail');
select is(
  (select count(*)::int from public.lead_timeline_entries
    where lead_id = 'e7500000-0000-0000-0000-000000000011' and detail ~ '[0-9a-f]{8}-[0-9a-f]{4}'),
  0, 'assign_lead_seller: nunca contém UUID');

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.assign_lead_seller('e7500000-0000-0000-0000-000000000012', null, 1)$$,
  'assign_lead_seller: remoção, sucesso');
reset role;
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000012'),
  'Responsável removido', 'assign_lead_seller (remoção): label distinto');
select ok(
  (select detail is null from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000012'),
  'assign_lead_seller (remoção): detail nulo');

-- Reatribuir o MESMO vendedor: nenhuma entrada nova.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.assign_lead_seller('e7500000-0000-0000-0000-000000000013', 'e7b2b1-seller-1', 1)$$,
  'assign_lead_seller: reatribuir o mesmo vendedor não falha (idempotente por valor)');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000013'), 0,
  'assign_lead_seller (no-op, mesmo vendedor): nenhuma entrada criada');

-- seller_not_found: nenhuma entrada.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.assign_lead_seller('e7500000-0000-0000-0000-000000000014', 'nao-existe', 1)$$,
  'seller_not_found', 'assign_lead_seller: vendedor inexistente falha');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000014'), 0,
  'assign_lead_seller (seller_not_found): nenhuma entrada criada');

-- forbidden (Seller nunca chama assign_lead_seller): nenhuma entrada.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.assign_lead_seller('e7500000-0000-0000-0000-000000000017', 'e7b2b1-seller-1', 1)$$,
  'forbidden', 'assign_lead_seller: Seller nunca pode chamar (proibição incondicional)');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000017'), 0,
  'assign_lead_seller (forbidden/Seller): nenhuma entrada criada');

-- ═══════════════════════════════════════════════════════════════════════
-- F. ARCHIVE_LEAD
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.archive_lead('e7500000-0000-0000-0000-000000000015', 1)$$,
  'archive_lead: sucesso');
reset role;

select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000015'), 1,
  'archive_lead: exatamente 1 entrada');
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000015'),
  'Lead arquivado', 'archive_lead: label sanitizado');
select isnt((select archived_at from public.leads where id = 'e7500000-0000-0000-0000-000000000015'), null,
  'archive_lead: o Lead realmente fica arquivado');

-- repetição idempotente: nenhuma entrada NOVA.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.archive_lead('e7500000-0000-0000-0000-000000000015', 1)$$,
  'archive_lead: chamada repetida (idempotente) não falha');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000015'), 1,
  'archive_lead (repetição idempotente): ainda exatamente 1 entrada, nenhuma duplicada');

-- ═══════════════════════════════════════════════════════════════════════
-- G. UNARCHIVE_LEAD
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.unarchive_lead('e7500000-0000-0000-0000-000000000016', 1)$$,
  'unarchive_lead: sucesso');
reset role;

select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000016'), 1,
  'unarchive_lead: exatamente 1 entrada');
select is((select label from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000016'),
  'Lead restaurado', 'unarchive_lead: label sanitizado');
select is((select archived_at from public.leads where id = 'e7500000-0000-0000-0000-000000000016'), null,
  'unarchive_lead: o Lead realmente volta a ativo');

-- repetição idempotente: nenhuma entrada NOVA.
select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.unarchive_lead('e7500000-0000-0000-0000-000000000016', 2)$$,
  'unarchive_lead: chamada repetida (idempotente) não falha');
reset role;
select is((select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000016'), 1,
  'unarchive_lead (repetição idempotente): ainda exatamente 1 entrada, nenhuma duplicada');

-- ═══════════════════════════════════════════════════════════════════════
-- H. ATOMICIDADE / ISOLAMENTO POR EMPRESA
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.lead_timeline_entries where company_id = 'e7000000-0000-0000-0000-000000000002'),
  0, 'nenhuma entrada de timeline vazou para a empresa B a partir de mutations na empresa A');

select is(
  (select count(*)::int from public.lead_timeline_entries t
    where not exists (select 1 from public.leads l where l.id = t.lead_id and l.company_id = t.company_id)),
  0, 'nenhuma entrada de timeline órfã (lead_id sem lead correspondente na mesma empresa)');

-- ═══════════════════════════════════════════════════════════════════════
-- I. RLS/GRANTS revalidados (mesma policy/grants já publicados, intocados)
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'lead_timeline_entries: continua com exatamente 1 policy (nenhuma nova)');

set local role authenticated;
select throws_ok(
  $$insert into public.lead_timeline_entries (company_id, lead_id, icon, color, label)
    values ('e7000000-0000-0000-0000-000000000001', 'e7500000-0000-0000-0000-000000000001', 'i', '#c', 'l')$$,
  '42501', null, 'authenticated: INSERT direto em lead_timeline_entries continua negado (sem GRANT)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- J. NOTA MANUAL (add_lead_timeline_entry) — continua funcionando
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e7100000-0000-0000-0000-000000000001');
set local role authenticated;
create temp table t_manual as
  select * from public.add_lead_timeline_entry('e7500000-0000-0000-0000-000000000001', 'message', 'Observação adicionada', '#3B82F6', 'nota manual e7b2b1');
reset role;
select is((select label from t_manual), 'Observação adicionada', 'add_lead_timeline_entry (nota manual) continua funcionando após a migration');
select is(
  (select count(*)::int from public.lead_timeline_entries where lead_id = 'e7500000-0000-0000-0000-000000000001'),
  2, 'lead com update automático (1) + nota manual (1) = 2 entradas, sem interferência mútua');

select * from finish();
rollback;
