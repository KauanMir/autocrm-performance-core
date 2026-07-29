-- M1-F S4-C2C hotfix — GRANT SELECT em public.profiles para authenticated
-- (20260721150000_m1f_s4c2c_login_profile_read.sql). Prova que o gap de
-- login pré-existente foi fechado SEM enfraquecer isolamento: anon
-- continua bloqueado, nenhuma coluna extra (created_at/updated_at) foi
-- exposta, e nenhum INSERT/UPDATE/DELETE foi concedido a ninguém por esta
-- migration.
--
-- M1-F S8-C1-A: profiles_select_company foi removida
-- (20260728140000_m1f_s8c1a_close_profile_seller_access.sql) — zero
-- consumidor client-side confirmado em auditoria (S8-C1-A0); a listagem
-- administrativa multi-perfil já é resolvida inteiramente por
-- list_company_users/list_inactive_company_users (RPCs SECURITY DEFINER).
-- authenticated agora só lê o que profiles_select_own permite: a própria
-- linha, nunca a de um colega, nem para Manager/Super Admin.
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
  ('00000000-0000-0000-0000-000000000000', 'fb100000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's4c2c-login-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fb100000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's4c2c-login-inactive@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('fb100000-0000-0000-0000-000000000001', 'Manager A', 's4c2c-login-manager-a@test.local', true, null),
  ('fb100000-0000-0000-0000-000000000002', 'Seller A', 's4c2c-login-seller-a@test.local', true, null),
  ('fb100000-0000-0000-0000-000000000003', 'Manager B', 's4c2c-login-manager-b@test.local', true, null),
  ('fb100000-0000-0000-0000-000000000004', 'Super Admin Login', 's4c2c-login-superadmin@test.local', true, 'super_admin'),
  ('fb100000-0000-0000-0000-000000000005', 'Inativo Global', 's4c2c-login-inactive@test.local', false, null);

-- ══════════════════════════════════════════════════════════════════════
-- GRANTS: exatamente o esperado, nada a mais
-- ══════════════════════════════════════════════════════════════════════

-- ── anon continua SEM select em nenhuma coluna de profiles ──────────────
select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'anon' and privilege_type = 'SELECT'),
  0, 'anon continua sem SELECT em nenhuma coluna de profiles');

-- ── authenticated tem SELECT exatamente nas 5 colunas esperadas (M1-F
--    S8-E2 removeu company_id/role/seller_id do catálogo — o privilégio
--    de coluna concedido pela migration histórica cai junto com a coluna
--    dropada), nunca created_at/updated_at, nunca mais nem menos ────────
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array[
    'id','name','email','is_active','platform_role'
  ]) as c),
  'authenticated tem SELECT exatamente nas 5 colunas restantes usadas por _loadProfile(), nunca created_at/updated_at');

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

-- ── M1-F S8-C1-A: Manager A NÃO lê diretamente outro profile da própria
--    empresa (profiles_select_company removida) — só a própria linha,
--    mesmo sem filtro (M1-F S8-E2: company_id deixou de existir em
--    profiles — identidade empresarial só em company_memberships) ───────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.profiles),
  1, 'Manager A ve so a propria linha, mesmo sem filtro (Seller A nao aparece)');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000002'),
  0, 'Manager A NAO consegue ler o Seller A (mesma empresa) por id direto — leitura de terceiros e so via RPC');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000003'),
  0, 'Manager A NAO consegue ler o Manager B (empresa diferente) por id direto');
reset role;

-- ── Seller A NÃO lê outro profile — nem o do Manager A da mesma empresa ──
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.profiles),
  1, 'Seller A ve so a propria linha, nunca a do Manager A');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000001'),
  0, 'Seller A NAO consegue ler o Manager A por id direto');
reset role;

-- ── M1-F S8-C1-A: Super Admin NÃO recebe SELECT direto amplo em profiles
--    — le a propria linha (ja provado acima), mas nao a de terceiros,
--    mesmo sem company_id proprio para "isolar" ─────────────────────────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000001'),
  0, 'Super Admin NAO consegue ler o Manager A por id direto (sem SELECT amplo em profiles)');
select is(
  (select count(*)::int from public.profiles),
  1, 'Super Admin, sem filtro, ve so a propria linha (nenhuma policy de leitura ampla restante)');
reset role;

-- ── isolamento entre empresas: Manager B nunca lê nada da empresa A ──────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000001'),
  0, 'Manager B nao consegue ler o Manager A (empresa diferente) por id direto');
select is(
  (select count(*)::int from public.profiles),
  1, 'Manager B, sem filtro, ve so a propria linha (RLS filtra o resto, inclusive de outra empresa)');
reset role;

-- ── profile globalmente inativo: profiles_select_own nao filtra por
--    is_active (nunca filtrou — a checagem de seguranca real e no app,
--    AuthService._loadProfile/restoreSession, que rejeita is_active=false
--    e encerra a sessao Auth, S6-E). Esta migration NAO altera esse
--    comportamento — prova que a remocao de profiles_select_company nao
--    mexeu na unica policy que protege o login ────────────────────────────
set local role authenticated;
select pg_temp.as_user('fb100000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.profiles where id = 'fb100000-0000-0000-0000-000000000005'),
  1, 'profile globalmente inativo ainda le a propria linha via profiles_select_own (guarda real e no app, inalterada aqui)');
reset role;

-- ── anon: tentativa real de leitura falha (nao so ausencia no catalogo) ──
set local role anon;
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501', null, 'anon: select em profiles falha de verdade (permission denied)');
reset role;

select finish();
rollback;
