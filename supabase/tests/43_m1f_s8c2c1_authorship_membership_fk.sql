-- M1-F S8-C2-C1-AUTH-A1 — leads_created_by_fk/leads_updated_by_fk apontando
-- para company_memberships(company_id, profile_id) (autoria empresarial por
-- membership histórica). Prova: (1) autorização (membership) e integridade
-- referencial (FK) agora usam a MESMA fonte, nunca mais profiles.company_id;
-- (2) transferência de empresa não quebra create_lead/update_lead na nova
-- empresa; (3) autoria histórica (offboarding/transferência) nunca é
-- apagada nem invalidada; (4) Super Admin continua null; (5) hard delete de
-- membership referenciada é bloqueado; (6) nenhuma RPC foi redefinida.
-- Roda como postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ═══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('cb100000-0000-0000-0000-000000000001', 'S8C2C1AuthA1 Empresa Origem', 'ativa'),
  ('cb100000-0000-0000-0000-000000000002', 'S8C2C1AuthA1 Empresa Destino', 'ativa'),
  ('cb100000-0000-0000-0000-000000000003', 'S8C2C1AuthA1 Empresa Terceira', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'authA1-manager1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'authA1-manager2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'authA1-seller1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'authA1-successor@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'authA1-outsider@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'authA1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'authA1-legacy@test.local', now(), now(), now());

-- profiles.company_id/role/seller_id de "Legado" abaixo são DELIBERADAMENTE
-- divergentes da membership real (empresa terceira, role manager) — prova
-- de que a nova FK nunca lê profiles.company_id (ela nem referencia
-- profiles).
insert into public.profiles (id, company_id, name, email, role, is_active, platform_role) values
  ('cb200000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'Manager Um', 'authA1-manager1@test.local', 'manager', true, null),
  ('cb200000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000001', 'Manager Dois', 'authA1-manager2@test.local', 'manager', true, null),
  ('cb200000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000001', 'Seller Um', 'authA1-seller1@test.local', 'seller', true, null),
  ('cb200000-0000-0000-0000-000000000004', 'cb100000-0000-0000-0000-000000000001', 'Sucessor', 'authA1-successor@test.local', 'seller', true, null),
  ('cb200000-0000-0000-0000-000000000005', 'cb100000-0000-0000-0000-000000000003', 'Outsider', 'authA1-outsider@test.local', 'manager', true, null),
  ('cb200000-0000-0000-0000-000000000006', null, 'Super Admin AuthA1', 'authA1-superadmin@test.local', 'seller', true, 'super_admin'),
  ('cb200000-0000-0000-0000-000000000007', 'cb100000-0000-0000-0000-000000000003', 'Legado Divergente', 'authA1-legacy@test.local', 'manager', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('cb300000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'manager', true, 'active'),
  ('cb300000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'manager', true, 'active'),
  ('cb300000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'seller',  true, 'active'),
  ('cb300000-0000-0000-0000-000000000004', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000004', 'seller',  true, 'active'),
  ('cb300000-0000-0000-0000-000000000005', 'cb100000-0000-0000-0000-000000000003', 'cb200000-0000-0000-0000-000000000005', 'manager', true, 'active'),
  -- "Legado Divergente": membership real e MANAGER na empresa TERCEIRA —
  -- coincide com profiles.company_id aqui de proposito (o ponto sensivel
  -- desta suite e a FK, nao a autorizacao por role/seller_id legado, ja
  -- coberta exaustivamente no teste 42).
  ('cb300000-0000-0000-0000-000000000007', 'cb100000-0000-0000-0000-000000000003', 'cb200000-0000-0000-0000-000000000007', 'manager', true, 'active');

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('authA1SellerUm',      'cb100000-0000-0000-0000-000000000001', 'Seller Um',  'AuthA1-S1', 'cb200000-0000-0000-0000-000000000003', 'cb300000-0000-0000-0000-000000000003', true),
  ('authA1Sucessor',      'cb100000-0000-0000-0000-000000000001', 'Sucessor',   'AuthA1-SU', 'cb200000-0000-0000-0000-000000000004', 'cb300000-0000-0000-0000-000000000004', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('cb400000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('cb400000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('cb400000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000003', 'new', 'Novo', 0);

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.leads'::regclass and conname = 'leads_created_by_fk'),
  'FOREIGN KEY (company_id, created_by_profile_id) REFERENCES company_memberships(company_id, profile_id) ON DELETE RESTRICT',
  'leads_created_by_fk aponta para company_memberships(company_id, profile_id), ON DELETE RESTRICT');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.leads'::regclass and conname = 'leads_updated_by_fk'),
  'FOREIGN KEY (company_id, updated_by_profile_id) REFERENCES company_memberships(company_id, profile_id) ON DELETE RESTRICT',
  'leads_updated_by_fk aponta para company_memberships(company_id, profile_id), ON DELETE RESTRICT');

select is(
  (select confdeltype from pg_constraint where conrelid='public.leads'::regclass and conname='leads_created_by_fk'),
  'r', 'leads_created_by_fk: ON DELETE RESTRICT (nunca SET NULL/CASCADE)');
select is(
  (select confdeltype from pg_constraint where conrelid='public.leads'::regclass and conname='leads_updated_by_fk'),
  'r', 'leads_updated_by_fk: ON DELETE RESTRICT (nunca SET NULL/CASCADE)');
select is(
  (select confupdtype from pg_constraint where conrelid='public.leads'::regclass and conname='leads_created_by_fk'),
  'a', 'leads_created_by_fk: ON UPDATE NO ACTION (implicito, igual as demais FKs de leads)');
select is(
  (select confmatchtype from pg_constraint where conrelid='public.leads'::regclass and conname='leads_created_by_fk'),
  's', 'leads_created_by_fk: MATCH SIMPLE (default, preservado)');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.company_memberships'::regclass
      and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (company_id, profile_id)'),
  1, 'UNIQUE(company_id, profile_id) em company_memberships existe e nao foi recriada/alterada');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='leads'
      and column_name in ('created_by_profile_id','updated_by_profile_id')),
  2, 'nenhuma coluna nova ou removida em leads (as duas colunas de autoria continuam existindo)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('create_lead','update_lead','check_lead_phone_duplicate','resolve_lead_mutation_context')),
  4, 'as 4 funcoes do S8-C2-C1 continuam existindo, sem duplicata (nenhuma RPC redefinida nesta migration)');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_lead'),
  'create_lead: assinatura do S8-C2-C1 preservada (p_company_id ainda o ultimo parametro)');

-- ═══════════════════════════════════════════════════════════════════════
-- TRANSFERÊNCIA: create/update na empresa destino funcionam
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cb200000-0000-0000-0000-000000000003'); -- Seller Um
set local role authenticated;

create temp table t_pre_transfer_lead as
  select * from public.create_lead('Lead Pre Transferencia', '(11) 90000-9001', 'HB20');
select is((select company_id from t_pre_transfer_lead), 'cb100000-0000-0000-0000-000000000001'::uuid,
  'lead pre-transferencia criado na empresa origem');
select is((select created_by_profile_id from t_pre_transfer_lead), 'cb200000-0000-0000-0000-000000000003'::uuid,
  'created_by_profile_id = Seller Um (autoria real preservada)');

reset role;

select pg_temp.as_user('cb200000-0000-0000-0000-000000000006'); -- Super Admin
set local role authenticated;

create temp table t_transfer as
  select * from public.transfer_membership(
    'cb300000-0000-0000-0000-000000000003',
    'cb100000-0000-0000-0000-000000000002',
    'seller',
    'cb200000-0000-0000-0000-000000000004',
    'S8C2C1AuthA1 - teste de transferencia'
  );
select is((select destination_company_id from t_transfer), 'cb100000-0000-0000-0000-000000000002'::uuid,
  'transferencia concluida: membership destino na empresa B');

reset role;

select is(
  (select lifecycle_status::text from public.company_memberships where id = 'cb300000-0000-0000-0000-000000000003'),
  'offboarded', 'membership de origem (empresa A) vira offboarded, nunca apagada');
select is(
  (select company_id from public.company_memberships
    where profile_id = 'cb200000-0000-0000-0000-000000000003' and is_active),
  'cb100000-0000-0000-0000-000000000002'::uuid, 'membership ativa de Seller Um agora e na empresa B');
select is(
  (select company_id from public.profiles where id = 'cb200000-0000-0000-0000-000000000003'),
  'cb100000-0000-0000-0000-000000000001'::uuid,
  'profiles.company_id (legado) permanece empresa A — nunca sincronizado pela transferencia');

select pg_temp.as_user('cb200000-0000-0000-0000-000000000003'); -- Seller Um, agora em B
set local role authenticated;

create temp table t_post_transfer_create as
  select * from public.create_lead('Lead Pos Transferencia', '(11) 90000-9002', 'Onix');
select is((select company_id from t_post_transfer_create), 'cb100000-0000-0000-0000-000000000002'::uuid,
  'create_lead na empresa DESTINO funciona depois da transferencia (achado da auditoria corrigido)');
select is((select created_by_profile_id from t_post_transfer_create), 'cb200000-0000-0000-0000-000000000003'::uuid,
  'created_by_profile_id = Seller Um, satisfeito pela NOVA membership (empresa B)');

create temp table t_post_transfer_update as
  select * from public.update_lead(
    (select id from t_post_transfer_create), (select version from t_post_transfer_create),
    'Lead Pos Transferencia Editado', '(11) 90000-9002', 'Onix Novo');
select is((select updated_by_profile_id from t_post_transfer_update), 'cb200000-0000-0000-0000-000000000003'::uuid,
  'update_lead na empresa destino funciona depois da transferencia, updated_by_profile_id correto');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- HISTÓRICO: lead antigo da empresa de origem continua valido
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select created_by_profile_id from public.leads where id = (select id from t_pre_transfer_lead)),
  'cb200000-0000-0000-0000-000000000003'::uuid,
  'lead pre-transferencia mantem created_by_profile_id original — transferencia nunca reescreve autoria historica');
select is(
  (select company_id from public.leads where id = (select id from t_pre_transfer_lead)),
  'cb100000-0000-0000-0000-000000000001'::uuid,
  'lead pre-transferencia continua na empresa de origem (so seller_id do lead aberto e reatribuido pelo sucessor, nao a autoria)');

-- ═══════════════════════════════════════════════════════════════════════
-- OFFBOARDING: autoria historica sobrevive, autorizacao operacional some
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cb200000-0000-0000-0000-000000000001'); -- Manager Um
set local role authenticated;
create temp table t_manager_lead as
  select * from public.create_lead('Lead do Manager', '(11) 90000-9003', 'Kicks');
reset role;

select pg_temp.as_user('cb200000-0000-0000-0000-000000000006'); -- Super Admin
set local role authenticated;
select * from public.offboard_manager('cb300000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'S8C2C1AuthA1 - offboarding de teste');
reset role;

select is(
  (select lifecycle_status::text from public.company_memberships where id = 'cb300000-0000-0000-0000-000000000001'),
  'offboarded', 'membership do Manager Um vira offboarded');
select is(
  (select created_by_profile_id from public.leads where id = (select id from t_manager_lead)),
  'cb200000-0000-0000-0000-000000000001'::uuid,
  'lead do Manager Um mantem a autoria original mesmo apos o offboarding (FK satisfeita pela membership offboarded)');

select pg_temp.as_user('cb200000-0000-0000-0000-000000000001'); -- Manager Um, agora offboarded
set local role authenticated;
select throws_ok(
  $$select public.create_lead('X', '(11) 9', 'C')$$,
  'forbidden', 'Manager offboarded perde autorizacao operacional (FK nao concede autorizacao por si mesma)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN: created_by/updated_by permanecem null, audit_log correto
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cb200000-0000-0000-0000-000000000006');
set local role authenticated;
create temp table t_sa_lead as
  select * from public.create_lead('Lead do Super Admin', '(11) 90000-9004', 'HRV', null, null, null, null,
    'cb100000-0000-0000-0000-000000000001');
select is((select created_by_profile_id from t_sa_lead), null, 'Super Admin create: created_by_profile_id continua NULL');

create temp table t_sa_update as
  select * from public.update_lead((select id from t_sa_lead), (select version from t_sa_lead),
    'Lead do Super Admin Editado', '(11) 90000-9004', 'HRV Novo', null, null, null,
    'cb100000-0000-0000-0000-000000000001');
select is((select updated_by_profile_id from t_sa_update), null, 'Super Admin update: updated_by_profile_id continua NULL');
reset role;

select is(
  (select count(*)::int from public.audit_log
    where entity_type='lead' and entity_id = (select id::text from t_sa_lead) and actor_profile_id = 'cb200000-0000-0000-0000-000000000006'),
  2, 'audit_log registra o Super Admin real em create e update (autoria continua rastreada, mesmo com FK null)');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'cb200000-0000-0000-0000-000000000006'),
  0, 'nenhuma membership artificial foi criada para o Super Admin');

-- ═══════════════════════════════════════════════════════════════════════
-- DEFESA CROSS-COMPANY: FK bloqueia diretamente, sem depender da RPC
-- ═══════════════════════════════════════════════════════════════════════
-- Outsider tem membership real na empresa TERCEIRA — nunca na empresa
-- origem. Uma tentativa direta (fora de qualquer RPC) de gravar Outsider
-- como autor de um lead da empresa origem prova que a integridade
-- referencial em si (nao so a logica da RPC) nega a combinacao.

select throws_like(
  $$insert into public.leads (company_id, name, phone, car, stage_id, created_by_profile_id)
      values ('cb100000-0000-0000-0000-000000000001', 'Cross Company', '(11) 9', 'C',
        'cb400000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000005')$$,
  '%leads_created_by_fk%',
  'INSERT direto com created_by_profile_id de outra empresa (Outsider, empresa terceira) e negado pela FK');

select throws_like(
  format($$update public.leads set updated_by_profile_id = 'cb200000-0000-0000-0000-000000000005' where id = %L$$,
    (select id from t_pre_transfer_lead)),
  '%leads_updated_by_fk%',
  'UPDATE direto atribuindo autoria a Outsider (sem membership na empresa do lead) e negado pela FK');

select is(
  (select created_by_profile_id from public.leads where id = (select id from t_pre_transfer_lead)),
  'cb200000-0000-0000-0000-000000000003'::uuid,
  'tentativa negada nao alterou parcialmente o lead — autoria original permanece intacta');

-- ═══════════════════════════════════════════════════════════════════════
-- HARD DELETE: membership referenciada por lead nao pode ser apagada
-- ═══════════════════════════════════════════════════════════════════════

select throws_like(
  $$delete from public.company_memberships where id = 'cb300000-0000-0000-0000-000000000001'$$,
  '%leads_created_by_fk%',
  'DELETE fisico da membership do Manager Um (offboarded, referenciada por lead historico) e bloqueado pela FK');
select is(
  (select count(*)::int from public.company_memberships where id = 'cb300000-0000-0000-0000-000000000001'),
  1, 'membership do Manager Um continua existindo apos a tentativa de exclusao bloqueada');

-- ═══════════════════════════════════════════════════════════════════════
-- LEGADO DIVERGENTE: profiles.company_id nunca participa da FK nem da autorizacao
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cb200000-0000-0000-0000-000000000007'); -- Legado Divergente (membership real: empresa terceira)
set local role authenticated;
create temp table t_legacy_lead as
  select * from public.create_lead('Lead Legado', '(11) 90000-9005', 'Onix');
select is((select company_id from t_legacy_lead), 'cb100000-0000-0000-0000-000000000003'::uuid,
  'legado divergente: cria na empresa da MEMBERSHIP real (terceira), FK satisfeita normalmente');
select is((select created_by_profile_id from t_legacy_lead), 'cb200000-0000-0000-0000-000000000007'::uuid,
  'legado divergente: autoria gravada normalmente, FK nunca consultou profiles.company_id');
reset role;

select * from finish();
rollback;
