-- META-MVP1 — confiabilidade do Lead Ads (20261106100000_meta_leadads_mvp1_reliability.sql).
-- Grants, validade do token, ingestão com conexão em erro, complete v2 atômico,
-- fila de revisão, reprocessamento, mapeamento por formulário e visibilidade
-- das respostas. Dados fictícios; rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ═══ A. catálogo e privilégios ══════════════════════════════════════════
select has_table('public', 'lead_form_submissions', 'lead_form_submissions existe');
select has_table('public', 'meta_lead_form_mappings', 'meta_lead_form_mappings existe');

select ok((select relrowsecurity from pg_class where oid = 'public.lead_form_submissions'::regclass), 'RLS em lead_form_submissions');
select ok((select relrowsecurity from pg_class where oid = 'public.meta_lead_form_mappings'::regclass), 'RLS em meta_lead_form_mappings');

select is(
  (select count(*)::int
     from unnest(array['public.lead_form_submissions', 'public.meta_lead_form_mappings']) t,
          unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(r, t, p)),
  0, 'zero grants diretos nas tabelas novas (acesso só por RPC)');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('meta_connection_upsert_v2', 'meta_connection_mark_error', 'meta_connection_owner_for_ingestion',
                       'meta_connection_lookup_for_processing', 'meta_form_mapping_for_processing',
                       'meta_leadgen_event_complete_v2', 'list_lead_form_submissions', 'meta_connection_health',
                       'meta_leadgen_review_list', 'meta_leadgen_review_summary', 'meta_leadgen_event_requeue',
                       'meta_leadgen_event_dismiss', 'meta_form_mapping_list', 'meta_form_mapping_set',
                       'meta_form_mapping_delete', 'meta_leadgen_event_register')
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  16, 'as 16 funções novas/recriadas são SECURITY DEFINER com search_path vazio');

select ok(
  bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('authenticated', f, 'EXECUTE')),
  'RPCs do processor/callback: só service_role')
from unnest(array[
  'public.meta_connection_upsert_v2(uuid, text, text, text, smallint, text[], timestamptz, uuid, timestamptz, text, timestamptz, timestamptz, timestamptz)',
  'public.meta_connection_mark_error(uuid, text)',
  'public.meta_connection_owner_for_ingestion(text)',
  'public.meta_connection_lookup_for_processing(uuid)',
  'public.meta_form_mapping_for_processing(uuid, text)',
  'public.meta_leadgen_event_complete_v2(uuid, uuid, text, text, jsonb, text, text, text, text, timestamptz)',
  'public.meta_leadgen_event_register(uuid, uuid, text, text, text, timestamptz)'
]) f;

select ok(
  bool_and(has_function_privilege('authenticated', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('service_role', f, 'EXECUTE')),
  'RPCs de revisão/mapeamento/leitura: só authenticated (autorização dentro da função)')
from unnest(array[
  'public.list_lead_form_submissions(uuid, uuid)',
  'public.meta_connection_health(uuid)',
  'public.meta_leadgen_review_list(uuid, integer)',
  'public.meta_leadgen_review_summary(uuid)',
  'public.meta_leadgen_event_requeue(uuid, uuid)',
  'public.meta_leadgen_event_dismiss(uuid, uuid, text)',
  'public.meta_form_mapping_list(uuid)',
  'public.meta_form_mapping_set(uuid, text, text, text)',
  'public.meta_form_mapping_delete(uuid, text, text)'
]) f;

select is(public.meta_leadgen_error_kind('token_expired'), 'operational', 'token_expired é operacional');
select ok(not exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'meta_leadgen_events'
     and column_name ~ '(name|phone|email|field_data|answers|payload)'),
  'ledger continua sem PII');

-- lead_form_answers_valid
select ok(public.lead_form_answers_valid('[{"key":"cor","values":["Prata"]}]'::jsonb), 'respostas válidas');
select ok(public.lead_form_answers_valid('[]'::jsonb), 'lista vazia é válida');
select ok(not public.lead_form_answers_valid('{"key":"x"}'::jsonb), 'objeto solto é inválido');
select ok(not public.lead_form_answers_valid('[{"key":"x","values":[]}]'::jsonb), 'values vazio é inválido');
select ok(not public.lead_form_answers_valid('[{"key":"x","values":[1]}]'::jsonb), 'valor não-texto é inválido');
select ok(not public.lead_form_answers_valid('[{"key":"x","values":["a"],"extra":1}]'::jsonb), 'chave extra é inválida');
select ok(not public.lead_form_answers_valid('[{"values":["a"]}]'::jsonb), 'sem key é inválido');
select ok(not public.lead_form_answers_valid(
  (select jsonb_agg(jsonb_build_object('key', 'k' || g, 'values', jsonb_build_array('v'))) from generate_series(1, 51) g)),
  'mais de 50 respostas é inválido');

-- ═══ fixtures ═══════════════════════════════════════════════════════════
insert into public.companies (id, name, status) values
  ('fd100000-0000-0000-0000-00000000000a', 'MVP1 Empresa A', 'ativa'),
  ('fd100000-0000-0000-0000-00000000000b', 'MVP1 Empresa B', 'ativa');

insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values
  ('fd100000-0000-0000-0000-00000000000a', 'new', 'Novo', 0, false),
  ('fd100000-0000-0000-0000-00000000000b', 'new', 'Novo', 0, false);

-- META-MVP2: a gravação exige a empresa habilitada para Lead Ads.
insert into public.company_meta_lead_ads_access (company_id, enabled) values ('fd100000-0000-0000-0000-00000000000a', true);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mvp1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'mvp1-seller-a@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mvp1-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fd200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'mvp1-super@test.local',     now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('fd200000-0000-0000-0000-000000000001', 'MVP1 Manager A', 'mvp1-manager-a@test.local', true, null),
  ('fd200000-0000-0000-0000-000000000002', 'MVP1 Seller A',  'mvp1-seller-a@test.local',  true, null),
  ('fd200000-0000-0000-0000-000000000003', 'MVP1 Manager B', 'mvp1-manager-b@test.local', true, null),
  ('fd200000-0000-0000-0000-000000000004', 'MVP1 Super',     'mvp1-super@test.local',     true, 'super_admin');

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('fd300000-0000-0000-0000-000000000001', 'fd100000-0000-0000-0000-00000000000a', 'fd200000-0000-0000-0000-000000000001', 'manager', true),
  ('fd300000-0000-0000-0000-000000000002', 'fd100000-0000-0000-0000-00000000000a', 'fd200000-0000-0000-0000-000000000002', 'seller',  true),
  ('fd300000-0000-0000-0000-000000000003', 'fd100000-0000-0000-0000-00000000000b', 'fd200000-0000-0000-0000-000000000003', 'manager', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('mvp1SellerA', 'fd100000-0000-0000-0000-00000000000a', 'MVP1 Seller A', 'S', 'fd200000-0000-0000-0000-000000000002', 'fd300000-0000-0000-0000-000000000002', true);

-- ═══ B. upsert v2 com validade do token (service_role) ═══════════════════
set local role service_role;

select is(
  (select status from public.meta_connection_upsert_v2(
     'fd100000-0000-0000-0000-00000000000a', '950000000009001', 'Pagina MVP1 A', 'fake-ct-mvp1-a', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
     now(), 'fd200000-0000-0000-0000-000000000001', now(),
     p_token_origin => 'exchanged_long_lived', p_token_checked_at => now(), p_token_data_access_expires_at => now() + interval '90 days')),
  'connected', 'upsert v2 com token sem expiração e acesso a dados em 90 dias → connected');

select throws_ok(
  $$select * from public.meta_connection_upsert_v2(
     'fd100000-0000-0000-0000-00000000000a', '950000000009002', 'X', 'fake-ct', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
     now(), null, now(), p_token_origin => 'exchanged_long_lived', p_token_checked_at => now(), p_token_expires_at => now() + interval '2 hours')$$,
  'P0001', 'token_short_lived', 'token que expira em horas nunca é salvo');

select throws_ok(
  $$select * from public.meta_connection_upsert_v2(
     'fd100000-0000-0000-0000-00000000000a', '950000000009002', 'X', 'fake-ct', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
     now(), null, now(), p_token_origin => 'exchanged_long_lived', p_token_checked_at => now(), p_token_data_access_expires_at => now() - interval '1 minute')$$,
  'P0001', 'token_data_access_expired', 'acesso a dados vencido nunca é salvo');

select throws_ok(
  $$select * from public.meta_connection_upsert_v2(
     'fd100000-0000-0000-0000-00000000000a', '950000000009002', 'X', 'fake-ct', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
     now(), null, now(), p_token_origin => 'guess', p_token_checked_at => now())$$,
  'P0001', 'invalid_input', 'origem de token desconhecida → invalid_input');

reset role;

select is(
  (select token_origin || ':' || (token_expires_at is null)::text || ':' || (token_checked_at is not null)::text
     from public.company_meta_integrations where page_id = '950000000009001'),
  'exchanged_long_lived:true:true', 'metadados do token gravados');

-- Conexão da Empresa B, já em erro (usada para isolamento e ingestão em erro).
insert into public.company_meta_integrations
  (id, company_id, page_id, page_name, access_token_ciphertext, token_key_version, granted_scopes, status, connected_at)
values
  ('fda00000-0000-0000-0000-00000000000b', 'fd100000-0000-0000-0000-00000000000b', '950000000009003', 'Pagina MVP1 B',
   'fake-ct-mvp1-b', 1, array['pages_show_list'], 'connected', now());

-- ═══ C. marcação de erro e ingestão com conexão em erro ═════════════════
set local role service_role;
select is((select out_outcome from public.meta_connection_mark_error('fda00000-0000-0000-0000-00000000000b', 'token_invalid')),
  'marked', 'connected → error');
select is((select out_outcome from public.meta_connection_mark_error('fda00000-0000-0000-0000-00000000000b', 'token_invalid')),
  'unchanged', 'segunda marcação não altera nada');
select throws_ok($$select * from public.meta_connection_mark_error('fda00000-0000-0000-0000-00000000000b', 'boom')$$,
  'P0001', 'invalid_input', 'código fora da lista → invalid_input');
select is((select status from public.meta_connection_owner_for_ingestion('950000000009003')), 'error',
  'owner_for_ingestion devolve conexão em erro');
select is((select count(*)::int from public.meta_connection_owner_by_page('950000000009003')), 0,
  'owner_by_page (callback) continua só com connected');
select ok((select out_created from public.meta_leadgen_event_register(
  'fda00000-0000-0000-0000-00000000000b', 'fd100000-0000-0000-0000-00000000000b', '950000000009003', '990000000000901')),
  'register aceita conexão em erro: o lead aguarda reconexão no ledger');
reset role;

select is((select status || ':' || last_error_code from public.company_meta_integrations where id = 'fda00000-0000-0000-0000-00000000000b'),
  'error:token_invalid', 'status e código gravados');
select ok(exists (select 1 from public.audit_log where action = 'meta_connection_marked_error'
                   and entity_id = 'fda00000-0000-0000-0000-00000000000b'), 'marcação auditada');

-- ═══ D. complete v2 ═════════════════════════════════════════════════════
-- Integração A tem id gerado pelo upsert: guardamos em config.
select set_config('mvp1.int_a', (select id::text from public.company_meta_integrations where page_id = '950000000009001'), false);

insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, form_id, status, received_at, next_attempt_at, attempts, lease_token, locked_until)
select v.id::uuid, current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a', '950000000009001',
       v.leadgen, '108600000000001', 'processing', now(), now(), 1, v.lease::uuid, now() + interval '5 minutes'
  from (values
    ('fde00000-0000-0000-0000-000000000001', '990000000000001', 'fd500000-0000-0000-0000-000000000001'),
    ('fde00000-0000-0000-0000-000000000002', '990000000000002', 'fd500000-0000-0000-0000-000000000002'),
    ('fde00000-0000-0000-0000-000000000003', '990000000000003', 'fd500000-0000-0000-0000-000000000003'),
    ('fde00000-0000-0000-0000-000000000004', '990000000000004', 'fd500000-0000-0000-0000-000000000004'),
    ('fde00000-0000-0000-0000-000000000005', '990000000000005', 'fd500000-0000-0000-0000-000000000005')
  ) as v(id, leadgen, lease);

set local role service_role;

-- D1. lead novo sem veículo: car = "Não informado", vehicle_interest NULL.
select results_eq(
  $$select out_outcome from public.meta_leadgen_event_complete_v2(
     'fde00000-0000-0000-0000-000000000001', 'fd500000-0000-0000-0000-000000000001',
     'Cliente MVP1 Um', '61999990901', '[{"key":"forma_pagamento","values":["Financiamento"]}]'::jsonb,
     p_email => 'um@test.local', p_form_id => '108600000000001', p_ad_id => '120000000000001',
     p_submitted_at => '2026-11-05 12:00:00+00')$$,
  $$values ('created'::text)$$, 'D1 created');

-- D2. lead novo com veículo mapeado: car = veículo.
select results_eq(
  $$select out_outcome from public.meta_leadgen_event_complete_v2(
     'fde00000-0000-0000-0000-000000000002', 'fd500000-0000-0000-0000-000000000002',
     'Cliente MVP1 Dois', '61999990902', '[]'::jsonb, p_vehicle => 'Onix 2024')$$,
  $$values ('created'::text)$$, 'D2 created com veículo');

-- D3. mesmo telefone do D1: linked_existing, lead existente NÃO é alterado.
select results_eq(
  $$select out_outcome from public.meta_leadgen_event_complete_v2(
     'fde00000-0000-0000-0000-000000000003', 'fd500000-0000-0000-0000-000000000003',
     'Outro Nome', '61999990901', '[{"key":"cor","values":["Preto"]}]'::jsonb,
     p_email => 'outro@test.local', p_vehicle => 'Tracker')$$,
  $$values ('linked_existing'::text)$$, 'D3 linked_existing pelo mesmo telefone');

-- D4. e-mail que viola a constraint da tabela: a RPC inteira falha e NADA fica gravado.
select throws_ok(
  $$select * from public.meta_leadgen_event_complete_v2(
     'fde00000-0000-0000-0000-000000000004', 'fd500000-0000-0000-0000-000000000004',
     'Cliente MVP1 Quatro', '61999990904', '[]'::jsonb, p_email => 'sem-arroba')$$,
  '23514', null, 'D4 falha na gravação das respostas aborta a transação');

-- D5. respostas inválidas → invalid_input antes de qualquer escrita.
select throws_ok(
  $$select * from public.meta_leadgen_event_complete_v2(
     'fde00000-0000-0000-0000-000000000005', 'fd500000-0000-0000-0000-000000000005',
     'Cliente MVP1 Cinco', '61999990905', '[{"key":"x"}]'::jsonb)$$,
  'P0001', 'invalid_input', 'D5 respostas fora do formato → invalid_input');

-- D6. lease errado → lease_lost, sem escrita.
select results_eq(
  $$select out_outcome from public.meta_leadgen_event_complete_v2(
     'fde00000-0000-0000-0000-000000000005', 'fd500000-0000-0000-0000-0000000000ff',
     'Cliente MVP1 Cinco', '61999990905', '[]'::jsonb)$$,
  $$values ('lease_lost'::text)$$, 'D6 lease errado → lease_lost');

reset role;

select is(
  (select car || '|' || source || '|' || coalesce(seller_id, 'null') from public.leads
    where company_id = 'fd100000-0000-0000-0000-00000000000a' and phone_digits = '61999990901'),
  'Não informado|Meta Lead Ads|null', 'D1 lead: car "Não informado", origem Meta, sem vendedor');
select is(
  (select car from public.leads where company_id = 'fd100000-0000-0000-0000-00000000000a' and phone_digits = '61999990902'),
  'Onix 2024', 'D2 lead: car = veículo do formulário');
select is(
  (select name || '|' || car || '|' || version::text from public.leads
    where company_id = 'fd100000-0000-0000-0000-00000000000a' and phone_digits = '61999990901'),
  'Cliente MVP1 Um|Não informado|1', 'D3 não alterou nome, carro nem versão do lead existente');
select is(
  (select count(*)::int from public.leads where company_id = 'fd100000-0000-0000-0000-00000000000a'
     and phone_digits in ('61999990901', '5561999990901')),
  1, 'D3 não criou segundo lead');
select is(
  (select string_agg(s.outcome || ':' || coalesce(s.vehicle_interest, '-') || ':' || coalesce(s.contact_email, '-'), ',' order by s.created_at, s.outcome)
     from public.lead_form_submissions s
     join public.leads l on l.id = s.lead_id
    where l.phone_digits = '61999990901'),
  'created:-:um@test.local,linked_existing:Tracker:outro@test.local',
  'D1/D3: duas submissões preservadas no mesmo lead, cada uma com seus dados');
select is(
  (select answers from public.lead_form_submissions where meta_event_id = 'fde00000-0000-0000-0000-000000000001'),
  '[{"key":"forma_pagamento","values":["Financiamento"]}]'::jsonb, 'D1 respostas personalizadas preservadas');
select is(
  (select ad_id || '|' || form_id || '|' || to_char(submitted_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.lead_form_submissions
    where meta_event_id = 'fde00000-0000-0000-0000-000000000001'),
  '120000000000001|108600000000001|2026-11-05 12:00', 'D1 metadados do anúncio/formulário preservados');
select ok(exists (
  select 1 from public.lead_timeline_entries t join public.leads l on l.id = t.lead_id
   where l.phone_digits = '61999990901' and t.label = 'Novo formulário Meta recebido'),
  'D3 histórico registra o novo envio');
select is(
  (select string_agg(status, ',' order by id) from public.meta_leadgen_events
    where id in ('fde00000-0000-0000-0000-000000000001', 'fde00000-0000-0000-0000-000000000002', 'fde00000-0000-0000-0000-000000000003')),
  'processed,processed,processed', 'D1–D3 eventos processed');
select is(
  (select status || ':' || (lease_token is not null)::text from public.meta_leadgen_events where id = 'fde00000-0000-0000-0000-000000000004'),
  'processing:true', 'D4 evento NÃO virou processed: continua processing com o lease');
select is((select count(*)::int from public.leads where phone_digits = '61999990904'), 0, 'D4 nenhum lead órfão');
select is((select count(*)::int from public.lead_form_submissions where meta_event_id = 'fde00000-0000-0000-0000-000000000004'), 0,
  'D4 nenhuma submissão órfã');

-- ═══ E. fila de revisão, reprocessamento e encerramento ═════════════════
insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, status, received_at, next_attempt_at, attempts, last_error_code, requeue_count)
values
  -- falha definitiva aberta
  ('fde00000-0000-0000-0000-000000000011', current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a',
   '950000000009001', '990000000000011', 'failed', now() - interval '1 day', now(), 1, 'missing_phone', 0),
  -- em nova tentativa (operacional)
  ('fde00000-0000-0000-0000-000000000012', current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a',
   '950000000009001', '990000000000012', 'received', now() - interval '2 hours', now() + interval '1 hour', 0, 'token_invalid', 0),
  -- parado: received vencido há mais de 15 minutos sem erro (sem agendador)
  ('fde00000-0000-0000-0000-000000000013', current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a',
   '950000000009001', '990000000000013', 'received', now() - interval '1 hour', now() - interval '1 hour', 0, null, 0),
  -- falha antiga demais (100 dias)
  ('fde00000-0000-0000-0000-000000000014', current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a',
   '950000000009001', '990000000000014', 'failed', now() - interval '100 days', now(), 1, 'event_expired', 0),
  -- limite de reprocessamento atingido
  ('fde00000-0000-0000-0000-000000000015', current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a',
   '950000000009001', '990000000000015', 'failed', now() - interval '1 day', now(), 1, 'max_attempts', 10),
  -- retry vencido há 1 h sem ninguém processar (sem cron): deve aparecer como parado
  ('fde00000-0000-0000-0000-000000000017', current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a',
   '950000000009001', '990000000000017', 'received', now() - interval '3 hours', now() - interval '1 hour', 1, 'graph_error', 0),
  -- recebido há 8 dias e expirado: será reprocessado e NÃO pode expirar de novo no claim
  ('fde00000-0000-0000-0000-000000000016', current_setting('mvp1.int_a')::uuid, 'fd100000-0000-0000-0000-00000000000a',
   '950000000009001', '990000000000016', 'failed', now() - interval '8 days', now(), 1, 'event_expired', 0);

-- Manager A
select pg_temp.as_user('fd200000-0000-0000-0000-000000000001');
set local role authenticated;

select is(
  (select string_agg(review_state || ':' || coalesce(last_error_code, '-'), ',' order by review_state, last_error_code)
     from public.meta_leadgen_review_list('fd100000-0000-0000-0000-00000000000a', 50)),
  'failed:event_expired,failed:event_expired,failed:max_attempts,failed:missing_phone,retrying:token_invalid,stuck:graph_error,stuck:-',
  'E1 Manager A vê falhas, retries e parados; retry vencido sem processamento conta como parado');
select is(
  (select failed_open || '/' || retrying || '/' || stuck || '/' || processed_last_7d
     from public.meta_leadgen_review_summary('fd100000-0000-0000-0000-00000000000a')),
  '4/1/2/3', 'E2 resumo: 4 falhas, 1 retry no prazo, 2 parados (sem agendador), 3 processados');
select is(
  (select can_requeue::text || '/' || can_dismiss::text from public.meta_leadgen_review_list('fd100000-0000-0000-0000-00000000000a', 50)
    where event_id = 'fde00000-0000-0000-0000-000000000014'),
  'false/true', 'E3 falha de 100 dias: não reprocessa, pode encerrar');
select is(
  (select count(*)::int from public.meta_connection_health('fd100000-0000-0000-0000-00000000000a')
    where status = 'connected' and token_origin = 'exchanged_long_lived'),
  1, 'E4 saúde da conexão visível ao Manager');
select ok(not exists (
  select 1 from information_schema.routines r join information_schema.parameters p
    on p.specific_name = r.specific_name
   where r.routine_name = 'meta_connection_health' and p.parameter_name ilike '%ciphertext%'),
  'E4 saúde da conexão nunca devolve ciphertext');

select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000011')),
  'requeued', 'E5 reprocessa falha definitiva');
select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000001')),
  'not_requeueable', 'E6 evento processed não é reprocessado');
select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000014')),
  'too_old', 'E7 mais de 90 dias → too_old');
select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000015')),
  'requeue_limit', 'E8 limite de 10 reprocessamentos');
select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000016')),
  'requeued', 'E9 reprocessa evento expirado');
select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fda00000-0000-0000-0000-0000000000ff')),
  'not_found', 'E10 evento inexistente → not_found');

select is((select out_outcome from public.meta_leadgen_event_dismiss('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000014', 'not_recoverable')),
  'dismissed', 'E11 encerra falha');
select is((select out_outcome from public.meta_leadgen_event_dismiss('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000014', 'not_recoverable')),
  'not_dismissable', 'E12 não encerra duas vezes');
select is((select out_outcome from public.meta_leadgen_event_dismiss('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000012', 'duplicate')),
  'not_dismissable', 'E13 só falhas podem ser encerradas');
select throws_ok($$select * from public.meta_leadgen_event_dismiss('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000015', 'texto livre')$$,
  '22023', 'invalid_input', 'E14 motivo fora da lista → invalid_input');
select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000014')),
  'not_requeueable', 'E15 encerrado não volta a ser reprocessado');
select ok(not exists (select 1 from public.meta_leadgen_review_list('fd100000-0000-0000-0000-00000000000a', 50)
                       where event_id = 'fde00000-0000-0000-0000-000000000014'), 'E16 encerrado sai da fila');
reset role;

select is(
  (select status || ':' || attempts || ':' || requeue_count || ':' || (last_requeued_by = 'fd200000-0000-0000-0000-000000000001')::text
          || ':' || (next_attempt_at <= now())::text
     from public.meta_leadgen_events where id = 'fde00000-0000-0000-0000-000000000011'),
  'received:0:1:true:true', 'E5 evento volta a received, tentativas zeradas, autor registrado');
select is(
  (select review_resolution || ':' || (review_resolved_by = 'fd200000-0000-0000-0000-000000000001')::text
     from public.meta_leadgen_events where id = 'fde00000-0000-0000-0000-000000000014'),
  'not_recoverable:true', 'E11 resolução e autor gravados');
select is(
  (select count(*)::int from public.audit_log where action in ('meta_leadgen_event_requeued', 'meta_leadgen_event_dismissed')
     and company_id = 'fd100000-0000-0000-0000-00000000000a'),
  3, 'E5/E9/E11 reprocessamentos e encerramento auditados');

-- E17. a janela de 7 dias recomeça no reprocessamento (evento de 8 dias é reclamado, não expira).
set local role service_role;
select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch('fde00000-0000-0000-0000-000000000016', 1, 90)),
  1, 'E17 evento reprocessado de 8 dias é reclamado (não expira de novo)');
reset role;
select is((select status from public.meta_leadgen_events where id = 'fde00000-0000-0000-0000-000000000016'),
  'processing', 'E17 status processing');

-- ═══ F. autorização ═════════════════════════════════════════════════════
select pg_temp.as_user('fd200000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select throws_ok($$select * from public.meta_leadgen_review_list('fd100000-0000-0000-0000-00000000000a', 50)$$,
  '42501', 'forbidden', 'F1 Seller não vê a fila');
select throws_ok($$select * from public.meta_connection_health('fd100000-0000-0000-0000-00000000000a')$$,
  '42501', 'forbidden', 'F2 Seller não vê a saúde da conexão');
select throws_ok($$select * from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000015')$$,
  '42501', 'forbidden', 'F3 Seller não reprocessa');
select throws_ok($$select * from public.meta_form_mapping_set('fd100000-0000-0000-0000-00000000000a', '108600000000001', 'vehicle', 'carro')$$,
  '42501', 'forbidden', 'F4 Seller não mapeia');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000003'); -- Manager B
set local role authenticated;
select throws_ok($$select * from public.meta_leadgen_review_list('fd100000-0000-0000-0000-00000000000a', 50)$$,
  '42501', 'forbidden', 'F5 Manager B não vê a fila da Empresa A');
select throws_ok($$select * from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000a', 'fde00000-0000-0000-0000-000000000015')$$,
  '42501', 'forbidden', 'F6 Manager B não reprocessa evento da Empresa A');
select is((select out_outcome from public.meta_leadgen_event_requeue('fd100000-0000-0000-0000-00000000000b', 'fde00000-0000-0000-0000-000000000015')),
  'not_found', 'F7 evento da Empresa A pedido pela Empresa B → not_found');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000004'); -- Super Admin
set local role authenticated;
select ok((select count(*) from public.meta_leadgen_review_list('fd100000-0000-0000-0000-00000000000a', 50)) > 0,
  'F8 Super Admin vê a fila da Empresa A');
reset role;

select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok($$select * from public.meta_leadgen_review_summary('fd100000-0000-0000-0000-00000000000a')$$,
  '28000', 'unauthenticated', 'F9 sem sessão → unauthenticated');
reset role;

set local role anon;
select throws_ok($$select * from public.meta_leadgen_review_summary('fd100000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'F10 anon sem EXECUTE');
reset role;

-- ═══ G. mapeamento por formulário ═══════════════════════════════════════
select pg_temp.as_user('fd200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select is((select field_key from public.meta_form_mapping_set('fd100000-0000-0000-0000-00000000000a', '108600000000001', 'vehicle', ' qual_carro ')),
  'qual_carro', 'G1 mapeamento salvo (espaços removidos)');
select is((select field_key from public.meta_form_mapping_set('fd100000-0000-0000-0000-00000000000a', '108600000000001', 'vehicle', 'modelo')),
  'modelo', 'G2 mesmo alvo atualiza (sem duplicar)');
select is((select count(*)::int from public.meta_form_mapping_list('fd100000-0000-0000-0000-00000000000a')), 1, 'G3 um mapeamento');
select throws_ok($$select * from public.meta_form_mapping_set('fd100000-0000-0000-0000-00000000000a', '108600000000001', 'cpf', 'cpf')$$,
  '22023', 'invalid_input', 'G4 alvo fora da lista → invalid_input');
select throws_ok($$select * from public.meta_form_mapping_set('fd100000-0000-0000-0000-00000000000a', 'abc', 'vehicle', 'x')$$,
  '22023', 'invalid_input', 'G5 form_id não numérico → invalid_input');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000003'); -- Manager B
set local role authenticated;
select is((select count(*)::int from public.meta_form_mapping_list('fd100000-0000-0000-0000-00000000000b')), 0,
  'G6 Manager B não vê mapeamentos da Empresa A');
reset role;

set local role service_role;
select is((select out_field_key from public.meta_form_mapping_for_processing('fd100000-0000-0000-0000-00000000000a', '108600000000001')
            where out_target = 'vehicle'), 'modelo', 'G7 processor lê o mapeamento da company + formulário');
select is((select count(*)::int from public.meta_form_mapping_for_processing('fd100000-0000-0000-0000-00000000000b', '108600000000001')), 0,
  'G8 mesmo formulário em outra company não herda mapeamento');
select is((select count(*)::int from public.meta_form_mapping_for_processing('fd100000-0000-0000-0000-00000000000a', null)), 0,
  'G9 form_id ausente → sem mapeamento');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select out_outcome from public.meta_form_mapping_delete('fd100000-0000-0000-0000-00000000000a', '108600000000001', 'vehicle')),
  'deleted', 'G10 remove mapeamento');
select is((select out_outcome from public.meta_form_mapping_delete('fd100000-0000-0000-0000-00000000000a', '108600000000001', 'vehicle')),
  'not_found', 'G11 remover de novo → not_found');
reset role;

-- ═══ H. visibilidade das respostas ══════════════════════════════════════
select set_config('mvp1.lead1', (select id::text from public.leads where phone_digits = '61999990901'), false);

select pg_temp.as_user('fd200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select is((select count(*)::int from public.list_lead_form_submissions(current_setting('mvp1.lead1')::uuid)), 2,
  'H1 Manager A vê as duas submissões do lead');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000002'); -- Seller A, lead sem vendedor
set local role authenticated;
select throws_ok(format($$select * from public.list_lead_form_submissions(%L::uuid)$$, current_setting('mvp1.lead1')),
  'P0002', 'lead_not_found', 'H2 Seller não vê respostas de lead que não é dele');
reset role;

update public.leads set seller_id = 'mvp1SellerA' where id = current_setting('mvp1.lead1')::uuid;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.list_lead_form_submissions(current_setting('mvp1.lead1')::uuid)), 2,
  'H3 Seller vê as respostas depois de atribuído');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000003'); -- Manager B
set local role authenticated;
select throws_ok(format($$select * from public.list_lead_form_submissions(%L::uuid)$$, current_setting('mvp1.lead1')),
  'P0002', 'lead_not_found', 'H4 Manager B não vê lead da Empresa A');
reset role;

select pg_temp.as_user('fd200000-0000-0000-0000-000000000004'); -- Super Admin
set local role authenticated;
select is((select count(*)::int from public.list_lead_form_submissions(current_setting('mvp1.lead1')::uuid, 'fd100000-0000-0000-0000-00000000000a')), 2,
  'H5 Super Admin vê com company explícita');
select throws_ok(format($$select * from public.list_lead_form_submissions(%L::uuid)$$, current_setting('mvp1.lead1')),
  '22023', 'company_required', 'H6 Super Admin sem company → company_required');
reset role;

select * from finish();
rollback;
