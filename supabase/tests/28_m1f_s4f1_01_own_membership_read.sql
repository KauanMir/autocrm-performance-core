-- M1-F S4-F1 (01) — leitura da PRÓPRIA membership em company_memberships
-- (20260722100000_m1f_s4f1_01_own_membership_read.sql). Prova que o novo
-- consumidor real (canManageInvites/_loadActiveMembership no frontend) foi
-- habilitado SEM afrouxar isolamento: cada ator só lê sua própria linha,
-- nunca a de outro usuário ou de outra empresa; anon continua bloqueado;
-- nenhum privilégio de escrita foi concedido; nenhuma coluna além de
-- company_id/role/is_active é legível.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ── fixtures: 2 empresas, Manager ativo + Manager2 ativo + Seller ativo na
--    empresa A, Manager ativo na empresa B, Manager com membership INATIVA
--    na empresa A, e um auth user sem profile nenhuma ──────────────────────
insert into public.companies (id, name, status) values
  ('e1000000-0000-0000-0000-000000000001', 'S4F1 Empresa A', 'ativa'),
  ('e1000000-0000-0000-0000-000000000002', 'S4F1 Empresa B', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e1100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's4f1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's4f1-manager-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1100000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's4f1-seller-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1100000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's4f1-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1100000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's4f1-manager-inactive@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1100000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's4f1-noprofile@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active, platform_role) values
  ('e1100000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Manager A', 's4f1-manager-a@test.local', 'manager', true, null),
  ('e1100000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'Manager A2', 's4f1-manager-a2@test.local', 'manager', true, null),
  ('e1100000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'Seller A', 's4f1-seller-a@test.local', 'seller', true, null),
  ('e1100000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'Manager B', 's4f1-manager-b@test.local', 'manager', true, null),
  ('e1100000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'Manager Inactive', 's4f1-manager-inactive@test.local', 'manager', true, null);
-- e1100000-...-000006 (auth user sem profile) deliberadamente SEM linha em profiles

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('e1200000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'manager', true),
  ('e1200000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000002', 'manager', true),
  ('e1200000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000003', 'seller', true),
  ('e1200000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'e1100000-0000-0000-0000-000000000004', 'manager', true),
  ('e1200000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000005', 'manager', false);

-- ══════════════════════════════════════════════════════════════════════
-- RLS e GRANTS: continuam exatamente o esperado
-- ══════════════════════════════════════════════════════════════════════

select ok(
  (select relrowsecurity from pg_class where relname = 'company_memberships' and relnamespace = 'public'::regnamespace),
  'company_memberships continua com RLS habilitada');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  0, 'authenticated NAO tem SELECT de tabela inteira em company_memberships');

select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array['company_id', 'is_active', 'role']) as c),
  'authenticated tem SELECT exatamente em company_id/role/is_active, nunca id/profile_id/invited_at/joined_at/created_at/updated_at');

select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee = 'anon' and privilege_type = 'SELECT'),
  0, 'anon continua sem SELECT em nenhuma coluna de company_memberships');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'nenhum INSERT/UPDATE/DELETE foi concedido a authenticated em company_memberships');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee in ('anon', 'service_role') and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0, 'anon e service_role continuam sem SELECT/INSERT/UPDATE/DELETE novo em company_memberships');

-- ══════════════════════════════════════════════════════════════════════
-- COMPORTAMENTO REAL: cada ator só lê a própria linha
-- ══════════════════════════════════════════════════════════════════════

-- ── Manager A lê a própria membership (ativa, role=manager). Nenhuma
--    consulta abaixo filtra por id/profile_id — essas colunas NÃO estão no
--    GRANT (só company_id/role/is_active, ver bloco de grants acima); a
--    RLS (profile_id = auth.uid()) já restringe às linhas do próprio ator,
--    então "sem filtro" e "filtrado pelo próprio profile_id" devolvem o
--    mesmo resultado — a diferença é que só o primeiro é uma consulta que
--    authenticated tem permissão de fazer ─────────────────────────────────
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.company_memberships),
  1, 'Manager A consegue ler a propria membership');
select is(
  (select role::text from public.company_memberships where is_active),
  'manager', 'Manager A ativo e identificado corretamente como manager na consulta real (is_active=true)');
select is(
  (select company_id from public.company_memberships where is_active),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'Manager A: company_id correto na propria membership');
reset role;

-- ── Manager A NÃO lê a membership de Manager A2 nem a de Seller A (mesma
--    empresa, outros usuários) — provado pelo total: a empresa A tem 3
--    memberships (Manager A/A2/Seller A), mas Manager A só enxerga 1 (a
--    própria), então as outras 2 estão necessariamente invisíveis (RLS).
--    Checar por id específico não é possível aqui: id também não está no
--    GRANT, e não haveria como provar "não vejo a linha X" sem antes ler
--    a coluna id, que authenticated nunca pode ler diretamente ───────────
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.company_memberships where company_id = 'e1000000-0000-0000-0000-000000000001'),
  1, 'Manager A, sem filtro por id, ve so a propria linha na empresa (RLS filtra o resto, inclusive Manager A2 e Seller A)');
reset role;

-- ── Manager A NÃO lê a membership de Manager B (outra empresa) ──────────
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.company_memberships where company_id = 'e1000000-0000-0000-0000-000000000002'),
  0, 'Manager A NAO consegue ler nenhuma membership da empresa B');
reset role;

-- ── Seller A: mesma regra, só a própria linha, role=seller ──────────────
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000003');
select is(
  (select role::text from public.company_memberships where is_active),
  'seller', 'Seller A: propria membership ativa tem role=seller (nunca manager)');
select is(
  (select count(*)::int from public.company_memberships),
  1, 'Seller A ve exatamente 1 linha (a propria) — nenhuma membership de outro usuario, mesmo sem filtro');
reset role;

-- ── Manager Inactive: consegue ler a própria linha (é dele), mas a
--    consulta que o frontend realmente usa (is_active=true) devolve ZERO
--    linhas — é assim que a autorização nega, não por RLS esconder a
--    linha, mas pelo dado ativo/inativo estar correto ──────────────────
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.company_memberships),
  1, 'Manager Inactive consegue ler a propria linha (RLS so exige profile_id = auth.uid())');
select is(
  (select count(*)::int from public.company_memberships where is_active),
  0, 'Manager Inactive: a consulta real (is_active=true) devolve ZERO linhas — nunca autorizado como manager ativo');
reset role;

-- ── Manager B (outra empresa): identificado corretamente, isolado de A ──
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000004');
select is(
  (select role::text from public.company_memberships where is_active),
  'manager', 'Manager B ativo e identificado corretamente');
select is(
  (select count(*)::int from public.company_memberships where company_id = 'e1000000-0000-0000-0000-000000000001'),
  0, 'Manager B NAO consegue ler nenhuma membership da empresa A');
reset role;

-- ── Auth user sem profile (e sem membership nenhuma): zero linhas ───────
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000006');
select is(
  (select count(*)::int from public.company_memberships),
  0, 'Auth user sem profile nao le nenhuma linha de company_memberships (nao tem nenhuma)');
reset role;

-- ── anon: tentativa real de leitura falha de verdade (nao so ausencia no
--    catalogo) ───────────────────────────────────────────────────────────
set local role anon;
select throws_ok(
  $$select count(*) from public.company_memberships$$,
  '42501', null, 'anon: select em company_memberships falha de verdade (permission denied)');
reset role;

-- ── nenhuma escrita foi habilitada para ninguem (defesa em profundidade,
--    além da checagem de catálogo acima) ────────────────────────────────
set local role authenticated;
select pg_temp.as_user('e1100000-0000-0000-0000-000000000001');
select throws_ok(
  $$update public.company_memberships set is_active = false where profile_id = 'e1100000-0000-0000-0000-000000000001'$$,
  '42501', null, 'authenticated: UPDATE em company_memberships continua negado (nenhum GRANT de escrita)');
reset role;

select finish();
rollback;
