-- META-INGESTION-P2.2 — claim, fail, complete e lookup de processamento (pgTAP).
-- Dados fake; tudo em transação com rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── schema e segurança ─────────────────────────────────────────────────
select columns_are('public', 'meta_leadgen_events',
  array['id', 'integration_id', 'company_id', 'page_id', 'leadgen_id', 'form_id', 'status', 'crm_lead_id',
        'attempts', 'locked_until', 'last_error_code', 'received_at', 'processed_at', 'created_at', 'updated_at',
        'next_attempt_at', 'lease_token'],
  'colunas P2: somente next_attempt_at e lease_token adicionadas');

select ok(exists (select 1 from pg_constraint where conname = 'meta_leadgen_events_state_ck' and contype = 'c'),
  'check de consistência de estados existe');
select ok(exists (select 1 from pg_indexes where tablename = 'meta_leadgen_events' and indexname = 'meta_leadgen_events_claim_idx'),
  'índice de claim existe');

select ok((select relrowsecurity from pg_class where oid = 'public.meta_leadgen_events'::regclass), 'RLS habilitado');
select ok(not exists (select 1 from pg_policies where tablename = 'meta_leadgen_events'), 'zero policies');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.meta_leadgen_events', p)),
  0, 'zero grants diretos para anon, authenticated e service_role');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('meta_leadgen_event_claim_batch', 'meta_leadgen_event_fail', 'meta_leadgen_event_complete',
                       'meta_connection_lookup_for_processing', 'meta_leadgen_error_kind')
     and p.prosecdef = (p.proname <> 'meta_leadgen_error_kind')
     and p.proconfig @> array['search_path=""']),
  5, 'cinco funções com search_path fixo; SECURITY DEFINER exceto error_kind (sql immutable)');

select ok(
  has_function_privilege('service_role', 'public.meta_leadgen_event_claim_batch(uuid, integer, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.meta_leadgen_event_fail(uuid, uuid, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.meta_leadgen_event_complete(uuid, uuid, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.meta_connection_lookup_for_processing(uuid)', 'EXECUTE'),
  'service_role com EXECUTE nas quatro RPCs');

select ok(
  not has_function_privilege('anon', 'public.meta_leadgen_event_claim_batch(uuid, integer, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.meta_leadgen_event_claim_batch(uuid, integer, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.meta_leadgen_event_fail(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.meta_leadgen_event_fail(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.meta_leadgen_event_complete(uuid, uuid, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.meta_leadgen_event_complete(uuid, uuid, text, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.meta_connection_lookup_for_processing(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.meta_connection_lookup_for_processing(uuid)', 'EXECUTE'),
  'anon e authenticated sem EXECUTE nas RPCs');

select ok(
  not has_function_privilege('service_role', 'public.meta_leadgen_error_kind(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.meta_leadgen_error_kind(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.meta_leadgen_error_kind(text)', 'EXECUTE'),
  'classificação de erro é interna: sem EXECUTE para nenhum role de API');

-- ── política de erro (espelha o runtime) ──────────────────────────────
select is(public.meta_leadgen_error_kind('graph_timeout'), 'retryable', 'graph_timeout retryable');
select is(public.meta_leadgen_error_kind('lead_not_found'), 'retryable', 'lead_not_found retryable');
select is(public.meta_leadgen_error_kind('crm_create_failed'), 'retryable', 'crm_create_failed retryable');
select is(public.meta_leadgen_error_kind('token_invalid'), 'operational', 'token_invalid operational');
select is(public.meta_leadgen_error_kind('initial_stage_missing'), 'operational', 'initial_stage_missing operational');
select is(public.meta_leadgen_error_kind('duplicate_phone_ambiguous'), 'terminal', 'duplicate_phone_ambiguous terminal');
select is(public.meta_leadgen_error_kind('integration_not_found'), 'terminal', 'integration_not_found terminal');
select is(public.meta_leadgen_error_kind('event_expired'), 'terminal', 'event_expired terminal');
select is(public.meta_leadgen_error_kind('raw Meta message: boom'), null::text, 'código desconhecido não tem classe');

-- ── fixtures (postgres) ───────────────────────────────────────────────
insert into public.companies (id, name) values
  ('f9eeeeee-1111-1111-1111-111111111111', 'Empresa P2 A'),
  ('f9eeeeee-2222-2222-2222-222222222222', 'Empresa P2 B');

-- Empresa A recebe as cinco etapas padrão; Empresa B fica sem etapas.
insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values
  ('f9eeeeee-1111-1111-1111-111111111111', 'new', 'Novo', 0, false),
  ('f9eeeeee-1111-1111-1111-111111111111', 'qualified', 'Qualificado', 1, false),
  ('f9eeeeee-1111-1111-1111-111111111111', 'visit_scheduled', 'Visita agendada', 2, false),
  ('f9eeeeee-1111-1111-1111-111111111111', 'negotiation', 'Em negociação', 3, false),
  ('f9eeeeee-1111-1111-1111-111111111111', 'closing', 'Fechamento', 4, true);

insert into public.company_meta_integrations
  (id, company_id, page_id, page_name, access_token_ciphertext, token_key_version, granted_scopes, status, connected_at)
values
  ('f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111', '950000000000011', 'Pagina P2 A',
   'fake-ct-p2-a', 1, array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
   'connected', now()),
  ('f9a00000-0000-0000-0000-00000000000b', 'f9eeeeee-2222-2222-2222-222222222222', '950000000000012', 'Pagina P2 B',
   'fake-ct-p2-b', 1, array['pages_show_list'], 'connected', now()),
  ('f9a00000-0000-0000-0000-00000000000c', 'f9eeeeee-1111-1111-1111-111111111111', '950000000000013', 'Pagina P2 C',
   null, 1, array['pages_show_list'], 'disconnected', null);

-- eventos de claim/fail
insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, form_id, status, received_at, next_attempt_at,
   attempts, lease_token, locked_until)
values
  ('f9e00000-0000-0000-0000-000000000001', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000001', '970000000000001', 'received', now(), now(), 0, null, null),
  ('f9e00000-0000-0000-0000-000000000002', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000002', null, 'received', now(), now() + interval '1 day', 0, null, null),
  ('f9e00000-0000-0000-0000-000000000003', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000003', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000003', now() - interval '1 minute'),
  ('f9e00000-0000-0000-0000-000000000004', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000004', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000004', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000005', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000005', null, 'processing', now(), now(), 5,
   'f9100000-0000-0000-0000-000000000005', now() - interval '1 minute'),
  ('f9e00000-0000-0000-0000-000000000006', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000006', null, 'received', now(), now(), 0, null, null),
  ('f9e00000-0000-0000-0000-000000000007', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000007', null, 'received', now(), now(), 0, null, null);

-- ── CLAIM ─────────────────────────────────────────────────────────────
set local role service_role;

create temp table p22_claim1 as
  select * from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000001', 20, 90);

select is((select out_attempts from p22_claim1), 1, 'claim de received elegível incrementa attempts para 1');
select set_config('p22.lease_claim1', (select out_lease_token::text from p22_claim1), false);

reset role;
select is(
  (select status from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000001'),
  'processing', 'claim move o evento para processing');
select ok(
  (select lease_token is not null and locked_until > now() from public.meta_leadgen_events
    where id = 'f9e00000-0000-0000-0000-000000000001'),
  'claim grava lease_token e locked_until futuro');
select ok(
  (select count(*) = 0 from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000001'
     and next_attempt_at > now()),
  'next_attempt_at de received elegível já venceu');
set local role service_role;

select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000002', 20, 90)),
  0, 'received com next_attempt_at futuro não é claimed');

select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000004', 20, 90)),
  0, 'processing com lease válida não é reclaimed');

create temp table p22_reclaim3 as
  select * from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000003', 20, 90);
select is((select out_attempts from p22_reclaim3), 2,
  'processing com lease expirada é reclaimed e incrementa attempts');
reset role;
select ok(
  (select lease_token <> 'f9100000-0000-0000-0000-000000000003'::uuid from public.meta_leadgen_events
    where id = 'f9e00000-0000-0000-0000-000000000003'),
  'reclaim gera lease_token novo');
set local role service_role;

select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000005', 20, 90)),
  0, 'stale com attempts 5 não é reclaimed');
reset role;
select is(
  (select last_error_code from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000005'),
  'max_attempts', 'stale com attempts 5 vira failed max_attempts');
select is(
  (select status from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000005'),
  'failed', 'stale com attempts 5 fica failed');
set local role service_role;

select throws_ok($$ select * from public.meta_leadgen_event_claim_batch(null, 0, 90) $$,
  'P0001', 'invalid_input', 'limit 0 recusado');
select throws_ok($$ select * from public.meta_leadgen_event_claim_batch(null, 21, 90) $$,
  'P0001', 'invalid_input', 'limit 21 recusado');
select throws_ok($$ select * from public.meta_leadgen_event_claim_batch(null, 20, 29) $$,
  'P0001', 'invalid_input', 'lease 29 recusado');
select throws_ok($$ select * from public.meta_leadgen_event_claim_batch(null, 20, 301) $$,
  'P0001', 'invalid_input', 'lease 301 recusado');
select lives_ok($$ select * from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000002', 1, 30) $$,
  'limit 1 e lease 30 aceitos (limite inferior)');
select lives_ok($$ select * from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000002', 20, 300) $$,
  'limit 20 e lease 300 aceitos (limite superior)');

select ok(
  position('ciphertext' in pg_get_function_result('public.meta_leadgen_event_claim_batch(uuid, integer, integer)'::regprocedure)) = 0
  and position('access_token' in pg_get_function_result('public.meta_leadgen_event_claim_batch(uuid, integer, integer)'::regprocedure)) = 0,
  'claim não devolve ciphertext nem access_token');

-- ── FAIL: lease ───────────────────────────────────────────────────────
select is(
  (select out_outcome from public.meta_leadgen_event_fail(
     'f9e00000-0000-0000-0000-000000000003', 'f9100000-0000-0000-0000-000000000003', 'graph_timeout')),
  'lease_lost', 'fail com lease expirada não muda o evento');
select is(
  (select out_outcome from public.meta_leadgen_event_fail(
     'f9e00000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-0000000000ff', 'graph_timeout')),
  'lease_lost', 'fail com lease errada não muda o evento');
select throws_ok($$ select * from public.meta_leadgen_event_fail(
     'f9e00000-0000-0000-0000-000000000001', current_setting('p22.lease_claim1')::uuid, 'Raw Meta message') $$,
  'P0001', 'invalid_input', 'código desconhecido recusado');
select throws_ok($$ select * from public.meta_leadgen_event_fail(
     'f9e00000-0000-0000-0000-000000000001', null, 'graph_timeout') $$,
  'P0001', 'invalid_input', 'lease nula recusada');
reset role;
select is(
  (select status from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000001'),
  'processing', 'lease errada não altera status');
set local role service_role;

-- ── FAIL: retry com backoff ───────────────────────────────────────────
-- evento 1 já está processing (attempts 1) com lease de claim1
select is(
  (select out_outcome from public.meta_leadgen_event_fail(
     'f9e00000-0000-0000-0000-000000000001', current_setting('p22.lease_claim1')::uuid, 'graph_timeout')),
  'retry_scheduled', 'retryable attempt 1 agenda retry');
reset role;
select ok(
  (select status = 'received' and lease_token is null and locked_until is null
          and last_error_code = 'graph_timeout'
          and next_attempt_at = now() + interval '1 minute'
   from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000001'),
  'retryable attempt 1: received, lease limpa, backoff de 1 minuto');
set local role service_role;

-- sequência de attempts 2..5 no evento 6
select set_config('p22.lease', (select out_lease_token::text from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000006', 20, 90)), false);
select is(
  (select out_next_attempt_at - now() from public.meta_leadgen_event_fail('f9e00000-0000-0000-0000-000000000006',
     current_setting('p22.lease')::uuid, 'graph_error')),
  interval '1 minute', 'attempt 1 de evento 6: backoff 1 minuto');

reset role;
update public.meta_leadgen_events set next_attempt_at = now() where id = 'f9e00000-0000-0000-0000-000000000006';
set local role service_role;
select set_config('p22.lease', (select out_lease_token::text from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000006', 20, 90)), false);
select is(
  (select out_next_attempt_at - now() from public.meta_leadgen_event_fail('f9e00000-0000-0000-0000-000000000006',
     current_setting('p22.lease')::uuid, 'graph_error')),
  interval '5 minutes', 'attempt 2 agenda 5 minutos');

reset role;
update public.meta_leadgen_events set next_attempt_at = now() where id = 'f9e00000-0000-0000-0000-000000000006';
set local role service_role;
select set_config('p22.lease', (select out_lease_token::text from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000006', 20, 90)), false);
select is(
  (select out_next_attempt_at - now() from public.meta_leadgen_event_fail('f9e00000-0000-0000-0000-000000000006',
     current_setting('p22.lease')::uuid, 'graph_error')),
  interval '15 minutes', 'attempt 3 agenda 15 minutos');

reset role;
update public.meta_leadgen_events set next_attempt_at = now() where id = 'f9e00000-0000-0000-0000-000000000006';
set local role service_role;
select set_config('p22.lease', (select out_lease_token::text from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000006', 20, 90)), false);
select is(
  (select out_next_attempt_at - now() from public.meta_leadgen_event_fail('f9e00000-0000-0000-0000-000000000006',
     current_setting('p22.lease')::uuid, 'graph_error')),
  interval '60 minutes', 'attempt 4 agenda 60 minutos');

reset role;
update public.meta_leadgen_events set next_attempt_at = now() where id = 'f9e00000-0000-0000-0000-000000000006';
set local role service_role;
select set_config('p22.lease', (select out_lease_token::text from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000006', 20, 90)), false);
select is(
  (select out_outcome from public.meta_leadgen_event_fail('f9e00000-0000-0000-0000-000000000006',
     current_setting('p22.lease')::uuid, 'graph_error')),
  'failed_max_attempts', 'attempt 5 retryable termina em max_attempts');
reset role;
select ok(
  (select status = 'failed' and last_error_code = 'max_attempts' and lease_token is null
   from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000006'),
  'attempt 5: failed com last_error_code max_attempts e lease limpa');
set local role service_role;

-- ── FAIL: operacional não consome tentativa ───────────────────────────
select set_config('p22.lease', (select out_lease_token::text from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000007', 20, 90)), false);
select is(
  (select out_attempts from public.meta_leadgen_event_fail('f9e00000-0000-0000-0000-000000000007',
     current_setting('p22.lease')::uuid, 'token_invalid')),
  0, 'operacional devolve attempts ao valor anterior (0)');
reset role;
select ok(
  (select status = 'received' and next_attempt_at = now() + interval '1 hour' and last_error_code = 'token_invalid'
          and attempts = 0 and lease_token is null
   from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000007'),
  'operacional: received, +1 hora, last_error_code, lease limpa');
set local role service_role;
select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000007', 20, 90)),
  0, 'operacional não é claimable antes de +1 hora');
reset role;
update public.meta_leadgen_events set next_attempt_at = now() where id = 'f9e00000-0000-0000-0000-000000000007';
set local role service_role;
select is(
  (select out_attempts from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000007', 20, 90)),
  1, 'após operacional, nova claim começa de attempts 1 (não consumiu tentativa)');

-- ── FAIL: terminal ────────────────────────────────────────────────────
reset role;
update public.meta_leadgen_events set next_attempt_at = now() where id = 'f9e00000-0000-0000-0000-000000000002';
set local role service_role;
select set_config('p22.lease', (select out_lease_token::text from public.meta_leadgen_event_claim_batch('f9e00000-0000-0000-0000-000000000002', 20, 300)), false);
select is(
  (select out_outcome from public.meta_leadgen_event_fail('f9e00000-0000-0000-0000-000000000002',
     current_setting('p22.lease')::uuid, 'missing_name')),
  'failed_terminal', 'terminal vira failed_terminal');
reset role;
select ok(
  (select status = 'failed' and last_error_code = 'missing_name' and lease_token is null and locked_until is null
   from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000002'),
  'terminal: failed com código e sem lease');
set local role service_role;

-- ── COMPLETE — fixtures de processing com lease conhecida ─────────────
reset role;
insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, form_id, status, received_at, next_attempt_at,
   attempts, lease_token, locked_until)
values
  ('f9e00000-0000-0000-0000-000000000101', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000101', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000101', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000102', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000102', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000102', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000103', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000103', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000103', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000104', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000104', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000104', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000105', 'f9a00000-0000-0000-0000-00000000000c', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000013', '960000000000105', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000105', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000106', 'f9a00000-0000-0000-0000-00000000000b', 'f9eeeeee-2222-2222-2222-222222222222',
   '950000000000012', '960000000000106', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000106', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000107', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000107', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000107', now() + interval '10 minutes');

-- lead existente ativo com telefone 61988880001 e lead arquivado com 61988880002
insert into public.leads (id, company_id, name, phone, car, stage_id, archived_at) values
  ('f9c00000-0000-0000-0000-000000000001', 'f9eeeeee-1111-1111-1111-111111111111', 'Pre-existente', '61988880009', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'), null),
  ('f9c00000-0000-0000-0000-000000000002', 'f9eeeeee-1111-1111-1111-111111111111', 'Arquivado', '61988880002', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'), now());

-- dois leads ativos com 61988880003 (ambíguo)
insert into public.leads (company_id, name, phone, car, stage_id) values
  ('f9eeeeee-1111-1111-1111-111111111111', 'Ambiguo 1', '61988880003', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new')),
  ('f9eeeeee-1111-1111-1111-111111111111', 'Ambiguo 2', '61988880003', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'));

-- ── COMPLETE: validação defensiva ─────────────────────────────────────
set local role service_role;
select throws_ok($$ select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000101',
     'f9100000-0000-0000-0000-000000000101', '   ', '61988880010', 'Onix') $$,
  'P0001', 'invalid_input', 'name vazio recusado');
select throws_ok($$ select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000101',
     'f9100000-0000-0000-0000-000000000101', 'Cliente', '61988880010', '') $$,
  'P0001', 'invalid_input', 'car vazio recusado');
select throws_ok($$ select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000101',
     'f9100000-0000-0000-0000-000000000101', 'Cliente', '+5561988880010', 'Onix') $$,
  'P0001', 'invalid_input', 'telefone com + não é renormalizado no SQL');
select throws_ok($$ select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000101',
     'f9100000-0000-0000-0000-000000000101', 'Cliente', '0619888800', 'Onix') $$,
  'P0001', 'invalid_input', 'telefone iniciado por 0 recusado');
select throws_ok($$ select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000101',
     'f9100000-0000-0000-0000-000000000101', 'Cliente', '6198888', 'Onix') $$,
  'P0001', 'invalid_input', 'telefone curto recusado');

-- ── COMPLETE: fencing e integração ────────────────────────────────────
select is(
  (select out_outcome from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000101',
     'f9100000-0000-0000-0000-0000000000ff', 'Cliente', '61988880010', 'Onix')),
  'lease_lost', 'lease errada no complete: lease_lost');
reset role;
select is((select count(*)::int from public.leads where phone = '61988880010'), 0,
  'lease_lost não cria lead');
set local role service_role;

select is(
  (select out_outcome from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000105',
     'f9100000-0000-0000-0000-000000000105', 'Cliente', '61988880011', 'Onix')),
  'integration_not_found', 'integração desconectada: integration_not_found sem criar lead');
reset role;
select is((select count(*)::int from public.leads where phone = '61988880011'), 0,
  'integration_not_found não cria lead');
set local role service_role;

select is(
  (select out_outcome from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000106',
     'f9100000-0000-0000-0000-000000000106', 'Cliente', '61988880012', 'Onix')),
  'initial_stage_missing', 'empresa sem etapa new: initial_stage_missing');
reset role;
select is((select count(*)::int from public.leads where phone = '61988880012'), 0,
  'initial_stage_missing não cria lead');
set local role service_role;

-- ── COMPLETE: criação com defaults oficiais ───────────────────────────
create temp table p22_created as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000101',
    'f9100000-0000-0000-0000-000000000101', 'Cliente Teste', '61988880001', 'Não informado');
select is((select out_outcome from p22_created), 'created', 'sem lead ativo: created');
select set_config('p22.created_lead', (select out_crm_lead_id::text from p22_created), false);

reset role;
select ok(
  (select count(*) = 1 from public.leads l
    where l.id = current_setting('p22.created_lead')::uuid
      and l.company_id = 'f9eeeeee-1111-1111-1111-111111111111'
      and l.name = 'Cliente Teste'
      and l.phone = '61988880001'
      and l.car = 'Não informado'
      and l.stage_id = (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new')
      and l.source = 'Meta Lead Ads'
      and l.seller_id is null
      and l.urgency = 'red'
      and l.temperature is null
      and l.last_activity_label = 'Sem contato ainda'
      and l.alert_label = 'Fazer primeiro contato'
      and l.created_by_profile_id is null
      and l.archived_at is null),
  'lead criado com etapa new, source Meta Lead Ads, seller NULL e defaults oficiais');
select ok(
  (select count(*) = 1 from public.lead_timeline_entries t
    where t.lead_id = current_setting('p22.created_lead')::uuid and t.label = 'Lead criado'),
  'timeline "Lead criado" gravada pelo helper oficial');
select ok(
  (select status = 'processed' and crm_lead_id = current_setting('p22.created_lead')::uuid
          and processed_at is not null and lease_token is null and locked_until is null and last_error_code is null
   from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000101'),
  'evento processed com crm_lead_id, processed_at e lease limpa');

-- ── COMPLETE: vincula ativo existente sem alterar o lead ───────────────
set local role service_role;
create temp table p22_linked as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000102',
    'f9100000-0000-0000-0000-000000000102', 'Outro Nome', '61988880001', 'Outro Carro');
select is((select out_outcome from p22_linked), 'linked_existing', 'lead ativo com mesmo telefone: linked_existing');
select is((select out_crm_lead_id::text from p22_linked), current_setting('p22.created_lead'),
  'vínculo aponta para o lead existente (mesmo id)');
reset role;
select ok(
  (select count(*) = 1 from public.leads where phone = '61988880001'),
  'linked_existing não cria segundo lead');
select ok(
  (select name = 'Cliente Teste' and car = 'Não informado' and version = 1
   from public.leads where id = current_setting('p22.created_lead')::uuid),
  'linked_existing não atualiza o lead existente (nome, car, version preservados)');
select ok(
  (select status = 'processed' and crm_lead_id = current_setting('p22.created_lead')::uuid
   from public.meta_leadgen_events where id = 'f9e00000-0000-0000-0000-000000000102'),
  'evento vinculado fica processed com o mesmo crm_lead_id');

-- ── COMPLETE: arquivado não conta como duplicado ──────────────────────
set local role service_role;
select is(
  (select out_outcome from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000103',
     'f9100000-0000-0000-0000-000000000103', 'Cliente Arquivado', '61988880002', 'Onix')),
  'created', 'só arquivado com o telefone: cria lead novo ativo');
reset role;
select is((select count(*)::int from public.leads where phone = '61988880002' and archived_at is null), 1,
  'exatamente um lead ativo para o telefone arquivado');
select is((select count(*)::int from public.leads where phone = '61988880002' and archived_at is not null), 1,
  'arquivado permanece arquivado e intocado');
set local role service_role;

-- ── COMPLETE: ambiguidade ─────────────────────────────────────────────
select is(
  (select out_outcome from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000104',
     'f9100000-0000-0000-0000-000000000104', 'Ambiguo', '61988880003', 'Onix')),
  'duplicate_phone_ambiguous', 'dois ativos com mesmo telefone: duplicate_phone_ambiguous');
reset role;
select is((select count(*)::int from public.leads where phone = '61988880003'), 2,
  'ambiguidade não cria terceiro lead nem altera os existentes');
select ok(
  (select status = 'processing' and crm_lead_id is null from public.meta_leadgen_events
    where id = 'f9e00000-0000-0000-0000-000000000104'),
  'ambiguidade não muda o evento (fail será feito pelo processor)');

-- ── COMPLETE: atomicidade (falha depois da criação) ───────────────────
create function public.p22_force_processed_failure() returns trigger
language plpgsql as $$
begin
  raise exception 'forced_after_insert';
end;
$$;
create trigger p22_force_processed_failure
  before update on public.meta_leadgen_events
  for each row when (new.status = 'processed')
  execute function public.p22_force_processed_failure();

set local role service_role;
select throws_ok($$ select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000107',
     'f9100000-0000-0000-0000-000000000107', 'Atomico', '61988880005', 'Onix') $$,
  'P0001', 'forced_after_insert', 'falha após o INSERT do lead aborta a RPC');
reset role;
select is((select count(*)::int from public.leads where phone = '61988880005'), 0,
  'rollback: nenhum lead órfão após falha');
select ok(
  (select status = 'processing' and crm_lead_id is null from public.meta_leadgen_events
    where id = 'f9e00000-0000-0000-0000-000000000107'),
  'rollback: evento continua processing, sem crm_lead_id');
drop trigger p22_force_processed_failure on public.meta_leadgen_events;
drop function public.p22_force_processed_failure();

-- ── MATCH DE EQUIVALÊNCIA +55 ─────────────────────────────────────────
reset role;
insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, form_id, status, received_at, next_attempt_at,
   attempts, lease_token, locked_until)
values
  ('f9e00000-0000-0000-0000-000000000110', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000110', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000110', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000111', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000111', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000111', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000112', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000112', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000112', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000113', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000113', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000113', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000114', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000114', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000114', now() + interval '10 minutes'),
  ('f9e00000-0000-0000-0000-000000000115', 'f9a00000-0000-0000-0000-00000000000a', 'f9eeeeee-1111-1111-1111-111111111111',
   '950000000000011', '960000000000115', null, 'processing', now(), now(), 1,
   'f9100000-0000-0000-0000-000000000115', now() + interval '10 minutes');

insert into public.leads (company_id, name, phone, car, stage_id, archived_at) values
  ('f9eeeeee-1111-1111-1111-111111111111', 'DDI Ativo', '+55 61 97777-1111', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'), null),
  ('f9eeeeee-1111-1111-1111-111111111111', 'Nacional Ativo', '61966660001', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'), null),
  ('f9eeeeee-1111-1111-1111-111111111111', 'DDI Ativo 2', '+55 61 96666-0001', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'), null),
  ('f9eeeeee-1111-1111-1111-111111111111', 'DDI Arquivado', '+55 61 95555-0001', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'), now()),
  ('f9eeeeee-1111-1111-1111-111111111111', 'Nacional A', '61933330001', 'Onix',
   (select id from public.pipeline_stages where company_id = 'f9eeeeee-1111-1111-1111-111111111111' and code = 'new'), null);

-- B: lead ativo armazenado com +55; evento nacional → vincula, sem novo lead
set local role service_role;
create temp table p22_b as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000110',
    'f9100000-0000-0000-0000-000000000110', 'Cliente DDI', '61977771111', 'Não informado');
select is((select out_outcome from p22_b), 'linked_existing', 'B: lead +55 ativo + evento nacional → linked_existing');
reset role;
select is((select count(*)::int from public.leads where phone_digits in ('61977771111', '5561977771111')), 1,
  'B: nenhum segundo lead para o cliente com +55');

-- A: lead ativo nacional; evento nacional → vincula
set local role service_role;
create temp table p22_a as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000115',
    'f9100000-0000-0000-0000-000000000115', 'Cliente Nacional', '61933330001', 'Não informado');
select is((select out_outcome from p22_a), 'linked_existing', 'A: lead nacional ativo + evento nacional → linked_existing');
reset role;

-- C: um ativo nacional + um ativo +55 equivalente → ambíguo, sem mutação
set local role service_role;
create temp table p22_c as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000111',
    'f9100000-0000-0000-0000-000000000111', 'Cliente Ambiguo', '61966660001', 'Não informado');
select is((select out_outcome from p22_c), 'duplicate_phone_ambiguous',
  'C: nacional + +55 ativos equivalentes → duplicate_phone_ambiguous');
reset role;
select is((select count(*)::int from public.leads where phone_digits in ('61966660001', '5561966660001')), 2,
  'C: nenhum lead novo e nenhum existente alterado');
select ok((select status = 'processing' and crm_lead_id is null from public.meta_leadgen_events
  where id = 'f9e00000-0000-0000-0000-000000000111'), 'C: evento segue processing para o processor fazer fail');

-- D: somente arquivado +55 equivalente → cria lead novo ativo
set local role service_role;
create temp table p22_d as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000112',
    'f9100000-0000-0000-0000-000000000112', 'Cliente Arquivado DDI', '61955550001', 'Não informado');
select is((select out_outcome from p22_d), 'created', 'D: só arquivado +55 equivalente → created');
reset role;
select is((select count(*)::int from public.leads where phone_digits in ('61955550001', '5561955550001')
  and archived_at is null), 1, 'D: exatamente um lead ativo equivalente');
select is((select count(*)::int from public.leads where phone_digits = '5561955550001' and archived_at is not null), 1,
  'D: arquivado +55 permanece arquivado e intocado');

-- E: dois eventos Meta com o mesmo telefone → um único lead
set local role service_role;
create temp table p22_e1 as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000113',
    'f9100000-0000-0000-0000-000000000113', 'Cliente Duplo', '61944440001', 'Não informado');
create temp table p22_e2 as
  select * from public.meta_leadgen_event_complete('f9e00000-0000-0000-0000-000000000114',
    'f9100000-0000-0000-0000-000000000114', 'Cliente Duplo', '61944440001', 'Não informado');
select is((select out_outcome from p22_e1), 'created', 'E: primeiro evento cria o lead');
select is((select out_outcome from p22_e2), 'linked_existing', 'E: segundo evento vincula ao mesmo lead');
reset role;
select is((select count(*)::int from public.leads where phone_digits in ('61944440001', '5561944440001')), 1,
  'E: um único lead para o telefone');

-- ── LOOKUP PARA PROCESSOR ─────────────────────────────────────────────
set local role service_role;
select ok(
  (select out_status = 'connected' and out_access_token_ciphertext = 'fake-ct-p2-a'
   from public.meta_connection_lookup_for_processing('f9a00000-0000-0000-0000-00000000000a')),
  'lookup de integração connected devolve ciphertext ao service_role');
select ok(
  (select out_status = 'disconnected' and out_access_token_ciphertext is null
   from public.meta_connection_lookup_for_processing('f9a00000-0000-0000-0000-00000000000c')),
  'lookup de integração desconectada não devolve ciphertext');
select is(
  (select count(*)::int from public.meta_connection_lookup_for_processing('f9a00000-0000-0000-0000-0000000000ff')),
  0, 'lookup de integração inexistente: zero linhas');
select throws_ok($$ select * from public.meta_connection_lookup_for_processing(null) $$,
  'P0001', 'invalid_input', 'lookup com id nulo recusado');
reset role;

select * from finish();
rollback;
