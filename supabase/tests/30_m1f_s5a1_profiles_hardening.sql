-- M1-F S5-A1 — hardening da superfície de escrita direta de public.profiles
-- (20260723150000_m1f_s5a1_profiles_hardening.sql). Prova permanentemente:
-- (1) a policy profiles_update_admin foi removida e nenhuma outra policy de
-- UPDATE existe em profiles; (2) anon/authenticated/PUBLIC não têm nenhum
-- privilégio de escrita/DDL (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
-- TRIGGER) em profiles, nem de tabela nem de coluna; (3) o SELECT por
-- coluna necessário ao login (S4-C2C) continua intacto, sem regressão;
-- (4) mesmo que um GRANT UPDATE futuro reapareça por acidente, a ausência
-- de qualquer policy de UPDATE bloqueia a escrita (RLS "default deny" —
-- sem policy para o comando, nenhuma linha é alcançada); (5) o guard de
-- platform_role (m1f_s1_01) permanece coerente.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- 1. POLICY — profiles_update_admin removida, nenhuma outra UPDATE, leitura
--    própria/empresa preservada
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_admin'),
  0, 'profiles_update_admin nao existe mais');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'),
  0, 'nenhuma policy de UPDATE existe em public.profiles (nenhuma substituta ampla foi criada)');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own'),
  1, 'profiles_select_own permanece');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_company'),
  1, 'profiles_select_company permanece');

-- ══════════════════════════════════════════════════════════════════════
-- 2. PRIVILEGIOS DE TABELA — zero escrita/DDL para anon/authenticated/PUBLIC
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'anon e authenticated: zero INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER de tabela em profiles');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'PUBLIC'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'PUBLIC: zero INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER de tabela em profiles');

-- ══════════════════════════════════════════════════════════════════════
-- 3. PRIVILEGIOS POR COLUNA — zero UPDATE em qualquer coluna atual
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE'),
  0, 'anon e authenticated: zero UPDATE por coluna em qualquer coluna de profiles');

select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated') and column_name = 'platform_role'
      and privilege_type = 'UPDATE'),
  0, 'platform_role especificamente: continua sem UPDATE para anon/authenticated (coerencia com m1f_s1_01)');

-- ══════════════════════════════════════════════════════════════════════
-- 4. SELECT PRESERVADO — nenhuma coluna de leitura necessaria foi removida
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array[
    'id', 'company_id', 'name', 'email', 'role', 'seller_id', 'is_active', 'platform_role'
  ]) as c),
  'authenticated mantem SELECT exatamente nas 8 colunas ja autorizadas (S4-C2C) — nenhuma removida, nenhuma nova');

select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'anon' and privilege_type = 'SELECT'),
  0, 'anon continua sem SELECT em nenhuma coluna de profiles');

-- ══════════════════════════════════════════════════════════════════════
-- 5. DEFESA EM PROFUNDIDADE — GRANT UPDATE amplo simulado (pior caso),
--    ainda assim bloqueado pela ausencia de qualquer policy de UPDATE
--    (RLS "default deny": sem policy para o comando, nenhuma linha e
--    alcancada) — grant existe so dentro desta transacao, desfeito pelo
--    rollback final do arquivo, nunca persiste no banco real.
-- ══════════════════════════════════════════════════════════════════════

grant select, update on public.profiles to authenticated;

set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$update public.profiles set name = 'Tentativa Pos-Hardening' where id = auth.uid()$$,
  'admin: UPDATE nao lanca excecao mesmo com GRANT amplo simulado (RLS filtra silenciosamente, sem policy de UPDATE)');

select is(
  (select name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Admin', 'name do admin permanece inalterado apos a tentativa (nenhuma policy de UPDATE para aplicar o CHECK)');

reset role;

-- ── mesma prova para manager e seller, cobrindo os tres papeis legados
--    que a policy antiga distinguia (so admin passava pela USING antiga;
--    agora nenhum papel passa, porque nao ha policy nenhuma) ─────────────
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$update public.profiles set name = 'Tentativa Manager' where id = auth.uid()$$,
  'manager: UPDATE nao lanca excecao mesmo com GRANT amplo simulado');
select is(
  (select name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Carlos Mendes', 'name do manager permanece inalterado apos a tentativa');
reset role;

set local role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select lives_ok(
  $$update public.profiles set name = 'Tentativa Seller' where id = auth.uid()$$,
  'seller: UPDATE nao lanca excecao mesmo com GRANT amplo simulado');
select is(
  (select name from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'Lucas Martins', 'name do seller permanece inalterado apos a tentativa');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. PLATFORM ROLE — guard permanece coerente (nao regride m1f_s1_01)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_guard_platform_role_ck'),
  1, 'trigger profiles_guard_platform_role_ck permanece em public.profiles');

-- Nota: antes deste hardening (profiles_update_admin ainda existente), um
-- admin passava pela USING da policy antiga e so entao era barrado pelo
-- trigger (P0001, ver 14_m1f_s1_platform_role_selfpromotion.sql). Agora,
-- sem NENHUMA policy de UPDATE, a linha do admin nunca e alcancada em
-- primeiro lugar (RLS "default deny" filtra antes do trigger disparar) —
-- defesa mais forte, nao regressao: o resultado observavel (platform_role
-- nunca muda) e identico, mas por uma camada a mais.
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$update public.profiles set platform_role = 'super_admin' where id = auth.uid()$$,
  'admin: UPDATE de platform_role nao lanca excecao (RLS ja filtra a linha antes do trigger ser avaliado)');
select is(
  (select platform_role from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::public.platform_role, 'platform_role do admin continua null apos a tentativa (RLS nega a linha; trigger nem chega a ser avaliado)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. RPCS EXISTENTES — continuam SECURITY DEFINER de propriedade do owner,
--    nao dependem do GRANT revogado nesta migration (nao reexecuta as
--    dezenas de testes ja existentes de 22-27; a suite completa e quem
--    prova a nao regressao funcional)
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_invite', 'resend_invite', 'cancel_invite', 'accept_invite', 'create_company')
      and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'),
  5, 'create_invite/resend_invite/cancel_invite/accept_invite/create_company continuam SECURITY DEFINER de propriedade de postgres (nao dependem do GRANT revogado)');

select finish();
rollback;
