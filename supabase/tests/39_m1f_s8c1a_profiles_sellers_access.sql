-- M1-F S8-C1-A — fechamento do acesso direto a profiles/sellers
-- (20260728140000_m1f_s8c1a_close_profile_seller_access.sql). Prova:
-- (1) profiles_select_company foi removida e profiles_select_own e a
-- UNICA policy de SELECT restante em public.profiles — nenhum ator le
-- diretamente o profile de outra pessoa, nem Manager da mesma empresa,
-- nem Super Admin; (2) as quatro policies legadas de public.sellers
-- foram removidas, nenhuma substituta foi criada, e nenhum GRANT novo
-- foi concedido — a tabela permanece tao inalcancavel ao cliente quanto
-- sempre esteve; (3) nenhuma RPC SECURITY DEFINER (listagem ou ciclo de
-- vida) foi removida ou alterada por esta migration. Roda como
-- postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ── fixtures: duas empresas, manager+seller em cada, um Super Admin ──────
insert into public.companies (id, name, status) values
  ('ca100000-0000-0000-0000-000000000001', 'S8C1A Empresa A', 'ativa'),
  ('ca100000-0000-0000-0000-000000000002', 'S8C1A Empresa B', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8c1a-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8c1a-seller-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8c1a-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ca200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8c1a-superadmin@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('ca200000-0000-0000-0000-000000000001', 'Manager A', 's8c1a-manager-a@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000002', 'Seller A', 's8c1a-seller-a@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000003', 'Manager B', 's8c1a-manager-b@test.local', true, null),
  ('ca200000-0000-0000-0000-000000000004', 'Super Admin S8C1A', 's8c1a-superadmin@test.local', true, 'super_admin');

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('ca300000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000001', 'manager', true),
  ('ca300000-0000-0000-0000-000000000002', 'ca100000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000002', 'seller', true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id) values
  ('s8c1aSellerA', 'ca100000-0000-0000-0000-000000000001', 'Seller A', 'S8C1A-A',
   'ca200000-0000-0000-0000-000000000002', 'ca300000-0000-0000-0000-000000000002');

-- ══════════════════════════════════════════════════════════════════════
-- PROFILES
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true, 'RLS habilitada em public.profiles');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  1, 'public.profiles tem exatamente 1 policy no total');

select is(
  (select array_agg(policyname::text order by policyname::text) from pg_policies
    where schemaname = 'public' and tablename = 'profiles'),
  array['profiles_select_own'],
  'profiles_select_own e a UNICA policy restante de public.profiles');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_company'),
  0, 'profiles_select_company esta ausente');

-- ── Manager A: le o proprio profile, nao le o de Seller A (mesma empresa) ─
set local role authenticated;
select pg_temp.as_user('ca200000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.profiles where id = 'ca200000-0000-0000-0000-000000000001'),
  1, 'Manager A le o proprio profile');
select is(
  (select count(*)::int from public.profiles where id = 'ca200000-0000-0000-0000-000000000002'),
  0, 'Manager A NAO le o profile de Seller A (mesma empresa, leitura de terceiros e so via RPC)');
reset role;

-- ── Seller A: le o proprio profile, nao le o de Manager A ────────────────
set local role authenticated;
select pg_temp.as_user('ca200000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.profiles where id = 'ca200000-0000-0000-0000-000000000002'),
  1, 'Seller A le o proprio profile');
select is(
  (select count(*)::int from public.profiles where id = 'ca200000-0000-0000-0000-000000000001'),
  0, 'Seller A NAO le o profile de Manager A');
reset role;

-- ── Super Admin: le o proprio profile, nao le o de ninguem mais ─────────
set local role authenticated;
select pg_temp.as_user('ca200000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.profiles where id = 'ca200000-0000-0000-0000-000000000004'),
  1, 'Super Admin le o proprio profile');
select is(
  (select count(*)::int from public.profiles where id = 'ca200000-0000-0000-0000-000000000001'),
  0, 'Super Admin NAO le diretamente o profile de Manager A (sem SELECT amplo em profiles)');
select is(
  (select count(*)::int from public.profiles),
  1, 'Super Admin, sem filtro, ve so a propria linha');
reset role;

-- ── nenhuma escrita direta: sem policy de UPDATE (ja provado em
--    30_m1f_s5a1_profiles_hardening.sql; reconfirmado aqui no catalogo) ──
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'),
  0, 'nenhuma policy de UPDATE existe em public.profiles');

-- ══════════════════════════════════════════════════════════════════════
-- SELLERS
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select relrowsecurity from pg_class where oid = 'public.sellers'::regclass),
  true, 'RLS habilitada em public.sellers');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'sellers'
      and policyname in ('sellers_select_own', 'sellers_select_company', 'sellers_insert_admin', 'sellers_update_admin')),
  0, 'as quatro policies legadas de sellers estao ausentes');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'sellers'),
  0, 'public.sellers nao tem NENHUMA policy — nenhuma substituta foi criada nesta etapa');

-- ── nenhum grant novo em nenhuma operacao, para authenticated nem anon ───
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sellers'
      and grantee in ('authenticated', 'anon')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0, 'nenhum GRANT de SELECT/INSERT/UPDATE/DELETE em sellers para authenticated/anon (mesma exposicao de sempre: zero)');

-- ── tentativa client-side direta: SELECT nega antes mesmo de avaliar RLS
--    (sem GRANT de tabela, PostgREST/postgres recusa a operacao) ─────────
set local role authenticated;
select pg_temp.as_user('ca200000-0000-0000-0000-000000000001');
select throws_ok(
  $$select count(*) from public.sellers$$,
  '42501', null, 'Manager A: SELECT direto em sellers falha por ausencia de GRANT (permission denied), nao so por RLS');
select throws_ok(
  $$insert into public.sellers (id, company_id, name, first_name) values ('s8c1aHack', 'ca100000-0000-0000-0000-000000000001', 'Hack', 'H')$$,
  '42501', null, 'Manager A: INSERT direto em sellers falha por ausencia de GRANT');
reset role;

set local role anon;
select throws_ok(
  $$select count(*) from public.sellers$$,
  '42501', null, 'anon: SELECT direto em sellers falha por ausencia de GRANT');
reset role;

-- ── RPCs SECURITY DEFINER existentes nao foram removidas/alteradas ───────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_profile_seller_id_for_company'
      and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'),
  1, 'current_profile_seller_id_for_company continua SECURITY DEFINER de propriedade de postgres');

-- Helper continua funcionando normalmente para o Seller real da fixture
-- (a remocao das policies legadas de sellers nao afeta a resolucao via
-- membership, que nunca dependeu delas).
set local role authenticated;
select pg_temp.as_user('ca200000-0000-0000-0000-000000000002');
select is(
  public.current_profile_seller_id_for_company('ca100000-0000-0000-0000-000000000001'),
  's8c1aSellerA',
  'current_profile_seller_id_for_company continua resolvendo o seller correto (nunca dependeu de sellers_select_*)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- CONFIRMAÇÃO DE REGRESSÃO — catálogo de RPCs administrativas intacto
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'list_company_users', 'list_inactive_company_users',
      'current_profile_seller_id_for_company',
      'suspend_membership', 'reactivate_membership',
      'offboard_seller', 'offboard_manager', 'transfer_membership'
    )),
  8, 'as 8 RPCs administrativas/de ciclo de vida continuam no catalogo, nenhuma removida por esta migration');

-- ── nenhuma tabela/coluna foi removida POR ESTA migration (S8-C1-A só
--    tocou policies/grants) — M1-F S8-E2, em migration POSTERIOR, removeu
--    fisicamente company_id/role/seller_id de public.profiles; o conjunto
--    abaixo reflete o catálogo final após toda a suíte de migrations ─────
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('id', 'name', 'email', 'is_active', 'platform_role', 'created_at', 'updated_at')),
  7, 'as 7 colunas finais de public.profiles permanecem intactas (company_id/role/seller_id removidas pelo S8-E2)');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'sellers'
      and column_name in ('id', 'company_id', 'profile_id', 'membership_id', 'name', 'first_name', 'team', 'is_active', 'created_at', 'updated_at')),
  10, 'todas as 10 colunas de public.sellers permanecem intactas');

select finish();
rollback;
