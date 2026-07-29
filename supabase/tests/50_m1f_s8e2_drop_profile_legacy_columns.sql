-- M1-F S8-E2 — remoção física de profiles.company_id/role/seller_id
-- (20260729190000_m1f_s8e2a_stop_profile_legacy_writes.sql +
-- 20260729200000_m1f_s8e2b_drop_profile_legacy_columns.sql,
-- docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §46). Cobre: catálogo (as
-- 3 colunas ausentes, as 7 colunas finais presentes, FKs/índices antigos
-- ausentes, nenhuma view/coluna substituta); accept_invite() para Manager/
-- Seller/Super Admin sem nenhuma escrita nas colunas legadas; profile
-- existente aceitando um segundo convite sem escrita empresarial em
-- profiles; identidade resolvida inteiramente via company_memberships/
-- sellers/platform_role; transferência de membership; autoria de leads;
-- regressão do catálogo de RPCs/policies. Roda como postgres dentro de uma
-- transação com rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- GRANT temporário, dentro desta transação (nunca persiste — rollback ao
-- final): permite ler invites por token_hash enquanto "set local role
-- service_role" está ativo, mesmo padrão e mesma justificativa dos testes
-- 23/24/25/26.
grant select on public.invites to service_role;

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('company_id', 'role', 'seller_id')),
  0, 'profiles.company_id/role/seller_id nao existem mais no catalogo');

select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'),
  array['created_at', 'email', 'id', 'is_active', 'name', 'platform_role', 'updated_at'],
  'public.profiles tem exatamente as 7 colunas finais, nenhuma a mais nem a menos');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname in ('profiles_company_id_fkey', 'profiles_seller_id_fkey', 'profiles_company_id_uidx')),
  0, 'as 3 constraints legadas (2 FKs + 1 UNIQUE orfao) nao existem mais');

select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'profiles'
      and indexname in ('profiles_company_id_idx', 'profiles_seller_id_idx')),
  0, 'os 2 indices legados nao existem mais');

select is(
  (select count(*)::int from pg_constraint where conrelid = 'public.profiles'::regclass),
  2, 'public.profiles tem exatamente 2 constraints restantes (pkey + FK para auth.users)');

-- nenhuma view/coluna substituta foi criada para preencher o lugar das
-- 3 colunas removidas (nenhuma view nova em public, nenhuma coluna
-- generated/computed em profiles).
select is(
  (select count(*)::int from information_schema.views where table_schema = 'public'),
  0, 'nenhuma view nova foi criada em public (nenhum substituto para as colunas removidas)');

-- o enum user_role fica orfao (nenhuma coluna o usa mais) mas nao foi
-- dropado — decisao explicita, fora do escopo desta etapa.
select has_enum('public', 'user_role'::name);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and udt_name = 'user_role'),
  0, 'user_role continua no catalogo mas nenhuma coluna o usa mais (orfao, nao dropado por decisao)');

-- catálogo de RPCs/policies de leads/invites intacto (regressão ampla).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_invite', 'resend_invite', 'cancel_invite',
      'complete_invite_delivery', 'complete_invite_resend_delivery',
      'reserve_create_invite_rate_limit', 'reserve_resend_invite_rate_limit',
      'validate_invite_token', 'accept_invite', 'reserve_invite_validation_rate_limit',
      'update_membership_role', 'update_profile_name', 'list_company_users',
      'list_inactive_company_users', 'suspend_membership', 'reactivate_membership',
      'offboard_seller', 'offboard_manager', 'transfer_membership',
      'create_lead', 'update_lead', 'move_lead_to_stage', 'apply_lead_event',
      'assign_lead_seller', 'archive_lead', 'unarchive_lead',
      'add_lead_timeline_entry', 'check_lead_phone_duplicate')),
  28, 'as 28 RPCs centrais continuam existindo, sem duplicata, nenhuma removida por esta etapa');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  1, 'public.profiles continua com exatamente 1 policy (profiles_select_own)');

-- accept_invite: assinatura, grants e SECURITY DEFINER preservados.
select has_function('public'::name, 'accept_invite'::name, array['text']::name[],
  'accept_invite continua com a assinatura p_token_hash text');
select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.accept_invite(text)'::regprocedure),
  'accept_invite continua SECURITY DEFINER');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'accept_invite' and grantee = 'anon'),
  0, 'anon continua sem EXECUTE em accept_invite');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'accept_invite' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1, 'authenticated continua com EXECUTE em accept_invite');

-- prosrc (nunca pg_get_functiondef, ver nota nos arquivos 48/49): a
-- checagem exata do INSERT (coluna a coluna) já prova que company_id/
-- role/seller_id nao fazem mais parte da lista de colunas gravadas —
-- checar a mera presença da substring "company_id" no corpo inteiro
-- daria falso positivo (a função referencia company_id legitimamente em
-- outros pontos, como p_company_id do convite).
select ok(
  (select p.prosrc ilike '%insert into public.profiles (id, name, email, is_active)%'
     from pg_proc p where p.oid = 'public.accept_invite(text)'::regprocedure),
  'accept_invite insere profiles exatamente com (id, name, email, is_active)');

-- ══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('e5020000-0000-0000-0000-000000000001', 'S8E2 Empresa A', 'ativa'),
  ('e5020000-0000-0000-0000-000000000002', 'S8E2 Empresa B (destino)', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e5010000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8e2-inviter@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5010000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8e2-newmanager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5010000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8e2-newseller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5010000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8e2-newsuperadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5010000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's8e2-existing-second-invite@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5010000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's8e2-transfer-seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5010000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's8e2-manager-companion@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('e5010000-0000-0000-0000-000000000001', 'S8E2 Inviter', 's8e2-inviter@test.local', true, 'super_admin'),
  ('e5010000-0000-0000-0000-000000000007', 'S8E2 Manager Companion', 's8e2-manager-companion@test.local', true, null);

-- companheiro de Manager na Empresa A, ativo (nunca aceita convite via RPC
-- — só precondição para a seção 5 poder desligar o Manager 002 sem exigir
-- sucessor: "última gestora" nunca fica sem substituto).
insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('e5040000-0000-0000-0000-000000000007', 'e5020000-0000-0000-0000-000000000001', 'e5010000-0000-0000-0000-000000000007', 'manager', true, 'active');

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('e5030000-0000-0000-0000-000000000001', 'e5020000-0000-0000-0000-000000000001', 'new', 'Novo', 0);

-- ══════════════════════════════════════════════════════════════════════
-- 2. ACCEPT_INVITE — MANAGER (sem escrita legada, identidade via membership)
-- ══════════════════════════════════════════════════════════════════════

set local role service_role;
select public.create_invite('e5010000-0000-0000-0000-000000000001', 'e5020000-0000-0000-0000-000000000001', 's8e2-newmanager@test.local', 'S8E2 Novo Manager', 'manager', repeat('e1', 32));
select public.complete_invite_delivery('e5010000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e1', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000002');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('e1', 32)) rr)
   select r.success and r.code = 'ok' and r.role_kind = 'manager' and r.company_id = 'e5020000-0000-0000-0000-000000000001' from r),
  'MANAGER: aceite bem-sucedido, sem nenhuma coluna legada disponivel para gravar');
reset role;
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name in ('name','email','is_active')
      and (select count(*)::int from public.profiles where id='e5010000-0000-0000-0000-000000000002' and name='S8E2 Novo Manager' and email='s8e2-newmanager@test.local' and is_active) = 1),
  3, 'MANAGER: profiles criado com exatamente name/email/is_active corretos (nenhuma outra coluna para preencher)');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'e5010000-0000-0000-0000-000000000002' and company_id = 'e5020000-0000-0000-0000-000000000001' and role = 'manager' and is_active),
  1, 'MANAGER: identidade empresarial existe exclusivamente em company_memberships');
select is(
  (select platform_role from public.profiles where id = 'e5010000-0000-0000-0000-000000000002'),
  null::public.platform_role, 'MANAGER: platform_role continua null');

-- ══════════════════════════════════════════════════════════════════════
-- 3. ACCEPT_INVITE — SELLER (identidade via sellers.membership_id)
-- ══════════════════════════════════════════════════════════════════════

set local role service_role;
select public.create_invite('e5010000-0000-0000-0000-000000000001', 'e5020000-0000-0000-0000-000000000001', 's8e2-newseller@test.local', 'S8E2 Novo Seller', 'seller', repeat('e2', 32));
select public.complete_invite_delivery('e5010000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e2', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000003');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('e2', 32)) rr)
   select r.success and r.code = 'ok' and r.role_kind = 'seller' and r.company_id = 'e5020000-0000-0000-0000-000000000001' from r),
  'SELLER: aceite bem-sucedido');
reset role;
select is(
  (select count(*)::int from public.sellers s join public.company_memberships cm on cm.id = s.membership_id
    where s.profile_id = 'e5010000-0000-0000-0000-000000000003' and cm.profile_id = 'e5010000-0000-0000-0000-000000000003'
      and cm.company_id = 'e5020000-0000-0000-0000-000000000001' and cm.role = 'seller'),
  1, 'SELLER: identidade de vendedor resolvida via sellers.membership_id -> company_memberships, nunca via coluna em profiles');
select is(
  (select create_lead.company_id from public.create_lead('S8E2 Cliente Seller', '(11) 90000-0001', 'Onix')),
  'e5020000-0000-0000-0000-000000000001'::uuid,
  'SELLER: create_lead resolve a empresa exclusivamente via membership apos o aceite');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. ACCEPT_INVITE — SUPER ADMIN (identidade via platform_role, zero membership)
-- ══════════════════════════════════════════════════════════════════════

set local role service_role;
select public.create_invite('e5010000-0000-0000-0000-000000000001', null, 's8e2-newsuperadmin@test.local', 'S8E2 Novo Super Admin', 'super_admin', repeat('e3', 32));
select public.complete_invite_delivery('e5010000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e3', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000004');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('e3', 32)) rr)
   select r.success and r.code = 'ok' and r.role_kind = 'super_admin' from r),
  'SUPER ADMIN: aceite bem-sucedido');
reset role;
select is(
  (select platform_role from public.profiles where id = 'e5010000-0000-0000-0000-000000000004'),
  'super_admin'::public.platform_role, 'SUPER ADMIN: identidade de plataforma exclusivamente via platform_role');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'e5010000-0000-0000-0000-000000000004'),
  0, 'SUPER ADMIN: zero company_membership criada (nenhuma coluna legada para "vazar" uma empresa)');

-- ══════════════════════════════════════════════════════════════════════
-- 5. PROFILE EXISTENTE ACEITANDO UM SEGUNDO CONVITE (sem escrita empresarial)
-- ══════════════════════════════════════════════════════════════════════

-- este profile ja existe (proprio insert into profiles ja rodou no aceite
-- da secao 2, reaproveitando o mesmo ator) e aceita um SEGUNDO convite, de
-- uma empresa diferente — accept_invite() so cria a membership nova, nunca
-- volta a tocar profiles (o "if v_profile.id is null" so roda na primeira vez).
-- Uma membership ATIVA em outra empresa bloquearia o aceite com
-- membership_conflict (comportamento correto, coberto exaustivamente em
-- 26_m1f_s4c1_invite_acceptance.sql) — por isso o Manager e desligado da
-- Empresa A antes (Manager Companion permanece, dispensando sucessor); uma
-- membership HISTÓRICA (offboarded) nunca bloqueia um novo aceite.
select id as manager_membership_id from public.company_memberships
  where profile_id = 'e5010000-0000-0000-0000-000000000002' and company_id = 'e5020000-0000-0000-0000-000000000001' \gset

set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000001'); -- Super Admin inviter
select * from public.offboard_manager(:'manager_membership_id', null, 'S8E2 - libera para o segundo aceite');
reset role;

select updated_at as manager_updated_before from public.profiles where id = 'e5010000-0000-0000-0000-000000000002' \gset

set local role service_role;
select public.create_invite('e5010000-0000-0000-0000-000000000001', 'e5020000-0000-0000-0000-000000000002', 's8e2-newmanager@test.local', 'S8E2 Segundo Convite', 'seller', repeat('e4', 32));
select public.complete_invite_delivery('e5010000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e4', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000002');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('e4', 32)) rr)
   select r.success and r.code = 'ok' and r.role_kind = 'seller' and r.company_id = 'e5020000-0000-0000-0000-000000000002' from r),
  'profile existente (sem membership ativa, a antiga foi desligada) aceita um segundo convite (empresa B, papel seller) sem erro');
reset role;
select is(
  (select updated_at from public.profiles where id = 'e5010000-0000-0000-0000-000000000002'),
  :'manager_updated_before'::timestamptz,
  'profiles.updated_at do ator NAO mudou — o segundo aceite nao escreveu nada em profiles (nenhuma coluna empresarial para atualizar)');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'e5010000-0000-0000-0000-000000000002'),
  2, 'ator agora tem 2 memberships (uma por empresa) — profiles continua com 1 unica linha global');

-- ══════════════════════════════════════════════════════════════════════
-- 6. TRANSFERÊNCIA — identidade sempre resolvida pela membership ATIVA corrente
-- ══════════════════════════════════════════════════════════════════════

-- ator dedicado, sem leads abertos (evita successor_required — fora de
-- escopo desta suíte, já coberto exaustivamente em 37_m1f_s6d_membership_transfer.sql).
set local role service_role;
select public.create_invite('e5010000-0000-0000-0000-000000000001', 'e5020000-0000-0000-0000-000000000001', 's8e2-transfer-seller@test.local', 'S8E2 Transfer Seller', 'seller', repeat('e5', 32));
select public.complete_invite_delivery('e5010000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e5', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000006');
select public.accept_invite(repeat('e5', 32));
reset role;

select id as seller_membership_id from public.company_memberships
  where profile_id = 'e5010000-0000-0000-0000-000000000006' and company_id = 'e5020000-0000-0000-0000-000000000001' \gset

set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000001'); -- Super Admin inviter
select * from public.transfer_membership(
  :'seller_membership_id',
  'e5020000-0000-0000-0000-000000000002',
  'seller',
  null,
  'S8E2 - teste de transferencia'
);
reset role;

select is(
  (select company_id from public.company_memberships where profile_id = 'e5010000-0000-0000-0000-000000000006' and is_active),
  'e5020000-0000-0000-0000-000000000002'::uuid, 'apos a transferencia, a membership ATIVA do Seller aponta para a empresa destino');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'e5010000-0000-0000-0000-000000000006'),
  2, 'a membership de origem (agora offboarded) continua existindo, nunca apagada');

-- ══════════════════════════════════════════════════════════════════════
-- 7. AUTORIA DE LEADS — FK sustentada por company_memberships, nunca por profiles
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.leads'::regclass and conname = 'leads_created_by_fk'),
  'FOREIGN KEY (company_id, created_by_profile_id) REFERENCES company_memberships(company_id, profile_id) ON DELETE RESTRICT',
  'leads_created_by_fk continua apontando para company_memberships, nunca para profiles');

-- Manager 002 teve a membership ativa transferida para a Empresa B na
-- seção 5 — usa o Manager Companion (007), cuja membership ativa continua
-- na Empresa A (única com pipeline_stages nesta fixture).
set local role authenticated;
select pg_temp.as_user('e5010000-0000-0000-0000-000000000007'); -- Manager Companion, empresa A
create temp table t_s8e2_lead as
  select * from public.create_lead('S8E2 Cliente Manager', '(11) 90000-0002', 'HB20');
reset role;
select is(
  (select created_by_profile_id from t_s8e2_lead),
  'e5010000-0000-0000-0000-000000000007'::uuid, 'autoria do lead gravada corretamente, satisfeita pela membership ativa (nao por profiles)');

-- ══════════════════════════════════════════════════════════════════════
-- 8. REGRESSÃO — nenhuma tabela/policy vizinha alterada por esta etapa
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'company_memberships'),
  1, 'company_memberships continua com exatamente 1 policy (company_memberships_select_own)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'sellers'),
  0, 'public.sellers continua sem nenhuma policy (inalcancavel a authenticated/anon)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'anon/authenticated continuam sem INSERT/UPDATE/DELETE de tabela em profiles');

set local role anon;
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501', null, 'anon: select em profiles continua falhando de verdade (permission denied)');
reset role;

select finish();
rollback;
