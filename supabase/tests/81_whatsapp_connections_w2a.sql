-- WHATSAPP-W2A — whatsapp_connections e RPCs (pgTAP). Dados fake; rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

select has_table('public', 'whatsapp_connections', 'tabela existe');

select columns_are('public', 'whatsapp_connections',
  array['id', 'company_id', 'waba_id', 'phone_number_id', 'display_phone_number', 'access_token_ciphertext',
        'token_key_version', 'status', 'connected_at', 'connected_by', 'disconnected_at', 'last_error_code',
        'last_error_at', 'created_at', 'updated_at'],
  'colunas exatas: sem coluna de token em plaintext');

select ok((select relrowsecurity from pg_class where oid = 'public.whatsapp_connections'::regclass), 'RLS habilitado');
select ok(not exists (select 1 from pg_policies where tablename = 'whatsapp_connections'), 'zero policies');
select ok(not exists (select 1 from pg_class c, aclexplode(c.relacl) a
  where c.oid = 'public.whatsapp_connections'::regclass and a.grantee = 0), 'PUBLIC sem privilégio');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.whatsapp_connections', p)),
  0, 'anon, authenticated e service_role sem privilégio direto na tabela');

select ok(
  (select count(*) = 1 from pg_constraint where conname = 'whatsapp_connections_company_phone_uniq' and contype = 'u'),
  '(company_id, phone_number_id) UNIQUE');
select ok(
  (select indisunique and pg_get_expr(indpred, indrelid) like '%connected%'
   from pg_index where indexrelid = 'public.whatsapp_connections_phone_connected_uniq'::regclass),
  'phone_number_id UNIQUE parcial quando status = connected');
select ok(
  (select confdeltype = 'c' from pg_constraint
   where conrelid = 'public.whatsapp_connections'::regclass and contype = 'f'
     and confrelid = 'public.companies'::regclass),
  'company_id FK companies ON DELETE CASCADE');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('whatsapp_connection_upsert', 'whatsapp_connection_status',
                       'whatsapp_connection_owner_by_phone_number', 'whatsapp_connection_lookup_for_processing')
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  4, 'as 4 RPCs são SECURITY DEFINER com search_path fixo');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname like 'whatsapp_connection_%'
     and p.prosrc ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
  0, 'nenhum UUID literal hardcoded nas RPCs');

select is(
  (select count(*)::int
   from unnest(array[
     'public.whatsapp_connection_upsert(uuid, text, text, text, text, smallint, timestamptz, uuid)',
     'public.whatsapp_connection_status(uuid)',
     'public.whatsapp_connection_owner_by_phone_number(text)',
     'public.whatsapp_connection_lookup_for_processing(text)']) f,
     unnest(array['anon', 'authenticated', 'public']) r
   where has_function_privilege(r, f, 'EXECUTE')),
  0, 'anon, authenticated e PUBLIC sem EXECUTE em nenhuma RPC');

select is(
  (select count(*)::int
   from unnest(array[
     'public.whatsapp_connection_upsert(uuid, text, text, text, text, smallint, timestamptz, uuid)',
     'public.whatsapp_connection_status(uuid)',
     'public.whatsapp_connection_owner_by_phone_number(text)',
     'public.whatsapp_connection_lookup_for_processing(text)']) f
   where has_function_privilege('service_role', f, 'EXECUTE')),
  4, 'service_role com EXECUTE nas 4 RPCs');

-- Contrato de saída: somente lookup_for_processing expõe ciphertext.
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname like 'whatsapp_connection_%'
     and 'access_token_ciphertext' = any(p.proargnames)
     and p.proname <> 'whatsapp_connection_upsert'),
  1, 'só uma RPC (além do parâmetro de entrada do upsert) menciona ciphertext');
select ok(
  (select 'access_token_ciphertext' = any(p.proargnames) from pg_proc p
   where p.proname = 'whatsapp_connection_lookup_for_processing'),
  'essa RPC é a lookup_for_processing');
select ok(
  (select not ('access_token_ciphertext' = any(p.proargnames[9:])) from pg_proc p
   where p.proname = 'whatsapp_connection_upsert'),
  'upsert não devolve ciphertext nas colunas de saída');

-- ── fixtures (como postgres) ─────────────────────────────────────────────
insert into public.companies (id, name) values
  ('fa1eeeee-1111-1111-1111-111111111111', 'Empresa WA A'),
  ('fa1eeeee-2222-2222-2222-222222222222', 'Empresa WA B');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fa100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fa1user1@test.local', now(), now(), now());
insert into public.profiles (id, name, email, is_active) values
  ('fa100000-0000-0000-0000-000000000001', 'WA Usuario 1', 'fa1user1@test.local', true);

-- ── authenticated: nenhum caminho direto ─────────────────────────────────
set local role authenticated;
select throws_ok($$ select * from public.whatsapp_connections $$, '42501', null, 'authenticated não lê a tabela');
select throws_ok($$ select * from public.whatsapp_connection_lookup_for_processing('810000000000001') $$,
  '42501', null, 'authenticated não executa lookup_for_processing');
select throws_ok($$ select * from public.whatsapp_connection_status('fa1eeeee-1111-1111-1111-111111111111') $$,
  '42501', null, 'authenticated não executa status');
reset role;

set local role anon;
select throws_ok($$ select * from public.whatsapp_connection_owner_by_phone_number('810000000000001') $$,
  '42501', null, 'anon não executa owner_by_phone_number');
reset role;

-- ── service_role: caminho real ───────────────────────────────────────────
set local role service_role;

select throws_ok($$ select * from public.whatsapp_connections $$, '42501', null,
  'service_role também não lê a tabela diretamente (só via RPC)');

select is(
  (select status from public.whatsapp_connection_upsert(
     'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000001', '+1 555-078-3881',
     'fake-ct-wa-0001', 1::smallint, now(), 'fa100000-0000-0000-0000-000000000001')),
  'connected', 'conexão por company: upsert cria em status connected');

select set_config('w2a.conn_a', (select id::text from public.whatsapp_connection_status('fa1eeeee-1111-1111-1111-111111111111')), true);

select is(
  (select count(*)::int from public.whatsapp_connection_upsert(
     'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000001', null,
     'fake-ct-wa-0002', 1::smallint, now(), null) r
   where r::text like '%fake-ct-wa%'),
  0, 'retorno do upsert nunca contém ciphertext');

select is(
  (select id::text from public.whatsapp_connection_upsert(
     'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000001', '+1 555-078-3881',
     'fake-ct-wa-0003', 1::smallint, now(), 'fa100000-0000-0000-0000-000000000001')),
  current_setting('w2a.conn_a'), 'reconnect idempotente: mesmo phone_number_id na mesma company atualiza a mesma linha');

select is(
  (select count(*)::int from public.whatsapp_connection_status('fa1eeeee-1111-1111-1111-111111111111')),
  1, 'reconnect não duplica a linha');

select is(
  (select access_token_ciphertext from public.whatsapp_connection_lookup_for_processing('810000000000001')),
  'fake-ct-wa-0003', 'reconnect substitui o ciphertext (lookup_for_processing devolve o mais recente)');

select is(
  (select count(*)::int from public.whatsapp_connection_status('fa1eeeee-1111-1111-1111-111111111111') s
   where s::text like '%fake-ct%'),
  0, 'status nunca retorna ciphertext');

select is(
  (select count(*)::int from public.whatsapp_connection_owner_by_phone_number('810000000000001') o
   where o::text like '%fake-ct%'),
  0, 'owner_by_phone_number nunca retorna ciphertext');

select throws_ok(
  $$ select * from public.whatsapp_connection_upsert(
       'fa1eeeee-2222-2222-2222-222222222222', '820000000000002', '810000000000001', null,
       'fake-ct-wa-0004', 1::smallint, now(), null) $$,
  'P0001', 'phone_number_already_connected',
  'outra company não se apropria de phone_number_id já conectado');

select is(
  (select count(*)::int from public.whatsapp_connection_status('fa1eeeee-2222-2222-2222-222222222222')),
  0, 'conflito não deixa linha parcial na company B');

select is(
  (select company_id from public.whatsapp_connection_owner_by_phone_number('810000000000001')),
  'fa1eeeee-1111-1111-1111-111111111111'::uuid, 'phone_number_id → company correta');

select is(
  (select count(*)::int from public.whatsapp_connection_owner_by_phone_number('819999999999999')),
  0, 'número desconhecido: owner vazio');
select is(
  (select count(*)::int from public.whatsapp_connection_lookup_for_processing('819999999999999')),
  0, 'número desconhecido: lookup vazio');

-- Uma company pode ter vários números.
select is(
  (select status from public.whatsapp_connection_upsert(
     'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000005', null,
     'fake-ct-wa-0005', 1::smallint, now(), null)),
  'connected', 'segundo número na mesma company');
select is(
  (select count(*)::int from public.whatsapp_connection_status('fa1eeeee-1111-1111-1111-111111111111')),
  2, 'company A com 2 conexões');

-- Validação de entrada.
select throws_ok($$ select * from public.whatsapp_connection_upsert(
  'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '81a', null, 'fake-ct', 1::smallint, now(), null) $$,
  'P0001', 'invalid_input', 'phone_number_id não numérico falha');
select throws_ok($$ select * from public.whatsapp_connection_upsert(
  'fa1eeeee-1111-1111-1111-111111111111', 'x', '810000000000009', null, 'fake-ct', 1::smallint, now(), null) $$,
  'P0001', 'invalid_input', 'waba_id inválido falha');
select throws_ok($$ select * from public.whatsapp_connection_upsert(
  'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000009', 'nome<script>', 'fake-ct', 1::smallint, now(), null) $$,
  'P0001', 'invalid_input', 'display_phone_number fora do formato falha');
select throws_ok($$ select * from public.whatsapp_connection_upsert(
  'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000009', null, '', 1::smallint, now(), null) $$,
  'P0001', 'invalid_input', 'ciphertext vazio falha (nunca conecta sem token cifrado)');
select throws_ok($$ select * from public.whatsapp_connection_upsert(
  'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000009', null, repeat('x', 4097), 1::smallint, now(), null) $$,
  'P0001', 'invalid_input', 'ciphertext acima de 4096 falha');
select throws_ok($$ select * from public.whatsapp_connection_upsert(
  'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000009', null, 'fake-ct', 0::smallint, now(), null) $$,
  'P0001', 'invalid_input', 'token_key_version inválido falha');
select throws_ok($$ select * from public.whatsapp_connection_upsert(
  'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000009', null, 'fake-ct', 1::smallint, null, null) $$,
  'P0001', 'invalid_input', 'connected_at ausente falha');
select throws_ok($$ select * from public.whatsapp_connection_status(null) $$,
  'P0001', 'invalid_input', 'status sem company falha');
select throws_ok($$ select * from public.whatsapp_connection_owner_by_phone_number('abc') $$,
  'P0001', 'invalid_input', 'owner com phone_number_id inválido falha');
select throws_ok($$ select * from public.whatsapp_connection_lookup_for_processing(null) $$,
  'P0001', 'invalid_input', 'lookup sem phone_number_id falha');

reset role;

-- Conexão desconectada libera o número para outra company.
update public.whatsapp_connections set status = 'disconnected', disconnected_at = now()
  where id = current_setting('w2a.conn_a')::uuid;

set local role service_role;
select is(
  (select count(*)::int from public.whatsapp_connection_owner_by_phone_number('810000000000001')),
  0, 'conexão disconnected não resolve no webhook');
select is(
  (select company_id from public.whatsapp_connection_upsert(
     'fa1eeeee-2222-2222-2222-222222222222', '820000000000002', '810000000000001', null,
     'fake-ct-wa-0006', 1::smallint, now(), null)),
  'fa1eeeee-2222-2222-2222-222222222222'::uuid, 'número liberado pode ser conectado por outra company');
select throws_ok(
  $$ select * from public.whatsapp_connection_upsert(
       'fa1eeeee-1111-1111-1111-111111111111', '820000000000001', '810000000000001', null,
       'fake-ct-wa-0007', 1::smallint, now(), null) $$,
  'P0001', 'phone_number_already_connected',
  'company antiga não reconecta número agora conectado a outra');
reset role;

select is(
  (select count(*)::int from public.audit_log
   where action = 'whatsapp_connection_upserted' and entity_type = 'whatsapp_connection'
     and (after_data::text like '%fake-ct%' or after_data::text like '%8100000000%' or after_data::text like '%8200000000%')),
  0, 'audit_log sem ciphertext nem identificadores externos');
select ok(
  (select count(*) > 0 from public.audit_log where action = 'whatsapp_connection_upserted'),
  'upsert audita');

select * from finish();
rollback;
