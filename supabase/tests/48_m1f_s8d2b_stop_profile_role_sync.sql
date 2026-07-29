-- M1-F S8-D2-B — fim da sincronização legada de profiles.role dentro de
-- update_membership_role (20260729170000_m1f_s8d2b_stop_profile_role_sync.sql,
-- docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §44). Cobre: catálogo
-- (assinatura/grants/search_path inalterados), Seller->Manager e
-- Manager->Seller sem sincronizar profiles.role, legado divergente nunca
-- concede/retira autoridade, e que erros continuam sem escrita parcial.
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

-- profiles.role continua existindo fisicamente (reservada ao S8-E) e
-- accept_invite continua intacto (fora de escopo desta etapa).
select has_column('public'::name, 'profiles'::name, 'role'::name,
  'profiles.role continua existindo fisicamente — remoção física fica para o S8-E');
select has_function('public'::name, 'accept_invite'::name, array['text']::name[],
  'accept_invite continua existindo, intocado nesta etapa');

-- M1-F S8-E1: os helpers legados M1-C (current_profile_role,
-- is_manager_or_admin, current_profile_company_id, current_profile_
-- seller_id) foram removidos fisicamente do catálogo numa etapa
-- posterior — cobertura completa da remoção em
-- 49_m1f_s8e1_drop_legacy_profile_helpers.sql. No momento do S8-D2-B
-- (esta migration) eles ainda existiam, sem nenhum consumidor ativo
-- (auditoria S8-D2-B) — essa garantia intermediária não é mais o estado
-- atual do catálogo, por isso não é mais afirmada aqui.

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

-- role legado 'seller'/'manager' abaixo COINCIDE de propósito com o papel
-- ATUAL da membership no início do teste — isso prova que a divergência
-- é introduzida pela própria mudança real de role (nunca mais
-- reconciliada), não uma fixture já desalinhada de partida.
insert into public.profiles (id, name, email, role, is_active, platform_role) values
  ('f8d10000-0000-0000-0000-000000000001', 'S8D2B Super Admin', 's8d2b-superadmin@test.local', 'seller', true, 'super_admin'),
  ('f8d10000-0000-0000-0000-000000000002', 'S8D2B Manager Companion', 's8d2b-manager-companion@test.local', 'manager', true, null),
  ('f8d10000-0000-0000-0000-000000000003', 'S8D2B Seller Target', 's8d2b-seller-target@test.local', 'seller', true, null),
  ('f8d10000-0000-0000-0000-000000000004', 'S8D2B Manager Target', 's8d2b-manager-target@test.local', 'manager', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, created_at) values
  ('f8d30000-0000-0000-0000-000000000002', 'f8d20000-0000-0000-0000-000000000001', 'f8d10000-0000-0000-0000-000000000002', 'manager', true, now()),
  ('f8d30000-0000-0000-0000-000000000003', 'f8d20000-0000-0000-0000-000000000001', 'f8d10000-0000-0000-0000-000000000003', 'seller',  true, now()),
  ('f8d30000-0000-0000-0000-000000000004', 'f8d20000-0000-0000-0000-000000000001', 'f8d10000-0000-0000-0000-000000000004', 'manager', true, now());

insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('s8d2b-target', 'f8d20000-0000-0000-0000-000000000001', 'f8d30000-0000-0000-0000-000000000003', 'f8d10000-0000-0000-0000-000000000003', 'S8D2B Seller Target', 'S8D2B', true);

-- ══════════════════════════════════════════════════════════════════════
-- 2. SELLER -> MANAGER: profiles.role nunca sincroniza
-- ══════════════════════════════════════════════════════════════════════

select is((select role from public.profiles where id = 'f8d10000-0000-0000-0000-000000000003'), 'seller'::public.user_role, '1. antes: profiles.role = seller (em sincronia com a membership)');
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
  (select role from public.profiles where id = 'f8d10000-0000-0000-0000-000000000003'),
  'seller'::public.user_role, '1. profiles.role NUNCA sincroniza — continua seller mesmo com a membership virando manager (S8-D2-B)');
select is(
  (select membership_id from public.sellers where id = 's8d2b-target'),
  null::uuid, '1. seller desvinculado (membership_id NULL) apos a promocao — lifecycle preservado');
select is(
  (select is_active from public.sellers where id = 's8d2b-target'),
  false, '1. seller inativado apos a promocao — lifecycle preservado');
select is(
  (select (before_data->>'profile_role')::public.user_role from public.audit_log
    where entity_id = 'f8d30000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  'seller'::public.user_role, '1. audit_log.before_data.profile_role mostra o valor REAL (seller), nunca um valor esperado');
select is(
  (select (after_data->>'profile_role')::public.user_role from public.audit_log
    where entity_id = 'f8d30000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  'seller'::public.user_role, '1. audit_log.after_data.profile_role IGUAL ao before (nunca afirma que profiles.role foi alterado)');
select is(
  (select action from public.audit_log where entity_id = 'f8d30000-0000-0000-0000-000000000003' order by occurred_at desc limit 1),
  'user_membership_role_updated', '1. audit_log criado normalmente para a mudanca real de membership');

-- ══════════════════════════════════════════════════════════════════════
-- 3. MANAGER -> SELLER: profiles.role nunca sincroniza (sem historico de seller)
-- ══════════════════════════════════════════════════════════════════════

select is((select role from public.profiles where id = 'f8d10000-0000-0000-0000-000000000004'), 'manager'::public.user_role, '2. antes: profiles.role = manager (em sincronia com a membership)');

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
  (select role from public.profiles where id = 'f8d10000-0000-0000-0000-000000000004'),
  'manager'::public.user_role, '2. profiles.role NUNCA sincroniza — continua manager mesmo com a membership virando seller (S8-D2-B)');
select is(
  (select count(*)::int from public.sellers where profile_id = 'f8d10000-0000-0000-0000-000000000004' and company_id = 'f8d20000-0000-0000-0000-000000000001' and is_active),
  1, '2. exatamente 1 seller ativo criado — lifecycle preservado');
select is(
  (select (before_data->>'profile_role')::public.user_role from public.audit_log
    where entity_id = 'f8d30000-0000-0000-0000-000000000004' order by occurred_at desc limit 1),
  'manager'::public.user_role, '2. audit_log.before_data.profile_role mostra o valor REAL (manager)');
select is(
  (select (after_data->>'profile_role')::public.user_role from public.audit_log
    where entity_id = 'f8d30000-0000-0000-0000-000000000004' order by occurred_at desc limit 1),
  'manager'::public.user_role, '2. audit_log.after_data.profile_role IGUAL ao before (nunca afirma alteracao)');

-- ══════════════════════════════════════════════════════════════════════
-- 4. IDEMPOTÊNCIA: profiles.role divergente NUNCA conta como trabalho pendente
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
  0, '3. chamada idempotente (profiles.role="seller" divergente da membership="manager") NAO cria auditoria nova — a divergencia nunca conta como trabalho pendente');
select is(
  (select role from public.profiles where id = 'f8d10000-0000-0000-0000-000000000003'),
  'seller'::public.user_role, '3. profiles.role continua seller (permanece divergente para sempre — comportamento esperado por design)');

-- ══════════════════════════════════════════════════════════════════════
-- 5. LEGADO DIVERGENTE: profiles.role nunca concede nem retira autoridade
-- ══════════════════════════════════════════════════════════════════════

-- profiles.role='seller' no ator Super Admin (fixture deliberada, linha
-- 1) nunca interferiu na autorizacao — a chamada acima (secoes 2-4) so
-- funcionou porque platform_role='super_admin', nunca por causa do role
-- legado. No momento desta migration, current_profile_role()/
-- is_manager_or_admin() (helpers legados) ainda existiam no catálogo e
-- continuavam lendo profiles.role, mas nenhuma policy/RPC ativa os
-- consultava — comprovado empiricamente pela ausencia de qualquer
-- policy/funcao no catalogo ativo que os referencie (auditoria S8-D2-B).
-- Removidos fisicamente numa etapa posterior (S8-E1).
set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000004'); -- Manager Target: profiles.role legado='manager', platform_role=null
select is(
  public.is_platform_super_admin(),
  false, '4. Manager Target (profiles.role legado="manager", platform_role=null) NUNCA e tratado como Super Admin — helper real ignora profiles.role');
reset role;

-- Manager com profiles.role legado divergente continua barrado de chamar
-- a RPC (autorizacao e' platform_role, nunca profiles.role) — profile
-- role='manager' aqui nao amplia nada.
set local role authenticated;
select pg_temp.as_user('f8d10000-0000-0000-0000-000000000004'); -- Manager Target (agora seller de fato, profiles.role ainda diz 'manager')
select throws_ok(
  $$select * from public.update_membership_role('f8d30000-0000-0000-0000-000000000002', 'f8d20000-0000-0000-0000-000000000001', 'seller')$$,
  '42501', 'forbidden', '4. profiles.role legado "manager" NAO concede autoridade de Super Admin — continua forbidden');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. ERROS: nenhuma escrita parcial, profiles.role sempre intacto
-- ══════════════════════════════════════════════════════════════════════

select role as profile_role_before_err_2 from public.profiles where id = 'f8d10000-0000-0000-0000-000000000002' \gset
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
  (select role from public.profiles where id = 'f8d10000-0000-0000-0000-000000000002'),
  :'profile_role_before_err_2'::public.user_role, '5. profiles.role do alvo intacto apos as 3 falhas acima');
select is(
  (select role from public.company_memberships where id = 'f8d30000-0000-0000-0000-000000000002'),
  :'membership_role_before_err_2'::public.company_role, '5. company_memberships.role do alvo intacto apos as 3 falhas acima (nenhuma alteracao parcial)');

select * from finish();
rollback;
