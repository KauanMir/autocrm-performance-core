-- M1-F S4-F1 (02) — GRANT SELECT por coluna em public.invites
-- (20260722100100_m1f_s4f1_02_invites_column_grants.sql). Prova que o
-- endurecimento (tabela inteira → 10 colunas explícitas) preserva
-- exatamente o comportamento real que a RLS já garantia (quem convidou vê
-- os próprios, Super Admin vê todos, isolamento entre empresas/atores) e
-- adicionalmente bloqueia token_hash mesmo numa linha que a RLS deixaria
-- visível — a defesa de coluna é independente da defesa de linha.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ── fixtures: 2 empresas, 2 Managers na empresa A (cada um convida o
--    seu), 1 Manager na empresa B, 1 Seller na empresa A, 1 Super Admin,
--    1 auth user sem profile, 3 convites (um por Manager convidador) ────
insert into public.companies (id, name, status) values
  ('e2000000-0000-0000-0000-000000000001', 'S4F1 Invites Empresa A', 'ativa'),
  ('e2000000-0000-0000-0000-000000000002', 'S4F1 Invites Empresa B', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e2100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's4f1-inv-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's4f1-inv-manager-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2100000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's4f1-inv-seller-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2100000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's4f1-inv-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2100000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's4f1-inv-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2100000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's4f1-inv-noprofile@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active, platform_role) values
  ('e2100000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'Inv Manager A', 's4f1-inv-manager-a@test.local', 'manager', true, null),
  ('e2100000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'Inv Manager A2', 's4f1-inv-manager-a2@test.local', 'manager', true, null),
  ('e2100000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000001', 'Inv Seller A', 's4f1-inv-seller-a@test.local', 'seller', true, null),
  ('e2100000-0000-0000-0000-000000000004', 'e2000000-0000-0000-0000-000000000002', 'Inv Manager B', 's4f1-inv-manager-b@test.local', 'manager', true, null),
  ('e2100000-0000-0000-0000-000000000005', null, 'Inv Super Admin', 's4f1-inv-superadmin@test.local', 'seller', true, 'super_admin');
-- e2100000-...-000006 (auth user sem profile) deliberadamente SEM linha em profiles

insert into public.invites (id, company_id, email, name, role_kind, token_hash, status, invited_by_profile_id, expires_at) values
  ('e2200000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 's4f1-invitee-1@test.local', 'Convidado 1', 'seller', repeat('a1', 32), 'pending', 'e2100000-0000-0000-0000-000000000001', now() + interval '7 days'),
  ('e2200000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 's4f1-invitee-2@test.local', 'Convidado 2', 'seller', repeat('a2', 32), 'pending', 'e2100000-0000-0000-0000-000000000002', now() + interval '7 days'),
  ('e2200000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000002', 's4f1-invitee-3@test.local', 'Convidado 3', 'seller', repeat('a3', 32), 'pending', 'e2100000-0000-0000-0000-000000000004', now() + interval '7 days');

-- ══════════════════════════════════════════════════════════════════════
-- RLS e GRANTS: continuam exatamente o esperado
-- ══════════════════════════════════════════════════════════════════════

select ok(
  (select relrowsecurity from pg_class where relname = 'invites' and relnamespace = 'public'::regnamespace),
  'invites continua com RLS habilitada');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'invites'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  0, 'authenticated NAO tem mais SELECT de tabela inteira em invites (endurecido nesta etapa)');

select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'invites'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  (select array_agg(c order by c) from unnest(array[
    'id', 'company_id', 'invited_by_profile_id', 'name', 'email',
    'role_kind', 'status', 'expires_at', 'accepted_at', 'created_at'
  ]) as c),
  'authenticated tem SELECT exatamente nas 10 colunas da whitelist, nunca token_hash/email_normalized/accepted_profile_id/updated_at');

select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'invites'
      and grantee = 'authenticated' and column_name = 'token_hash'),
  0, 'token_hash: ZERO grants para authenticated em qualquer privilegio');

select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'invites'
      and grantee = 'anon' and privilege_type = 'SELECT'),
  0, 'anon continua sem SELECT em nenhuma coluna de invites');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'invites'
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'zero INSERT/UPDATE/DELETE novo para authenticated em invites');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'invites'
      and grantee in ('anon', 'service_role') and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0, 'anon e service_role continuam sem SELECT/INSERT/UPDATE/DELETE novo em invites');

-- ══════════════════════════════════════════════════════════════════════
-- COMPORTAMENTO REAL: RLS de linha continua intacta sob o grant novo
-- ══════════════════════════════════════════════════════════════════════

-- ── Manager A lê só o próprio convite ────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('e2100000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.invites where invited_by_profile_id = 'e2100000-0000-0000-0000-000000000001'),
  1, 'Manager A le o proprio convite');
select is(
  (select count(*)::int from public.invites where id = 'e2200000-0000-0000-0000-000000000002'),
  0, 'Manager A NAO le o convite de Manager A2 (mesma empresa, outro convidador)');
select is(
  (select count(*)::int from public.invites where id = 'e2200000-0000-0000-0000-000000000003'),
  0, 'Manager A NAO le o convite de Manager B (outra empresa)');
select is(
  (select count(*)::int from public.invites where company_id = 'e2000000-0000-0000-0000-000000000001'),
  1, 'Manager A, sem filtro por convidador, ve so o proprio convite na empresa (RLS filtra o resto)');
reset role;

-- ── token_hash negado mesmo na linha que a RLS permite (o próprio
--    convite de Manager A) — defesa de coluna independente da de linha ──
set local role authenticated;
select pg_temp.as_user('e2100000-0000-0000-0000-000000000001');
select throws_ok(
  $$select token_hash from public.invites where id = 'e2200000-0000-0000-0000-000000000001'$$,
  '42501', null, 'Manager A: token_hash negado mesmo no proprio convite (RLS permitiria a linha, GRANT nega a coluna)');
reset role;

-- ── Seller A: nao convidou ninguem, nao ve nenhum convite ───────────────
set local role authenticated;
select pg_temp.as_user('e2100000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.invites),
  0, 'Seller A nao le nenhum convite (nunca convidou ninguem, nao e super admin)');
reset role;

-- ── Manager B: só o próprio, isolado da empresa A ───────────────────────
set local role authenticated;
select pg_temp.as_user('e2100000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.invites where invited_by_profile_id = 'e2100000-0000-0000-0000-000000000004'),
  1, 'Manager B le o proprio convite');
select is(
  (select count(*)::int from public.invites where company_id = 'e2000000-0000-0000-0000-000000000001'),
  0, 'Manager B NAO le nenhum convite da empresa A');
reset role;

-- ── Super Admin: le todos os convites permitidos (os 3) ─────────────────
set local role authenticated;
select pg_temp.as_user('e2100000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.invites),
  3, 'Super Admin le todos os convites (is_platform_super_admin() na policy)');
reset role;

-- ── Auth user sem profile: zero linhas ──────────────────────────────────
set local role authenticated;
select pg_temp.as_user('e2100000-0000-0000-0000-000000000006');
select is(
  (select count(*)::int from public.invites),
  0, 'Auth user sem profile nao le nenhum convite');
reset role;

-- ── anon: tentativa real de leitura falha de verdade ─────────────────────
set local role anon;
select throws_ok(
  $$select count(*) from public.invites$$,
  '42501', null, 'anon: select em invites falha de verdade (permission denied)');
reset role;

select finish();
rollback;
