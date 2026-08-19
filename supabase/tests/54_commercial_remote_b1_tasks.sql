-- COMMERCIAL-REMOTE-B1-A — Tasks remoto: schema + RLS + RPC
-- Prova: (1) tasks/enums/checks/FKs/indexes exatamente como desenhado;
-- (2) RLS SELECT-only, escrita direta revogada de anon/authenticated;
-- (3) resolve_commercial_mutation_context nunca exposto ao cliente;
-- (4) create_task/update_task/complete_task respeitam Manager (empresa
--     inteira, responsável obrigatório) e Seller (só a própria Task, nunca
--     reatribui); (5) isolamento cross-company (empresa foreign invisível,
--     Super Admin negado, empresa não-ativa negada, profile sem membership
--     negado); (6) integridade de dados (título vazio, FK inválida,
--     consistência de conclusão); (7) concorrência otimista (version
--     correta passa, stale falha); (8) anon nunca executa. Roda como
--     postgres. Rollback ao final — nenhum dado persiste.

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
  ('cb100000-0000-0000-0000-000000000001', 'B1 Tasks Empresa A Ativa', 'ativa'),
  ('cb100000-0000-0000-0000-000000000002', 'B1 Tasks Empresa B Ativa (outra)', 'ativa'),
  ('cb100000-0000-0000-0000-000000000003', 'B1 Tasks Empresa C Suspensa', 'suspensa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b1t-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b1t-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'b1t-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'b1t-seller-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'b1t-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'b1t-seller-b1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'b1t-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'b1t-nomembership@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('cb200000-0000-0000-0000-000000000001', 'Super Admin B1T', 'b1t-superadmin@test.local', true, 'super_admin'),
  ('cb200000-0000-0000-0000-000000000002', 'Manager A',       'b1t-manager-a@test.local',  true, null),
  ('cb200000-0000-0000-0000-000000000003', 'Seller A1',       'b1t-seller-a1@test.local',  true, null),
  ('cb200000-0000-0000-0000-000000000004', 'Seller A2',       'b1t-seller-a2@test.local',  true, null),
  ('cb200000-0000-0000-0000-000000000005', 'Manager B',       'b1t-manager-b@test.local',  true, null),
  ('cb200000-0000-0000-0000-000000000006', 'Seller B1',       'b1t-seller-b1@test.local',  true, null),
  ('cb200000-0000-0000-0000-000000000007', 'Manager C',       'b1t-manager-c@test.local',  true, null),
  ('cb200000-0000-0000-0000-000000000008', 'Sem Membership',  'b1t-nomembership@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('cb300000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'manager', true),
  ('cb300000-0000-0000-0000-000000000003', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'seller',  true),
  ('cb300000-0000-0000-0000-000000000004', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000004', 'seller',  true),
  ('cb300000-0000-0000-0000-000000000005', 'cb100000-0000-0000-0000-000000000002', 'cb200000-0000-0000-0000-000000000005', 'manager', true),
  ('cb300000-0000-0000-0000-000000000006', 'cb100000-0000-0000-0000-000000000002', 'cb200000-0000-0000-0000-000000000006', 'seller',  true),
  ('cb300000-0000-0000-0000-000000000007', 'cb100000-0000-0000-0000-000000000003', 'cb200000-0000-0000-0000-000000000007', 'manager', true);
-- cb200000-...-08 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('b1tSellerA1',    'cb100000-0000-0000-0000-000000000001', 'Seller A1',       'B1T-A1', 'cb200000-0000-0000-0000-000000000003', 'cb300000-0000-0000-0000-000000000003', true),
  ('b1tSellerA2',    'cb100000-0000-0000-0000-000000000001', 'Seller A2',       'B1T-A2', 'cb200000-0000-0000-0000-000000000004', 'cb300000-0000-0000-0000-000000000004', true),
  ('b1tSellerA1Inx', 'cb100000-0000-0000-0000-000000000001', 'Seller A1 Inact', 'B1T-A1I', null, null, false),
  ('b1tSellerB1',    'cb100000-0000-0000-0000-000000000002', 'Seller B1',       'B1T-B1', 'cb200000-0000-0000-0000-000000000006', 'cb300000-0000-0000-0000-000000000006', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('cb400000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('cb400000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('cb500000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'Lead A1', '(11) 90000-9001', 'Onix',
   'cb400000-0000-0000-0000-000000000001', 'b1tSellerA1'),
  ('cb500000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000002', 'Lead B1', '(11) 90000-9002', 'HB20',
   'cb400000-0000-0000-0000-000000000002', 'b1tSellerB1');

-- ═══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public', 'tasks', 'tabela public.tasks existe');

select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_priority'),
  array['alta','media','baixa']::text[],
  'task_priority: exatamente alta/media/baixa, nesta ordem');
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_status'),
  array['pending','completed']::text[],
  'task_status: exatamente pending/completed (sem late/today/upcoming)');

select col_not_null('public', 'tasks', 'company_id', 'company_id NOT NULL');
select col_is_null('public', 'tasks', 'lead_id', 'lead_id nullable');
select col_is_null('public', 'tasks', 'assigned_seller_id', 'assigned_seller_id nullable na tabela (obrigatorio so no RPC)');
select col_not_null('public', 'tasks', 'title', 'title NOT NULL');
select col_not_null('public', 'tasks', 'note', 'note NOT NULL');
select col_has_default('public', 'tasks', 'note', 'note tem default');
select col_default_is('public', 'tasks', 'note', '', 'note default vazio');
select col_not_null('public', 'tasks', 'priority', 'priority NOT NULL');
select col_not_null('public', 'tasks', 'status', 'status NOT NULL');
select col_default_is('public', 'tasks', 'status', 'pending', 'status default pending');
select col_not_null('public', 'tasks', 'due_at', 'due_at NOT NULL');
select col_is_null('public', 'tasks', 'completed_at', 'completed_at nullable');
select col_is_null('public', 'tasks', 'created_by', 'created_by nullable');
select col_is_null('public', 'tasks', 'updated_by', 'updated_by nullable');
select col_is_null('public', 'tasks', 'completed_by', 'completed_by nullable');
select col_not_null('public', 'tasks', 'version', 'version NOT NULL');
select col_default_is('public', 'tasks', 'version', '1', 'version default 1');

select has_check('public', 'tasks', 'tasks: possui pelo menos um CHECK');
select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.tasks'::regclass and contype = 'c') >= 3,
  'tasks: pelo menos 3 CHECK constraints (title, version, completion consistency)');

select ok(
  (select confdeltype from pg_constraint where conname = 'tasks_company_lead_fk') = 'r',
  'tasks_company_lead_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'tasks_company_seller_fk') = 'r',
  'tasks_company_seller_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'tasks_created_by_fk') = 'r',
  'tasks_created_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'tasks_updated_by_fk') = 'r',
  'tasks_updated_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'tasks_completed_by_fk') = 'r',
  'tasks_completed_by_fk: ON DELETE RESTRICT');
select ok(
  (select confdeltype from pg_constraint where conname = 'tasks_company_id_fkey' or conname like 'tasks_company_id%') = 'c',
  'tasks.company_id -> companies(id): ON DELETE CASCADE (espelha leads.company_id)');

select has_index('public', 'tasks', 'tasks_company_status_due_idx', 'index (company_id, status, due_at) existe');
select has_index('public', 'tasks', 'tasks_company_seller_status_due_idx', 'index (company_id, assigned_seller_id, status, due_at) existe');
select has_index('public', 'tasks', 'tasks_company_lead_idx', 'index (company_id, lead_id) existe');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_task','update_task','complete_task','resolve_commercial_mutation_context')),
  4, 'as 4 funcoes existem, uma unica assinatura cada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_task','update_task','complete_task','resolve_commercial_mutation_context')
      and p.prosecdef),
  4, 'as 4 funcoes sao SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_task','update_task','complete_task','resolve_commercial_mutation_context')
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  4, 'as 4 funcoes tem search_path configurado explicitamente');

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SECURITY / GRANTS
-- ═══════════════════════════════════════════════════════════════════════

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tasks'::regclass),
  'RLS habilitado em public.tasks');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'tasks' and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1, 'authenticated: SELECT concedido em tasks');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'tasks' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'authenticated: nenhum grant direto de INSERT/UPDATE/DELETE em tasks');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'tasks' and grantee = 'anon'),
  0, 'anon: nenhum grant em tasks');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'resolve_commercial_mutation_context' and grantee = 'authenticated'),
  0, 'resolve_commercial_mutation_context: authenticated NAO tem EXECUTE (nunca API publica)');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'resolve_commercial_mutation_context' and grantee = 'anon'),
  0, 'resolve_commercial_mutation_context: anon NAO tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'create_task' and grantee = 'authenticated'),
  1, 'create_task: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name in ('create_task','update_task','complete_task') and grantee = 'anon'),
  0, 'create_task/update_task/complete_task: anon NAO tem EXECUTE');

-- ═══════════════════════════════════════════════════════════════════════
-- 3. MANAGER A (empresa CA1 ativa)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cb200000-0000-0000-0000-000000000002');
set local role authenticated;

select is(
  (select t.company_id from public.create_task('T1 ManagerCreated A1', 'alta', now() + interval '1 day', 'b1tSellerA1', 'cb500000-0000-0000-0000-000000000001') t),
  'cb100000-0000-0000-0000-000000000001'::uuid,
  'Manager: create_task para Seller A1 com Lead da empresa resolve company_id correto');
select is(
  (select t.status from public.tasks t where t.title = 'T1 ManagerCreated A1'),
  'pending'::public.task_status, 'T1: status inicial pending');
select is(
  (select t.version from public.tasks t where t.title = 'T1 ManagerCreated A1'),
  1, 'T1: version inicial 1');
select is(
  (select t.created_by from public.tasks t where t.title = 'T1 ManagerCreated A1'),
  'cb200000-0000-0000-0000-000000000002'::uuid, 'T1: created_by = Manager A');
select is(
  (select t.completed_at is null and t.completed_by is null from public.tasks t where t.title = 'T1 ManagerCreated A1'),
  true, 'T1: completed_at/completed_by nulos na criacao');

select throws_ok(
  $$select public.create_task('Sem responsavel', 'media', now())$$,
  'seller_required', 'Manager: create_task sem assigned_seller_id e negado (produto atual nunca cria Task sem responsavel)');
select throws_ok(
  $$select public.create_task('Seller de outra empresa', 'media', now(), 'b1tSellerB1')$$,
  'seller_not_found', 'Manager: create_task para Seller de outra empresa e negado');
select throws_ok(
  $$select public.create_task('Seller inativo', 'media', now(), 'b1tSellerA1Inx')$$,
  'seller_not_found', 'Manager: create_task para Seller inativo e negado');
select throws_ok(
  $$select public.create_task('Lead de outra empresa', 'media', now(), 'b1tSellerA1', 'cb500000-0000-0000-0000-000000000002')$$,
  'lead_not_found', 'Manager: create_task com Lead de outra empresa e negado');
select throws_ok(
  $$select public.create_task('   ', 'media', now(), 'b1tSellerA1')$$,
  'invalid_title', 'Manager: create_task com titulo vazio/so espacos e negado');
select throws_ok(
  $$select public.create_task('Prioridade invalida', 'urgente', now(), 'b1tSellerA1')$$,
  '22P02', null, 'Manager: create_task com prioridade fora do enum e rejeitado pelo tipo (nunca vira valor livre)');

select ok(
  (select t.id from public.create_task('T1R ManagerReassign', 'baixa', now() + interval '2 days', 'b1tSellerA1') t) is not null,
  'Manager: create_task T1R (para reatribuir depois) criado');
select is(
  (select t.assigned_seller_id from public.tasks t where t.title = 'T1R ManagerReassign'),
  'b1tSellerA1', 'T1R: inicialmente atribuido a Seller A1');

select ok(
  (select t.assigned_seller_id from public.update_task(
    (select id from public.tasks where title = 'T1R ManagerReassign'), 1,
    'T1R ManagerReassign', '', 'baixa', now() + interval '3 days', 'b1tSellerA2') t) = 'b1tSellerA2',
  'Manager: update_task reatribui T1R para Seller A2');
select is(
  (select t.version from public.tasks t where t.title = 'T1R ManagerReassign'),
  2, 'T1R: version incrementou apos update_task');

select throws_ok(
  format($$select public.update_task(%L, 1, 'T1R stale', '', 'baixa', now(), 'b1tSellerA2')$$,
    (select id from public.tasks where title = 'T1R ManagerReassign')),
  'stale_write', 'Manager: update_task com expected_version desatualizada (1, real=2) e negado');

select ok(
  (select t.status from public.complete_task(
    (select id from public.tasks where title = 'T1R ManagerReassign'), 2) t) = 'completed',
  'Manager: complete_task conclui T1R (version correta)');
select is(
  (select t.completed_by from public.tasks t where t.title = 'T1R ManagerReassign'),
  'cb200000-0000-0000-0000-000000000002'::uuid, 'T1R: completed_by = Manager A');

select throws_ok(
  format($$select public.complete_task(%L, 3)$$, (select id from public.tasks where title = 'T1R ManagerReassign')),
  'already_completed', 'Manager: complete_task numa Task ja concluida e negado com erro deterministico proprio');
select throws_ok(
  format($$select public.update_task(%L, 3, 'x', '', 'baixa', now(), 'b1tSellerA2')$$,
    (select id from public.tasks where title = 'T1R ManagerReassign')),
  'task_completed', 'Manager: update_task numa Task concluida e negado (imutavel neste B1)');

-- id capturado agora (Manager enxerga T4) porque Seller A1/Manager B/Super
-- Admin/anon, mais abaixo, NAO enxergam T4 via SELECT (RLS) — um lookup por
-- titulo sob esses papeis retornaria NULL e mascararia o teste pretendido.
select t.id as t4_id from public.create_task('T4 ManagerCreated A2', 'media', now() + interval '1 day', 'b1tSellerA2') t \gset
select ok(:'t4_id' is not null,
  'Manager: create_task T4 para Seller A2 (usado nos testes de isolamento de Seller abaixo)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SELLER A1 (empresa CA1 ativa)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cb200000-0000-0000-0000-000000000003');
set local role authenticated;

select is(
  (select t.assigned_seller_id from public.create_task('T2 SellerA1 Self', 'media', now() + interval '1 day') t),
  'b1tSellerA1', 'Seller: create_task sem assigned_seller_id normaliza para o proprio seller');
-- id capturado agora (Seller A1 enxerga a propria T3) porque Manager B/Super
-- Admin/anon, mais abaixo, NAO enxergam T3 via SELECT (RLS/grants) — um
-- lookup por titulo sob esses papeis retornaria NULL/erro e mascararia o
-- teste pretendido (cross-company/Super Admin/anon).
select t.id as t3_id, t.assigned_seller_id as t3_seller from public.create_task('T3 SellerA1 Explicit', 'baixa', now() + interval '1 day', 'b1tSellerA1') t \gset
select is(:'t3_seller'::text, 'b1tSellerA1'::text, 'Seller: create_task informando o proprio seller_id explicitamente funciona');
select throws_ok(
  $$select public.create_task('Para outro seller', 'media', now(), 'b1tSellerA2')$$,
  'forbidden', 'Seller: create_task para outro Seller e negado');

select is(
  (select count(*)::int from public.tasks where title = 'T1 ManagerCreated A1'),
  1, 'Seller A1: enxerga a propria T1 (SELECT via RLS)');
select is(
  (select count(*)::int from public.tasks where title = 'T2 SellerA1 Self'),
  1, 'Seller A1: enxerga a propria T2');
select is(
  (select count(*)::int from public.tasks where title = 'T4 ManagerCreated A2'),
  0, 'Seller A1: NAO enxerga T4 (atribuida a Seller A2)');

select ok(
  (select t.due_at from public.update_task(
    :'t3_id', 1,
    'T3 SellerA1 Explicit', 'nota atualizada', 'alta', now() + interval '5 days', 'b1tSellerA1') t) is not null,
  'Seller: update_task na propria Task funciona');

select throws_ok(
  format($$select public.update_task(%L, 1, 'x', '', 'media', now(), 'b1tSellerA2')$$, :'t4_id'),
  'forbidden', 'Seller: update_task em Task de outro Seller e negado');
select throws_ok(
  format($$select public.update_task(%L, 2, 'T2 SellerA1 Self', '', 'media', now(), 'b1tSellerA2')$$,
    (select id from public.tasks where title = 'T2 SellerA1 Self')),
  'forbidden', 'Seller: update_task tentando reatribuir a propria Task para outro Seller e negado');
select throws_ok(
  format($$select public.complete_task(%L, 1)$$, :'t4_id'),
  'forbidden', 'Seller: complete_task em Task de outro Seller e negado');

select ok(
  (select t.status from public.complete_task(
    (select id from public.tasks where title = 'T2 SellerA1 Self'), 1) t) = 'completed',
  'Seller: complete_task na propria Task funciona');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. TENANCY / CROSS-COMPANY / EMPRESA NAO-ATIVA / SEM MEMBERSHIP / SUPER ADMIN
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('cb200000-0000-0000-0000-000000000005'); -- Manager B (CA2 ativa, outra empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.tasks where title in ('T1 ManagerCreated A1','T3 SellerA1 Explicit','T4 ManagerCreated A2')),
  0, 'Manager B (CA2): nenhuma Task de CA1 e visivel (isolamento por company_id)');
select throws_ok(
  format($$select public.update_task(%L, 1, 'x', '', 'media', now(), 'b1tSellerA1')$$, :'t3_id'),
  'task_not_found', 'Manager B: update_task numa Task de outra empresa (id existe, company nao) e negado como task_not_found');
select throws_ok(
  format($$select public.complete_task(%L, 1)$$, :'t3_id'),
  'task_not_found', 'Manager B: complete_task numa Task de outra empresa e negado como task_not_found');
reset role;

select pg_temp.as_user('cb200000-0000-0000-0000-000000000007'); -- Manager C (CA3 suspensa)
set local role authenticated;
select throws_ok(
  $$select public.create_task('x', 'media', now(), 'b1tSellerA1')$$,
  'forbidden', 'Manager C (empresa suspensa): create_task negado');
reset role;

select pg_temp.as_user('cb200000-0000-0000-0000-000000000008'); -- Sem Membership
set local role authenticated;
select throws_ok(
  $$select public.create_task('x', 'media', now())$$,
  'forbidden', 'Profile sem membership ativa: create_task negado');
reset role;

select pg_temp.as_user('cb200000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.create_task('x', 'media', now(), 'b1tSellerA1')$$,
  'forbidden', 'Super Admin: create_task negado (Tasks nao tem superficie de Super Admin neste B1)');
select throws_ok(
  format($$select public.update_task(%L, 1, 'x', '', 'media', now(), 'b1tSellerA1')$$, :'t3_id'),
  'forbidden', 'Super Admin: update_task negado');
select throws_ok(
  format($$select public.complete_task(%L, 1)$$, :'t3_id'),
  'forbidden', 'Super Admin: complete_task negado');
select is(
  (select count(*)::int from public.tasks),
  0, 'Super Admin: SELECT direto em tasks nao enxerga nenhuma linha (sem policy propria, current_membership_company_id() sempre null)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. INTEGRIDADE DE DADOS (direto, como owner da tabela, fora de RLS)
-- ═══════════════════════════════════════════════════════════════════════

select throws_ok(
  $$insert into public.tasks (company_id, assigned_seller_id, title, priority, due_at)
    values ('cb100000-0000-0000-0000-000000000001', 'b1tSellerA1', '   ', 'media', now())$$,
  '23514', null, 'insert direto: titulo vazio/so espacos viola tasks_title_not_blank_ck');

select throws_ok(
  $$insert into public.tasks (company_id, assigned_seller_id, lead_id, title, priority, due_at)
    values ('cb100000-0000-0000-0000-000000000001', 'b1tSellerA1', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'X', 'media', now())$$,
  '23503', null, 'insert direto: lead_id inexistente/de outra empresa viola tasks_company_lead_fk');

select throws_ok(
  $$insert into public.tasks (company_id, assigned_seller_id, title, priority, due_at, status, completed_at, completed_by)
    values ('cb100000-0000-0000-0000-000000000001', 'b1tSellerA1', 'X', 'media', now(), 'completed', null, null)$$,
  '23514', null, 'insert direto: status completed sem completed_at/completed_by viola tasks_completion_consistency_ck');

select throws_ok(
  format($$insert into public.tasks (company_id, assigned_seller_id, title, priority, due_at, status, completed_at, completed_by)
    values ('cb100000-0000-0000-0000-000000000001', 'b1tSellerA1', 'X', 'media', now(), 'pending', now(), %L)$$,
    'cb200000-0000-0000-0000-000000000002'),
  '23514', null, 'insert direto: status pending com completed_at preenchido viola tasks_completion_consistency_ck');

-- Linha sem responsavel (nunca produzida pelas RPCs em B1, mas a coluna
-- permanece nullable por design — precheck §8/§10): confirma que a policy
-- SELECT trata assigned_seller_id IS NULL como visivel a QUALQUER Seller
-- da empresa (comportamento defensivo espelhando _filteredTasks local).
insert into public.tasks (company_id, title, priority, due_at)
  values ('cb100000-0000-0000-0000-000000000001', 'T5 Sem Responsavel', 'baixa', now() + interval '1 day');

select pg_temp.as_user('cb200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select is(
  (select count(*)::int from public.tasks where title = 'T5 Sem Responsavel'),
  1, 'Seller A1: enxerga Task sem responsavel (policy defensiva, mesmo sem writer ativo em B1)');
reset role;
select pg_temp.as_user('cb200000-0000-0000-0000-000000000004'); -- Seller A2
set local role authenticated;
select is(
  (select count(*)::int from public.tasks where title = 'T5 Sem Responsavel'),
  1, 'Seller A2: tambem enxerga a mesma Task sem responsavel');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. ANON — nunca executa nada
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select count(*) from public.tasks$$, '42501', null, 'anon: SELECT direto em tasks falha');
select throws_ok($$select public.create_task('x', 'media', now())$$, '42501', null, 'anon: create_task falha (sem EXECUTE)');
select throws_ok(
  format($$select public.update_task(%L, 1, 'x', '', 'media', now(), 'b1tSellerA1')$$, :'t3_id'),
  '42501', null, 'anon: update_task falha (sem EXECUTE)');
select throws_ok(
  format($$select public.complete_task(%L, 1)$$, :'t3_id'),
  '42501', null, 'anon: complete_task falha (sem EXECUTE)');
reset role;

select * from finish();
rollback;
