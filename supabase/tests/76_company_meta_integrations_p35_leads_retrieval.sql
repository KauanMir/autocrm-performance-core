-- META-P3.5 — invariável de completude das quatro permissões obrigatórias do
-- Lead Ads em meta_connection_upsert (pgTAP). Ciphertexts fake. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── propriedades da RPC recriada (ACL inalterada) ────────────────────────
select ok(
  (select p.prosrc like '%c_required_scopes%' from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'meta_connection_upsert'),
  'RPC recriada com a regra de completude');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'meta_connection_upsert'
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  1,
  'RPC continua SECURITY DEFINER com search_path fixo');

select is(
  (select array_to_string(array_agg(a.grantee::regrole::text order by a.grantee::regrole::text), ',') from pg_proc p,
     aclexplode(p.proacl) a
   where p.pronamespace = 'public'::regnamespace and p.proname = 'meta_connection_upsert' and a.privilege_type = 'EXECUTE'),
  'postgres,service_role',
  'EXECUTE continua restrito a postgres (owner) e service_role');

select ok(
  not has_function_privilege('authenticated', 'public.meta_connection_upsert(uuid, text, text, text, smallint, text[], timestamp with time zone, uuid, timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.meta_connection_upsert(uuid, text, text, text, smallint, text[], timestamp with time zone, uuid, timestamp with time zone)', 'EXECUTE'),
  'authenticated e anon continuam sem EXECUTE');

-- ── fixtures ─────────────────────────────────────────────────────────────
insert into public.companies (id, name) values
  ('f5eeeeee-1111-1111-1111-111111111111', 'Empresa F35 A');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f5000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f5user1@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active) values
  ('f5000000-0000-0000-0000-000000000001', 'F35 Usuario 1', 'f5user1@test.local', true);

set local role service_role;

-- ── as quatro => permitido, independente da ordem ─────────────────────────
select is(
  (select status from public.meta_connection_upsert(
     'f5eeeeee-1111-1111-1111-111111111111', '800000000000001', 'Pagina F35 1', 'fake-ct-f35-0001', 1::smallint,
     array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(),
     'f5000000-0000-0000-0000-000000000001', null)),
  'connected',
  'as quatro permissões => permitido');

select is(
  (select status from public.meta_connection_upsert(
     'f5eeeeee-1111-1111-1111-111111111111', '800000000000002', 'Pagina F35 2', 'fake-ct-f35-0002', 1::smallint,
     array['leads_retrieval', 'pages_manage_metadata', 'pages_show_list', 'pages_read_engagement'], now(), null, null)),
  'connected',
  'mesmas quatro em ordem diferente => permitido');

-- ── faltando qualquer uma => rejeitado ───────────────────────────────────
select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000003', 'x', 'fake-ct-f35-0003', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'], now(), null, null) $$,
  'P0001', 'invalid_input', 'faltando leads_retrieval => rejeitado');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000004', 'x', 'fake-ct-f35-0004', 1::smallint,
       array['pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'faltando pages_show_list => rejeitado');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000005', 'x', 'fake-ct-f35-0005', 1::smallint,
       array['pages_show_list', 'pages_manage_metadata', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'faltando pages_read_engagement => rejeitado');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000006', 'x', 'fake-ct-f35-0006', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'faltando pages_manage_metadata => rejeitado');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000007', 'x', 'fake-ct-f35-0007', 1::smallint,
       array['pages_show_list'], now(), null, null) $$,
  'P0001', 'invalid_input', 'apenas uma permissão => rejeitado');

-- ── scope desconhecido => rejeitado ──────────────────────────────────────
select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000008', 'x', 'fake-ct-f35-0008', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'ads_management'], now(), null, null) $$,
  'P0001', 'invalid_input', 'scope desconhecido no lugar de leads_retrieval => rejeitado');

-- ── duplicatas não podem mascarar falta ──────────────────────────────────
select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000009', 'x', 'fake-ct-f35-0009', 1::smallint,
       array['leads_retrieval', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement'], now(), null, null) $$,
  'P0001', 'invalid_input', 'duplicata + pages_manage_metadata faltando => rejeitado');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000010', 'x', 'fake-ct-f35-0010', 1::smallint,
       array['pages_show_list', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'], now(), null, null) $$,
  'P0001', 'invalid_input', 'duplicata de pages_show_list sem leads_retrieval => rejeitado');

-- ── cinco entradas => rejeitado ──────────────────────────────────────────
select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000011', 'x', 'fake-ct-f35-0011', 1::smallint,
       array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval', 'leads_retrieval'], now(), null, null) $$,
  'P0001', 'invalid_input', 'cinco entradas (duplicata) => rejeitado');

select throws_ok(
  $$ select * from public.meta_connection_upsert(
       'f5eeeeee-1111-1111-1111-111111111111', '800000000000012', 'x', 'fake-ct-f35-0012', 1::smallint,
       '{}'::text[], now(), null, null) $$,
  'P0001', 'invalid_input', 'array vazio => rejeitado');

reset role;

-- ── nada parcial após as rejeições: só as duas conexões válidas ──────────
select is(
  (select count(*)::int from public.company_meta_integrations where company_id = 'f5eeeeee-1111-1111-1111-111111111111'),
  2,
  'apenas as duas conexões válidas foram persistidas');

select * from finish();
rollback;
