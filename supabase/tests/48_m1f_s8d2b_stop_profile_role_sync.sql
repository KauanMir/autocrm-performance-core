-- M1-F S8-D2-B — fim da sincronização legada de profiles.role dentro de
-- update_membership_role (20260729170000_m1f_s8d2b_stop_profile_role_sync.sql,
-- docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §44). Cobre: catálogo
-- (assinatura/grants/search_path inalterados), Seller->Manager e
-- Manager->Seller sem sincronizar profiles.role, e que erros continuam sem
-- escrita parcial.
--
-- M1-F S8-E2: profiles.role foi removida fisicamente do catálogo (a coluna
-- que este arquivo originalmente provava "nunca sincronizar" deixou de
-- existir) e o Migration 1 do S8-E2 redefiniu update_membership_role para
-- também parar de LER profiles.role (a chave profile_role saiu por
-- completo de before_data/after_data no audit_log, decisão humana
-- registrada em §46). As asserções que comparavam profiles.role
-- antes/depois e as que liam before_data/after_data->>'profile_role' foram
-- removidas — o comportamento real que restou (membership.role muda,
-- lifecycle de sellers preservado, idempotência, autorização por
-- platform_role, nenhuma escrita parcial em erro) continua integralmente
-- coberto abaixo.
-- Fixtures sintéticas @test.local, transação com rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO — assinatura/grants/search_path inalterados
-- ══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'update_membership_role'::name,
  array['uuid', 'uuid', 'company_role']::name[],
  'update_membership_role continua com a mesma assinatura (p_membership_id uuid, p_company_id uuid, p_role company_role)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_membership_role'),
  1, 'exatamente uma sobrecarga de update_membership_role');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_membership_role'),
  true, 'SECURITY DEFINER preservado');

select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_membership_role'),
  array['search_path=""']::text[], 'search_path='''' preservado');

select ok(
  not has_function_privilege('public', 'public.update_membership_role(uuid,uuid,company_role)', 'EXECUTE'),
  'public sem EXECUTE (inalterado)');
select ok(
  not has_function_privilege('anon', 'public.update_membership_role(uuid,uuid,company_role)', 'EXECUTE'),
  'anon sem EXECUTE (inalterado)');
select ok(
  has_function_privilege('authenticated', 'public.update_membership_role(uuid,uuid,company_role)', 'EXECUTE'),
  'authenticated com EXECUTE (inalterado)');

select has_function('public'::name, 'accept_invite'::name, array['text']::name[],
  'accept_invite continua existindo, intocado nesta etapa');

-- update_membership_role nunca mais escreve OU lê profiles.role — a chave
-- profile_role deixou de existir em before_data/after_data (decisão S8-E2).
-- Checa a chave jsonb literal (com aspas), não a substring "profile_role"
-- crua, que também aparece num comentário explicativo no corpo da função.
select is(
  (select p.prosrc ilike '%''profile_role''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_membership_role'),
  false, 'update_membership_role nao constroi mais a chave jsonb ''profile_role'' em lugar nenhum do corpo (S8-E2)');

-- ══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('f8d20000-0000-0000-0000-000000000001', 'S8D2B Empresa A', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f8d10000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8d2b-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f8d10000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8d2b-manager-companion@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f8d10000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8d2b-seller-target@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f8d10000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8d2b-manager-target@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('f8d10000-0000-0000-0000-000000000001', 'S8D2B Super Admin', 's8d2b-superadmin@test.local', true, 'super_admin'),
  ('f8d10000-0000-0000-0000-000000000002', 'S8D2B Manager Companion', 's8d2b-manager-companion@test.local', true, null),
  ('f8d10000-0000-0000-0000-000000000003', 'S8D2B Seller Target', 's8d2b-seller-target@test.local', true, null),
  ('f8d10000-0000-0000-0000-000000000004', 'S8D2B Manager Target', 's8d2b-manager-target@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, created_at) values
  ('f8d30000-0000-0000-0000-000000000002', 'f8d20000-0000-0000-0000-000000000001', 'f8d10000-0000-0000-0000-000000000002', 'manager', true, now()),
  ('f8d30000-0000-0000-0000-000000000003', 'f8d20000-0000-0000-0000-000000000001', 'f8d10000-0000-0000-0000-000000000003', 'seller',  true, now()),
  ('f8d30000-0000-0000-0000-000000000004', 'f8d20000-0000-0000-0000-000000000001', 'f8d10000-0000-0000-0000-000000000004', 'manager', true, now());

insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s8d2b-target', 'f8d20000-0000-0000-0000-000000000001', 'f8d30000-0000-0000-0000-000000000003', 'f8d10000-0000-0000-0000-000000000003', 'S8D2B Seller Target', 'S8D2B', true);

-- ══════════════════════════════════════════════════════════════════════
-- 2. SELLER -> MANAGER
-- ══════════════════════════════════════════════════════════════════════

select is((select role from public.company_memberships where id = 'f8d30000-0000-0000-0000-000000000003'), 'seller'::public.company_role, '1. antes: membership.role = seller');

set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000001'); -- Super Admin
select lives_ok(
  $$select * from public.update_membership_role('f8d30000-0000-0000-0000-000000000003', 'f8d20000-0000-0000-0000-000000000001', 'manager')$$,
  '1. Seller Target promovido a Manager, sem erro');
reset role;

select is(
  (select role from public.company_memberships where id = 'f8d30000-0000-0000-0000-000000000003'),
  'manager'::public.company_role, '1. membership.role agora e manager');
select is(
  (select membership_id from public.sellers where id = 's8d2b-target'),
  null::uuid, '1. seller desvinculado (membership_id NULL) apos a promocao — lifecycle preservado');
select is(
  (select is_active from public.sellers where id = 's8d2b-target'),
  false, '1. seller inativado apos a promocao — lifecycle preservado');
select is(
  (select action from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  'user_membership_role_updated', '1. audit_log criado normalmente para a mudanca real de membership');
select ok(
  not ((select before_data from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000003' order by occurred_at desc limit 1) ? 'profile_role'),
  '1. audit_log.before_data NAO contem a chave profile_role (removida no S8-E2)');
select ok(
  not ((select after_data from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000003' order by occurred_at desc limit 1) ? 'profile_role'),
  '1. audit_log.after_data NAO contem a chave profile_role (removida no S8-E2)');

-- ══════════════════════════════════════════════════════════════════════
-- 3. MANAGER -> SELLER (sem historico de seller)
-- ══════════════════════════════════════════════════════════════════════

select is((select role from public.company_memberships where id = 'f8d30000-0000-0000-0000-000000000004'), 'manager'::public.company_role, '2. antes: membership.role = manager');

set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000001'); -- Super Admin
select lives_ok(
  $$select * from public.update_membership_role('f8d30000-0000-0000-0000-000000000004', 'f8d20000-0000-0000-0000-000000000001', 'seller')$$,
  '2. Manager Target rebaixado a Seller (novo seller criado, sem historico previo), sem erro');
reset role;

select is(
  (select role from public.company_memberships where id = 'f8d30000-0000-0000-0000-000000000004'),
  'seller'::public.company_role, '2. membership.role agora e seller');
select is(
  (select count(*)::int from public.sellers where profile_id = 'f8d10000-0000-0000-0000-000000000004' and company_id = 'f8d20000-0000-0000-0000-000000000001' and is_active),
  1, '2. exatamente 1 seller ativo criado — lifecycle preservado');
select ok(
  not ((select before_data from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000004' order by occurred_at desc limit 1) ? 'profile_role'),
  '2. audit_log.before_data NAO contem a chave profile_role');
select ok(
  not ((select after_data from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000004' order by occurred_at desc limit 1) ? 'profile_role'),
  '2. audit_log.after_data NAO contem a chave profile_role');

-- ══════════════════════════════════════════════════════════════════════
-- 4. IDEMPOTÊNCIA
-- ══════════════════════════════════════════════════════════════════════

select count(*)::int as audit_before_003 from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000003' \gset

set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000001');
select lives_ok(
  $$select * from public.update_membership_role('f8d30000-0000-0000-0000-000000000003', 'f8d20000-0000-0000-0000-000000000001', 'manager')$$,
  '3. chamar de novo com a MESMA role (manager): membership ja correta, seller ja desvinculado — idempotente');
reset role;

select is(
  (select count(*)::int from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000003') - :audit_before_003,
  0, '3. chamada idempotente NAO cria auditoria nova');

-- ══════════════════════════════════════════════════════════════════════
-- 5. AUTORIZAÇÃO: somente platform_role decide, Manager continua barrado
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000004'); -- Manager Target (agora seller de fato)
select is(
  public.is_platform_super_admin(),
  false, '4. Manager Target (platform_role=null) NUNCA e tratado como Super Admin');
reset role;

set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000004');
select throws_ok(
  $$select * from public.update_membership_role('f8d30000-0000-0000-0000-000000000002', 'f8d20000-0000-0000-0000-000000000001', 'seller')$$,
  '42501', 'forbidden', '4. Manager continua barrado de chamar a RPC (autorizacao e exclusivamente platform_role)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. ERROS: nenhuma escrita parcial
-- ══════════════════════════════════════════════════════════════════════

select role as membership_role_before_err_2 from public.company_memberships where id = 'f8d30000-0000-0000-0000-000000000002' \gset

set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000001'); -- Super Admin
select throws_ok(
  $$select * from public.update_membership_role('f8d30000-0000-0000-0000-000000000002', 'f8d20000-0000-0000-0000-000000000001', null)$$,
  '22023', 'invalid_role', '5. p_role NULL invalido — nenhuma escrita');
select throws_ok(
  $$select * from public.update_membership_role('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f8d20000-0000-0000-0000-000000000001', 'manager')$$,
  'P0002', 'membership_not_found', '5. membership inexistente — nenhuma escrita');
select throws_ok(
  $$select * from public.update_membership_role('f8d30000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manager')$$,
  'P0002', 'membership_not_found', '5. empresa errada (nao bate com a membership real) — nenhuma escrita');
reset role;

select is(
  (select role from public.company_memberships where id = 'f8d30000-0000-0000-0000-000000000002'),
  :'membership_role_before_err_2'::public.company_role, '5. company_memberships.role do alvo intacto apos as 3 falhas acima (nenhuma alteracao parcial)');

select * from finish();
rollback;
