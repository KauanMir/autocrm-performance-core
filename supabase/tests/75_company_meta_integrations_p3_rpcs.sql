-- META-PERSISTENCE-P3 — RPCs meta_connection_* (pgTAP).
-- Cobre existência, SECURITY DEFINER, search_path fixo, ACL (somente
-- service_role), comportamento das três RPCs, validação de argumentos,
-- conflito de Page conectada e ausência de vazamento de ciphertext.
-- Ciphertexts são claramente fake. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── existência e propriedades de segurança ───────────────────────────────
select has_function('public', 'meta_connection_upsert',
  array['uuid', 'text', 'text', 'text', 'smallint', 'text[]', 'timestamp with time zone', 'uuid', 'timestamp with time zone'],
  'RPC meta_connection_upsert existe com a assinatura aprovada');
select has_function('public', 'meta_connection_status', array['uuid'], 'RPC meta_connection_status existe');
select has_function('public', 'meta_connection_lookup_by_page', array['text'], 'RPC meta_connection_lookup_by_page existe');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%' and p.prosecdef),
  3,
  'as três RPCs são SECURITY DEFINER');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%'
     and p.proconfig @> array['search_path=""']),
  3,
  'as três RPCs têm search_path fixo vazio (referências qualificadas)');

select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%' and a.grantee = 0),
  'PUBLIC sem EXECUTE nas RPCs');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'anon sem EXECUTE nas RPCs');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0, 'authenticated sem EXECUTE nas RPCs');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%'
     and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  3, 'service_role com EXECUTE nas três RPCs');

select ok(not has_table_privilege('service_role', 'public.company_meta_integrations', 'SELECT'),
  'service_role continua sem SELECT direto na tabela');

-- Forma dos retornos: nenhum ciphertext exposto pela assinatura, exceto lookup (por desenho).
select is(
  (select array_agg(n order by ord) from pg_proc p,
     unnest(p.proargnames, p.proargmodes::text[]) with ordinality as t(n, m, ord)
   where p.proname = 'meta_connection_status' and m = 't'),
  array['id', 'company_id', 'page_id', 'page_name', 'status', 'granted_scopes', 'connected_at',
        'leadgen_subscribed_at', 'disconnected_at', 'last_error_code', 'last_error_at', 'updated_at'],
  'status retorna apenas metadados (sem ciphertext nem material criptográfico)');

select is(
  (select array_agg(n order by ord) from pg_proc p,
     unnest(p.proargnames, p.proargmodes::text[]) with ordinality as t(n, m, ord)
   where p.proname = 'meta_connection_lookup_by_page' and m = 't'),
  array['integration_id', 'company_id', 'page_id', 'status', 'access_token_ciphertext', 'token_key_version'],
  'lookup_by_page retorna somente os campos necessários');

select is(
  (select array_agg(n order by ord) from pg_proc p,
     unnest(p.proargnames, p.proargmodes::text[]) with ordinality as t(n, m, ord)
   where p.proname = 'meta_connection_upsert' and m = 't'),
  array['id', 'company_id', 'page_id', 'page_name', 'status', 'connected_at', 'leadgen_subscribed_at'],
  'upsert retorna mínimo, sem ciphertext');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%'
     and p.prosrc like '%variable_conflict%'),
  0, 'nenhum #variable_conflict no corpo das RPCs');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'meta_connection\_%'
     and p.prosrc ~'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
  0, 'nenhum UUID literal (inclusive TEST_COMPANY_ID) hardcoded nas RPCs');

-- ── fixtures (como postgres) ─────────────────────────────────────────────
insert into public.companies (id, name) values
  ('f3eeeeee-1111-1111-1111-111111111111', 'Empresa F3 A'),
  ('f3eeeeee-2222-2222-2222-222222222222', 'Empresa F3 B');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f3user1@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active) values
  ('f3000000-0000-0000-0000-000000000001', 'F3 Usuario 1', 'f3user1@test.local', true);

-- ── service_role: caminho real de acesso ─────────────────────────────────
set local role service_role;

select is(
  (select status from public.meta_connection_upsert(
     'f3eeeeee-1111-1111-1111-111111111111', '600000000000001', 'Pagina F3 A', 'fake-ct-f3-0001', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(),
     'f3000000-0000-0000-0000-000000000001', null)),
  'connected',
  'upsert cria conexão em status connected');

select is(
  (select count(*)::int from public.meta_connection_upsert(
     'f3eeeeee-1111-1111-1111-111111111111', '600000000000001', 'Pagina F3 A', 'fake-ct-f3-0002', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), 'f3000000-0000-0000-0000-000000000001', null) r
   where r::text like '%fake-ct-f3%'),
  0,
  'retorno do upsert nunca contém ciphertext');

select is(
  (select id from public.meta_connection_status('f3eeeeee-1111-1111-1111-111111111111') where page_id = '600000000000001'),
  (select id from public.meta_connection_upsert(
     'f3eeeeee-1111-1111-1111-111111111111', '600000000000001', 'Pagina F3 A', 'fake-ct-f3-0003', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), 'f3000000-0000-0000-0000-000000000001', null)),
  'reconexão atualiza a mesma linha (mesmo id)');

select is(
  (select count(*)::int from public.meta_connection_status('f3eeeeee-1111-1111-1111-111111111111')),
  1,
  'reconexão não duplica a linha');

select is(
  (select count(*)::int from public.meta_connection_status('f3eeeeee-1111-1111-1111-111111111111') s
   where s::text like '%fake-ct%'),
  0,
  'status nunca retorna ciphertext');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-2222-2222-2222-222222222222', '600000000000001', 'Pagina F3 B', 'fake-ct-f3-0005', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'page_already_connected',
  'mesma page conectada em outra company falha com erro controlado');

select is(
  (select count(*)::int from public.meta_connection_status('f3eeeeee-2222-2222-2222-222222222222')),
  0,
  'falha de conflito não deixa linha parcial na company B');

select is(
  (select company_id from public.meta_connection_lookup_by_page('600000000000001')),
  'f3eeeeee-1111-1111-1111-111111111111'::uuid,
  'lookup_by_page de conexão conectada retorna a company correta');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '12a', 'x', 'fake-ct-f3-0006', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'page_id inválido falha cedo');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '600000000000009', 'x', '', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'ciphertext vazio falha');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '600000000000009', 'x', repeat('x', 4097), 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'ciphertext acima de 4096 falha');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '600000000000009', 'x', 'fake-ct-f3-0007', 0::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'token_key_version inválido falha');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '600000000000009', 'x', 'fake-ct-f3-0008', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], null, null, null) $$,
  'P0001', 'invalid_input', 'connected_at ausente falha');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '600000000000009', 'x', 'fake-ct-f3-0009', 1::smallint,
       array['ads_management'], now(), null, null) $$,
  'P0001', 'invalid_input', 'scope fora da allowlist validada falha');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '600000000000009', 'x', 'fake-ct-f3-0010', 1::smallint,
       '{}'::text[], now(), null, null) $$,
  'P0001', 'invalid_input', 'lista de scopes vazia falha');

select throws_ok(
  $$ select * from public.meta_connection_status(null) $$,
  'P0001', 'invalid_input', 'status com company_id nulo falha');

select throws_ok(
  $$ select * from public.meta_connection_lookup_by_page('abc') $$,
  'P0001', 'invalid_input', 'lookup com page_id inválido falha');

select throws_ok(
  $$ select * from public.company_meta_integrations $$,
  '42501', null, 'service_role sem SELECT direto na tabela');

reset role;

-- ── estados não conectados (como postgres, para montar o cenário) ────────
update public.company_meta_integrations
   set status = 'error', last_error_code = 'token_invalid', last_error_at = now(),
       disconnected_at = now(), access_token_ciphertext = null
 where page_id = '600000000000001';

set local role service_role;

select is(
  (select count(*)::int from public.meta_connection_status('f3eeeeee-1111-1111-1111-111111111111') s
   where s.page_id = '600000000000001' and s.status = 'error' and s.disconnected_at is not null),
  1,
  'cenário: conexão em error com disconnected_at preenchido');

select is(
  (select count(*)::int from public.meta_connection_upsert(
     'f3eeeeee-1111-1111-1111-111111111111', '600000000000001', 'Pagina F3 A', 'fake-ct-f3-0011', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), 'f3000000-0000-0000-0000-000000000001', now()) r
   where r.status = 'connected'),
  1,
  'reconexão após erro/desconexão volta a connected');

select is(
  (select (s.disconnected_at is null and s.last_error_code is null and s.last_error_at is null)
   from public.meta_connection_status('f3eeeeee-1111-1111-1111-111111111111') s where s.page_id = '600000000000001'),
  true,
  'reconexão limpa disconnected_at, last_error_code e last_error_at');

select is(
  (select count(*)::int from public.meta_connection_lookup_by_page('600000000000001')),
  1,
  'lookup encontra a conexão reconectada');

reset role;

-- conexão desconectada não aparece no lookup
set local role service_role;
select is(
  (select count(*)::int from public.meta_connection_upsert(
     'f3eeeeee-1111-1111-1111-111111111111', '600000000000002', 'Pagina F3 C', 'fake-ct-f3-0012', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) r where r.status = 'connected'),
  1, 'cenário: segunda page conectada');
reset role;

update public.company_meta_integrations
   set status = 'disconnected', access_token_ciphertext = null, disconnected_at = now()
 where page_id = '600000000000002';

set local role service_role;
select is(
  (select count(*)::int from public.meta_connection_lookup_by_page('600000000000002')),
  0,
  'lookup de conexão disconnected não retorna conexão ativa');

-- ── authenticated (seller/manager) não acessa ────────────────────────────
reset role;
set local role authenticated;

select throws_ok(
  $$ select * from public.meta_connection_status('f3eeeeee-1111-1111-1111-111111111111') $$,
  '42501', null, 'authenticated não consegue chamar RPC de status');

select throws_ok(
  $$ select * from public.meta_connection_lookup_by_page('600000000000001') $$,
  '42501', null, 'authenticated não consegue chamar lookup');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-1111-1111-1111-111111111111', '600000000000003', 'x', 'fake-ct-f3-0013', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  '42501', null, 'authenticated não consegue chamar upsert');

select throws_ok(
  $$ select count(*) from public.company_meta_integrations $$,
  '42501', null, 'authenticated sem acesso direto à tabela');

reset role;

-- ── auditoria: somente metadados, uma linha por upsert bem-sucedido ─────
select is(
  (select count(*)::int from public.audit_log where action = 'meta_connection_upserted'),
  5,
  'audit_log registra cada upsert bem-sucedido (5 chamadas com sucesso)');

select is(
  (select count(*)::int from public.audit_log
   where action = 'meta_connection_upserted' and (after_data::text like '%fake-ct%' or before_data is not null)),
  0,
  'audit_log não contém ciphertext nem before_data');

select is(
  (select count(*)::int from public.audit_log where action = 'meta_connection_upserted' and company_id = 'f3eeeeee-2222-2222-2222-222222222222'),
  0,
  'conflito de page na company B não gera audit');

-- ── unique_violation de OUTRO índice não vira page_already_connected ─────
-- Índice único temporário de teste (rollback junto com a transação), usado
-- para provocar uma segunda unique_violation sem alterar o schema aprovado.
reset role;
create unique index company_meta_integrations_tmp_name_uniq
  on public.company_meta_integrations (page_name)
  where page_name = 'dup-f3-tmp';

set local role service_role;

select is(
  (select status from public.meta_connection_upsert(
     'f3eeeeee-1111-1111-1111-111111111111', '700000000000001', 'dup-f3-tmp', 'fake-ct-f3-0020', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null)),
  'connected',
  'cenário: primeira page com nome dup-f3-tmp');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f3eeeeee-2222-2222-2222-222222222222', '700000000000002', 'dup-f3-tmp', 'fake-ct-f3-0021', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  '23505',
  'duplicate key value violates unique constraint "company_meta_integrations_tmp_name_uniq"',
  'unique_violation de outro índice é re-raised com erro original (não vira page_already_connected)');

reset role;

select is(
  (select count(*)::int from public.company_meta_integrations where page_id = '700000000000002'),
  0,
  'violação re-raised não deixa linha parcial');

select is(
  (select count(*)::int from public.audit_log
   where action = 'meta_connection_upserted' and entity_id is not null
     and after_data->>'page_id' = '700000000000002'),
  0,
  'violação re-raised não gera audit');

select * from finish();
rollback;
