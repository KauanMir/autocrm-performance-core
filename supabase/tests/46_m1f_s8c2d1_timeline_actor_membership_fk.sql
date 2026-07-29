-- M1-F S8-C2-D1-TIMELINE-AUTH-A1 — lead_timeline_actor_fk reapontada para
-- company_memberships (autoria da timeline por membership histórica).
-- Prova: (1) a FK aponta para company_memberships(company_id, profile_id),
-- nunca mais para profiles; (2) transferência A->B preserva a timeline
-- antiga e libera a nova, mesmo com profiles.company_id divergente;
-- (3) offboarding sustenta o histórico e bloqueia hard delete da
-- membership referenciada; (4) Super Admin continua com actor_profile_id
-- null; (5) defesa cross-company ao nível da própria constraint; (6)
-- nenhuma RPC ou coluna foi alterada. Roda como postgres. Rollback ao
-- final.
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
  ('f1000000-0000-0000-0000-000000000001', 'S8C2D1TL Empresa F1', 'ativa'),
  ('f1000000-0000-0000-0000-000000000002', 'S8C2D1TL Empresa F2', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8c2d1tl-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8c2d1tl-mgr-transfer@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8c2d1tl-mgr-offboard@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8c2d1tl-mgr-backup@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's8c2d1tl-legacy@test.local', now(), now(), now());

-- profiles.company_id do "legacy" e DELIBERADAMENTE F2 (divergente da
-- membership real, F1) — prova que nunca decide a autoria da timeline.
insert into public.profiles (id, company_id, name, email, role, is_active, platform_role) values
  ('f2000000-0000-0000-0000-000000000001', null, 'Repro SA TL', 's8c2d1tl-superadmin@test.local', 'seller', true, 'super_admin'),
  ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'Manager Transfer', 's8c2d1tl-mgr-transfer@test.local', 'manager', true, null),
  ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001', 'Manager Offboard', 's8c2d1tl-mgr-offboard@test.local', 'manager', true, null),
  ('f2000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000001', 'Manager Backup', 's8c2d1tl-mgr-backup@test.local', 'manager', true, null),
  ('f2000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002', 'Legado Divergente TL', 's8c2d1tl-legacy@test.local', 'seller', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002', 'manager', true, 'active'),
  ('f3000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000003', 'manager', true, 'active'),
  ('f3000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000004', 'manager', true, 'active'),
  -- Legado divergente: membership REAL e manager em F1 — profiles.company_id
  -- (F2) acima e so ruido legado.
  ('f3000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000005', 'manager', true, 'active');

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('f4000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('f4000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'F1 Lead Transfer', '(11) 90000-6001', 'C1', 'f4000000-0000-0000-0000-000000000001', null),
  ('f5000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'F2 Lead Transfer', '(11) 90000-6002', 'C2', 'f4000000-0000-0000-0000-000000000002', null),
  ('f5000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001', 'F1 Lead Offboard', '(11) 90000-6003', 'C3', 'f4000000-0000-0000-0000-000000000001', null),
  ('f5000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000001', 'F1 Lead Legacy', '(11) 90000-6004', 'C4', 'f4000000-0000-0000-0000-000000000001', null);

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════

select fk_ok('public', 'lead_timeline_entries', array['company_id','actor_profile_id'],
             'public', 'company_memberships', array['company_id','profile_id'],
             'lead_timeline_actor_fk aponta para company_memberships, nunca para profiles');

select is(
  (select confmatchtype from pg_constraint where conname = 'lead_timeline_actor_fk'),
  's', 'lead_timeline_actor_fk: MATCH SIMPLE preservado');
select is(
  (select condeferrable from pg_constraint where conname = 'lead_timeline_actor_fk'),
  false, 'lead_timeline_actor_fk: nao deferrable, preservado');
select is(
  (select confupdtype from pg_constraint where conname = 'lead_timeline_actor_fk'),
  'a', 'lead_timeline_actor_fk: ON UPDATE NO ACTION preservado');
select is(
  (select confdeltype from pg_constraint where conname = 'lead_timeline_actor_fk'),
  'r', 'lead_timeline_actor_fk: ON DELETE RESTRICT (nunca SET NULL/CASCADE)');

select col_is_null('public', 'lead_timeline_entries', 'actor_profile_id',
  'lead_timeline_entries.actor_profile_id continua nullable');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='lead_timeline_entries'),
  10, 'lead_timeline_entries: nenhuma coluna nova (10 colunas)');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.company_memberships'::regclass
      and conname = 'company_memberships_company_id_profile_id_key'),
  1, 'UNIQUE(company_id, profile_id) de company_memberships existe e nao foi recriada com outro nome');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('move_lead_to_stage','apply_lead_event','assign_lead_seller','archive_lead',
       'unarchive_lead','add_lead_timeline_entry','create_lead','update_lead',
       'check_lead_phone_duplicate','resolve_lead_mutation_context')),
  10, 'nenhuma RPC de mutation/resolver de leads foi redefinida (10 assinaturas)');
select ok(
  (select pg_get_function_arguments(p.oid) like '%, p_company_id uuid DEFAULT NULL::uuid'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_lead_timeline_entry'),
  'add_lead_timeline_entry: assinatura inalterada (p_company_id ainda ultimo parametro)');

-- ═══════════════════════════════════════════════════════════════════════
-- TIMELINE ANTES DA TRANSFERÊNCIA (F1)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('f2000000-0000-0000-0000-000000000002');
set local role authenticated;
create temp table t_tl_before as
  select * from public.add_lead_timeline_entry('f5000000-0000-0000-0000-000000000001', 'phone', 'Entrada antes da transferencia', '#111111');
reset role;

select is((select actor_profile_id from t_tl_before), 'f2000000-0000-0000-0000-000000000002'::uuid,
  'timeline em F1 antes da transferencia: actor_profile_id = profile real');

-- ═══════════════════════════════════════════════════════════════════════
-- TRANSFERÊNCIA F1 -> F2 (Manager Transfer; 2 outros managers permanecem
-- em F1 — nenhum sucessor exigido)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('f2000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select * from public.transfer_membership('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'manager', null, 'S8-C2-D1-TIMELINE-AUTH-A1 transferencia')$$,
  'Super Admin transfere Manager Transfer de F1 para F2');
reset role;

select is(
  (select is_active from public.company_memberships where id = 'f3000000-0000-0000-0000-000000000002'),
  false, 'membership antiga (F1) fica offboarded, nunca apagada');
select is(
  (select company_id from public.profiles where id = 'f2000000-0000-0000-0000-000000000002'),
  'f1000000-0000-0000-0000-000000000001'::uuid,
  'profiles.company_id permanece F1 apos a transferencia (nunca sincronizado)');

-- timeline ANTIGA de F1 continua valida (FK satisfeita pela membership
-- historica, agora offboarded).
select is(
  (select count(*)::int from public.lead_timeline_entries
    where id = (select id from t_tl_before)),
  1, 'timeline criada antes da transferencia permanece intacta em F1');

-- nova timeline em F2, ja autorizado pela membership nova (resolve_lead_
-- mutation_context) e agora tambem satisfeito pela FK reapontada.
select pg_temp.as_user('f2000000-0000-0000-0000-000000000002');
set local role authenticated;
create temp table t_tl_after as
  select * from public.add_lead_timeline_entry('f5000000-0000-0000-0000-000000000002', 'phone', 'Entrada depois da transferencia', '#222222');
reset role;

select is((select actor_profile_id from t_tl_after), 'f2000000-0000-0000-0000-000000000002'::uuid,
  'timeline em F2 apos a transferencia: mesmo profile global, FK satisfeita pela membership nova');
select is((select company_id from t_tl_after), 'f1000000-0000-0000-0000-000000000002'::uuid,
  'timeline em F2 gravada na empresa correta');

-- ═══════════════════════════════════════════════════════════════════════
-- OFFBOARDING (Manager Offboard; Manager Backup permanece — nenhum
-- sucessor exigido)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('f2000000-0000-0000-0000-000000000003');
set local role authenticated;
create temp table t_tl_offboard as
  select * from public.add_lead_timeline_entry('f5000000-0000-0000-0000-000000000003', 'phone', 'Entrada antes do offboarding', '#333333');
reset role;

select pg_temp.as_user('f2000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select * from public.offboard_manager('f3000000-0000-0000-0000-000000000003', null, 'S8-C2-D1-TIMELINE-AUTH-A1 offboarding')$$,
  'Super Admin desliga Manager Offboard de F1');
reset role;

select is(
  (select is_active from public.company_memberships where id = 'f3000000-0000-0000-0000-000000000003'),
  false, 'membership offboarded permanece na tabela (nunca apagada)');
select is(
  (select count(*)::int from public.lead_timeline_entries where id = (select id from t_tl_offboard)),
  1, 'timeline criada antes do offboarding permanece intacta (autoria historica sustentada)');

-- ator offboarded nao executa nova mutation (autorizacao operacional
-- perdida via resolve_lead_mutation_context — nao e a FK que decide isso).
select pg_temp.as_user('f2000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.add_lead_timeline_entry('f5000000-0000-0000-0000-000000000003', 'phone', 'Nao deveria funcionar', '#444444')$$,
  'forbidden', 'ator offboarded nao executa nova mutation de timeline');
reset role;

-- hard delete da membership referenciada e bloqueado pela FK.
select throws_ok(
  $$delete from public.company_memberships where id = 'f3000000-0000-0000-0000-000000000003'$$,
  '23503', null, 'hard delete de membership referenciada por timeline e bloqueado (ON DELETE RESTRICT)');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('f2000000-0000-0000-0000-000000000001');
set local role authenticated;
create temp table t_tl_sa as
  select * from public.add_lead_timeline_entry('f5000000-0000-0000-0000-000000000001', 'phone', 'Entrada Super Admin', '#555555', null,
    'f1000000-0000-0000-0000-000000000001');
reset role;

select is((select actor_profile_id from t_tl_sa), null,
  'Super Admin: actor_profile_id continua NULL (FK satisfeita trivialmente)');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'lead_timeline_entry' and entity_id = (select id::text from t_tl_sa)
      and actor_profile_id = 'f2000000-0000-0000-0000-000000000001'),
  1, 'audit_log continua registrando o Super Admin real');

-- ═══════════════════════════════════════════════════════════════════════
-- LEGADO DIVERGENTE
-- ═══════════════════════════════════════════════════════════════════════

-- profiles.company_id do "legacy" e F2 (legado, nunca lido) — a
-- membership real (F1, manager) e quem autoriza e satisfaz a FK.
select pg_temp.as_user('f2000000-0000-0000-0000-000000000005');
set local role authenticated;
create temp table t_tl_legacy as
  select * from public.add_lead_timeline_entry('f5000000-0000-0000-0000-000000000004', 'phone', 'Entrada legado divergente', '#666666');
reset role;

select is((select actor_profile_id from t_tl_legacy), 'f2000000-0000-0000-0000-000000000005'::uuid,
  'legado divergente: FK satisfeita pela membership real em F1, profiles.company_id (F2) nunca interfere');

-- ═══════════════════════════════════════════════════════════════════════
-- DEFESA CROSS-COMPANY AO NÍVEL DA CONSTRAINT
-- ═══════════════════════════════════════════════════════════════════════

-- Prova direta da propria FK (bypass da RPC, como postgres): um
-- actor_profile_id sem membership na empresa-alvo nunca pode ser gravado
-- como ator de uma timeline daquela empresa — Manager Backup so tem
-- membership em F1, nunca em F2.
select throws_ok(
  $$insert into public.lead_timeline_entries (company_id, lead_id, actor_profile_id, icon, color, label)
    values ('f1000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000002',
            'f2000000-0000-0000-0000-000000000004', 'i', '#c', 'l')$$,
  '23503', null,
  'INSERT direto com ator sem membership na empresa-alvo viola a FK (defesa cross-company na propria constraint)');

select * from finish();
rollback;
