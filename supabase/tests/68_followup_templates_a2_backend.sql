-- FOLLOW-UP-TEMPLATES-A2-EXEC-BACKEND — Company Follow-up Template Authority
-- Prova: (1) followup_templates/constraints/RLS/grants exatamente como
-- desenhado, reaproveitando public.task_priority (nenhum enum novo); (2)
-- resolve_followup_template_mutation_context nunca exposto ao cliente,
-- Seller sempre negado dentro dele; (3) create/update/set_active/reorder
-- respeitam Manager (própria empresa, nunca outra), Super Admin contextual
-- (p_company_id explícito, ativa/implantacao, nunca suspensa/cancelada) e
-- negam Seller sempre; (4) isolamento cross-company em todas as 4 RPCs de
-- escrita; (5) limite de 12 templates ATIVOS por empresa (create e
-- reativação), inativos nunca contam; (6) reorder exige permutação completa
-- da empresa, nunca ID de outra empresa; (7) leitura: Manager vê
-- ativos+inativos, Seller só ativos, Super Admin só via RPC dedicada; (8)
-- regressão de public.tasks/create_task (nenhuma mudança de schema/
-- comportamento); (9) anon nunca executa nada. Roda como postgres. Rollback
-- ao final — nenhum dado persiste.

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
  ('fa100000-0000-0000-0000-000000000001', 'FT Empresa A Ativa', 'ativa'),
  ('fa100000-0000-0000-0000-000000000002', 'FT Empresa B Ativa (outra)', 'ativa'),
  ('fa100000-0000-0000-0000-000000000003', 'FT Empresa C Suspensa', 'suspensa'),
  ('fa100000-0000-0000-0000-000000000004', 'FT Empresa D Cancelada', 'cancelada'),
  ('fa100000-0000-0000-0000-000000000005', 'FT Empresa E Implantacao', 'implantacao'),
  ('fa100000-0000-0000-0000-000000000006', 'FT Empresa F Limite Ativos', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fa200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ft-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ft-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ft-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'ft-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'ft-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'ft-nomembership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'ft-manager-f@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('fa200000-0000-0000-0000-000000000001', 'Super Admin FT', 'ft-superadmin@test.local', true, 'super_admin'),
  ('fa200000-0000-0000-0000-000000000002', 'Manager A',      'ft-manager-a@test.local',  true, null),
  ('fa200000-0000-0000-0000-000000000003', 'Seller A1',      'ft-seller-a1@test.local',  true, null),
  ('fa200000-0000-0000-0000-000000000004', 'Manager B',      'ft-manager-b@test.local',  true, null),
  ('fa200000-0000-0000-0000-000000000005', 'Manager C',      'ft-manager-c@test.local',  true, null),
  ('fa200000-0000-0000-0000-000000000006', 'Sem Membership', 'ft-nomembership@test.local', true, null),
  ('fa200000-0000-0000-0000-000000000007', 'Manager F',      'ft-manager-f@test.local',  true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('fa300000-0000-0000-0000-000000000002', 'fa100000-0000-0000-0000-000000000001', 'fa200000-0000-0000-0000-000000000002', 'manager', true),
  ('fa300000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'fa200000-0000-0000-0000-000000000003', 'seller',  true),
  ('fa300000-0000-0000-0000-000000000004', 'fa100000-0000-0000-0000-000000000002', 'fa200000-0000-0000-0000-000000000004', 'manager', true),
  ('fa300000-0000-0000-0000-000000000005', 'fa100000-0000-0000-0000-000000000003', 'fa200000-0000-0000-0000-000000000005', 'manager', true),
  ('fa300000-0000-0000-0000-000000000007', 'fa100000-0000-0000-0000-000000000006', 'fa200000-0000-0000-0000-000000000007', 'manager', true);
-- fa200000-...-06 (Sem Membership) deliberadamente sem nenhuma linha.

-- Fixture minima de Tasks (regressao, secao 10) — mesmo molde do teste 54.
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('ftSellerA1', 'fa100000-0000-0000-0000-000000000001', 'Seller A1', 'FT-A1',
   'fa200000-0000-0000-0000-000000000003', 'fa300000-0000-0000-0000-000000000003', true);

-- ═══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public', 'followup_templates', 'tabela public.followup_templates existe');

select col_not_null('public', 'followup_templates', 'company_id', 'company_id NOT NULL');
select col_not_null('public', 'followup_templates', 'name', 'name NOT NULL');
select col_not_null('public', 'followup_templates', 'task_title', 'task_title NOT NULL');
select col_not_null('public', 'followup_templates', 'task_note', 'task_note NOT NULL');
select col_has_default('public', 'followup_templates', 'task_note', 'task_note tem default');
select col_default_is('public', 'followup_templates', 'task_note', '', 'task_note default vazio');
select col_not_null('public', 'followup_templates', 'priority', 'priority NOT NULL');
select col_not_null('public', 'followup_templates', 'offset_value', 'offset_value NOT NULL');
select col_not_null('public', 'followup_templates', 'offset_unit', 'offset_unit NOT NULL');
select col_is_null('public', 'followup_templates', 'default_time', 'default_time nullable');
select col_not_null('public', 'followup_templates', 'is_active', 'is_active NOT NULL');
select col_default_is('public', 'followup_templates', 'is_active', 'true', 'is_active default true');
select col_not_null('public', 'followup_templates', 'sort_order', 'sort_order NOT NULL');
select col_not_null('public', 'followup_templates', 'created_by', 'created_by NOT NULL');
select col_not_null('public', 'followup_templates', 'updated_by', 'updated_by NOT NULL');
select col_not_null('public', 'followup_templates', 'version', 'version NOT NULL');
select col_default_is('public', 'followup_templates', 'version', '1', 'version default 1');

select is(
  (select t.typname from pg_attribute a
     join pg_type t on t.oid = a.atttypid
    where a.attrelid = 'public.followup_templates'::regclass and a.attname = 'priority'),
  'task_priority', 'priority reaproveita o enum public.task_priority (nenhum enum novo)');
select is(
  (select t.typname from pg_attribute a
     join pg_type t on t.oid = a.atttypid
    where a.attrelid = 'public.followup_templates'::regclass and a.attname = 'offset_unit'),
  'text', 'offset_unit e texto (nao um enum novo), validado via CHECK');

select ok(
  (select count(*)::int from pg_constraint where conrelid = 'public.followup_templates'::regclass and contype = 'c') >= 7,
  'followup_templates: pelo menos 7 CHECK constraints');
select ok(
  (select condeferrable and condeferred from pg_constraint
    where conrelid = 'public.followup_templates'::regclass and contype = 'u'
      and conname = 'followup_templates_company_id_sort_order_key'),
  'unique(company_id, sort_order) e DEFERRABLE INITIALLY DEFERRED');

select ok(
  (select confdeltype from pg_constraint where conname = 'followup_templates_company_id_fkey') = 'c',
  'followup_templates.company_id -> companies(id): ON DELETE CASCADE');
select ok(
  (select confrelid from pg_constraint where conname = 'followup_templates_created_by_fkey') = 'public.profiles'::regclass,
  'created_by referencia profiles(id) diretamente (nunca FK composta com company_memberships)');
select ok(
  (select confrelid from pg_constraint where conname = 'followup_templates_updated_by_fkey') = 'public.profiles'::regclass,
  'updated_by referencia profiles(id) diretamente');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.followup_templates'::regclass),
  'RLS habilitado em public.followup_templates');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'followup_templates' and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1, 'authenticated: SELECT concedido em followup_templates');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'followup_templates' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'authenticated: nenhum grant direto de INSERT/UPDATE/DELETE em followup_templates');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'followup_templates' and grantee = 'anon'),
  0, 'anon: nenhum grant em followup_templates');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('create_followup_template','update_followup_template','set_followup_template_active',
       'reorder_followup_templates','list_platform_followup_templates_for_company',
       'resolve_followup_template_mutation_context')),
  6, 'as 6 funcoes existem, uma unica assinatura cada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('create_followup_template','update_followup_template','set_followup_template_active',
       'reorder_followup_templates','list_platform_followup_templates_for_company',
       'resolve_followup_template_mutation_context')
      and p.prosecdef),
  6, 'as 6 funcoes sao SECURITY DEFINER');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'resolve_followup_template_mutation_context' and grantee in ('authenticated','anon')),
  0, 'resolve_followup_template_mutation_context: nunca API publica');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in ('create_followup_template','update_followup_template','set_followup_template_active',
                            'reorder_followup_templates','list_platform_followup_templates_for_company')
      and grantee = 'authenticated'),
  5, 'as 5 RPCs publicas: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in ('create_followup_template','update_followup_template','set_followup_template_active',
                            'reorder_followup_templates','list_platform_followup_templates_for_company')
      and grantee = 'anon'),
  0, 'as 5 RPCs publicas: anon NAO tem EXECUTE');

-- ═══════════════════════════════════════════════════════════════════════
-- 2. CREATE — MANAGER A (empresa FTA ativa)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('fa200000-0000-0000-0000-000000000002');
set local role authenticated;

select t.id as tpl1_id, t.company_id as tpl1_company, t.sort_order as tpl1_sort, t.created_by as tpl1_created_by
  from public.create_followup_template(
    'Cliente pediu para pensar', 'Retomar contato', 'media', 2, 'day') t \gset
select is(:'tpl1_company'::text, 'fa100000-0000-0000-0000-000000000001'::text, 'Manager A: create_followup_template resolve company_id correto');
select is(:'tpl1_sort'::int, 0, 'primeiro template da empresa recebe sort_order 0 automaticamente');
select is(:'tpl1_created_by'::text, 'fa200000-0000-0000-0000-000000000002'::text, 'created_by = Manager A (ator real)');
select ok((select t.version from public.followup_templates t where t.id = :'tpl1_id'::uuid) = 1, 'tpl1: version inicial 1');
select ok((select t.is_active from public.followup_templates t where t.id = :'tpl1_id'::uuid), 'tpl1: is_active default true');

select t.id as tpl2_id, t.sort_order as tpl2_sort
  from public.create_followup_template('Nao respondeu', 'Tentar novo contato', 'alta', 1, 'hour') t \gset
select is(:'tpl2_sort'::int, 1, 'segundo template recebe sort_order = max+1 automaticamente');

select t.id as tpl3_id, t.sort_order as tpl3_sort
  from public.create_followup_template('Retornar em 7 dias', 'Retomar contato', 'baixa', 7, 'day', '', null, 99) t \gset
select is(:'tpl3_sort'::int, 99, 'sort_order explicito e respeitado quando enviado');

-- Manager passando p_company_id de OUTRA empresa: ignorado, sempre a propria
select t.id as tpl4_id, t.company_id as tpl4_company
  from public.create_followup_template('x', 'y', 'media', 1, 'day', '', null, null, 'fa100000-0000-0000-0000-000000000002') t \gset
select is(:'tpl4_company'::text, 'fa100000-0000-0000-0000-000000000001'::text,
  'Manager A: p_company_id de outra empresa e ignorado, template sempre criado na PROPRIA empresa');

-- boundary valida (168h / 90 dias) — nunca negada
select ok(
  (select t.offset_value from public.create_followup_template('Boundary hour', 'x', 'media', 168, 'hour') t) = 168,
  'offset_value = 168 com offset_unit=hour e o teto MAXIMO valido (nunca negado)');
select ok(
  (select t.offset_value from public.create_followup_template('Boundary day', 'x', 'media', 90, 'day') t) = 90,
  'offset_value = 90 com offset_unit=day e o teto MAXIMO valido (nunca negado)');

-- validacoes de shape
select throws_ok(
  $$select public.create_followup_template('  ', 'Retomar contato', 'media', 1, 'day')$$,
  'followup_template_invalid_name', 'name em branco e negado');
select throws_ok(
  $$select public.create_followup_template('Nome', '  ', 'media', 1, 'day')$$,
  'followup_template_invalid_task_title', 'task_title em branco e negado');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 1, 'week')$$,
  'followup_template_invalid_offset', 'offset_unit fora de hour/day e negado');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 0, 'day')$$,
  'followup_template_invalid_offset', 'offset_value = 0 e negado');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', -1, 'day')$$,
  'followup_template_invalid_offset', 'offset_value negativo e negado');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 169, 'hour')$$,
  'followup_template_invalid_offset', 'offset_value > 168 para hour e negado (teto defensivo)');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 91, 'day')$$,
  'followup_template_invalid_offset', 'offset_value > 90 para day e negado (teto defensivo)');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 1, 'day', '', '25:00')$$,
  'followup_template_invalid_time', 'default_time fora do range 00:00-23:59 e negado');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 1, 'day', '', 'abc')$$,
  'followup_template_invalid_time', 'default_time fora do formato HH:mm e negado');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 1, 'day', '', '9:00')$$,
  'followup_template_invalid_time', 'default_time sem zero a esquerda e negado (formato estrito)');
select throws_ok(
  $$select public.create_followup_template('Nome', 'Titulo', 'media', 3, 'hour', '', '09:00')$$,
  'followup_template_invalid_time', 'default_time combinado com offset_unit=hour e negado (precheck A1 §8)');
select ok(
  (select t.default_time from public.create_followup_template('Amanha as 9', 'Retomar contato', 'media', 1, 'day', '', '09:00') t) = '09:00',
  'default_time valido (HH:mm) com offset_unit=day e aceito');
select throws_ok(
  $$select public.create_followup_template('Prioridade invalida', 'Titulo', 'urgente', 1, 'day')$$,
  '22P02', null, 'priority fora do enum e rejeitado pelo tipo (nunca vira valor livre)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CREATE — SELLER A1 / MANAGER C (suspensa) / SEM MEMBERSHIP
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('fa200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select throws_ok(
  $$select public.create_followup_template('x', 'y', 'media', 1, 'day')$$,
  'forbidden', 'Seller: create_followup_template e sempre negado');
reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000005'); -- Manager C (empresa suspensa)
set local role authenticated;
select throws_ok(
  $$select public.create_followup_template('x', 'y', 'media', 1, 'day')$$,
  'forbidden', 'Manager de empresa suspensa: create_followup_template e negado');
reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000006'); -- Sem Membership
set local role authenticated;
select throws_ok(
  $$select public.create_followup_template('x', 'y', 'media', 1, 'day')$$,
  'forbidden', 'Profile sem membership ativa: create_followup_template e negado');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. CREATE / UPDATE — SUPER ADMIN CONTEXTUAL
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('fa200000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;

select throws_ok(
  $$select public.create_followup_template('x', 'y', 'media', 1, 'day')$$,
  'company_required', 'Super Admin sem p_company_id: create_followup_template negado com company_required');
select throws_ok(
  $$select public.create_followup_template('x', 'y', 'media', 1, 'day', '', null, null, 'fa100000-0000-0000-0000-000000000004')$$,
  'company_read_only', 'Super Admin em empresa CANCELADA: create_followup_template negado');
select throws_ok(
  $$select public.create_followup_template('x', 'y', 'media', 1, 'day', '', null, null, 'fa100000-0000-0000-0000-000000000003')$$,
  'company_read_only', 'Super Admin em empresa SUSPENSA: create_followup_template negado (nunca escreve, so le)');

select t.id as sa_tpl_id, t.created_by as sa_tpl_created_by
  from public.create_followup_template('Template Super Admin', 'Retomar contato', 'alta', 3, 'day', '', null, null, 'fa100000-0000-0000-0000-000000000001') t \gset
select is(:'sa_tpl_created_by'::text, 'fa200000-0000-0000-0000-000000000001'::text,
  'Super Admin: created_by e o profile REAL do Super Admin (nunca NULL, diferente do padrao de leads)');

select ok(
  (select t.id from public.create_followup_template('Template em implantacao', 'Retomar contato', 'alta', 1, 'day', '', null, null, 'fa100000-0000-0000-0000-000000000005') t) is not null,
  'Super Admin: create_followup_template numa empresa em IMPLANTACAO e permitido');

select ok(
  (select t.name from public.update_followup_template(
    :'sa_tpl_id', 1, 'Template Super Admin Editado', 'Retomar contato', 'nota', 'media', 5, 'day', null,
    'fa100000-0000-0000-0000-000000000001') t) = 'Template Super Admin Editado',
  'Super Admin: update_followup_template com company_id explicito funciona');

reset role;

-- Template GENUINAMENTE de outra empresa (Manager B, empresa FTB) — usado
-- nos testes de isolamento cross-company abaixo. NUNCA reaproveitar sa_tpl_id
-- para isso (foi criado pelo Super Admin DENTRO da empresa A, seção 4).
select pg_temp.as_user('fa200000-0000-0000-0000-000000000004'); -- Manager B
set local role authenticated;
select t.id as tplb_id from public.create_followup_template('Empresa B Template', 'x', 'media', 1, 'day') t \gset
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. UPDATE — MANAGER A (proprio) / cross-company / version conflict / Seller
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('fa200000-0000-0000-0000-000000000002'); -- Manager A
set local role authenticated;

select ok(
  (select t.task_title from public.update_followup_template(
    :'tpl1_id', 1, 'Cliente pediu para pensar', 'Retomar contato agora', 'nota nova', 'alta', 3, 'day', '10:30') t) = 'Retomar contato agora',
  'Manager A: update_followup_template no proprio template funciona');
select is(
  (select t.version from public.followup_templates t where t.id = :'tpl1_id'::uuid),
  2, 'tpl1: version incrementou apos update');

select throws_ok(
  format($$select public.update_followup_template(%L, 1, 'x', 'y', '', 'media', 1, 'day', null)$$, :'tpl1_id'),
  'followup_template_conflict', 'Manager A: update com expected_version desatualizada (1, real=2) e negado');

select throws_ok(
  $$select public.update_followup_template('00000000-0000-0000-0000-000000000000', 1, 'x', 'y', '', 'media', 1, 'day', null)$$,
  'followup_template_not_found', 'Manager A: update de id inexistente e negado');

select throws_ok(
  format($$select public.update_followup_template(%L, 1, 'x', 'y', '', 'media', 1, 'day', null)$$, :'tplb_id'),
  'followup_template_not_found', 'Manager A: update de template de OUTRA empresa (FTB) e negado como not_found (isolamento)');

select throws_ok(
  format($$select public.update_followup_template(%L, 2, '   ', 'y', '', 'media', 1, 'day', null)$$, :'tpl1_id'),
  'followup_template_invalid_name', 'Manager A: update com name em branco e negado (mesma validacao do create)');

reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select throws_ok(
  format($$select public.update_followup_template(%L, 2, 'x', 'y', '', 'media', 1, 'day', null)$$, :'tpl1_id'),
  'forbidden', 'Seller: update_followup_template e sempre negado');
select throws_ok(
  format($$select public.set_followup_template_active(%L, 2, false, null)$$, :'tpl1_id'),
  'forbidden', 'Seller: set_followup_template_active e sempre negado');
select throws_ok(
  $$select public.reorder_followup_templates(array['00000000-0000-0000-0000-000000000000'::uuid])$$,
  'forbidden', 'Seller: reorder_followup_templates e sempre negado');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. READ (RLS) — Manager ativos+inativos, Seller so ativos, cross-company
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('fa200000-0000-0000-0000-000000000002'); -- Manager A
set local role authenticated;

select ok(
  (select t.is_active from public.set_followup_template_active(:'tpl2_id', 1, false, null) t) = false,
  'Manager A: set_followup_template_active desativa tpl2');

select is(
  (select count(*)::int from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000001'),
  8, 'Manager A: enxerga TODOS os templates da propria empresa (ativos+inativos) — 7 criados pelo Manager A + 1 criado pelo Super Admin (secao 4) = 8, incluindo tpl2 ja inativo');
reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select is(
  (select count(*)::int from public.followup_templates where id = :'tpl2_id'::uuid),
  0, 'Seller A1: NAO enxerga tpl2 (desativado)');
select is(
  (select count(*)::int from public.followup_templates where id = :'tpl1_id'::uuid),
  1, 'Seller A1: enxerga tpl1 (ativo)');
reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000004'); -- Manager B (outra empresa)
set local role authenticated;
select is(
  (select count(*)::int from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000001'),
  0, 'Manager B: NENHUM template de outra empresa e visivel (isolamento por company_id)');
reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;
select is(
  (select count(*)::int from public.followup_templates),
  0, 'Super Admin: SELECT direto em followup_templates nao enxerga nenhuma linha (sem policy propria)');

select throws_ok(
  $$select public.list_platform_followup_templates_for_company(null)$$,
  'company_required', 'Super Admin: list_platform_followup_templates_for_company sem company e negado');
select is(
  (select count(*)::int from public.list_platform_followup_templates_for_company('fa100000-0000-0000-0000-000000000001')),
  7, 'Super Admin: list_platform (default include_inactive=false) conta so os ATIVOS da empresa A (8 total - 1 inativo)');
select is(
  (select count(*)::int from public.list_platform_followup_templates_for_company('fa100000-0000-0000-0000-000000000001', true)),
  8, 'Super Admin: list_platform com include_inactive=true conta ativos+inativos da empresa A');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. ACTIVE LIMIT (empresa FTF dedicada, isolada dos templates das secoes acima)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('fa200000-0000-0000-0000-000000000007'); -- Manager F
set local role authenticated;

select t.id as f01_id from public.create_followup_template('F01', 'x', 'media', 1, 'day') t \gset
select ok((select t.id from public.create_followup_template('F02', 'x', 'media', 1, 'day') t) is not null, 'F02 criado');
select ok((select t.id from public.create_followup_template('F03', 'x', 'media', 1, 'day') t) is not null, 'F03 criado');
select ok((select t.id from public.create_followup_template('F04', 'x', 'media', 1, 'day') t) is not null, 'F04 criado');
select ok((select t.id from public.create_followup_template('F05', 'x', 'media', 1, 'day') t) is not null, 'F05 criado');
select ok((select t.id from public.create_followup_template('F06', 'x', 'media', 1, 'day') t) is not null, 'F06 criado');
select ok((select t.id from public.create_followup_template('F07', 'x', 'media', 1, 'day') t) is not null, 'F07 criado');
select ok((select t.id from public.create_followup_template('F08', 'x', 'media', 1, 'day') t) is not null, 'F08 criado');
select ok((select t.id from public.create_followup_template('F09', 'x', 'media', 1, 'day') t) is not null, 'F09 criado');
select ok((select t.id from public.create_followup_template('F10', 'x', 'media', 1, 'day') t) is not null, 'F10 criado');
select ok((select t.id from public.create_followup_template('F11', 'x', 'media', 1, 'day') t) is not null, 'F11 criado');
select ok((select t.id from public.create_followup_template('F12', 'x', 'media', 1, 'day') t) is not null, 'F12 criado (12 ativos, no limite)');

select is(
  (select count(*)::int from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000006' and is_active),
  12, 'empresa F: exatamente 12 templates ATIVOS apos as 12 criacoes');

select throws_ok(
  $$select public.create_followup_template('F13', 'x', 'media', 1, 'day')$$,
  'followup_template_limit_reached', '13o template ATIVO e negado (limite congelado de 12)');

select ok(
  (select t.is_active from public.set_followup_template_active(:'f01_id', 1, false, null) t) = false,
  'desativar F01 libera 1 slot (11 ativos)');
select is(
  (select count(*)::int from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000006' and is_active),
  11, 'empresa F: 11 ativos apos desativar F01 (inativos nunca contam)');

select t.id as f13_id from public.create_followup_template('F13', 'x', 'media', 1, 'day') t \gset
select is(
  (select count(*)::int from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000006' and is_active),
  12, 'empresa F: 12 ativos de novo apos F13 (slot liberado por F01 foi reaproveitado)');

select throws_ok(
  format($$select public.set_followup_template_active(%L, 1, true, null)$$, :'f01_id'),
  'followup_template_limit_reached', 'reativar F01 agora (ja 12 ativos) e negado pelo mesmo limite');

select ok(
  (select t.is_active from public.set_followup_template_active(:'f13_id', 1, false, null) t) = false,
  'desativar F13 libera 1 slot de novo (11 ativos)');
select ok(
  (select t.is_active from public.set_followup_template_active(:'f01_id', 2, true, null) t) = true,
  'reativar F01 agora (11 ativos) e permitido, volta a 12');
select is(
  (select count(*)::int from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000006' and is_active),
  12, 'empresa F: 12 ativos apos reativar F01');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. REORDER
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('fa200000-0000-0000-0000-000000000002'); -- Manager A
set local role authenticated;

select array_agg(id order by sort_order) as ft_a_ids
  from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000001' \gset

select array_agg(id order by sort_order desc) as ft_a_reversed
  from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000001' \gset

select ok(
  (select count(*) from public.reorder_followup_templates(:'ft_a_reversed'::uuid[])) = cardinality(:'ft_a_ids'::uuid[]),
  'reorder_followup_templates com permutacao completa (invertida) retorna todos os templates da empresa');
select is(
  (select t.sort_order from public.followup_templates t where t.id = (:'ft_a_reversed'::uuid[])[1]),
  0, 'primeiro id da lista enviada recebe sort_order 0 apos reorder');
select is(
  (select t.sort_order from public.followup_templates t where t.id = (:'ft_a_reversed'::uuid[])[array_length(:'ft_a_reversed'::uuid[],1)]),
  array_length(:'ft_a_ids'::uuid[],1) - 1, 'ultimo id da lista enviada recebe o maior sort_order apos reorder');

-- lista incompleta (falta 1 id)
select (:'ft_a_ids'::uuid[])[1:array_length(:'ft_a_ids'::uuid[],1)-1] as ft_a_incomplete \gset
select throws_ok(
  format($$select public.reorder_followup_templates(%L::uuid[])$$, :'ft_a_incomplete'),
  'followup_template_reorder_incomplete', 'reorder com permutacao INCOMPLETA (falta 1 id) e negado');

-- lista com id de outra empresa (cross-company) — tplb_id (FTB) nunca pertence a FTA
select throws_ok(
  format($$select public.reorder_followup_templates(array[%L::uuid] || %L::uuid[])$$, :'tplb_id', :'ft_a_ids'),
  'followup_template_not_found', 'reorder incluindo um ID de OUTRA empresa (FTB) e negado como not_found');

reset role;

-- confirma que o reorder de A nunca tocou a empresa F
select pg_temp.as_user('fa200000-0000-0000-0000-000000000007'); -- Manager F
set local role authenticated;
select is(
  (select count(*)::int from public.followup_templates where company_id = 'fa100000-0000-0000-0000-000000000006' and is_active),
  12, 'empresa F: reorder de outra empresa (A) nunca alterou nada aqui — ainda 12 ativos');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. REGRESSAO — public.tasks / create_task (precheck A2-EXEC §42)
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public', 'tasks', 'REGRESSAO: tabela public.tasks continua existindo, schema intocado');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_task','update_task','complete_task','resolve_commercial_mutation_context')),
  4, 'REGRESSAO: create_task/update_task/complete_task/resolve_commercial_mutation_context continuam exatamente 4 funcoes');

select pg_temp.as_user('fa200000-0000-0000-0000-000000000002'); -- Manager A
set local role authenticated;
select is(
  (select t.assigned_seller_id from public.create_task('Regressao Manager', 'media', now() + interval '1 day', 'ftSellerA1') t),
  'ftSellerA1', 'REGRESSAO: Manager cria Task normal com responsavel explicito (create_task intocado)');
reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000003'); -- Seller A1
set local role authenticated;
select is(
  (select t.assigned_seller_id from public.create_task('Regressao Seller', 'media', now() + interval '1 day') t),
  'ftSellerA1', 'REGRESSAO: Seller cria Task e continua autoatribuido automaticamente');
reset role;

select pg_temp.as_user('fa200000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.create_task('Regressao Super Admin', 'media', now() + interval '1 day', 'ftSellerA1')$$,
  'forbidden', 'REGRESSAO: Super Admin continua PROIBIDO de criar Task (create_task nunca foi aberto)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. ANON — nunca executa nada
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select count(*) from public.followup_templates$$, '42501', null, 'anon: SELECT direto em followup_templates falha');
select throws_ok($$select public.create_followup_template('x', 'y', 'media', 1, 'day')$$, '42501', null, 'anon: create_followup_template falha (sem EXECUTE)');
select throws_ok(
  format($$select public.update_followup_template(%L, 1, 'x', 'y', '', 'media', 1, 'day', null)$$, :'tpl1_id'),
  '42501', null, 'anon: update_followup_template falha (sem EXECUTE)');
select throws_ok(
  format($$select public.set_followup_template_active(%L, 1, false, null)$$, :'tpl1_id'),
  '42501', null, 'anon: set_followup_template_active falha (sem EXECUTE)');
select throws_ok(
  $$select public.reorder_followup_templates(array['00000000-0000-0000-0000-000000000000'::uuid])$$,
  '42501', null, 'anon: reorder_followup_templates falha (sem EXECUTE)');
select throws_ok(
  $$select public.list_platform_followup_templates_for_company('fa100000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon: list_platform_followup_templates_for_company falha (sem EXECUTE)');
reset role;

select * from finish();
rollback;
