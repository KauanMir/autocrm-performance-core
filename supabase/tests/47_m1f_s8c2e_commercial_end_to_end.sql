-- M1-F S8-C2-E — auditoria integrada do acesso comercial do Super Admin.
-- Prova o SISTEMA COMPLETO como um único fluxo coerente (não repete as
-- asserções unitárias já cobertas por 41-46): leitura + as 9 RPCs de
-- mutation + resolver + autoria por membership histórica + audit_log
-- sanitizado, todos operando juntos, na ordem real em que o frontend
-- platform os invoca. Roda como postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
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
  ('e1000000-0000-0000-0000-000000000001', 'S8C2E2E Empresa A Ativa', 'ativa'),
  ('e1000000-0000-0000-0000-000000000002', 'S8C2E2E Empresa B Ativa (outra)', 'ativa'),
  ('e1000000-0000-0000-0000-000000000003', 'S8C2E2E Empresa C Implantacao', 'implantacao'),
  ('e1000000-0000-0000-0000-000000000004', 'S8C2E2E Empresa D Suspensa', 'suspensa'),
  ('e1000000-0000-0000-0000-000000000005', 'S8C2E2E Empresa E Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e2e-sa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e2e-mgr-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'e2e-seller-a@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e2000000-0000-0000-0000-000000000001', 'E2E Super Admin', 'e2e-sa@test.local', true, 'super_admin'),
  ('e2000000-0000-0000-0000-000000000002', 'E2E Manager A', 'e2e-mgr-a@test.local', true, null),
  ('e2000000-0000-0000-0000-000000000003', 'E2E Seller A', 'e2e-seller-a@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', 'manager', true, 'active'),
  ('e3000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', 'seller', true, 'active');

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('e8SellerA', 'e1000000-0000-0000-0000-000000000001', 'E2E Seller A', 'E2E-A', 'e2000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003', true),
  ('e8SellerB', 'e1000000-0000-0000-0000-000000000002', 'E2E Seller B', 'E2E-B', null, null, true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('e4000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'qualified', 'Qualificado', 1),
  ('e4000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('e4000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000003', 'new', 'Novo', 0),
  ('e4000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000004', 'new', 'Novo', 0),
  ('e4000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000005', 'new', 'Novo', 0);

-- ═══════════════════════════════════════════════════════════════════════
-- FLUXO FELIZ COMPLETO — SUPER ADMIN, EMPRESA A (ATIVA)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e2000000-0000-0000-0000-000000000001');
set local role authenticated;

select is(
  (select count(*)::int from public.list_commercial_companies() where id::text like 'e1000000%'),
  5, 'SA le as 5 empresas do fluxo, incluindo suspensa/cancelada');
select is(
  (select count(*)::int from public.list_pipeline_stages_for_company('e1000000-0000-0000-0000-000000000001')),
  2, 'SA le as Stages reais da empresa A');
select is(
  (select count(*)::int from public.list_platform_sellers_for_company('e1000000-0000-0000-0000-000000000001')),
  1, 'SA le os Sellers operacionais reais da empresa A');

create temp table t_created as
  select * from public.create_lead('E2E Cliente', '(11) 90000-8001', 'HB20', null, null, null, null, 'e1000000-0000-0000-0000-000000000001');
select is((select created_by_profile_id from t_created), null, 'SA create: created_by_profile_id null');
select is((select updated_by_profile_id from t_created), null, 'SA create: updated_by_profile_id null');

select is(
  (select status from public.check_lead_phone_duplicate('(11) 90000-8001', 'e1000000-0000-0000-0000-000000000001')),
  'accessible', 'duplicidade encontra o Lead recem-criado');

create temp table t_updated as
  select * from public.update_lead((select id from t_created), 1, 'E2E Cliente Editado', '(11) 90000-8001', 'HB20', null, null, null, 'e1000000-0000-0000-0000-000000000001');
select is((select version from t_updated), 2, 'SA update: version 2');

create temp table t_moved as
  select * from public.move_lead_to_stage((select id from t_created), 'e4000000-0000-0000-0000-000000000002', null, 'e1000000-0000-0000-0000-000000000001');
select is((select stage_id from t_moved), 'e4000000-0000-0000-0000-000000000002'::uuid, 'SA move: nova etapa aplicada');

create temp table t_assigned as
  select * from public.assign_lead_seller((select id from t_created), 'e8SellerA', (select version from t_moved), 'e1000000-0000-0000-0000-000000000001');
select is((select seller_id from t_assigned), 'e8SellerA', 'SA assign: seller real atribuido');

create temp table t_event as
  select * from public.apply_lead_event((select id from t_created), 'visit_confirmed', 'e1000000-0000-0000-0000-000000000001');
select is((select urgency from t_event), 'green'::public.lead_urgency, 'SA event: mapeamento aplicado');

create temp table t_timeline as
  select * from public.add_lead_timeline_entry((select id from t_created), 'message', 'Nota E2E', '#3B82F6', 'detalhe operacional', 'e1000000-0000-0000-0000-000000000001');
select is((select actor_profile_id from t_timeline), null, 'SA timeline: actor_profile_id null');

create temp table t_archived as
  select * from public.archive_lead((select id from t_created), (select version from t_event), 'e1000000-0000-0000-0000-000000000001');
select ok((select archived_at from t_archived) is not null, 'SA archive: arquivado');
select is(
  (select count(*)::int from public.list_platform_leads_for_company('e1000000-0000-0000-0000-000000000001', true) where id = (select id from t_created)),
  1, 'lead arquivado aparece na lista archived=true');
select is(
  (select count(*)::int from public.list_platform_leads_for_company('e1000000-0000-0000-0000-000000000001', false) where id = (select id from t_created)),
  0, 'lead arquivado some da lista archived=false');

create temp table t_unarchived as
  select * from public.unarchive_lead((select id from t_created), (select version from t_archived), 'e1000000-0000-0000-0000-000000000001');
select is((select archived_at from t_unarchived), null::timestamptz, 'SA unarchive: restaurado');
select is(
  (select count(*)::int from public.list_platform_leads_for_company('e1000000-0000-0000-0000-000000000001', false) where id = (select id from t_created)),
  1, 'lead restaurado volta para a lista archived=false');

reset role;

-- audit_log do fluxo completo: exatamente as 7 mutations de Super Admin
-- (create/update/move/assign/event/archive/unarchive) + 1 timeline,
-- todas com ator real e sem PII.
select is(
  (select count(*)::int from public.audit_log where company_id = 'e1000000-0000-0000-0000-000000000001'
    and entity_id = (select id::text from t_created)),
  7, 'audit_log: exatamente 7 acoes na entidade lead (create/update/move/assign/event/archive/unarchive)');
select is(
  (select count(*)::int from public.audit_log where entity_type = 'lead_timeline_entry'
    and (after_data->>'lead_id')::uuid = (select id from t_created)),
  1, 'audit_log: exatamente 1 acao de timeline');
select is(
  (select count(*)::int from public.audit_log
    where company_id = 'e1000000-0000-0000-0000-000000000001'
      and entity_id = (select id::text from t_created)
      and actor_profile_id <> 'e2000000-0000-0000-0000-000000000001'),
  0, 'audit_log: todo ator registrado e o Super Admin real do fluxo');
select is(
  (select count(*)::int from public.audit_log al
    where (al.entity_id = (select id::text from t_created) or al.entity_type = 'lead_timeline_entry')
      and (al.before_data::text ilike '%90000-8001%' or al.after_data::text ilike '%90000-8001%'
        or al.before_data::text ilike '%E2E Cliente%' or al.after_data::text ilike '%E2E Cliente%'
        or al.before_data::text ilike '%Nota E2E%' or al.after_data::text ilike '%Nota E2E%'
        or al.before_data::text ilike '%detalhe operacional%' or al.after_data::text ilike '%detalhe operacional%')),
  0, 'audit_log: nenhuma ocorrencia do telefone/nome/conteudo real da timeline em nenhuma acao do fluxo');

-- ═══════════════════════════════════════════════════════════════════════
-- CROSS-COMPANY — SA tentando usar entidades de A em B (falha fechada)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e2000000-0000-0000-0000-000000000001');
set local role authenticated;

select throws_ok(
  format($$select public.move_lead_to_stage(%L, 'e4000000-0000-0000-0000-000000000003', null, 'e1000000-0000-0000-0000-000000000002')$$, (select id from t_created)),
  'lead_not_found', 'lead de A operado com p_company_id=B: lead_not_found, nunca vazando a empresa real');
select throws_ok(
  format($$select public.move_lead_to_stage(%L, 'e4000000-0000-0000-0000-000000000003', null, 'e1000000-0000-0000-0000-000000000001')$$, (select id from t_created)),
  'stage_not_found', 'stage de B usado em A: stage_not_found');
select throws_ok(
  format($$select public.assign_lead_seller(%L, 'e8SellerB', %s, 'e1000000-0000-0000-0000-000000000001')$$, (select id from t_created), (select version from t_unarchived)),
  'seller_not_found', 'seller de B usado em A: seller_not_found');
select throws_ok(
  format($$select public.add_lead_timeline_entry(%L, 'i', 'l', '#c', null, 'e1000000-0000-0000-0000-000000000002')$$, (select id from t_created)),
  'lead_not_found', 'timeline de lead de A em B: lead_not_found');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- MATRIZ DE STATUS — SA em implantacao/suspensa/cancelada
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e2000000-0000-0000-0000-000000000001');
set local role authenticated;

select lives_ok(
  $$select public.create_lead('E2E C', '(11) 90000-8002', 'Onix', null, null, null, null, 'e1000000-0000-0000-0000-000000000003')$$,
  'SA cria em empresa implantacao: permitido');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', null, null, null, null, 'e1000000-0000-0000-0000-000000000004')$$,
  'company_read_only', 'SA nega mutation em empresa suspensa');
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C', null, null, null, null, 'e1000000-0000-0000-0000-000000000005')$$,
  'company_read_only', 'SA nega mutation em empresa cancelada');
select lives_ok(
  $$select count(*) from public.list_platform_leads_for_company('e1000000-0000-0000-0000-000000000004', false)$$,
  'SA le historico de empresa suspensa');
select lives_ok(
  $$select count(*) from public.list_platform_leads_for_company('e1000000-0000-0000-0000-000000000005', false)$$,
  'SA le historico de empresa cancelada');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- MANAGER — membership decide, p_company_id do cliente e ignorado
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e2000000-0000-0000-0000-000000000002');
set local role authenticated;

create temp table t_mgr_lead as
  select * from public.create_lead('E2E Mgr Cliente', '(11) 90000-8003', 'Civic');
select is((select company_id from t_mgr_lead), 'e1000000-0000-0000-0000-000000000001'::uuid, 'Manager cria na propria empresa (membership)');
select is((select created_by_profile_id from t_mgr_lead), 'e2000000-0000-0000-0000-000000000002'::uuid, 'Manager: autoria real preservada');

create temp table t_mgr_moved as
  select * from public.move_lead_to_stage((select id from t_mgr_lead), 'e4000000-0000-0000-0000-000000000002', null, 'e1000000-0000-0000-0000-000000000002');
select is((select stage_id from t_mgr_moved), 'e4000000-0000-0000-0000-000000000002'::uuid,
  'Manager move mesmo enviando p_company_id de OUTRA empresa (B) — parametro ignorado, opera na propria (A)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SELLER — somente o proprio Lead; assign/archive sempre forbidden
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('e2000000-0000-0000-0000-000000000003');
set local role authenticated;

create temp table t_seller_lead as
  select * from public.create_lead('E2E Seller Cliente', '(11) 90000-8004', 'Kicks');
select is((select seller_id from t_seller_lead), 'e8SellerA', 'Seller: autoatribuido na criacao');

select throws_ok(
  format($$select public.assign_lead_seller(%L, 'e8SellerA', 1)$$, (select id from t_seller_lead)),
  'forbidden', 'Seller nunca executa assign, mesmo no proprio Lead');
select throws_ok(
  format($$select public.archive_lead(%L, 1)$$, (select id from t_seller_lead)),
  'forbidden', 'Seller nunca arquiva, mesmo o proprio Lead');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ATOMICIDADE — nenhuma entidade orfa em todo o fluxo integrado
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.lead_timeline_entries t where not exists (select 1 from public.leads l where l.id = t.lead_id)),
  0, 'nenhuma timeline orfa apos o fluxo integrado completo');
select is(
  (select count(*)::int from public.audit_log al
    where al.entity_type = 'lead' and not exists (select 1 from public.leads l where l.id::text = al.entity_id)),
  0, 'nenhum audit_log orfao (entity_type=lead) apos o fluxo integrado completo');
select is(
  (select count(*)::int from public.audit_log al
    where al.entity_type = 'lead_timeline_entry' and not exists (select 1 from public.lead_timeline_entries t where t.id::text = al.entity_id)),
  0, 'nenhum audit_log orfao (entity_type=lead_timeline_entry) apos o fluxo integrado completo');

select * from finish();
rollback;
