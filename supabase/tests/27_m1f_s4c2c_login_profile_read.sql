-- M1-F S4-C2C hotfix — GRANT SELECT em public.profiles para authenticated
-- (20260721150000_m1f_s4c2c_login_profile_read.sql). Prova que o gap de
-- login pré-existente foi fechado SEM enfraquecer isolamento: anon
-- continua bloqueado, authenticated só lê o que profiles_select_own/
-- profiles_select_company já permitiam, nenhuma coluna extra
-- (created_at/updated_at) foi exposta, e nenhum INSERT/UPDATE/DELETE foi
-- concedido a ninguém por esta migration.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ── fixtures: duas empresas, um manager e um seller em cada, mais um
--    Super Admin de plataforma (sem empresa) ────────────────────────────
insert into public.companies (id, name, status) values
  ('fb000000-0000-0000-0000-000000000001', 'S4C2C Login Empresa A', 'ativa'),
  ('fb000000-0000-0000-0000-000000000002', 'S4C2C Login Empresa B', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fb100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's4c2c-login-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fb100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's4c2c-login-seller-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fb100000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's4c2c-login-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fb100000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's4c2c-login-superadmin@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active, platform_role) values
  ('fb100000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', 'Manager A', 's4c2c-login-manager-a@test.local', 'manager', true, null),
  ('fb100000-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-000000000001', 'Seller A', 's4c2c-login-seller-a@test.local', 'seller', true, null),
  ('fb100000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000002', 'Manager B', 's4c2c-login-manager-b@test.local', 'manager', true, null),
  ('fb100000-0000-0000-0000-000000000004', null, 'Super Admin Login', 's4c2c-login-superadmin@test.local', 'seller', true, 'super_admin');

-- ══════════════════════════════════════════════════════════════════════
-- GRANTS: exatamente o esperado, nada a mais
-- ══════════════════════════════════════════════════════════════════════

-- ── anon continua SEM select em nenhuma coluna de profiles ──────────────
select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'anon' and privilege_type = 'SELECT'),
  0, 'anon continua sem SELECT em nenhuma coluna de profiles');

-- ── authenticated tem SELECT exatamente nas 8 colunas esperadas, nunca
--    created_at/updated_at, nunca mais nem menos ────────────────────────
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array[
    'id','company_id','name','email','role','seller_id','is_active','platform_role'
  ]) as c),
  'authenticated tem SELECT exatamente nas 8 colunas usadas por _loadProfile(), nunca created_at/updated_at');

-- ── nenhum INSERT/UPDATE/DELETE foi concedido a authenticated por esta
--    migration (a fixture do S4-C2C não altera privilégios de escrita) ──
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'nenhum INSERT/UPDATE/DELETE foi concedido a authenticated em profiles');

-- ── service_role e anon continuam sem qualquer privilégio de escrita
--    novo (fora do escopo desta migration, que só toca SELECT) ─────────
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon','service_role') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'anon e service_role continuam sem SELECT/INSERT/UPDATE/DELETE em profiles');

-- ── sellers e company_memberships não receberam nenhum grant novo desta
--    migration (fora de escopo — nenhum código client-side as consulta) ─
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sellers'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  0, 'sellers continua sem SELECT para authenticated (fora de escopo do hotfix)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  0, 'company_memberships continua sem SELECT para authenticated (fora de escopo do hotfix)');

-- ══════════════════════════════════════════════════════════════════════
-- COMPORTAMENTO REAL: cada papel lê exatamente o que deveria
-- ══════════════════════════════════════════════════════════════════════

-- ── Manager A lê o próprio profile (profiles_select_own) ────────────────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000001'),
  1, 'Manager A consegue ler o proprio profile');
reset role;

-- ── Seller A lê o próprio profile (profiles_select_own) ──────────────────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000002'),
  1, 'Seller A consegue ler o proprio profile');
reset role;

-- ── Super Admin (company_id null) lê o próprio profile normalmente ──────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000004'),
  1, 'Super Admin consegue ler o proprio profile mesmo com company_id null');
reset role;

-- ── Manager A vê os profiles da PRÓPRIA empresa (profiles_select_company
--    + is_manager_or_admin()) — Manager A e Seller A, nunca Manager B ───
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.profiles where company_id = 'fb000000-0000-0000-0000-000000000001'),
  2, 'Manager A ve os 2 profiles da propria empresa (ele mesmo + Seller A)');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000003'),
  0, 'Manager A NAO consegue ler o Manager B (empresa diferente) mesmo tentando por id direto');
reset role;

-- ── Seller A (não é manager/admin) NÃO enxerga o resto da empresa, só a
--    si mesmo — profiles_select_company exige is_manager_or_admin() ─────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.profiles where company_id = 'fb000000-0000-0000-0000-000000000001'),
  1, 'Seller A ve so a propria linha na empresa, nunca a do Manager A (nao e manager/admin)');
reset role;

-- ── isolamento entre empresas: Manager B nunca lê nada da empresa A ──────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.profiles where company_id = 'fb000000-0000-0000-0000-000000000001'),
  0, 'Manager B nao consegue ler nenhum profile da empresa A (isolamento entre empresas)');
select is(
  (select count(*)::int from public.profiles),
  1, 'Manager B, sem filtro, ve so a propria linha (RLS filtra o resto de outra empresa)');
reset role;

-- ── anon: tentativa real de leitura falha (nao so ausencia no catalogo) ──
set local role anon;
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501', null, 'anon: select em profiles falha de verdade (permission denied)');
reset role;

select finish();
rollback;
