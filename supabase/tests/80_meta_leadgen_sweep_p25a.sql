-- META-INGESTION-P2.5A — expiração de 7 dias e claim em lote (pgTAP). Dados fake; rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

select ok(
  has_function_privilege('service_role', 'public.meta_leadgen_event_claim_batch(uuid, integer, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.meta_leadgen_event_claim_batch(uuid, integer, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.meta_leadgen_event_claim_batch(uuid, integer, integer)', 'EXECUTE'),
  'claim em lote: somente service_role');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
    where oid = 'public.meta_leadgen_event_claim_batch(uuid, integer, integer)'::regprocedure),
  'claim em lote: SECURITY DEFINER com search_path fixo');

-- ── fixtures (postgres) ───────────────────────────────────────────────
insert into public.companies (id, name) values ('fa0eeeee-1111-1111-1111-111111111111', 'Empresa P25A');
insert into public.company_meta_integrations
  (id, company_id, page_id, page_name, access_token_ciphertext, token_key_version, granted_scopes, status, connected_at)
values
  ('fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111', '950000000000251', 'Pagina P25A',
   'fake-ct-p25a', 1, array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
   'connected', now());

insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, form_id, status, received_at, next_attempt_at,
   attempts, last_error_code, lease_token, locked_until)
values
  -- e1: received antigo → expira
  ('fa0e0000-0000-0000-0000-000000000001', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000251', null, 'received', now() - interval '8 days', now(), 0, null, null, null),
  -- e2: received recente → claimable, não expira
  ('fa0e0000-0000-0000-0000-000000000002', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000252', null, 'received', now() - interval '6 days', now(), 0, null, null, null),
  -- e3: processing com lease VÁLIDA, antigo → não expira (outro worker está processando)
  ('fa0e0000-0000-0000-0000-000000000003', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000253', null, 'processing', now() - interval '8 days', now(), 1,
   null, 'fa100000-0000-0000-0000-000000000003', now() + interval '10 minutes'),
  -- e4: processing com lease EXPIRADA, antigo → expira
  ('fa0e0000-0000-0000-0000-000000000004', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000254', null, 'processing', now() - interval '8 days', now(), 1,
   null, 'fa100000-0000-0000-0000-000000000004', now() - interval '1 minute'),
  -- e5: operacional em espera (+1h), antigo → expira (fecha o loop)
  ('fa0e0000-0000-0000-0000-000000000005', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000255', null, 'received', now() - interval '8 days', now() + interval '1 hour', 0,
   'token_invalid', null, null),
  -- e6: processing lease expirada com attempts 5 → max_attempts (regra existente)
  ('fa0e0000-0000-0000-0000-000000000006', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000256', null, 'processing', now(), now(), 5,
   null, 'fa100000-0000-0000-0000-000000000006', now() - interval '1 minute'),
  -- e7: received com 6 dias 23 h → ainda dentro da janela, claimable
  ('fa0e0000-0000-0000-0000-000000000007', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000257', null, 'received', now() - interval '7 days' + interval '1 hour', now(), 0,
   null, null, null);

-- ── expiração antes do claim ──────────────────────────────────────────
set local role service_role;
create temp table p25a_batch as
  select * from public.meta_leadgen_event_claim_batch(null, 20, 90)
   where out_event_id in (
     'fa0e0000-0000-0000-0000-000000000001', 'fa0e0000-0000-0000-0000-000000000002',
     'fa0e0000-0000-0000-0000-000000000003', 'fa0e0000-0000-0000-0000-000000000004',
     'fa0e0000-0000-0000-0000-000000000005', 'fa0e0000-0000-0000-0000-000000000006',
     'fa0e0000-0000-0000-0000-000000000007');

reset role;

select is(
  (select array_agg(out_event_id::text order by out_event_id::text) from p25a_batch),
  array['fa0e0000-0000-0000-0000-000000000002', 'fa0e0000-0000-0000-0000-000000000007'],
  'claim em lote devolve somente eventos recentes elegíveis');

select ok(
  (select status = 'failed' and last_error_code = 'event_expired' and lease_token is null and locked_until is null
   and attempts = 0
   from public.meta_leadgen_events where id = 'fa0e0000-0000-0000-0000-000000000001'),
  'received > 7 dias vira failed/event_expired sem consumir attempt');

select ok(
  (select status = 'failed' and last_error_code = 'event_expired' and lease_token is null
   from public.meta_leadgen_events where id = 'fa0e0000-0000-0000-0000-000000000004'),
  'processing com lease expirada > 7 dias vira failed/event_expired');

select ok(
  (select status = 'failed' and last_error_code = 'event_expired'
   from public.meta_leadgen_events where id = 'fa0e0000-0000-0000-0000-000000000005'),
  'operacional em retry > 7 dias vira event_expired (fecha o loop +1h)');

select ok(
  (select status = 'processing' and lease_token = 'fa100000-0000-0000-0000-000000000003'::uuid
   from public.meta_leadgen_events where id = 'fa0e0000-0000-0000-0000-000000000003'),
  'lease vigente de evento antigo NÃO é expirada');

select ok(
  (select status = 'failed' and last_error_code = 'max_attempts'
   from public.meta_leadgen_events where id = 'fa0e0000-0000-0000-0000-000000000006'),
  'lease expirada com attempts 5 continua virando max_attempts');

select ok(
  (select status = 'processing' and attempts = 1 from public.meta_leadgen_events
   where id = 'fa0e0000-0000-0000-0000-000000000002'),
  'evento recente claimado: processing e attempts 1');

select ok(
  (select status = 'received' from public.meta_leadgen_events where id = 'fa0e0000-0000-0000-0000-000000000007')
  = false,
  'evento recente claimado não ficou em received');

-- ── idempotência e borda ──────────────────────────────────────────────
set local role service_role;
select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch(null, 20, 90)
    where out_event_id = 'fa0e0000-0000-0000-0000-000000000002'),
  0, 'segundo claim não reclama evento com lease vigente');

select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch('fa0e0000-0000-0000-0000-000000000001', 1, 90)),
  0, 'claim por id de evento expirado devolve zero linhas');
reset role;
select ok(
  (select status = 'failed' and last_error_code = 'event_expired' from public.meta_leadgen_events
   where id = 'fa0e0000-0000-0000-0000-000000000001'),
  'claim por id mantém o evento expirado como failed');

-- ── borda da janela: 7 dias exatos ───────────────────────────────────
insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, form_id, status, received_at, next_attempt_at, attempts)
values
  ('fa0e0000-0000-0000-0000-000000000008', 'fa0a0000-0000-0000-0000-00000000000a', 'fa0eeeee-1111-1111-1111-111111111111',
   '950000000000251', '960000000000258', null, 'received', now() - interval '7 days' - interval '1 minute', now(), 0);
set local role service_role;
select is(
  (select count(*)::int from public.meta_leadgen_event_claim_batch('fa0e0000-0000-0000-0000-000000000008', 1, 90)),
  0, 'um minuto além de 7 dias: expira, não é claimado');
reset role;
select ok(
  (select status = 'failed' from public.meta_leadgen_events where id = 'fa0e0000-0000-0000-0000-000000000008'),
  'um minuto além de 7 dias: failed');

select * from finish();
rollback;
