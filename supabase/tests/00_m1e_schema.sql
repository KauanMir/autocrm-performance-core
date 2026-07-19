-- M1-E E1 — testes de schema/constraints de leads e timeline (pgTAP).
-- Roda como postgres dentro de uma transação com rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── enums: existência e valores exatos ──────────────────────────────────
select has_enum('public', 'lead_urgency'::name);
select enum_has_labels('public', 'lead_urgency', array['red','amber','green']);
select has_enum('public', 'lead_temperature'::name);
select enum_has_labels('public', 'lead_temperature', array['hot','warm','cold']);
select has_enum('public', 'lead_event_type'::name);
select enum_has_labels('public', 'lead_event_type', array[
  'call_outcome_visit','call_outcome_proposal','call_outcome_callback','call_outcome_no_answer',
  'visit_scheduled_complete','visit_scheduled_incomplete','visit_confirmed','visit_canceled',
  'visit_rescheduled','deal_created_needs_approval','deal_created_direct','deal_approved',
  'deal_rejected','sale_registered','sale_canceled','visit_result_done','visit_result_thinking',
  'visit_result_no_interest']);
select has_enum('public', 'lead_duplicate_status'::name);
select enum_has_labels('public', 'lead_duplicate_status', array['none','accessible','restricted']);

-- ── tabelas e colunas essenciais ────────────────────────────────────────
select has_table('public'::name, 'leads'::name);
select has_table('public'::name, 'lead_timeline_entries'::name);
select col_type_is('public'::name, 'leads'::name, 'version'::name, 'integer');
select col_type_is('public'::name, 'leads'::name, 'seller_id'::name, 'text');
select col_type_is('public'::name, 'leads'::name, 'stage_id'::name, 'uuid');
select col_type_is('public'::name, 'leads'::name, 'value_amount'::name, 'numeric(12,2)');
select col_type_is('public'::name, 'leads'::name, 'phone_digits'::name, 'text');
select col_not_null('public'::name, 'leads'::name, 'company_id'::name);
select col_not_null('public'::name, 'leads'::name, 'stage_id'::name);
select col_is_null('public'::name, 'leads'::name, 'seller_id'::name);
select col_is_null('public'::name, 'leads'::name, 'value_amount'::name);
select col_default_is('public'::name, 'leads'::name, 'version'::name, '1'::text, 'version default 1');
select hasnt_column('public'::name, 'lead_timeline_entries'::name, 'updated_at'::name);
select col_not_null('public'::name, 'lead_timeline_entries'::name, 'company_id'::name);
select col_is_null('public'::name, 'lead_timeline_entries'::name, 'actor_profile_id'::name);

-- ── índices ─────────────────────────────────────────────────────────────
select has_index('public'::name, 'leads'::name, 'leads_company_active_idx'::name);
select has_index('public'::name, 'leads'::name, 'leads_company_stage_idx'::name);
select has_index('public'::name, 'leads'::name, 'leads_company_seller_idx'::name);
select has_index('public'::name, 'leads'::name, 'leads_company_phone_digits_idx'::name);
select has_index('public'::name, 'lead_timeline_entries'::name, 'lead_timeline_lead_id_idx'::name);
select has_index('public'::name, 'lead_timeline_entries'::name, 'lead_timeline_company_id_idx'::name);

-- ── unique composta (alvo de FKs futuras) ───────────────────────────────
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.leads'::regclass and contype = 'u'
    and conkey::int[] = array[
      (select attnum::int from pg_attribute where attrelid='public.leads'::regclass and attname='company_id'),
      (select attnum::int from pg_attribute where attrelid='public.leads'::regclass and attname='id')]
), 'unique (company_id, id) existe em leads');

-- ── fixtures (empresa B para testes de FK cruzada) ──────────────────────
insert into public.companies (id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B Teste');
insert into public.pipeline_stages (id, company_id, code, name, sort_order, is_terminal)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'new', 'Novo', 0, false);
insert into public.sellers (id, company_id, name, first_name)
  values ('sB1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Vendedor B', 'Vend');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', 'b1111111-1111-1111-1111-111111111111',
          'authenticated', 'authenticated', 'adminb@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role)
  values ('b1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'Admin B', 'adminb@test.local', 'admin');

-- ── lead válido: defaults, generated column e triggers ──────────────────
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
        'Teste Schema', '(11) 91234-5678', 'Carro X',
        (select id from public.pipeline_stages
          where company_id = '00000000-0000-0000-0000-000000000001' and code = 'new'), 's4');

select is((select phone_digits from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11912345678', 'phone_digits normalizado da mascara');
select is((select urgency::text from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'red', 'urgency default red');
select is((select version from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'version default 1');

update public.leads set name = 'Teste Schema 2' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select version from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2, 'trigger incrementa version em UPDATE');

update public.leads set version = 99 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select version from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  3, 'trigger ignora version enviada e usa old+1');

-- ── checks ──────────────────────────────────────────────────────────────
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id)
  values ('00000000-0000-0000-0000-000000000001', 'X', '---', 'C',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'))$$,
  '23514', null, 'telefone sem digitos falha (phone_digits check)');
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id)
  values ('00000000-0000-0000-0000-000000000001', '   ', '(11) 9', 'C',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'))$$,
  '23514', null, 'name em branco falha');
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id)
  values ('00000000-0000-0000-0000-000000000001', 'X', '(11) 9', '  ',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'))$$,
  '23514', null, 'car em branco falha');
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id, value_amount)
  values ('00000000-0000-0000-0000-000000000001', 'X', '(11) 9', 'C',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), -1)$$,
  '23514', null, 'value_amount negativo falha');
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id, version)
  values ('00000000-0000-0000-0000-000000000001', 'X', '(11) 9', 'C',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 0)$$,
  '23514', null, 'version 0 falha');

-- ── FKs compostas: referencias cruzadas entre empresas falham ───────────
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id)
  values ('00000000-0000-0000-0000-000000000001', 'X', '(11) 9', 'C',
    'bbbbbbbb-0000-0000-0000-00000000000b')$$,
  '23503', null, 'stage de outra empresa falha');
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id, seller_id)
  values ('00000000-0000-0000-0000-000000000001', 'X', '(11) 9', 'C',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 'sB1')$$,
  '23503', null, 'seller de outra empresa falha');
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id, created_by_profile_id)
  values ('00000000-0000-0000-0000-000000000001', 'X', '(11) 9', 'C',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'),
    'b1111111-1111-1111-1111-111111111111')$$,
  '23503', null, 'profile de outra empresa em created_by falha');

-- ── FK de auditoria: delete do profile anula SOMENTE a coluna de profile ─
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001',
          'authenticated', 'authenticated', 'descartavel@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role)
  values ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
          'Descartavel', 'descartavel@test.local', 'manager');
insert into public.leads (id, company_id, name, phone, car, stage_id, created_by_profile_id, updated_by_profile_id)
values ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
        'Auditoria', '(11) 90000-0002', 'Carro Y',
        (select id from public.pipeline_stages
          where company_id = '00000000-0000-0000-0000-000000000001' and code = 'new'),
        'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001');

delete from public.profiles where id = 'dddddddd-0000-0000-0000-000000000001';

select is((select created_by_profile_id from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null::uuid, 'created_by_profile_id anulado apos delete do profile');
select is((select updated_by_profile_id from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null::uuid, 'updated_by_profile_id anulado apos delete do profile');
select is((select company_id from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000001'::uuid, 'company_id intacto apos delete do profile');

-- ── timeline: FK composta e cascade ─────────────────────────────────────
select throws_ok($$insert into public.lead_timeline_entries (company_id, lead_id, icon, color, label)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-0000-0000-0000-000000000001', 'i', '#fff', 'x')$$,
  '23503', null, 'timeline com company divergente do lead falha');

insert into public.lead_timeline_entries (id, company_id, lead_id, icon, color, label)
values ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'phone', '#27C75F', 'Ligacao');

select throws_ok($$insert into public.lead_timeline_entries (company_id, lead_id, icon, color, label)
  values ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', ' ', '#fff', 'x')$$,
  '23514', null, 'icon em branco falha na timeline');

delete from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.lead_timeline_entries
  where id = 'cccccccc-0000-0000-0000-000000000001'), 0, 'timeline apagada em cascade com o lead');

-- ── RPCs: SECURITY DEFINER e search_path vazio ──────────────────────────
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')), 9, 'as 9 RPCs existem');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')
    and p.prosecdef), 9, 'todas as 9 RPCs sao SECURITY DEFINER');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')
    and p.proconfig @> array['search_path=""']), 9, 'todas as 9 RPCs com search_path vazio');

select * from finish();
rollback;
