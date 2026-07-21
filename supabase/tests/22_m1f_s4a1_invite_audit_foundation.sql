-- M1-F S4-A1 — testes da fundação de schema de convites e auditoria
-- (pgTAP): tabelas invites/audit_log, enums, constraints de coerência,
-- índices de duplicidade, RLS. Nenhuma RPC de convite existe ainda —
-- apenas o modelo. Roda como postgres (fixtures) e authenticated/anon
-- (comportamento real via SET ROLE + request.jwt.claims). Rollback ao
-- final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures: duas empresas, um Manager em cada, um Seller, um Super
--    Admin temporário só para este teste (revertido pelo rollback do
--    arquivo, mesmo padrão já usado em 16/17/20/21) ─────────────────────
insert into public.companies (id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'Empresa A Invites'),
  ('a2000000-0000-0000-0000-000000000002', 'Empresa B Invites');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e1manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e2manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'e1seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e9superadmin@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'E1 Manager', 'e1manager@test.local', 'manager', true),
  ('e1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'E2 Manager', 'e2manager@test.local', 'manager', true),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'E1 Seller',  'e1seller@test.local',  'seller',  true),
  ('e9000000-0000-0000-0000-000000000001', null, 'E9 SuperAdmin (fixture)', 'e9superadmin@test.local', 'seller', true);

insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'manager', true),
  ('a2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'manager', true),
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'seller',  true);

update public.profiles set platform_role = 'super_admin' where id = 'e9000000-0000-0000-0000-000000000001';

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA INVITES
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public'::name, 'invites'::name, 'tabela invites existe');

select col_type_is('public'::name, 'invites'::name, 'id'::name, 'uuid', 'invites.id e uuid');
select col_type_is('public'::name, 'invites'::name, 'company_id'::name, 'uuid', 'invites.company_id e uuid');
select col_type_is('public'::name, 'invites'::name, 'email'::name, 'text', 'invites.email e text');
select col_type_is('public'::name, 'invites'::name, 'email_normalized'::name, 'text', 'invites.email_normalized e text');
select col_type_is('public'::name, 'invites'::name, 'name'::name, 'text', 'invites.name e text');
select col_type_is('public'::name, 'invites'::name, 'role_kind'::name, 'invite_role_kind', 'invites.role_kind e invite_role_kind');
select col_type_is('public'::name, 'invites'::name, 'token_hash'::name, 'text', 'invites.token_hash e text');
select col_type_is('public'::name, 'invites'::name, 'status'::name, 'invite_status', 'invites.status e invite_status');
select col_type_is('public'::name, 'invites'::name, 'invited_by_profile_id'::name, 'uuid', 'invites.invited_by_profile_id e uuid');
select col_type_is('public'::name, 'invites'::name, 'expires_at'::name, 'timestamp with time zone', 'invites.expires_at e timestamptz');
select col_type_is('public'::name, 'invites'::name, 'accepted_at'::name, 'timestamp with time zone', 'invites.accepted_at e timestamptz');
select col_type_is('public'::name, 'invites'::name, 'accepted_profile_id'::name, 'uuid', 'invites.accepted_profile_id e uuid');
select col_type_is('public'::name, 'invites'::name, 'created_at'::name, 'timestamp with time zone', 'invites.created_at e timestamptz');
select col_type_is('public'::name, 'invites'::name, 'updated_at'::name, 'timestamp with time zone', 'invites.updated_at e timestamptz');

select has_enum('public'::name, 'invite_role_kind'::name, 'enum invite_role_kind existe');
select enum_has_labels('public'::name, 'invite_role_kind'::name, array['super_admin','manager','seller'], 'invite_role_kind tem exatamente os 3 valores esperados');
select has_enum('public'::name, 'invite_status'::name, 'enum invite_status existe');
select enum_has_labels('public'::name, 'invite_status'::name, array['pending','accepted','expired','canceled','superseded'], 'invite_status tem exatamente os 5 valores esperados');

select col_not_null('public'::name, 'invites'::name, 'email'::name, 'invites.email e NOT NULL');
select col_not_null('public'::name, 'invites'::name, 'name'::name, 'invites.name e NOT NULL');
select col_not_null('public'::name, 'invites'::name, 'role_kind'::name, 'invites.role_kind e NOT NULL');
select col_not_null('public'::name, 'invites'::name, 'token_hash'::name, 'invites.token_hash e NOT NULL');
select col_not_null('public'::name, 'invites'::name, 'status'::name, 'invites.status e NOT NULL');
select col_not_null('public'::name, 'invites'::name, 'expires_at'::name, 'invites.expires_at e NOT NULL');
select col_not_null('public'::name, 'invites'::name, 'created_at'::name, 'invites.created_at e NOT NULL');
select col_not_null('public'::name, 'invites'::name, 'updated_at'::name, 'invites.updated_at e NOT NULL');
select col_default_is('public'::name, 'invites'::name, 'status'::name, 'pending', 'default de invites.status e pending');

select fk_ok('public'::name, 'invites'::name, array['company_id']::name[], 'public'::name, 'companies'::name, array['id']::name[], 'FK invites.company_id -> companies.id existe');
select fk_ok('public'::name, 'invites'::name, array['invited_by_profile_id']::name[], 'public'::name, 'profiles'::name, array['id']::name[], 'FK invites.invited_by_profile_id -> profiles.id existe');
select fk_ok('public'::name, 'invites'::name, array['accepted_profile_id']::name[], 'public'::name, 'profiles'::name, array['id']::name[], 'FK invites.accepted_profile_id -> profiles.id existe');

select has_trigger('public'::name, 'invites'::name, 'invites_set_updated_at'::name, 'trigger de updated_at existe em invites');

-- nenhum token bruto, senha ou campo de sessao existe como coluna real
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='invites'
      and column_name in ('token', 'password', 'access_token', 'refresh_token', 'session', 'user_metadata')),
  0, 'nenhuma coluna de token bruto/senha/sessao existe em invites');

-- ═══════════════════════════════════════════════════════════════════════
-- E-MAIL (normalizacao)
-- ═══════════════════════════════════════════════════════════════════════

insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id) values
  ('a1000000-0000-0000-0000-000000000001', '  Convidado.Um@Exemplo.COM  ', 'Convidado Um', 'seller', 'hash-sintetico-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001');

select is(
  (select email_normalized from public.invites where token_hash = 'hash-sintetico-001'),
  'convidado.um@exemplo.com', 'email_normalized aplica lower(btrim(email)) corretamente');
select is(
  (select email from public.invites where token_hash = 'hash-sintetico-001'),
  '  Convidado.Um@Exemplo.COM  ', 'email original (bruto) e preservado sem alteracao');

-- caixa diferente e espacos externos convergem para o MESMO
-- email_normalized (mesma identidade logica)
select is(
  lower(btrim('  Convidado.Um@Exemplo.COM  ')),
  lower(btrim('convidado.um@exemplo.com')),
  'caixa diferente e espacos externos convergem para a mesma normalizacao'
);

-- e-mail vazio apos trim e negado
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', '   ', 'Vazio', 'seller', 'hash-vazio-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'e-mail vazio apos trim e negado (invites_email_not_blank_ck)');

-- e-mail NULL e negado (NOT NULL)
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', null, 'Nulo', 'seller', 'hash-null-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  '23502', null, 'e-mail NULL e negado (NOT NULL)');

-- duplicidade PENDING na mesma empresa (mesmo email canonico, papeis
-- diferentes) e negada
insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id) values
  ('a1000000-0000-0000-0000-000000000001', 'duplicado@exemplo.com', 'Duplicado', 'seller', 'hash-dup-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', 'DUPLICADO@Exemplo.com', 'Duplicado 2', 'manager', 'hash-dup-002', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'segundo convite PENDING para o mesmo e-mail canonico na mesma empresa e negado (papel diferente nao muda isso)');

-- duplicidade PENDING de plataforma (company_id null) e negada
insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id) values
  (null, 'super1@exemplo.com', 'Super Um', 'super_admin', 'hash-super-001', now() + interval '7 days', 'e9000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values (null, 'Super1@Exemplo.com', 'Super Um 2', 'super_admin', 'hash-super-002', now() + interval '7 days', 'e9000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'segundo convite PENDING de plataforma para o mesmo e-mail canonico e negado');

-- historico (nao-pending) NAO bloqueia um novo pending para o mesmo e-mail
update public.invites set status = 'canceled' where token_hash = 'hash-dup-001';
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', 'duplicado@exemplo.com', 'Duplicado 3', 'seller', 'hash-dup-003', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  'convite CANCELED anterior nao bloqueia um novo PENDING para o mesmo e-mail (historico preservado, nao bloqueia)');

-- empresas diferentes nunca colidem entre si (mesmo e-mail, empresas
-- diferentes, ambos pending, sem violar nada)
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a2000000-0000-0000-0000-000000000002', 'duplicado@exemplo.com', 'Duplicado B', 'seller', 'hash-dup-b-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000002')$$,
  'mesmo e-mail em EMPRESA DIFERENTE nao colide com o indice de duplicidade');

-- ═══════════════════════════════════════════════════════════════════════
-- STATUS
-- ═══════════════════════════════════════════════════════════════════════

-- valor de status fora do enum e negado
select throws_ok(
  $$update public.invites set status = 'bogus'::public.invite_status where token_hash = 'hash-super-001'$$,
  '22P02', null, 'valor de status fora do enum e negado pelo proprio tipo');

-- pending com accepted_at preenchido viola a coerencia
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id, accepted_at)
    values ('a1000000-0000-0000-0000-000000000001', 'coerencia1@exemplo.com', 'Coerencia 1', 'seller', 'hash-coer-001', 'pending', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001', now())$$,
  '23514', null, 'status pending com accepted_at preenchido viola invites_accepted_coherence_ck');

-- accepted sem accepted_at/accepted_profile_id viola a coerencia
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', 'coerencia2@exemplo.com', 'Coerencia 2', 'seller', 'hash-coer-002', 'accepted', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'status accepted sem accepted_at/accepted_profile_id viola invites_accepted_coherence_ck');

-- accepted com os dois preenchidos e valido
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id, accepted_at, accepted_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', 'coerencia3@exemplo.com', 'Coerencia 3', 'seller', 'hash-coer-003', 'accepted', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001', now(), 'e1000000-0000-0000-0000-000000000003')$$,
  'status accepted com accepted_at e accepted_profile_id preenchidos e valido');

-- coerencia company_id x role_kind: manager/seller SEM company_id e negado
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values (null, 'semempresa@exemplo.com', 'Sem Empresa', 'seller', 'hash-semempresa-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'convite seller/manager sem company_id viola invites_company_role_coherence_ck');

-- super_admin COM company_id e negado
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', 'superindevido@exemplo.com', 'Super Indevido', 'super_admin', 'hash-superindevido-001', now() + interval '7 days', 'e9000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'convite super_admin com company_id preenchido viola invites_company_role_coherence_ck');

-- ═══════════════════════════════════════════════════════════════════════
-- TOKEN
-- ═══════════════════════════════════════════════════════════════════════

select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', 'semtoken@exemplo.com', 'Sem Token', 'seller', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  '23502', null, 'token_hash ausente e negado (NOT NULL)');

select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a2000000-0000-0000-0000-000000000002', 'outroemail@exemplo.com', 'Outro Email', 'seller', 'hash-sintetico-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000002')$$,
  '23505', null, 'token_hash duplicado (mesmo hash sintetico ja usado) e negado (unique)');

-- ═══════════════════════════════════════════════════════════════════════
-- AUDIT_LOG
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public'::name, 'audit_log'::name, 'tabela audit_log existe');

select col_type_is('public'::name, 'audit_log'::name, 'id'::name, 'uuid', 'audit_log.id e uuid');
select col_type_is('public'::name, 'audit_log'::name, 'actor_profile_id'::name, 'uuid', 'audit_log.actor_profile_id e uuid');
select col_type_is('public'::name, 'audit_log'::name, 'company_id'::name, 'uuid', 'audit_log.company_id e uuid');
select col_type_is('public'::name, 'audit_log'::name, 'action'::name, 'text', 'audit_log.action e text');
select col_type_is('public'::name, 'audit_log'::name, 'entity_type'::name, 'text', 'audit_log.entity_type e text');
select col_type_is('public'::name, 'audit_log'::name, 'entity_id'::name, 'text', 'audit_log.entity_id e text');
select col_type_is('public'::name, 'audit_log'::name, 'occurred_at'::name, 'timestamp with time zone', 'audit_log.occurred_at e timestamptz');
select col_type_is('public'::name, 'audit_log'::name, 'result'::name, 'text', 'audit_log.result e text');
select col_type_is('public'::name, 'audit_log'::name, 'reason'::name, 'text', 'audit_log.reason e text');
select col_type_is('public'::name, 'audit_log'::name, 'before_data'::name, 'jsonb', 'audit_log.before_data e jsonb');
select col_type_is('public'::name, 'audit_log'::name, 'after_data'::name, 'jsonb', 'audit_log.after_data e jsonb');
select col_type_is('public'::name, 'audit_log'::name, 'origin'::name, 'text', 'audit_log.origin e text');

select col_not_null('public'::name, 'audit_log'::name, 'action'::name, 'audit_log.action e NOT NULL');
select col_not_null('public'::name, 'audit_log'::name, 'entity_type'::name, 'audit_log.entity_type e NOT NULL');
select col_not_null('public'::name, 'audit_log'::name, 'occurred_at'::name, 'audit_log.occurred_at e NOT NULL');
select col_not_null('public'::name, 'audit_log'::name, 'result'::name, 'audit_log.result e NOT NULL');

select fk_ok('public'::name, 'audit_log'::name, array['actor_profile_id']::name[], 'public'::name, 'profiles'::name, array['id']::name[], 'FK audit_log.actor_profile_id -> profiles.id existe');
select fk_ok('public'::name, 'audit_log'::name, array['company_id']::name[], 'public'::name, 'companies'::name, array['id']::name[], 'FK audit_log.company_id -> companies.id existe');

-- append-only: como postgres (owner, bypassa RLS) confirmamos que
-- result so aceita os 2 valores fechados
select lives_ok(
  $$insert into public.audit_log (actor_profile_id, company_id, action, entity_type, entity_id, result)
    values ('e9000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'invite_sent', 'invite', 'algum-id', 'success')$$,
  'audit_log aceita result=success');
select lives_ok(
  $$insert into public.audit_log (actor_profile_id, company_id, action, entity_type, entity_id, result)
    values ('e9000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'invite_sent', 'invite', 'algum-id-2', 'failure')$$,
  'audit_log aceita result=failure');
select throws_ok(
  $$insert into public.audit_log (actor_profile_id, company_id, action, entity_type, entity_id, result)
    values ('e9000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'invite_sent', 'invite', 'algum-id-3', 'bogus')$$,
  '23514', null, 'audit_log rejeita result fora do CHECK (audit_log_result_ck)');

-- nenhuma coluna de token/senha existe em audit_log
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='audit_log'
      and column_name in ('token', 'token_hash', 'password', 'access_token', 'refresh_token', 'secret')),
  0, 'nenhuma coluna de token/senha/segredo existe em audit_log');

-- ═══════════════════════════════════════════════════════════════════════
-- FKS — PRESERVACAO DE HISTORICO (auditoria e correcao direcionada
-- pos-revisao: company_id passou de CASCADE para RESTRICT;
-- accepted_profile_id manteve SET NULL, com invites_accepted_coherence_ck
-- corrigida para nao mais exigir accepted_profile_id preenchido quando
-- status=accepted — ver comentarios da migration para a justificativa
-- completa). Fixtures desta secao sao isoladas (empresas/perfis proprios
-- com prefixo c/f), nunca reaproveitadas pelo resto do arquivo.
-- ═══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name) values
  ('c1000000-0000-0000-0000-000000000001', 'Empresa C FK Restrict'),
  ('c2000000-0000-0000-0000-000000000002', 'Empresa D FK SetNull Audit');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f1convidador@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'f2aceito@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'f3ator@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'F1 Convidador', 'f1convidador@test.local', 'manager', true),
  ('f2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'F2 Aceito', 'f2aceito@test.local', 'seller', true),
  ('f3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000002', 'F3 Ator Audit', 'f3ator@test.local', 'manager', true);

-- ── company_id: RESTRICT — excluir uma empresa com convite associado
--    e NEGADO; empresa e convite sobrevivem intactos ────────────────────
insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id) values
  ('c1000000-0000-0000-0000-000000000001', 'fk-restrict@exemplo.com', 'FK Restrict', 'seller', 'hash-fk-restrict-001', now() + interval '7 days', 'f1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$delete from public.companies where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'excluir uma empresa com convite associado e NEGADO (invites.company_id ON DELETE RESTRICT — preserva historico, nunca cascata destrutiva)');
select is(
  (select count(*)::int from public.companies where id = 'c1000000-0000-0000-0000-000000000001'),
  1, 'a empresa com convite associado continua existindo apos a tentativa de exclusao negada');
select is(
  (select count(*)::int from public.invites where token_hash = 'hash-fk-restrict-001'),
  1, 'o convite associado continua existindo intacto apos a tentativa de exclusao negada');

-- ── invited_by_profile_id: SET NULL — excluir o profile convidador
--    preserva o convite, apenas anula a referencia ──────────────────────
select lives_ok(
  $$delete from public.profiles where id = 'f1000000-0000-0000-0000-000000000001'$$,
  'excluir o profile que enviou o convite (f1) e permitido — invited_by_profile_id usa ON DELETE SET NULL');
select is(
  (select count(*)::int from public.invites where token_hash = 'hash-fk-restrict-001'),
  1, 'o convite sobrevive apos o profile convidador ser excluido (historico preservado)');
select is(
  (select invited_by_profile_id from public.invites where token_hash = 'hash-fk-restrict-001'),
  null, 'invited_by_profile_id foi anulado (SET NULL) apos a exclusao do profile convidador, sem apagar o convite');

-- ── accepted_profile_id: SET NULL — excluir o profile que aceitou
--    preserva o convite accepted; accepted_at nao desaparece; nenhuma
--    violacao de invites_accepted_coherence_ck ocorre (correcao pos-
--    auditoria comprovada de forma automatizada, nao apenas manual) ─────
insert into public.invites (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id, accepted_at, accepted_profile_id) values
  ('c1000000-0000-0000-0000-000000000001', 'fk-accepted@exemplo.com', 'FK Accepted', 'seller', 'hash-fk-accepted-001', 'accepted', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001', now(), 'f2000000-0000-0000-0000-000000000002');

select lives_ok(
  $$delete from public.profiles where id = 'f2000000-0000-0000-0000-000000000002'$$,
  'excluir o profile que aceitou o convite (f2) e permitido — accepted_profile_id usa ON DELETE SET NULL e o CHECK corrigido nao mais exige accepted_profile_id preenchido para status accepted');
select is(
  (select status::text from public.invites where token_hash = 'hash-fk-accepted-001'),
  'accepted', 'o convite continua com status accepted apos o profile aceito ser excluido (o fato do aceite nao desaparece)');
select is(
  (select accepted_at is not null from public.invites where token_hash = 'hash-fk-accepted-001'),
  true, 'accepted_at permanece preenchido apos a exclusao do profile aceito (quando o aceite ocorreu nao desaparece)');
select is(
  (select accepted_profile_id from public.invites where token_hash = 'hash-fk-accepted-001'),
  null, 'accepted_profile_id foi anulado (SET NULL) apos a exclusao do profile aceito, sem violar invites_accepted_coherence_ck e sem apagar o convite');

-- ── limitacao de schema reconhecida: o CHECK sozinho nao distingue
--    "nunca foi setado" de "setado e depois anulado pela FK" — um convite
--    PODE ser inserido diretamente como accepted com accepted_profile_id
--    NULL desde a criacao. A RPC futura de aceite (S4-C) e responsavel
--    por sempre preencher os dois campos no momento real do aceite ──────
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id, accepted_at, accepted_profile_id)
    values ('c1000000-0000-0000-0000-000000000001', 'fk-limitacao@exemplo.com', 'FK Limitacao', 'seller', 'hash-fk-limitacao-001', 'accepted', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001', now(), null)$$,
  'LIMITACAO RECONHECIDA: um convite pode ser inserido diretamente como accepted com accepted_profile_id NULL desde a criacao (accepted_at continua obrigatorio) — o CHECK nao distingue essa origem de um SET NULL posterior pela FK');

-- ── audit_log.actor_profile_id / company_id: SET NULL — excluir a
--    referencia nunca apaga a linha de auditoria (append-only real) ─────
insert into public.audit_log (actor_profile_id, company_id, action, entity_type, entity_id, result) values
  ('f3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000002', 'fk_survival_test', 'invite', 'fk-audit-001', 'success');

select lives_ok(
  $$delete from public.profiles where id = 'f3000000-0000-0000-0000-000000000003'$$,
  'excluir o profile ator de um registro de audit_log e permitido — actor_profile_id usa ON DELETE SET NULL');
select is(
  (select count(*)::int from public.audit_log where entity_id = 'fk-audit-001'),
  1, 'o registro de audit_log sobrevive apos o profile ator ser excluido (log nunca desaparece)');
select is(
  (select actor_profile_id from public.audit_log where entity_id = 'fk-audit-001'),
  null, 'actor_profile_id foi anulado (SET NULL) apos a exclusao do profile ator, sem apagar o log');

select lives_ok(
  $$delete from public.companies where id = 'c2000000-0000-0000-0000-000000000002'$$,
  'excluir uma empresa referenciada somente por audit_log (sem convites associados) e permitido — audit_log.company_id usa ON DELETE SET NULL, nao RESTRICT');
select is(
  (select count(*)::int from public.audit_log where entity_id = 'fk-audit-001'),
  1, 'o registro de audit_log sobrevive apos a empresa ser excluida (log nunca desaparece)');
select is(
  (select company_id from public.audit_log where entity_id = 'fk-audit-001'),
  null, 'company_id do audit_log foi anulado (SET NULL) apos a exclusao da empresa, sem apagar o log');
select is(
  (select occurred_at is not null from public.audit_log where entity_id = 'fk-audit-001'),
  true, 'occurred_at do registro de audit_log permanece preenchido e inalterado pelas exclusoes de referencia');

-- ═══════════════════════════════════════════════════════════════════════
-- RLS E ACL
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select relrowsecurity from pg_class where oid = 'public.invites'::regclass),
  true, 'RLS esta ativa em invites');
select is(
  (select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass),
  true, 'RLS esta ativa em audit_log');

-- anon nao le invites
set local role anon;
select throws_ok(
  $$select count(*) from public.invites$$,
  '42501', null, 'anon nao consegue ler invites (sem GRANT SELECT de tabela)');
reset role;

-- authenticated sem autoria nao ve os convites de terceiros
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.invites),
  0, 'Seller (nunca convida, nunca e dono de convite) nao ve nenhum convite');
reset role;

-- convidador ve os proprios
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.invites where invited_by_profile_id = 'e1000000-0000-0000-0000-000000000001'),
  (select count(*)::int from public.invites),
  'Manager E1 ve exatamente os convites que ele proprio criou (a contagem filtrada por autoria bate com a contagem total visivel), nada a mais');
reset role;

-- Manager nao ve convite de OUTRO Manager (E2 criou 1 convite; E1 nao deve
-- ve-lo)
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.invites where token_hash = 'hash-dup-b-001'),
  0, 'Manager E1 nao ve o convite criado pelo Manager E2 (isolamento entre convidadores)');
reset role;

select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.invites where token_hash = 'hash-dup-b-001'),
  1, 'Manager E2 ve o proprio convite');
reset role;

-- Super Admin sintetico ve TODOS os convites — total real capturado como
-- postgres (bypassa RLS) ANTES da troca de role, para nao comparar uma
-- consulta com ela mesma (tautologia)
create temporary table t22_expected_total as
  select count(*)::int as n from public.invites;
grant select on t22_expected_total to authenticated;

select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.invites),
  (select n from t22_expected_total),
  'Super Admin ve o total REAL de convites (consulta sem filtro nao e restringida pela RLS, nenhuma linha omitida)');
reset role;
drop table t22_expected_total;

-- zero INSERT/UPDATE/DELETE direto em invites, mesmo para o proprio
-- convidador ou Super Admin
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values ('a1000000-0000-0000-0000-000000000001', 'direto@exemplo.com', 'Direto', 'seller', 'hash-direto-001', now() + interval '7 days', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'INSERT direto em invites e negado mesmo para o proprio Manager (sem grant — criacao so sera via RPC futura)');
select throws_ok(
  $$update public.invites set status = 'canceled' where token_hash = 'hash-super-001'$$,
  '42501', null, 'UPDATE direto em invites e negado');
select throws_ok(
  $$delete from public.invites where token_hash = 'hash-super-001'$$,
  '42501', null, 'DELETE direto em invites e negado');
reset role;

select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id)
    values (null, 'direto2@exemplo.com', 'Direto 2', 'super_admin', 'hash-direto-002', now() + interval '7 days', 'e9000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'INSERT direto em invites e negado mesmo para Super Admin (sem grant)');
reset role;

-- audit_log fechado por completo: mesmo Super Admin nao le/escreve direto
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select count(*) from public.audit_log$$,
  '42501', null, 'audit_log: nem Super Admin le diretamente (sem grant/policy nesta etapa)');
select throws_ok(
  $$insert into public.audit_log (action, entity_type, result) values ('x', 'x', 'success')$$,
  '42501', null, 'audit_log: nem Super Admin escreve diretamente (grants futuros so via RPC SECURITY DEFINER)');
reset role;
set local role anon;
select throws_ok(
  $$select count(*) from public.audit_log$$,
  '42501', null, 'anon nao le audit_log');
reset role;

-- PUBLIC sem privilegios indevidos em nenhuma das duas tabelas
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='invites' and grantee='public'),
  0, 'PUBLIC sem nenhum grant em invites');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='audit_log' and grantee in ('public','anon','authenticated')),
  0, 'PUBLIC/anon/authenticated sem nenhum grant em audit_log (fechada por completo)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='invites' and grantee='authenticated' and privilege_type='SELECT'),
  1, 'authenticated tem exatamente o grant de SELECT em invites, nada mais');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='invites' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'authenticated nao tem INSERT/UPDATE/DELETE em invites');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE
-- ═══════════════════════════════════════════════════════════════════════

-- ATUALIZAÇÃO (M1-F S4-A2A): create_invite()/resend_invite()/
-- cancel_invite() passaram a existir (etapa seguinte, autorizada
-- separadamente) — a intenção original deste teste (nenhuma RPC de
-- convite nesta etapa S4-A1, que é só schema) permanece coberta pela
-- ausência das 3 no momento em que o S4-A1 foi commitado.
--
-- ATUALIZAÇÃO (M1-F S4-C1): accept_invite() passou a existir — a
-- checagem "deve ser 0" não faz mais sentido; substituída por uma
-- confirmação positiva de existência com a assinatura exata (mesmo
-- padrão das outras 3 RPCs de convite já atualizadas nesta seção).
select has_function('public'::name, 'accept_invite'::name, array['text']::name[],
  'accept_invite(text) passou a existir (M1-F S4-C1) — hash apenas, nunca token bruto');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')), 9, 'as 9 RPCs do M1-E continuam existindo, sem duplicata');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'policy de leads inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'policy de lead_timeline_entries inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'companies'),
  1, 'policy de companies inalterada (1 policy, companies_select_accessible do S3-A)');

-- runtime legado continua operando leads normalmente
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S4A1 Compat Teste', '(11) 90000-5555', 'Onix')).id$$,
  'SELLER legado (usuario seedado) ainda cria lead normalmente apos o S4-A1');
reset role;

select * from finish();
rollback;
