-- META-PERSISTENCE-P2 — estrutura de public.company_meta_integrations (pgTAP).
-- Cobre schema, constraints, índices, FKs, RLS fechado e revogações.
-- Ciphertexts são claramente fake. Nenhum token real. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

select is(
  (select count(*)::int from public.company_meta_integrations),
  0,
  'tabela nasce vazia (nenhum token persistido nesta fase)');

select has_table('public', 'company_meta_integrations', 'tabela existe no schema public');

select columns_are(
  'public', 'company_meta_integrations',
  array[
    'id', 'company_id', 'page_id', 'page_name', 'access_token_ciphertext',
    'token_key_version', 'granted_scopes', 'status', 'leadgen_subscribed_at',
    'connected_at', 'connected_by', 'disconnected_at', 'last_error_code',
    'last_error_at', 'created_at', 'updated_at'
  ],
  'colunas exatas do schema aprovado');

select col_type_is('public', 'company_meta_integrations', 'id', 'uuid', 'id é uuid');
select col_type_is('public', 'company_meta_integrations', 'token_key_version', 'smallint', 'key version é smallint');
select col_type_is('public', 'company_meta_integrations', 'granted_scopes', 'text[]', 'scopes é text[]');

-- ── RLS e privilégios ────────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'public.company_meta_integrations'::regclass),
  'RLS habilitado');

select ok(
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_meta_integrations'),
  'zero policies (nenhum acesso via browser/authenticated nesta fase)');

select ok(
  not exists (
    select 1
    from aclexplode((select relacl from pg_class where oid = 'public.company_meta_integrations'::regclass)) a
    where a.grantee = 0
  ),
  'PUBLIC sem nenhum privilégio na tabela');

select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.company_meta_integrations', p)),
  0,
  'anon, authenticated e service_role sem SELECT/INSERT/UPDATE/DELETE');

-- ── FKs ───────────────────────────────────────────────────────────────────
select fk_ok('public', 'company_meta_integrations', 'company_id', 'public', 'companies', 'id');
select fk_ok('public', 'company_meta_integrations', 'connected_by', 'public', 'profiles', 'id');

select is(
  (select confdeltype::text from pg_constraint
   where conrelid = 'public.company_meta_integrations'::regclass and contype = 'f'
     and confrelid = 'public.companies'::regclass),
  'c',
  'company_id ON DELETE CASCADE');

select is(
  (select confdeltype::text from pg_constraint
   where conrelid = 'public.company_meta_integrations'::regclass and contype = 'f'
     and confrelid = 'public.profiles'::regclass),
  'n',
  'connected_by ON DELETE SET NULL');

-- ── índices e trigger ─────────────────────────────────────────────────────
select col_is_unique('public', 'company_meta_integrations', array['company_id', 'page_id'],
  'UNIQUE (company_id, page_id)');

select ok(
  (select i.indisunique and i.indpred is not null
   from pg_index i where i.indexrelid = 'public.company_meta_integrations_page_connected_uniq'::regclass),
  'índice único parcial em page_id WHERE status = connected');

select has_trigger('public', 'company_meta_integrations', 'company_meta_integrations_set_updated_at',
  'trigger updated_at presente');

-- ── fixtures ──────────────────────────────────────────────────────────────
insert into public.companies (id, name) values
  ('f2eeeeee-1111-1111-1111-111111111111', 'Empresa F2 A'),
  ('f2eeeeee-2222-2222-2222-222222222222', 'Empresa F2 B');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f2user1@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active) values
  ('f2000000-0000-0000-0000-000000000001', 'F2 Usuario 1', 'f2user1@test.local', true);

-- ── constraints de valor ──────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '12a', 'disconnected') $$,
  '23514', null, 'page_id com letras é rejeitado');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '', 'disconnected') $$,
  '23514', null, 'page_id vazio é rejeitado');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', repeat('9', 31), 'disconnected') $$,
  '23514', null, 'page_id com 31 dígitos é rejeitado');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', repeat('9', 30), 'disconnected') $$,
  'page_id com 30 dígitos é aceito (limite)');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, page_name, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000001', repeat('a', 201), 'disconnected') $$,
  '23514', null, 'page_name com 201 caracteres é rejeitado');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, page_name, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000002', repeat('a', 200), 'disconnected') $$,
  'page_name com 200 caracteres é aceito (limite)');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000003', 'pending') $$,
  '23514', null, 'status inválido é rejeitado');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, token_key_version)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000004', 'disconnected', 0) $$,
  '23514', null, 'token_key_version 0 é rejeitado');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, connected_at)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000005', 'connected', now()) $$,
  '23514',
  'new row for relation "company_meta_integrations" violates check constraint "company_meta_integrations_connected_ciphertext_ck"',
  'status connected sem ciphertext é rejeitado (com connected_at preenchido)');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000006', 'disconnected') $$,
  'disconnected sem ciphertext é permitido');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, last_error_code)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000007', 'error', 'token_invalid') $$,
  'error sem ciphertext com código machine-readable é permitido');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, last_error_code)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000008', 'error', repeat('a', 65)) $$,
  '23514', null, 'last_error_code com 65 caracteres é rejeitado');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, last_error_code)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000009', 'error', 'Bad Code') $$,
  '23514', null, 'last_error_code fora do formato snake_case é rejeitado');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, access_token_ciphertext, connected_at)
     values ('f2eeeeee-2222-2222-2222-222222222222', '300000000000001', 'connected', 'fake-ciphertext-schema-test-only', now()) $$,
  'connected com ciphertext fake e connected_at é aceito (apenas estrutura)');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-2222-2222-2222-222222222222', '300000000000003', 'disconnected') $$,
  'connected_by NULL é aceito');

-- ── unicidade ─────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '200000000000006', 'disconnected') $$,
  '23505', null, 'mesma company + mesma page viola UNIQUE (company_id, page_id)');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, access_token_ciphertext, connected_at)
     values ('f2eeeeee-1111-1111-1111-111111111111', '300000000000001', 'connected', 'fake-ciphertext-schema-test-only', now()) $$,
  '23505', null, 'mesma page connected em DUAS companies é bloqueada pelo índice parcial');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '300000000000001', 'disconnected') $$,
  'mesma page disconnected em outra company não viola o índice parcial');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-1111-1111-1111-111111111111', '300000000000002', 'disconnected') $$,
  'duas linhas disconnected de companies distintas (page igual) são permitidas');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status)
     values ('f2eeeeee-2222-2222-2222-222222222222', '300000000000002', 'disconnected') $$,
  'page igual em outra company, ambas disconnected, é permitido');

-- ── connected_at e limite defensivo do ciphertext ─────────────────────────
select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, access_token_ciphertext)
     values ('f2eeeeee-1111-1111-1111-111111111111', '500000000000001', 'connected', 'fake-ciphertext-schema-test-only') $$,
  '23514',
  'new row for relation "company_meta_integrations" violates check constraint "company_meta_integrations_connected_at_ck"',
  'connected sem connected_at é rejeitado');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, access_token_ciphertext, connected_at)
     values ('f2eeeeee-1111-1111-1111-111111111111', '500000000000002', 'connected', 'fake-ciphertext-schema-test-only', now()) $$,
  'connected com connected_at é permitido');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, access_token_ciphertext, connected_at)
     values ('f2eeeeee-1111-1111-1111-111111111111', '500000000000003', 'connected', repeat('x', 4096), now()) $$,
  'ciphertext com exatamente 4096 caracteres é permitido (limite)');

select throws_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, access_token_ciphertext, connected_at)
     values ('f2eeeeee-1111-1111-1111-111111111111', '500000000000004', 'connected', repeat('x', 4097), now()) $$,
  '23514',
  'new row for relation "company_meta_integrations" violates check constraint "company_meta_integrations_ciphertext_len_ck"',
  'ciphertext com 4097 caracteres é rejeitado');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, connected_at)
     values ('f2eeeeee-1111-1111-1111-111111111111', '500000000000005', 'disconnected', now() - interval '1 day') $$,
  'disconnected mantém connected_at histórico, sem ciphertext');

select lives_ok(
  $$ insert into public.company_meta_integrations (company_id, page_id, status, connected_at, last_error_code, last_error_at)
     values ('f2eeeeee-1111-1111-1111-111111111111', '500000000000006', 'error', now() - interval '2 days', 'token_invalid', now()) $$,
  'error mantém connected_at histórico, sem ciphertext');

-- ── comportamento de exclusão ─────────────────────────────────────────────
insert into public.company_meta_integrations (company_id, page_id, status, connected_by)
values ('f2eeeeee-1111-1111-1111-111111111111', '400000000000001', 'disconnected', 'f2000000-0000-0000-0000-000000000001');

delete from public.profiles where id = 'f2000000-0000-0000-0000-000000000001';

select is(
  (select connected_by from public.company_meta_integrations where page_id = '400000000000001'),
  null::uuid,
  'excluir profile define connected_by = NULL (SET NULL), linha preservada');

select is(
  (select count(*)::int from public.company_meta_integrations where page_id = '400000000000001'),
  1,
  'linha continua existindo após excluir o profile');

delete from public.companies where id = 'f2eeeeee-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from public.company_meta_integrations where company_id = 'f2eeeeee-2222-2222-2222-222222222222'),
  0,
  'excluir company remove suas integrações (CASCADE)');

select * from finish();
rollback;
