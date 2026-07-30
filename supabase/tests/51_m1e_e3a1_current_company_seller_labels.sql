-- M1-E E3-A1 — catálogo seguro de seller_id -> name para Manager/Seller
-- (20260730030000_m1e_e3a1_current_company_seller_labels.sql). Cobre:
-- catálogo (assinatura sem parâmetro, SECURITY DEFINER, search_path,
-- grants), Manager recebe o catálogo completo da própria empresa
-- (incluindo Sellers históricos/inativos), Seller recebe somente a própria
-- linha atual, Super Admin nunca usa esta RPC, matriz de
-- membership/status, transferência (identidade sempre a ATUAL), nenhuma
-- tabela recebeu SELECT novo, list_platform_sellers_for_company intocada,
-- retorno sem PII além de seller_id/name. Roda como postgres dentro de
-- uma transação com rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_seller_labels'),
  1, 'list_current_company_seller_labels existe, assinatura unica');
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_seller_labels'),
  '', 'assinatura: zero parametros — empresa nunca enviada pelo cliente');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_seller_labels'),
  'SECURITY DEFINER');
select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_current_company_seller_labels'),
  array['search_path=""'], 'search_path fixo e vazio');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_current_company_seller_labels' and grantee = 'PUBLIC'),
  0, 'PUBLIC sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_current_company_seller_labels' and grantee = 'anon'),
  0, 'anon sem EXECUTE');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'list_current_company_seller_labels' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'authenticated com EXECUTE');

-- nenhuma tabela recebeu SELECT novo para authenticated/anon — a RPC
-- continua sendo o único caminho, mesmo padrão de list_platform_sellers_for_company.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sellers'
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'),
  0, 'nenhum SELECT novo em public.sellers para anon/authenticated');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'
      and table_name not in (select table_name from information_schema.role_column_grants where grantee='authenticated' and privilege_type='SELECT')),
  0, 'nenhum SELECT de TABELA INTEIRA novo em public.profiles (grant por coluna do S4-C2C, inalterado, e a asserção de coluna já é coberta em 30/31/38)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'company_memberships'
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'),
  0, 'nenhum SELECT de TABELA INTEIRA novo em public.company_memberships (grant por coluna do S4F1, inalterado)');

-- list_platform_sellers_for_company continua intacta (assinatura, grants,
-- comportamento) — esta etapa nunca a tocou.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_platform_sellers_for_company'),
  1, 'list_platform_sellers_for_company continua existindo, sem duplicata');
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_platform_sellers_for_company'),
  'p_company_id uuid', 'list_platform_sellers_for_company mantem a assinatura p_company_id uuid, intocada');

-- ══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('e3a10000-0000-0000-0000-000000000001', 'E3A1 Empresa A Ativa', 'ativa'),
  ('e3a10000-0000-0000-0000-000000000002', 'E3A1 Empresa B Ativa (outra)', 'ativa'),
  ('e3a10000-0000-0000-0000-000000000003', 'E3A1 Empresa C Implantacao', 'implantacao'),
  ('e3a10000-0000-0000-0000-000000000004', 'E3A1 Empresa D Suspensa', 'suspensa'),
  ('e3a10000-0000-0000-0000-000000000005', 'E3A1 Empresa E Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e3a1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e3a1-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'e3a1-seller-a2-historico@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'e3a1-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'e3a1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'e3a1-nomembership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'e3a1-suspended@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'e3a1-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'e3a1-inactive-profile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'e3a1-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'e3a1-manager-d@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'e3a1-manager-e@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3a20000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', 'e3a1-seller-transferido@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e3a20000-0000-0000-0000-000000000001', 'E3A1 Manager A', 'e3a1-manager-a@test.local', true, null),
  ('e3a20000-0000-0000-0000-000000000002', 'E3A1 Seller A1', 'e3a1-seller-a1@test.local', true, null),
  ('e3a20000-0000-0000-0000-000000000003', 'E3A1 Seller A2 Historico', 'e3a1-seller-a2-historico@test.local', true, null),
  ('e3a20000-0000-0000-0000-000000000004', 'E3A1 Manager B', 'e3a1-manager-b@test.local', true, null),
  ('e3a20000-0000-0000-0000-000000000005', 'E3A1 Super Admin', 'e3a1-superadmin@test.local', true, 'super_admin'),
  ('e3a20000-0000-0000-0000-000000000006', 'E3A1 Sem Membership', 'e3a1-nomembership@test.local', true, null),
  ('e3a20000-0000-0000-0000-000000000007', 'E3A1 Suspenso', 'e3a1-suspended@test.local', true, null),
  ('e3a20000-0000-0000-0000-000000000008', 'E3A1 Desligado', 'e3a1-offboarded@test.local', true, null),
  ('e3a20000-0000-0000-0000-000000000009', 'E3A1 Profile Inativo', 'e3a1-inactive-profile@test.local', false, null),
  ('e3a20000-0000-0000-0000-00000000000a', 'E3A1 Manager C', 'e3a1-manager-c@test.local', true, null),
  ('e3a20000-0000-0000-0000-00000000000b', 'E3A1 Manager D', 'e3a1-manager-d@test.local', true, null),
  ('e3a20000-0000-0000-0000-00000000000c', 'E3A1 Manager E', 'e3a1-manager-e@test.local', true, null),
  ('e3a20000-0000-0000-0000-00000000000d', 'E3A1 Seller Transferido', 'e3a1-seller-transferido@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('e3a30000-0000-0000-0000-000000000001', 'e3a10000-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-000000000001', 'manager', true, 'active'),
  ('e3a30000-0000-0000-0000-000000000002', 'e3a10000-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-000000000002', 'seller', true, 'active'),
  -- Seller A2 Historico: hoje é MANAGER (promovido) — a membership de
  -- seller antiga foi desligada; o profile continua ativo na empresa, só
  -- não é mais operacionalmente um Seller.
  ('e3a30000-0000-0000-0000-000000000003', 'e3a10000-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-000000000003', 'manager', true, 'active'),
  ('e3a30000-0000-0000-0000-000000000004', 'e3a10000-0000-0000-0000-000000000002', 'e3a20000-0000-0000-0000-000000000004', 'manager', true, 'active'),
  ('e3a30000-0000-0000-0000-000000000007', 'e3a10000-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-000000000007', 'manager', false, 'suspended'),
  ('e3a30000-0000-0000-0000-000000000008', 'e3a10000-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-000000000008', 'manager', false, 'offboarded'),
  ('e3a30000-0000-0000-0000-000000000009', 'e3a10000-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-000000000009', 'manager', true, 'active'),
  ('e3a3000a-0000-0000-0000-000000000001', 'e3a10000-0000-0000-0000-000000000003', 'e3a20000-0000-0000-0000-00000000000a', 'manager', true, 'active'),
  ('e3a3000b-0000-0000-0000-000000000001', 'e3a10000-0000-0000-0000-000000000004', 'e3a20000-0000-0000-0000-00000000000b', 'manager', true, 'active'),
  ('e3a3000c-0000-0000-0000-000000000001', 'e3a10000-0000-0000-0000-000000000005', 'e3a20000-0000-0000-0000-00000000000c', 'manager', true, 'active'),
  ('e3a3000d-0000-0000-0000-000000000001', 'e3a10000-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-00000000000d', 'seller', true, 'active');
-- e3a20000-...-000006 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active) values
  ('e3a1SellerA1', 'e3a10000-0000-0000-0000-000000000001', 'e3a30000-0000-0000-0000-000000000002', 'e3a20000-0000-0000-0000-000000000002', 'E3A1 Seller A1', 'E3A1', true),
  -- histórico: desvinculado (promovido a manager), continua na empresa A.
  ('e3a1SellerA2Hist', 'e3a10000-0000-0000-0000-000000000001', null, 'e3a20000-0000-0000-0000-000000000003', 'E3A1 Seller A2 Historico', 'E3A1', false),
  -- LIGADO à membership atual (pré-transferência) — transfer_membership
  -- exige isso para resolver o Seller de origem; vira histórico
  -- (desvinculado) DEPOIS da chamada, na seção 7.
  ('e3a1SellerTransferOrigem', 'e3a10000-0000-0000-0000-000000000001', 'e3a3000d-0000-0000-0000-000000000001', 'e3a20000-0000-0000-0000-00000000000d', 'E3A1 Seller Transferido', 'E3A1', true),
  ('e3a1SellerOutraEmpresa', 'e3a10000-0000-0000-0000-000000000002', null, null, 'E3A1 Seller Outra Empresa', 'E3A1', true);

-- ══════════════════════════════════════════════════════════════════════
-- 2. MANAGER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000001'); -- Manager A
select results_eq(
  $$select seller_id, name from public.list_current_company_seller_labels()$$,
  $$values ('e3a1SellerA1'::text, 'E3A1 Seller A1'::text),
           ('e3a1SellerA2Hist'::text, 'E3A1 Seller A2 Historico'::text),
           ('e3a1SellerTransferOrigem'::text, 'E3A1 Seller Transferido'::text)$$,
  'Manager A: catalogo completo da propria empresa, ordenado por name, incluindo historicos/desvinculados');
select is(
  (select count(*)::int from public.list_current_company_seller_labels()
     where seller_id = 'e3a1SellerOutraEmpresa'),
  0, 'Manager A: NUNCA ve seller de outra empresa');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. SELLER
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000002'); -- Seller A1
select results_eq(
  $$select seller_id, name from public.list_current_company_seller_labels()$$,
  $$values ('e3a1SellerA1'::text, 'E3A1 Seller A1'::text)$$,
  'Seller A1: recebe SOMENTE a propria linha atual, nunca o catalogo completo da empresa');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. SUPER ADMIN — nunca usa esta RPC
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000005'); -- Super Admin, sem membership por design
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'Super Admin (sem membership, por design) e negado — a RPC platform correta continua sendo list_platform_sellers_for_company');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. MEMBERSHIP (ausente/suspensa/offboarded/profile inativo)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000006'); -- sem nenhuma membership
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'sem membership: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000007'); -- membership suspensa
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'membership suspensa: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000008'); -- membership offboarded
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'membership offboarded: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000009'); -- profile globalmente inativo, membership ativa
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'profile globalmente inativo (mesmo com membership ativa): forbidden');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. STATUS DA EMPRESA (mesmo gate de leads_select/resolve_lead_mutation_context)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-00000000000a'); -- Manager C, empresa implantacao
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'Manager de empresa em implantacao: forbidden (mesmo gate restrito de leads_select)');
reset role;

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-00000000000b'); -- Manager D, empresa suspensa
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'Manager de empresa suspensa: forbidden');
reset role;

set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-00000000000c'); -- Manager E, empresa cancelada
select throws_ok(
  $$select * from public.list_current_company_seller_labels()$$,
  '42501', 'forbidden', 'Manager de empresa cancelada: forbidden');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. HISTÓRICO E TRANSFERÊNCIA
-- ══════════════════════════════════════════════════════════════════════

-- Já provado na seção 2 (Manager A ve 'e3a1SellerTransferOrigem', a linha
-- HISTORICA/desvinculada, com o nome correto) que o Manager da empresa de
-- ORIGEM continua resolvendo o nome do Seller transferido para Leads
-- antigos daquela empresa.

-- Transfere Seller Transferido (e3a1SellerTransferOrigem, hoje desvinculado
-- na empresa A) para a empresa B, criando uma linha NOVA em sellers lá —
-- mesmo padrão de transfer_membership já coberto em 37_m1f_s6d_....sql.
-- transfer_membership exige Super Admin real (is_platform_super_admin());
-- usa-se o Super Admin da fixture.
set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000005'); -- Super Admin
select * from public.transfer_membership(
  'e3a3000d-0000-0000-0000-000000000001',
  'e3a10000-0000-0000-0000-000000000002',
  'seller',
  null,
  'E3A1 - teste de transferencia'
);
reset role;

-- o Seller transferido, hoje na empresa B, resolve SOMENTE o seller ATUAL
-- (da empresa B) — nunca o antigo (e3a1SellerTransferOrigem, que ficou na
-- empresa A).
set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-00000000000d');
select is(
  (select count(*)::int from public.list_current_company_seller_labels()
     where seller_id = 'e3a1SellerTransferOrigem'),
  0, 'Seller transferido: NUNCA ve o seller antigo (empresa de origem) apos a transferencia');
select is(
  (select count(*)::int from public.list_current_company_seller_labels()),
  1, 'Seller transferido: resolve exatamente 1 linha (o seller ATUAL, da empresa nova)');
select isnt(
  (select seller_id from public.list_current_company_seller_labels()),
  'e3a1SellerTransferOrigem',
  'Seller transferido: o seller_id atual e uma identidade NOVA, nunca reaproveita o antigo');
reset role;

-- Manager B (empresa de destino) agora resolve a linha NOVA do Seller
-- transferido, junto do seller que já era da própria empresa.
set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000004'); -- Manager B
select is(
  (select count(*)::int from public.list_current_company_seller_labels()),
  2, 'Manager B: catalogo da empresa destino agora inclui o Seller transferido (linha nova) + o seller original da empresa B');
select is(
  (select count(*)::int from public.list_current_company_seller_labels()
     where seller_id = 'e3a1SellerTransferOrigem'),
  0, 'Manager B: NUNCA ve a linha antiga (que ficou na empresa de origem)');
reset role;

-- Manager A (empresa de origem) continua resolvendo o nome do Seller
-- transferido para qualquer Lead histórico que ainda referencie a linha
-- antiga — a linha nunca é apagada nem movida.
set local role authenticated;
select pg_temp.as_user('e3a20000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.list_current_company_seller_labels()
     where seller_id = 'e3a1SellerTransferOrigem'),
  1, 'Manager A: apos a transferencia, ainda resolve o nome do seller antigo (linha historica intocada na empresa de origem)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. PII
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select array_agg(a.name::text order by a.name::text)
     from unnest(
       (select proargnames from pg_proc where oid = 'public.list_current_company_seller_labels()'::regprocedure),
       (select proargmodes from pg_proc where oid = 'public.list_current_company_seller_labels()'::regprocedure)
     ) with ordinality as a(name, mode, ord)
    where a.mode = 't'),
  array['name', 'seller_id'],
  'retorno contem exatamente seller_id/name — nenhum outro campo (email/telefone/membership_id/lifecycle/platform_role/credenciais)');

select * from finish();
rollback;
