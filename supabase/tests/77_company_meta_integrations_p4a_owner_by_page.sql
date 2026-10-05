-- META-P4A — RPC meta_connection_owner_by_page (pgTAP): ownership metadata-only.
-- Ciphertexts fake. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

select has_function('public', 'meta_connection_owner_by_page', array['text'], 'RPC owner_by_page existe');

select ok(
  (select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'meta_connection_owner_by_page'),
  'owner_by_page é SECURITY DEFINER');

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'meta_connection_owner_by_page'),
  'owner_by_page tem search_path fixo vazio');

select ok(has_function_privilege('service_role', 'public.meta_connection_owner_by_page(text)', 'EXECUTE'),
  'service_role tem EXECUTE');
select ok(not has_function_privilege('anon', 'public.meta_connection_owner_by_page(text)', 'EXECUTE'),
  'anon sem EXECUTE');
select ok(not has_function_privilege('authenticated', 'public.meta_connection_owner_by_page(text)', 'EXECUTE'),
  'authenticated sem EXECUTE');
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.pronamespace = 'public'::regnamespace and p.proname = 'meta_connection_owner_by_page' and a.grantee = 0),
  'PUBLIC sem EXECUTE');

select ok(not has_table_privilege('service_role', 'public.company_meta_integrations', 'SELECT'),
  'tabela continua sem SELECT direto para service_role');
select ok(not has_table_privilege('authenticated', 'public.company_meta_integrations', 'SELECT'),
  'tabela continua sem SELECT direto para authenticated');

select is(
  (select array_agg(n order by ord) from pg_proc p,
     unnest(p.proargnames, p.proargmodes::text[]) with ordinality as t(n, m, ord)
   where p.proname = 'meta_connection_owner_by_page' and m = 't'),
  array['integration_id', 'company_id', 'page_id', 'status'],
  'retorno mínimo: sem ciphertext, key version, scopes, nome ou auditoria');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'meta_connection_owner_by_page'
     and p.prosrc ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
  0, 'nenhum UUID literal (inclusive TEST_COMPANY_ID) no corpo da RPC');

insert into public.companies (id, name) values
  ('f6eeeeee-1111-1111-1111-111111111111', 'Empresa F4A A'),
  ('f6eeeeee-2222-2222-2222-222222222222', 'Empresa F4A B');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f6000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f6user1@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active) values
  ('f6000000-0000-0000-0000-000000000001', 'F4A Usuario 1', 'f6user1@test.local', true);

insert into public.company_meta_integrations
  (company_id, page_id, page_name, access_token_ciphertext, token_key_version, granted_scopes, status, connected_at, connected_by)
values
  ('f6eeeeee-1111-1111-1111-111111111111', '900000000000001', 'Pagina F4A 1', 'fake-ct-f4a-0001', 1,
   array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], 'connected', now(),
   'f6000000-0000-0000-0000-000000000001'),
  ('f6eeeeee-2222-2222-2222-222222222222', '900000000000002', 'Pagina F4A 2', null, 1,
   array['pages_show_list'], 'disconnected', null, null),
  ('f6eeeeee-2222-2222-2222-222222222222', '900000000000003', 'Pagina F4A 3', null, 1,
   array['pages_show_list'], 'error', null, null);

set local role service_role;

select is(
  (select company_id from public.meta_connection_owner_by_page('900000000000001')),
  'f6eeeeee-1111-1111-1111-111111111111'::uuid,
  'page conectada retorna a company correta');

select is(
  (select count(*)::int from public.meta_connection_owner_by_page('900000000000002')),
  0, 'page disconnected não retorna ownership ativo');

select is(
  (select count(*)::int from public.meta_connection_owner_by_page('900000000000003')),
  0, 'page em error não retorna ownership ativo');

select is(
  (select count(*)::int from public.meta_connection_owner_by_page('900000000000999')),
  0, 'page sem conexão retorna zero linhas');

select is(
  (select count(*)::int from public.meta_connection_owner_by_page('900000000000001') r
   where r::text like '%fake-ct%' or r::text like '%pages_show_list%' or r::text like '%Pagina F4A%'),
  0, 'retorno não contém ciphertext, scopes nem nome da Page');

select throws_ok(
  $$ select * from public.meta_connection_owner_by_page('12a') $$,
  'P0001', 'invalid_input', 'page_id inválido falha');

select throws_ok(
  $$ select * from public.company_meta_integrations $$,
  '42501', null, 'service_role sem SELECT direto na tabela');

reset role;

set local role authenticated;
select throws_ok(
  $$ select * from public.meta_connection_owner_by_page('900000000000001') $$,
  '42501', null, 'authenticated não consegue chamar owner_by_page');
reset role;

select * from finish();
rollback;
