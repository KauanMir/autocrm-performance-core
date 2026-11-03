-- WHATSAPP-W2A — whatsapp_webhook_events e RPC de registro (pgTAP). Dados fake; rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

select has_table('public', 'whatsapp_webhook_events', 'tabela existe');

select columns_are('public', 'whatsapp_webhook_events',
  array['id', 'company_id', 'connection_id', 'phone_number_id', 'event_kind', 'event_key', 'message_id_hash',
        'message_type', 'status_value', 'processing_status', 'attempts', 'last_error_code', 'occurred_at',
        'received_at', 'processed_at', 'created_at', 'updated_at'],
  'colunas exatas: sem texto, telefone/nome do contato, wamid cru, status bruto, mídia ou payload');

select ok((select relrowsecurity from pg_class where oid = 'public.whatsapp_webhook_events'::regclass), 'RLS habilitado');
select ok(not exists (select 1 from pg_policies where tablename = 'whatsapp_webhook_events'), 'zero policies');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.whatsapp_webhook_events', p)),
  0, 'anon, authenticated e service_role sem privilégio direto na tabela');

select ok(
  (select count(*) = 1 from pg_constraint where conname = 'whatsapp_webhook_events_event_key_uniq' and contype = 'u'),
  'event_key UNIQUE');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'whatsapp_webhook_event_register'
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  1, 'register é SECURITY DEFINER com search_path fixo (uma única sobrecarga)');

select ok(
  not has_function_privilege('anon', 'public.whatsapp_webhook_event_register(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.whatsapp_webhook_event_register(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz)', 'EXECUTE'),
  'anon e authenticated sem EXECUTE');
select ok(
  has_function_privilege('service_role', 'public.whatsapp_webhook_event_register(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz)', 'EXECUTE'),
  'service_role com EXECUTE');

-- ── fixtures (postgres) ──────────────────────────────────────────────────
insert into public.companies (id, name) values
  ('fa2eeeee-1111-1111-1111-111111111111', 'Empresa WA Ledger A'),
  ('fa2eeeee-2222-2222-2222-222222222222', 'Empresa WA Ledger B');

insert into public.whatsapp_connections
  (id, company_id, waba_id, phone_number_id, access_token_ciphertext, status, connected_at)
values
  ('fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '830000000000001', '840000000000001',
   'fake-ct-ledger-a', 'connected', now()),
  ('fa2a0000-0000-0000-0000-00000000000b', 'fa2eeeee-2222-2222-2222-222222222222', '830000000000002', '840000000000002',
   null, 'disconnected', null);

set local role service_role;

-- Hashes fake (64 hex): h1/h2 = wamid; ks/kd/kx/ky = status bruto (sent, delivered, X, Y).
select set_config('w2a.h1', repeat('a', 64), true);
select set_config('w2a.h2', repeat('b', 64), true);
select set_config('w2a.ks', repeat('1', 64), true);
select set_config('w2a.kd', repeat('2', 64), true);
select set_config('w2a.kx', repeat('3', 64), true);
select set_config('w2a.ky', repeat('4', 64), true);

-- Argumentos: conn, company, phone, kind, message_id_hash, message_type, status_value, status_key_hash, occurred_at, received_at

select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'message', current_setting('w2a.h1'), 'text', null, null, now(), now())),
  true, 'mensagem nova: created');

select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'message', current_setting('w2a.h1'), 'text', null, null, now(), now())),
  false, 'mensagem duplicada (reentrega): não cria segundo ledger');

select is(
  (select out_processing_status from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'message', current_setting('w2a.h1'), 'image', null, null, null, now())),
  'received', 'mesmo wamid com outro tipo continua o mesmo evento (status received)');

select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'status', current_setting('w2a.h1'), null, 'sent', current_setting('w2a.ks'), now(), now())),
  true, 'status com o mesmo hash de wamid NÃO colide com a mensagem');

select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'status', current_setting('w2a.h1'), null, 'delivered', current_setting('w2a.kd'), now(), now())),
  true, 'cada transição de status é um evento distinto');

select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'status', current_setting('w2a.h1'), null, 'delivered', current_setting('w2a.kd'), now(), now())),
  false, 'status duplicado (reentrega) deduplicado');

-- Dois statuses DESCONHECIDOS distintos do mesmo wamid: ambos 'other', mas
-- status_key_hash diferente → event_keys diferentes.
select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'status', current_setting('w2a.h2'), null, 'other', current_setting('w2a.kx'), now(), now())),
  true, 'status desconhecido X: created');
select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'status', current_setting('w2a.h2'), null, 'other', current_setting('w2a.ky'), now(), now())),
  true, 'status desconhecido Y do MESMO wamid: created (não colide com X)');
select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'status', current_setting('w2a.h2'), null, 'other', current_setting('w2a.kx'), now(), now())),
  false, 'reentrega do status desconhecido X: deduplicada');

select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
     'message', current_setting('w2a.h2'), 'audio', null, null, null, now())),
  true, 'outro wamid: novo evento');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000b', 'fa2eeeee-2222-2222-2222-222222222222', '840000000000002',
  'message', repeat('c', 64), 'text', null, null, null, now()) $$,
  'P0001', 'connection_not_connected', 'conexão desconectada não registra');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-2222-2222-2222-222222222222', '840000000000001',
  'message', repeat('c', 64), 'text', null, null, null, now()) $$,
  'P0001', 'connection_not_connected', 'company divergente da conexão não registra');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000009',
  'message', repeat('c', 64), 'text', null, null, null, now()) $$,
  'P0001', 'connection_not_connected', 'phone_number_id divergente da conexão não registra');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'message', 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRB', 'text', null, null, null, now()) $$,
  'P0001', 'invalid_input', 'wamid cru (não hash) é rejeitado');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'status', repeat('c', 64), null, 'other', 'x_unknown_status_alpha', null, now()) $$,
  'P0001', 'invalid_input', 'status bruto (não hash) em status_key_hash é rejeitado');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'status', repeat('c', 64), null, 'read', null, null, now()) $$,
  'P0001', 'invalid_input', 'status sem status_key_hash falha');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'message', repeat('c', 64), 'text', null, repeat('5', 64), null, now()) $$,
  'P0001', 'invalid_input', 'message com status_key_hash falha');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'message', repeat('c', 64), null, null, null, null, now()) $$,
  'P0001', 'invalid_input', 'message sem message_type falha');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'status', repeat('c', 64), 'text', 'read', repeat('5', 64), null, now()) $$,
  'P0001', 'invalid_input', 'status com message_type falha');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'reaction', repeat('c', 64), 'text', null, null, null, now()) $$,
  'P0001', 'invalid_input', 'event_kind desconhecido falha');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'message', repeat('c', 64), 'hologram', null, null, null, now()) $$,
  '23514', null, 'message_type fora da allowlist barrado pelo CHECK');

select throws_ok($$ select * from public.whatsapp_webhook_event_register(
  'fa2a0000-0000-0000-0000-00000000000a', 'fa2eeeee-1111-1111-1111-111111111111', '840000000000001',
  'status', repeat('c', 64), null, 'x_unknown_status_alpha', repeat('5', 64), null, now()) $$,
  '23514', null, 'status_value bruto fora da allowlist barrado pelo CHECK (só classificação é armazenada)');

reset role;

select is(
  (select count(*)::int from public.whatsapp_webhook_events where connection_id = 'fa2a0000-0000-0000-0000-00000000000a'),
  6, 'ledger: 2 mensagens + 4 status (sent, delivered, X, Y), sem duplicatas');
select is(
  (select count(*)::int from public.whatsapp_webhook_events
   where message_id_hash = repeat('b', 64) and event_kind = 'status' and status_value = 'other'),
  2, 'os dois desconhecidos ficam armazenados só como "other"');
select is(
  (select count(distinct event_key)::int from public.whatsapp_webhook_events),
  (select count(*)::int from public.whatsapp_webhook_events),
  'event_key único por linha');
select is(
  (select count(*)::int from public.whatsapp_webhook_events where processing_status <> 'received' or attempts <> 0),
  0, 'W2A só registra: tudo em received, attempts 0');

select * from finish();
rollback;
