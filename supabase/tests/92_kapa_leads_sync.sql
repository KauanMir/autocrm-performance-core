-- KAPA LEADS → CRM (20261111120000_kapa_leads_sync.sql).
-- Vínculo desligado por padrão, cursor sem retroativo, fila idempotente, isolamento entre empresas,
-- associação ao lead existente (inclusive de Meta Lead Ads) e fila de revisão sem PII.
-- Dados fictícios; rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- Monta um item de página do worker.
create or replace function pg_temp.item(p_lead uuid, p_store uuid, p_created timestamptz, p_phone text, p_name text default 'Cliente Teste')
returns jsonb as $$
  select jsonb_build_object(
    'source_lead_id', p_lead,
    'source_campaign_id', 'fd900000-0000-0000-0000-0000000000c1',
    'source_campaign_slug', 'fabrica-de-aprovacao',
    'source_campaign_name', 'Fábrica de Aprovação',
    'source_created_at', p_created,
    'store_id', p_store,
    'payload', jsonb_build_object(
      'contact', jsonb_build_object('name', p_name, 'phone', p_phone, 'email', null),
      'vehicle', null,
      'answers', jsonb_build_array(
        jsonb_build_object('key', 'Campanha', 'values', jsonb_build_array('Fábrica de Aprovação')),
        jsonb_build_object('key', 'utm_source', 'values', jsonb_build_array('instagram'))),
      'source_label', 'Fábrica de Aprovação (KAPA Leads)'))
$$ language sql;

-- ═══ A. catálogo e privilégios ══════════════════════════════════════════
select is(
  (select count(*)::int
     from unnest(array['public.kapa_leads_store_links', 'public.kapa_leads_inbound_events']) t,
          unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(r, t, p)),
  0, 'A1 zero grants diretos nas tabelas novas');
select ok((select relrowsecurity from pg_class where oid = 'public.kapa_leads_store_links'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.kapa_leads_inbound_events'::regclass), 'A2 RLS ligado');

select ok(
  bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('authenticated', f, 'EXECUTE')),
  'A3 RPCs do worker: só service_role')
from unnest(array[
  'public.kapa_leads_links_for_poll()',
  'public.kapa_leads_ingest_page(uuid, timestamptz, uuid, jsonb, timestamptz, uuid)',
  'public.kapa_leads_link_record_failure(uuid, text)',
  'public.kapa_leads_process_pending(integer)',
  'public.kapa_leads_purge_expired()'
]) f;

select ok(
  bool_and(has_function_privilege('authenticated', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('service_role', f, 'EXECUTE')),
  'A4 RPCs de usuário: só authenticated (autorização dentro da função)')
from unnest(array[
  'public.kapa_leads_link_upsert(uuid, uuid, text, text)',
  'public.kapa_leads_link_set_enabled(uuid, uuid, boolean)',
  'public.kapa_leads_sync_health(uuid)',
  'public.kapa_leads_review_list(uuid, integer)',
  'public.kapa_leads_event_requeue(uuid, uuid)',
  'public.kapa_leads_event_dismiss(uuid, uuid, text)',
  'public.list_lead_form_submissions_v2(uuid, uuid)'
]) f;

select ok(
  not has_function_privilege('service_role', 'public._kapa_leads_process_event(public.kapa_leads_inbound_events)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._kapa_leads_process_event(public.kapa_leads_inbound_events)', 'EXECUTE'),
  'A5 processamento interno sem EXECUTE externo');
select is((select count(*)::int from public.kapa_leads_store_links), 0, 'A6 a migration não cria vínculo');

-- ═══ fixtures ═══════════════════════════════════════════════════════════
insert into public.companies (id, name, status) values
  ('fd100000-0000-0000-0000-00000000000a', 'KL Concessionária A', 'ativa'),
  ('fd100000-0000-0000-0000-00000000000b', 'KL Concessionária B', 'ativa'),
  ('fd100000-0000-0000-0000-00000000000c', 'KL Implantação C', 'implantacao');

insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values
  ('fd100000-0000-0000-0000-00000000000a', 'new', 'Novo', 0, false);
-- B sem etapa inicial de propósito (initial_stage_missing).

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'kl-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'kl-seller-a@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'kl-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'kl-super@test.local',     now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('fd200000-0000-0000-0000-000000000001', 'KL Manager A', 'kl-manager-a@test.local', true, null),
  ('fd200000-0000-0000-0000-000000000002', 'KL Seller A',  'kl-seller-a@test.local',  true, null),
  ('fd200000-0000-0000-0000-000000000003', 'KL Manager B', 'kl-manager-b@test.local', true, null),
  ('fd200000-0000-0000-0000-000000000005', 'KL Super',     'kl-super@test.local',     true, 'super_admin');

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('fd300000-0000-0000-0000-000000000001', 'fd100000-0000-0000-0000-00000000000a', 'fd200000-0000-0000-0000-000000000001', 'manager', true),
  ('fd300000-0000-0000-0000-000000000002', 'fd100000-0000-0000-0000-00000000000a', 'fd200000-0000-0000-0000-000000000002', 'seller',  true),
  ('fd300000-0000-0000-0000-000000000003', 'fd100000-0000-0000-0000-00000000000b', 'fd200000-0000-0000-0000-000000000003', 'manager', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('klSellerA', 'fd100000-0000-0000-0000-00000000000a', 'KL Seller A', 'SA', 'fd200000-0000-0000-0000-000000000002', 'fd300000-0000-0000-0000-000000000002', true);

-- ═══ B. vínculo (só Super Admin) ════════════════════════════════════════
select pg_temp.as_user('fd200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select throws_ok($$select * from public.kapa_leads_link_upsert('fd100000-0000-0000-0000-00000000000a', 'fd900000-0000-0000-0000-0000000000a1', 'RCAR')$$,
  '42501', 'forbidden', 'B1 Manager não cria vínculo');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000005'); -- Super Admin
set local role authenticated;
create temp table t_link_a on commit drop as
  select * from public.kapa_leads_link_upsert('fd100000-0000-0000-0000-00000000000a', 'fd900000-0000-0000-0000-0000000000a1', 'RCAR Seminovos');
select is((select enabled from t_link_a), false, 'B2 vínculo nasce desligado');
select throws_ok($$select * from public.kapa_leads_link_upsert('fd100000-0000-0000-0000-00000000000b', 'fd900000-0000-0000-0000-0000000000a1', 'RCAR')$$,
  '23505', 'store_linked_to_other_company', 'B3 a mesma loja nunca alimenta outra empresa');
select throws_ok($$select * from public.kapa_leads_link_upsert('fd100000-0000-0000-0000-00000000000a', 'fd900000-0000-0000-0000-0000000000a9', 'X', '9bad')$$,
  '22023', 'invalid_input', 'B4 chave de veículo inválida');
create temp table t_link_b on commit drop as
  select * from public.kapa_leads_link_upsert('fd100000-0000-0000-0000-00000000000b', 'fd900000-0000-0000-0000-0000000000b1', 'Vitrine Veículos');
create temp table t_link_c on commit drop as
  select * from public.kapa_leads_link_upsert('fd100000-0000-0000-0000-00000000000c', 'fd900000-0000-0000-0000-0000000000c9', 'Implantação');
reset role;
-- tabelas temporárias criadas como authenticated: leitura liberada para o resto do teste
grant select on t_link_a, t_link_b, t_link_c to public;

select is((select (cursor_created_at is null and activated_at is null) from public.kapa_leads_store_links where id = (select link_id from t_link_a)),
  true, 'B5 desligado: sem cursor');

set local role service_role;
select is((select count(*)::int from public.kapa_leads_links_for_poll()), 0, 'B6 nada para consultar enquanto desligado');
reset role;

-- ═══ C. ativação sem retroativo ═════════════════════════════════════════
select pg_temp.as_user('fd200000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok(format($$select * from public.kapa_leads_link_set_enabled('fd100000-0000-0000-0000-00000000000c', %L, true)$$, (select link_id from t_link_c)),
  '23514', 'company_not_active', 'C1 empresa em implantação não liga');
select throws_ok(format($$select * from public.kapa_leads_link_set_enabled('fd100000-0000-0000-0000-00000000000b', %L, true)$$, (select link_id from t_link_a)),
  'P0002', 'link_not_found', 'C2 vínculo de outra empresa → link_not_found');
select is((select cursor_created_at from public.kapa_leads_link_set_enabled('fd100000-0000-0000-0000-00000000000a', (select link_id from t_link_a), true)),
  now(), 'C3 ligar grava o cursor = agora');
select lives_ok(format($$select * from public.kapa_leads_link_set_enabled('fd100000-0000-0000-0000-00000000000b', %L, true)$$, (select link_id from t_link_b)),
  'C4 Super Admin liga B');
reset role;
select is((select cursor_lead_id::text from public.kapa_leads_store_links where id = (select link_id from t_link_a)),
  '00000000-0000-0000-0000-000000000000', 'C5 cursor começa no menor UUID');
select is((select count(*)::int from public.audit_log where action in ('kapa_leads_link_upserted', 'kapa_leads_link_enabled_set')
  and company_id in ('fd100000-0000-0000-0000-00000000000a', 'fd100000-0000-0000-0000-00000000000b', 'fd100000-0000-0000-0000-00000000000c')), 5,
  'C6 auditoria de vínculo e ativação');

set local role service_role;
select is((select count(*)::int from public.kapa_leads_links_for_poll()), 2, 'C7 dois vínculos ligados para consultar');

-- ═══ D. gravação na fila ════════════════════════════════════════════════
select is((select out_outcome from public.kapa_leads_ingest_page(
  (select link_id from t_link_a), now() - interval '1 day', '00000000-0000-0000-0000-000000000000', '[]'::jsonb, null, null)),
  'cursor_conflict', 'D1 cursor esperado diferente → cursor_conflict (nada gravado)');

select throws_ok(format($$select * from public.kapa_leads_ingest_page(%L, now(), '00000000-0000-0000-0000-000000000000', %L::jsonb, now() + interval '1 second', 'fd800000-0000-0000-0000-000000000001')$$,
  (select link_id from t_link_a),
  jsonb_build_array(pg_temp.item('fd800000-0000-0000-0000-000000000001', 'fd900000-0000-0000-0000-0000000000b1', now() + interval '1 second', '62900000001'))),
  '22023', 'store_mismatch', 'D2 item de outra loja recusa a página inteira');

select throws_ok(format($$select * from public.kapa_leads_ingest_page(%L, now(), '00000000-0000-0000-0000-000000000000', %L::jsonb, now() + interval '1 second', 'fd800000-0000-0000-0000-000000000001')$$,
  (select link_id from t_link_a),
  jsonb_build_array(pg_temp.item('fd800000-0000-0000-0000-000000000001', 'fd900000-0000-0000-0000-0000000000a1', now() - interval '1 hour', '62900000001'))),
  '22023', 'item_before_cursor', 'D3 lead anterior à ativação nunca entra (sem retroativo)');

select is(
  (select row(out_outcome, out_inserted, out_duplicates, out_invalid)::text from public.kapa_leads_ingest_page(
    (select link_id from t_link_a), now(), '00000000-0000-0000-0000-000000000000',
    jsonb_build_array(
      pg_temp.item('fd800000-0000-0000-0000-000000000001', 'fd900000-0000-0000-0000-0000000000a1', now() + interval '1 second', '62900000001', 'Ana Teste'),
      pg_temp.item('fd800000-0000-0000-0000-000000000002', 'fd900000-0000-0000-0000-0000000000a1', now() + interval '2 seconds', '12345', 'Telefone Ruim'),
      pg_temp.item('fd800000-0000-0000-0000-000000000003', 'fd900000-0000-0000-0000-0000000000a1', now() + interval '3 seconds', '62900000001', 'Ana Teste')),
    now() + interval '3 seconds', 'fd800000-0000-0000-0000-000000000003')),
  '(ok,2,0,1)', 'D4 página gravada: 2 válidos, 1 inválido');
reset role;

select is((select status || ':' || last_error_code from public.kapa_leads_inbound_events where source_lead_id = 'fd800000-0000-0000-0000-000000000002'),
  'failed:invalid_payload', 'D5 inválido fica visível como falha (nunca descartado)');
select is((select payload from public.kapa_leads_inbound_events where source_lead_id = 'fd800000-0000-0000-0000-000000000002'),
  '{}'::jsonb, 'D6 payload inválido não é guardado');

set local role service_role;
-- Repetir a mesma página (ex.: resposta perdida) não duplica: o item já está no cursor e é recusado.
select throws_ok(format($$select * from public.kapa_leads_ingest_page(%L, now() + interval '3 seconds', 'fd800000-0000-0000-0000-000000000003', %L::jsonb, now() + interval '3 seconds', 'fd800000-0000-0000-0000-000000000009')$$,
  (select link_id from t_link_a),
  jsonb_build_array(pg_temp.item('fd800000-0000-0000-0000-000000000003', 'fd900000-0000-0000-0000-0000000000a1', now() + interval '3 seconds', '62900000001'))),
  '22023', 'item_before_cursor', 'D7 item já no cursor é recusado (sem reprocessar)');
reset role;
select is((select count(*)::int from public.kapa_leads_inbound_events where link_id = (select link_id from t_link_a)), 3, 'D8 fila com 3 eventos, sem duplicata');
select is((select cursor_lead_id::text from public.kapa_leads_store_links where id = (select link_id from t_link_a)),
  'fd800000-0000-0000-0000-000000000003', 'D9 cursor avançou para o último item');

create temp table t_cur_b on commit drop as
  select cursor_created_at from public.kapa_leads_store_links where id = (select link_id from t_link_b);
grant select on t_cur_b to public;
-- Outro vínculo pode reenviar o mesmo source_lead_id? A unicidade é global: nunca dois.
set local role service_role;
select is(
  (select out_duplicates from public.kapa_leads_ingest_page(
    (select link_id from t_link_b), (select cursor_created_at from t_cur_b),
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_array(pg_temp.item('fd800000-0000-0000-0000-000000000001', 'fd900000-0000-0000-0000-0000000000b1', now() + interval '1 second', '62900000009')),
    now() + interval '1 second', 'fd800000-0000-0000-0000-000000000001')),
  1, 'D10 mesmo lead de origem nunca entra duas vezes');

-- ═══ E. processamento ═══════════════════════════════════════════════════
select is((select row(out_status, out_created, out_linked, out_retry, out_failed, out_held)::text from public.kapa_leads_process_pending(25)),
  '(ok,1,1,0,0,0)', 'E1 primeiro cria, segundo (mesmo telefone) associa');
reset role;

select is((select count(*)::int from public.leads where company_id = 'fd100000-0000-0000-0000-00000000000a' and phone_digits = '62900000001'),
  1, 'E2 um único lead para o contato');
select is((select row(l.seller_id is null, l.source, l.car, ps.code)::text
             from public.leads l join public.pipeline_stages ps on ps.id = l.stage_id
            where l.company_id = 'fd100000-0000-0000-0000-00000000000a' and l.phone_digits = '62900000001'),
  '(t,"Fábrica de Aprovação (KAPA Leads)","Não informado",new)', 'E3 sem vendedor, etapa inicial, origem da campanha');
select is((select count(*)::int from public.lead_form_submissions s
            where s.company_id = 'fd100000-0000-0000-0000-00000000000a' and s.source = 'kapa_leads'), 2,
  'E4 as duas simulações ficam registradas no lead');
select is((select string_agg(outcome, ',' order by outcome) from public.lead_form_submissions where source = 'kapa_leads'
            and company_id = 'fd100000-0000-0000-0000-00000000000a'), 'created,linked_existing', 'E5 resultados registrados');
select is((select count(*)::int from public.kapa_leads_inbound_events where status = 'processed' and payload <> '{}'::jsonb), 0,
  'E6 processado não guarda PII na fila');
select ok(exists (select 1 from public.lead_timeline_entries t
                   join public.leads l on l.id = t.lead_id
                  where l.company_id = 'fd100000-0000-0000-0000-00000000000a' and t.label like 'Nova simulação recebida:%'),
  'E7 linha do tempo registra a nova simulação');

-- ═══ F. associação com lead de outra origem (ex.: Meta Lead Ads) e ambiguidade ═══
insert into public.leads (id, company_id, name, phone, car, stage_id, urgency, last_activity_label, alert_label, source)
select 'fd700000-0000-0000-0000-000000000001', 'fd100000-0000-0000-0000-00000000000a', 'Bruno Meta', '62900000002', 'Onix',
       ps.id, 'red', 'Sem contato ainda', 'Fazer primeiro contato', 'Meta Lead Ads'
  from public.pipeline_stages ps where ps.company_id = 'fd100000-0000-0000-0000-00000000000a' and ps.code = 'new';

set local role service_role;
select is((select out_inserted from public.kapa_leads_ingest_page(
  (select link_id from t_link_a), now() + interval '3 seconds', 'fd800000-0000-0000-0000-000000000003',
  jsonb_build_array(pg_temp.item('fd800000-0000-0000-0000-000000000004', 'fd900000-0000-0000-0000-0000000000a1', now() + interval '4 seconds', '62900000002', 'Bruno Simulador')),
  now() + interval '4 seconds', 'fd800000-0000-0000-0000-000000000004')), 1, 'F1 simulação de contato que veio do Meta');
select is((select out_linked from public.kapa_leads_process_pending(25)), 1, 'F2 associada ao lead existente');
reset role;
select is((select row(name, source)::text from public.leads where id = 'fd700000-0000-0000-0000-000000000001'),
  '("Bruno Meta","Meta Lead Ads")', 'F3 cadastro e origem original preservados');
select is((select source_detail from public.lead_form_submissions where lead_id = 'fd700000-0000-0000-0000-000000000001'),
  'Fábrica de Aprovação (KAPA Leads)', 'F4 a nova origem fica no histórico do lead');

-- Dois leads ativos com o mesmo telefone: não escolhe sozinho.
insert into public.leads (company_id, name, phone, car, stage_id, urgency, last_activity_label, alert_label, source)
select 'fd100000-0000-0000-0000-00000000000a', 'Duplicado', '62900000002', 'HB20',
       ps.id, 'red', 'Sem contato ainda', 'Fazer primeiro contato', 'Manual'
  from public.pipeline_stages ps where ps.company_id = 'fd100000-0000-0000-0000-00000000000a' and ps.code = 'new';
set local role service_role;
select is((select out_inserted from public.kapa_leads_ingest_page(
  (select link_id from t_link_a), now() + interval '4 seconds', 'fd800000-0000-0000-0000-000000000004',
  jsonb_build_array(pg_temp.item('fd800000-0000-0000-0000-000000000005', 'fd900000-0000-0000-0000-0000000000a1', now() + interval '5 seconds', '62900000002')),
  now() + interval '5 seconds', 'fd800000-0000-0000-0000-000000000005')), 1, 'F5 nova simulação do telefone duplicado');
select is((select out_failed from public.kapa_leads_process_pending(25)), 1, 'F6 ambiguidade vai para revisão');
reset role;
select is((select status || ':' || last_error_code from public.kapa_leads_inbound_events where source_lead_id = 'fd800000-0000-0000-0000-000000000005'),
  'failed:duplicate_phone_ambiguous', 'F7 motivo registrado');
select ok((select payload <> '{}'::jsonb from public.kapa_leads_inbound_events where source_lead_id = 'fd800000-0000-0000-0000-000000000005'),
  'F8 falha guarda o payload para nova tentativa');

create temp table t_ev on commit drop as select source_lead_id, id from public.kapa_leads_inbound_events;
create temp table t_lead on commit drop as
  select id from public.leads where company_id = 'fd100000-0000-0000-0000-00000000000a' and phone_digits = '62900000001';
grant select on t_ev, t_lead to public;

-- ═══ G. revisão, saúde e isolamento ═════════════════════════════════════
select pg_temp.as_user('fd200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select is((select count(*)::int from public.kapa_leads_review_list('fd100000-0000-0000-0000-00000000000a', 50)), 2,
  'G1 Manager A vê as 2 falhas da própria empresa');
select is((select row(enabled, pending_count, failed_count, processed_7d)::text from public.kapa_leads_sync_health('fd100000-0000-0000-0000-00000000000a')),
  '(t,0,2,3)', 'G2 saúde: 0 pendentes, 2 falhas, 3 processados');
select throws_ok($$select * from public.kapa_leads_sync_health('fd100000-0000-0000-0000-00000000000b')$$, '42501', 'forbidden',
  'G3 Manager A não vê a empresa B');
select is((select out_outcome from public.kapa_leads_event_requeue('fd100000-0000-0000-0000-00000000000a',
  (select id from t_ev where source_lead_id = 'fd800000-0000-0000-0000-000000000002'))),
  'not_requeueable', 'G4 inválido não volta para a fila');
select is((select out_outcome from public.kapa_leads_event_requeue('fd100000-0000-0000-0000-00000000000a',
  (select id from t_ev where source_lead_id = 'fd800000-0000-0000-0000-000000000005'))),
  'requeued', 'G5 Manager devolve a ambiguidade para a fila');
select is((select out_outcome from public.kapa_leads_event_dismiss('fd100000-0000-0000-0000-00000000000a',
  (select id from t_ev where source_lead_id = 'fd800000-0000-0000-0000-000000000002'), 'not_recoverable')),
  'dismissed', 'G6 Manager descarta o inválido, com auditoria');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000003'); -- Manager B
set local role authenticated;
select is((select out_outcome from public.kapa_leads_event_requeue('fd100000-0000-0000-0000-00000000000b',
  (select id from t_ev where source_lead_id = 'fd800000-0000-0000-0000-000000000005'))),
  'not_found', 'G7 Manager B não mexe em evento de A');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select throws_ok($$select * from public.kapa_leads_review_list('fd100000-0000-0000-0000-00000000000a', 50)$$, '42501', 'forbidden',
  'G8 Seller não vê a fila técnica');
reset role;

select is((select count(*)::int from information_schema.routines r
            join information_schema.parameters p on p.specific_name = r.specific_name
           where r.routine_name = 'kapa_leads_review_list' and p.parameter_mode = 'OUT'
             and p.parameter_name ~ '(name|phone|email|payload|contact)' and p.parameter_name <> 'source_campaign_name'), 0,
  'G9 fila de revisão sem colunas de PII');

-- ═══ H. respostas com a origem (v2) e visibilidade ══════════════════════
select pg_temp.as_user('fd200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select is((select string_agg(distinct source || '|' || source_detail, ',') from public.list_lead_form_submissions_v2(
  (select id from t_lead),
  'fd100000-0000-0000-0000-00000000000a')),
  'kapa_leads|Fábrica de Aprovação (KAPA Leads)', 'H1 Manager vê origem e campanha');
reset role;
select pg_temp.as_user('fd200000-0000-0000-0000-000000000003'); -- Manager B
set local role authenticated;
select throws_ok(format($$select * from public.list_lead_form_submissions_v2(%L, 'fd100000-0000-0000-0000-00000000000a')$$,
  (select id from t_lead)),
  null, null, 'H2 Manager B não lê lead de A');
reset role;

-- ═══ I. pausa e falha transitória ═══════════════════════════════════════
select pg_temp.as_user('fd200000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select enabled from public.kapa_leads_link_set_enabled('fd100000-0000-0000-0000-00000000000a', (select link_id from t_link_a), false)),
  false, 'I1 Super Admin pausa A');
reset role;
set local role service_role;
select is((select row(out_held, out_failed)::text from public.kapa_leads_process_pending(25)), '(1,0)', 'I2 pausado: evento retido, não falha');
reset role;
select is((select status || ':' || attempts || ':' || last_error_code from public.kapa_leads_inbound_events
            where source_lead_id = 'fd800000-0000-0000-0000-000000000005'), 'pending:0:link_disabled', 'I3 retido sem contar tentativa');

-- B ligado e sem etapa inicial: nova tentativa com espera crescente.
set local role service_role;
select is((select out_inserted from public.kapa_leads_ingest_page(
  (select link_id from t_link_b), now() + interval '1 second', 'fd800000-0000-0000-0000-000000000001',
  jsonb_build_array(pg_temp.item('fd800000-0000-0000-0000-0000000000b2', 'fd900000-0000-0000-0000-0000000000b1', now() + interval '2 seconds', '62900000003')),
  now() + interval '2 seconds', 'fd800000-0000-0000-0000-0000000000b2')), 1, 'I4 evento de B na fila');
select is((select out_retry from public.kapa_leads_process_pending(25)), 1, 'I5 sem etapa inicial: nova tentativa');
reset role;
select is((select row(status, attempts, last_error_code, next_attempt_at > now())::text from public.kapa_leads_inbound_events
            where source_lead_id = 'fd800000-0000-0000-0000-0000000000b2'), '(pending,1,initial_stage_missing,t)', 'I6 espera antes da próxima tentativa');
select is((select count(*)::int from public.leads where company_id = 'fd100000-0000-0000-0000-00000000000b'), 0, 'I7 nada gravado em B');

-- Falha de consulta ao KAPA Leads: só metadados no vínculo.
set local role service_role;
select lives_ok(format($$select public.kapa_leads_link_record_failure(%L, 'source_timeout')$$, (select link_id from t_link_b)), 'I8 falha registrada');
reset role;
select is((select row(last_error_code, consecutive_failures)::text from public.kapa_leads_store_links where id = (select link_id from t_link_b)),
  '(source_timeout,1)', 'I9 código e contagem de falhas');

-- ═══ J. conferência por contagem ═══════════════════════════════════════
select ok(has_function_privilege('service_role', 'public.kapa_leads_record_reconciliation(uuid, timestamptz, timestamptz, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.kapa_leads_record_reconciliation(uuid, timestamptz, timestamptz, integer)', 'EXECUTE'),
  'J1 conferência: só service_role');
set local role service_role;
select is((select row(out_source_count, out_crm_count)::text from public.kapa_leads_record_reconciliation(
  (select link_id from t_link_a), now(), now() + interval '10 seconds', 6)), '(6,5)', 'J2 conta os eventos recebidos na janela (inclui falhas)');
select throws_ok(format($$select * from public.kapa_leads_record_reconciliation(%L, now(), now() - interval '1 second', 1)$$, (select link_id from t_link_a)),
  '22023', 'invalid_input', 'J3 janela invertida recusada');
reset role;
select pg_temp.as_user('fd200000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select row(reconciled_source_count, reconciled_crm_count)::text from public.kapa_leads_sync_health('fd100000-0000-0000-0000-00000000000a')),
  '(6,5)', 'J4 Manager vê a conferência na saúde');
reset role;

select * from finish();
rollback;
