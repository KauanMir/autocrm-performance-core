-- META-INGESTION-P1 — meta_leadgen_events e RPC de registro (pgTAP). Dados fake; rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

select has_table('public', 'meta_leadgen_events', 'tabela existe');

select columns_are('public', 'meta_leadgen_events',
  array['id', 'integration_id', 'company_id', 'page_id', 'leadgen_id', 'form_id', 'status', 'crm_lead_id',
        'attempts', 'locked_until', 'last_error_code', 'received_at', 'processed_at', 'created_at', 'updated_at',
        'next_attempt_at', 'lease_token'],
  'colunas exatas (P1 + P2.2 lease/retry): sem field_data, nome, telefone, email, CPF ou payload');

select ok((select relrowsecurity from pg_class where oid = 'public.meta_leadgen_events'::regclass), 'RLS habilitado');
select ok(not exists (select 1 from pg_policies where tablename = 'meta_leadgen_events'), 'zero policies');
select ok(not exists (select 1 from pg_class c, aclexplode(c.relacl) a
  where c.oid = 'public.meta_leadgen_events'::regclass and a.grantee = 0), 'PUBLIC sem privilégio');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.meta_leadgen_events', p)),
  0, 'anon, authenticated e service_role sem privilégio direto na tabela');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('meta_leadgen_event_claim', 'meta_leadgen_event_mark_failed', 'meta_leadgen_event_mark_processed')),
  0, 'RPCs P1 removidas (claim/mark_failed/mark_processed) continuam ausentes');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'meta_leadgen_event_register'
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  1, 'register é SECURITY DEFINER com search_path fixo');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'meta_leadgen_event_register'
     and p.prosrc ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
  0, 'nenhum UUID literal (inclusive company de teste) na RPC');

select ok(
  not has_function_privilege('anon', 'public.meta_leadgen_event_register(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.meta_leadgen_event_register(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE'),
  'anon e authenticated sem EXECUTE na RPC');

select ok(
  has_function_privilege('service_role', 'public.meta_leadgen_event_register(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE'),
  'service_role com EXECUTE na RPC');

select ok(
  (select count(*) = 1 from pg_constraint where conname = 'meta_leadgen_events_page_leadgen_uniq' and contype = 'u'),
  '(page_id, leadgen_id) UNIQUE');

select ok(
  (select count(*) = 1 from pg_constraint c where c.conname = 'meta_leadgen_events_crm_lead_fk' and c.contype = 'f'
     and c.confdeltype::text = 'n'),
  'crm_lead_id: FK composta (company_id, crm_lead_id) -> leads, ON DELETE SET NULL');

-- ── fixtures (postgres): empresa, perfil, duas integrações ────────────────
insert into public.companies (id, name) values
  ('f7eeeeee-1111-1111-1111-111111111111', 'Empresa P1 A'),
  ('f7eeeeee-2222-2222-2222-222222222222', 'Empresa P1 B');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f7000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f7user1@test.local', now(), now(), now());
insert into public.profiles (id, name, email, is_active) values
  ('f7000000-0000-0000-0000-000000000001', 'P1 Usuario', 'f7user1@test.local', true);

insert into public.company_meta_integrations
  (id, company_id, page_id, page_name, access_token_ciphertext, token_key_version, granted_scopes, status, connected_at, connected_by)
values
  ('f7a00000-0000-0000-0000-00000000000a', 'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', 'Pagina P1 A',
   'fake-ct-p1-a', 1, array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
   'connected', now(), 'f7000000-0000-0000-0000-000000000001'),
  ('f7a00000-0000-0000-0000-00000000000b', 'f7eeeeee-2222-2222-2222-222222222222', '950000000000002', 'Pagina P1 B',
   null, 1, array['pages_show_list'], 'disconnected', null, null);

set local role service_role;

select ok(set_config('p1.event', (select out_event_id::text from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a', 'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', '960000000000001', '970000000000001', now())), false) is not null, 'id do evento capturado pelo RPC');

select is(
  (select out_status from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
     'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', '960000000000001', '970000000000001', now())),
  'received', 'registro cria evento received');

select is(
  (select out_created from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
     'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', '960000000000001', '970000000000001', now())),
  false, 'mesmo leadgen_id repetido: out_created = false');

select is(
  (select out_event_id from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
     'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', '960000000000001', null, now())),
  current_setting('p1.event')::uuid, 'repetição devolve o mesmo event id, mesmo sem form_id');

select is(
  (select count(*)::int from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
     'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', '960000000000001', null, now())),
  1, 'repetição retorna exatamente uma linha');

reset role;
select is(
  (select count(*)::int from public.meta_leadgen_events where leadgen_id = '960000000000001'),
  1, 'webhook repetido resulta em exatamente um meta_leadgen_event');
select is(
  (select form_id from public.meta_leadgen_events where leadgen_id = '960000000000001'),
  '970000000000001', 'form_id gravado quando presente');
set local role service_role;

select is(
  (select out_created from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
     'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', '960000000000005', null, now())),
  true, 'form_id ausente cria evento com form_id NULL');

reset role;
select is(
  (select form_id from public.meta_leadgen_events where leadgen_id = '960000000000005'),
  null::text, 'form_id NULL gravado como NULL');
set local role service_role;

select throws_ok(
  $$ select * from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000b',
       'f7eeeeee-2222-2222-2222-222222222222', '950000000000002', '960000000000002', null, now()) $$,
  'P0001', 'integration_not_connected', 'integração desconectada não registra evento');

select throws_ok(
  $$ select * from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
       'f7eeeeee-2222-2222-2222-222222222222', '950000000000001', '960000000000003', null, now()) $$,
  'P0001', 'integration_not_connected', 'company diferente da integração não registra evento');

select throws_ok(
  $$ select * from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
       'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', 'abc', null, now()) $$,
  'P0001', 'invalid_input', 'leadgen_id não numérico é rejeitado');

select throws_ok(
  $$ select * from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
       'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', '960000000000004', 'x y', now()) $$,
  'P0001', 'invalid_input', 'form_id inválido é rejeitado');

select throws_ok(
  $$ select * from public.meta_leadgen_event_register('f7a00000-0000-0000-0000-00000000000a',
       'f7eeeeee-1111-1111-1111-111111111111', '950000000000001', null, null, now()) $$,
  'P0001', 'invalid_input', 'leadgen_id ausente não registra');

-- ── acesso direto negado ──────────────────────────────────────────────────
select throws_ok(
  $$ select count(*) from public.meta_leadgen_events $$,
  '42501', null, 'service_role sem SELECT direto na tabela');

reset role;
set local role authenticated;
select throws_ok(
  $$ select count(*) from public.meta_leadgen_events $$,
  '42501', null, 'authenticated sem acesso direto');
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.meta_leadgen_events $$,
  '42501', null, 'anon sem acesso direto');
reset role;

select * from finish();
rollback;
