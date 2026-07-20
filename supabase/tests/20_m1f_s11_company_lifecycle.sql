-- M1-F S1.1 — testes do fechamento da lacuna retroativa do S1 (pgTAP):
-- companies.status/trade_name/created_by_profile_id + integração com
-- can_access_company()/is_manager_or_platform() (m1f_s11). Roda como
-- postgres (fixtures) e authenticated (comportamento real via SET ROLE +
-- request.jwt.claims). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures: 4 empresas, uma por status, cada uma com manager+seller ───
insert into public.companies (id, name) values
  ('e1eeeeee-1111-1111-1111-111111111111', 'Empresa E1 Ativa'),
  ('e2eeeeee-2222-2222-2222-222222222222', 'Empresa E2 Suspensa'),
  ('e3eeeeee-3333-3333-3333-333333333333', 'Empresa E3 Cancelada'),
  ('e4eeeeee-4444-4444-4444-444444444444', 'Empresa E4 Implantacao');

update public.companies set status = 'ativa'      where id = 'e1eeeeee-1111-1111-1111-111111111111';
update public.companies set status = 'suspensa'   where id = 'e2eeeeee-2222-2222-2222-222222222222';
update public.companies set status = 'cancelada'  where id = 'e3eeeeee-3333-3333-3333-333333333333';
update public.companies set status = 'implantacao' where id = 'e4eeeeee-4444-4444-4444-444444444444';
-- e1 é setada explicitamente para 'ativa' (representa "empresa
-- existente já backfillada pela migration real" dentro deste arquivo,
-- que só existe nesta transação de teste — diferente das empresas do
-- seed.sql, o DEFAULT da coluna para uma linha nova é 'implantacao', não
-- 'ativa'; e1 não pode simplesmente "herdar" o backfill real)

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e1manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e1seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e2manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e2seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e3manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e3seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e9superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e9000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'e9legacyadmin@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('e1000000-0000-0000-0000-000000000001', 'e1eeeeee-1111-1111-1111-111111111111', 'E1 Manager', 'e1manager@test.local', 'manager', true),
  ('e1000000-0000-0000-0000-000000000002', 'e1eeeeee-1111-1111-1111-111111111111', 'E1 Seller',  'e1seller@test.local',  'seller',  true),
  ('e2000000-0000-0000-0000-000000000001', 'e2eeeeee-2222-2222-2222-222222222222', 'E2 Manager', 'e2manager@test.local', 'manager', true),
  ('e2000000-0000-0000-0000-000000000002', 'e2eeeeee-2222-2222-2222-222222222222', 'E2 Seller',  'e2seller@test.local',  'seller',  true),
  ('e3000000-0000-0000-0000-000000000001', 'e3eeeeee-3333-3333-3333-333333333333', 'E3 Manager', 'e3manager@test.local', 'manager', true),
  ('e3000000-0000-0000-0000-000000000002', 'e3eeeeee-3333-3333-3333-333333333333', 'E3 Seller',  'e3seller@test.local',  'seller',  true),
  ('e9000000-0000-0000-0000-000000000001', 'e1eeeeee-1111-1111-1111-111111111111', 'E9 SuperAdmin (fixture)', 'e9superadmin@test.local', 'seller', true),
  ('e9000000-0000-0000-0000-000000000002', 'e2eeeeee-2222-2222-2222-222222222222', 'E9 Legacy Admin', 'e9legacyadmin@test.local', 'admin', true);

insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('e1eeeeee-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'manager', true),
  ('e1eeeeee-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'seller',  true),
  ('e2eeeeee-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'manager', true),
  ('e2eeeeee-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000002', 'seller',  true),
  ('e3eeeeee-3333-3333-3333-333333333333', 'e3000000-0000-0000-0000-000000000001', 'manager', true),
  ('e3eeeeee-3333-3333-3333-333333333333', 'e3000000-0000-0000-0000-000000000002', 'seller',  true),
  ('e2eeeeee-2222-2222-2222-222222222222', 'e9000000-0000-0000-0000-000000000002', 'manager', true);

-- e9superadmin: platform_role='super_admin' só para este teste (como
-- postgres, fora de qualquer caminho de authenticated/anon — não é
-- autopromoção, é a fixture necessária, mesmo padrão de 16_m1f_s2_helpers).
-- Revertido pelo rollback do arquivo.
update public.profiles set platform_role = 'super_admin' where id = 'e9000000-0000-0000-0000-000000000001';

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════

select has_column('public'::name, 'companies'::name, 'status'::name, 'companies.status existe');
select col_type_is('public'::name, 'companies'::name, 'status'::name, 'public.company_status', 'companies.status e do tipo company_status');
select col_not_null('public'::name, 'companies'::name, 'status'::name, 'companies.status e NOT NULL');
select has_enum('public'::name, 'company_status'::name, 'enum company_status existe');
select enum_has_labels('public'::name, 'company_status'::name,
  array['implantacao','ativa','suspensa','cancelada'], 'company_status tem exatamente os 4 valores esperados');
select col_default_is('public'::name, 'companies'::name, 'status'::name, 'implantacao', 'default de companies.status e implantacao (para empresas novas)');

select has_column('public'::name, 'companies'::name, 'trade_name'::name, 'companies.trade_name existe');
select col_type_is('public'::name, 'companies'::name, 'trade_name'::name, 'text', 'companies.trade_name e text');
select is(
  (select is_nullable::text from information_schema.columns where table_schema='public' and table_name='companies' and column_name='trade_name'),
  'YES', 'companies.trade_name e nullable');

select has_column('public'::name, 'companies'::name, 'created_by_profile_id'::name, 'companies.created_by_profile_id existe');
select col_type_is('public'::name, 'companies'::name, 'created_by_profile_id'::name, 'uuid', 'companies.created_by_profile_id e uuid');
select fk_ok('public'::name, 'companies'::name, array['created_by_profile_id']::name[], 'public'::name, 'profiles'::name, array['id']::name[],
  'FK companies.created_by_profile_id -> profiles.id existe');

-- backfill REAL da migration: a empresa seedada por supabase/seed.sql
-- (criada ANTES desta migration rodar, no reset real) recebe 'ativa' —
-- diferente de qualquer company criada DENTRO deste arquivo de teste
-- (que nasce com o DEFAULT 'implantacao' da coluna, por ser uma linha
-- nova nesta transação, não uma linha pré-existente na hora da migration)
select is(
  (select status::text from public.companies where id = '00000000-0000-0000-0000-000000000001'),
  'ativa', 'empresa seedada (pre-existente na hora da migration real) recebeu status ativa pelo backfill');

-- status invalido e negado (violacao de tipo enum, nao apenas de RLS/grant
-- — testado como postgres para isolar exatamente essa checagem)
select throws_ok(
  $$update public.companies set status = 'bogus'::public.company_status where id = 'e1eeeeee-1111-1111-1111-111111111111'$$,
  '22P02', null, 'status invalido (fora do enum) e negado pelo proprio tipo');

-- INSERT explicito com status NULL e negado (coluna NOT NULL)
select throws_ok(
  $$insert into public.companies (name, status) values ('Empresa Status Null', null)$$,
  '23502', null, 'INSERT explicito com status NULL e negado (NOT NULL)');

-- INSERT omitindo status recebe o default 'implantacao'
insert into public.companies (id, name) values
  ('e6eeeeee-6666-6666-6666-666666666666', 'Empresa E6 Default Implantacao');
select is(
  (select status::text from public.companies where id = 'e6eeeeee-6666-6666-6666-666666666666'),
  'implantacao', 'INSERT omitindo status recebe o default implantacao');

-- nenhuma coluna anterior foi removida
select has_column('public'::name, 'companies'::name, 'id'::name, 'companies.id preservada');
select has_column('public'::name, 'companies'::name, 'name'::name, 'companies.name preservada');
select has_column('public'::name, 'companies'::name, 'cnpj'::name, 'companies.cnpj preservada');
select has_column('public'::name, 'companies'::name, 'phone'::name, 'companies.phone preservada');
select has_column('public'::name, 'companies'::name, 'timezone'::name, 'companies.timezone preservada');
select has_column('public'::name, 'companies'::name, 'created_at'::name, 'companies.created_at preservada');
select has_column('public'::name, 'companies'::name, 'updated_at'::name, 'companies.updated_at preservada');

-- exclusao de profile referenciado como created_by_profile_id nao apaga a
-- empresa (ON DELETE SET NULL) — nenhum dado historico e destruido
-- usa-se um profile descartável (não referenciado em nenhum outro bloco
-- deste arquivo) para não interferir nos testes de Super Admin acima/abaixo
insert into public.companies (id, name) values
  ('e5eeeeee-5555-5555-5555-555555555555', 'Empresa E5 Autoria Teste');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e5000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'e5disposable@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('e5000000-0000-0000-0000-000000000001', null, 'E5 Disposable', 'e5disposable@test.local', 'seller', true);
update public.companies set created_by_profile_id = 'e5000000-0000-0000-0000-000000000001' where id = 'e5eeeeee-5555-5555-5555-555555555555';
delete from public.profiles where id = 'e5000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.companies where id = 'e5eeeeee-5555-5555-5555-555555555555'),
  1, 'excluir o profile criador nao apaga a empresa');
select is(
  (select created_by_profile_id from public.companies where id = 'e5eeeeee-5555-5555-5555-555555555555'),
  null::uuid, 'created_by_profile_id vira NULL apos o profile ser excluido (ON DELETE SET NULL)');

-- ATUALIZAÇÃO (M1-F S3-A): esta asserção originalmente provava "zero
-- grants" como limite do S1.1. O S3-A (etapa posterior, aprovada
-- separadamente) concede SELECT a authenticated de propósito, como parte
-- da RLS de leitura de companies via can_access_company() — nenhuma
-- escrita direta (INSERT/UPDATE/DELETE) é concedida em nenhuma etapa;
-- criação continua exclusiva de create_company(). A intenção original do
-- teste (nenhuma escrita direta ampliada) permanece 100% coberta, agora
-- separada do SELECT que passou a existir legitimamente.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='companies' and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'anon/authenticated continuam sem INSERT/UPDATE/DELETE direto em companies (SELECT concedido pelo S3-A via RLS)');

-- ═══════════════════════════════════════════════════════════════════════
-- ACESSO
-- ═══════════════════════════════════════════════════════════════════════

-- Manager/Seller em empresa ATIVA: permitido
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e1eeeeee-1111-1111-1111-111111111111'), true, 'Manager de empresa ATIVA e permitido');
select is(public.is_manager_or_platform('e1eeeeee-1111-1111-1111-111111111111'), true, 'Manager de empresa ATIVA: is_manager_or_platform true');
reset role;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e1eeeeee-1111-1111-1111-111111111111'), true, 'Seller de empresa ATIVA e permitido');
select is(public.is_manager_or_platform('e1eeeeee-1111-1111-1111-111111111111'), false, 'Seller de empresa ATIVA: is_manager_or_platform false (can_access_company nao promove Seller a Manager)');
reset role;

-- Manager/Seller em empresa SUSPENSA: negado
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e2eeeeee-2222-2222-2222-222222222222'), false, 'Manager de empresa SUSPENSA e negado');
select is(public.is_manager_or_platform('e2eeeeee-2222-2222-2222-222222222222'), false, 'Manager de empresa SUSPENSA: is_manager_or_platform false');
reset role;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e2eeeeee-2222-2222-2222-222222222222'), false, 'Seller de empresa SUSPENSA e negado (membership ativa nao contorna o status)');
select is(public.is_manager_or_platform('e2eeeeee-2222-2222-2222-222222222222'), false, 'Seller de empresa SUSPENSA: is_manager_or_platform false');
reset role;

-- Manager/Seller em empresa CANCELADA: negado
select set_config('request.jwt.claims', '{"sub":"e3000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e3eeeeee-3333-3333-3333-333333333333'), false, 'Manager de empresa CANCELADA e negado');
select is(public.is_manager_or_platform('e3eeeeee-3333-3333-3333-333333333333'), false, 'Manager de empresa CANCELADA: is_manager_or_platform false');
reset role;
select set_config('request.jwt.claims', '{"sub":"e3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e3eeeeee-3333-3333-3333-333333333333'), false, 'Seller de empresa CANCELADA e negado');
select is(public.is_manager_or_platform('e3eeeeee-3333-3333-3333-333333333333'), false, 'Seller de empresa CANCELADA: is_manager_or_platform false');
reset role;

-- Manager/Seller em empresa em IMPLANTACAO: permitido ("uso normal
-- liberado", §8)
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e4eeeeee-4444-4444-4444-444444444444'), false, 'Manager de OUTRA empresa (E4) continua negado por falta de membership, independente do status dela');
reset role;

-- Super Admin: ativa/suspensa/implantacao permitido; cancelada negado
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e1eeeeee-1111-1111-1111-111111111111'), true, 'Super Admin em empresa ATIVA: permitido');
select is(public.can_access_company('e2eeeeee-2222-2222-2222-222222222222'), true, 'Super Admin em empresa SUSPENSA: permitido (suporte/auditoria/historico, §7.4/§8)');
select is(public.can_access_company('e3eeeeee-3333-3333-3333-333333333333'), false, 'Super Admin em empresa CANCELADA: negado (§7.4/§8 — unico status que nega mesmo para Super Admin)');
select is(public.can_access_company('e4eeeeee-4444-4444-4444-444444444444'), true, 'Super Admin em empresa em IMPLANTACAO: permitido');
select is(public.is_manager_or_platform('e2eeeeee-2222-2222-2222-222222222222'), true, 'Super Admin: is_manager_or_platform tambem permanece true em empresa SUSPENSA (herda can_access_company)');
select is(public.is_manager_or_platform('e3eeeeee-3333-3333-3333-333333333333'), false, 'Super Admin: is_manager_or_platform nega empresa CANCELADA (herda can_access_company)');
reset role;

-- target null / empresa inexistente continuam negados
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company(null), false, 'target null continua negado (mesmo para Super Admin)');
select is(public.can_access_company('99999999-9999-9999-9999-999999999999'), false, 'empresa inexistente continua negada (mesmo para Super Admin)');
reset role;

-- profiles.company_id/role legado NAO contorna o status: e9legacyadmin
-- tem profiles.role='admin' e profiles.company_id apontando para E2
-- (suspensa), mas can_access_company nunca le profiles.company_id/role —
-- so company_memberships + companies.status
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e2eeeeee-2222-2222-2222-222222222222'), false,
  'ADMIN legado com profiles.company_id/role apontando para empresa suspensa continua negado (profiles.company_id/role legado nao contorna status)');
reset role;

-- isolamento: ADMIN legado (platform_role NULL) NAO e tratado como Super
-- Admin em empresa ONDE NAO TEM NENHUMA MEMBERSHIP (E1, ativa — sem o
-- status suspensa/cancelada "ajudando" a negar por outro motivo, isso
-- prova que profiles.role='admin' sozinho nunca entra na ramificacao
-- Super Admin de can_access_company/is_manager_or_platform)
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('e1eeeeee-1111-1111-1111-111111111111'), false,
  'ADMIN legado sem membership em empresa ATIVA e negado (nao e tratado como Super Admin, mesmo com empresa acessivel)');
select is(public.is_manager_or_platform('e1eeeeee-1111-1111-1111-111111111111'), false,
  'ADMIN legado sem membership MANAGER em empresa ATIVA: is_manager_or_platform false (nao e Super Admin nem tem membership la)');
reset role;

-- nenhuma empresa ativa/selecionada e persistida (reforco pontual —
-- cobertura completa em 17_m1f_s2_security.sql)
select hasnt_table('public'::name, 'super_admin_active_company'::name, 'super_admin_active_company continua nao existindo apos o S1.1');

-- ── require_company_access() herda o novo gate empiricamente (nao apenas
--    por raciocinio de composicao — verificado de verdade aqui) ─────────
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.require_company_access('e2eeeeee-2222-2222-2222-222222222222')$$,
  '42501', null, 'require_company_access: Manager de empresa SUSPENSA e negado (herda can_access_company)');
reset role;
select set_config('request.jwt.claims', '{"sub":"e3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.require_company_access('e3eeeeee-3333-3333-3333-333333333333')$$,
  '42501', null, 'require_company_access: Seller de empresa CANCELADA e negado (herda can_access_company)');
reset role;
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.require_company_access('e2eeeeee-2222-2222-2222-222222222222'), 'e2eeeeee-2222-2222-2222-222222222222'::uuid,
  'require_company_access: Super Admin em empresa SUSPENSA e permitido (herda can_access_company)');
select throws_ok(
  $$select public.require_company_access('e3eeeeee-3333-3333-3333-333333333333')$$,
  '42501', null, 'require_company_access: Super Admin em empresa CANCELADA tambem e negado (herda can_access_company)');
reset role;

-- ── current_profile_seller_id_for_company() herda o novo gate: seller de
--    empresa suspensa/cancelada nao chega nem a resolver o seller_id —
--    falha em require_company_access antes ─────────────────────────────
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.current_profile_seller_id_for_company('e2eeeeee-2222-2222-2222-222222222222')$$,
  '42501', null, 'current_profile_seller_id_for_company: Seller de empresa SUSPENSA e negado (herda o gate via require_company_access)');
reset role;
select set_config('request.jwt.claims', '{"sub":"e3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.current_profile_seller_id_for_company('e3eeeeee-3333-3333-3333-333333333333')$$,
  '42501', null, 'current_profile_seller_id_for_company: Seller de empresa CANCELADA e negado (herda o gate via require_company_access)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SEGURANÇA
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from unnest(array['can_access_company(uuid)', 'is_manager_or_platform(uuid)']) as fn
    where has_function_privilege('anon', ('public.' || fn)::regprocedure, 'EXECUTE')),
  0, 'anon continua sem EXECUTE em can_access_company/is_manager_or_platform apos o CREATE OR REPLACE');
select is(
  (select count(*)::int from unnest(array['can_access_company(uuid)', 'is_manager_or_platform(uuid)']) as fn
    where has_function_privilege('public', ('public.' || fn)::regprocedure, 'EXECUTE')),
  0, 'PUBLIC continua sem EXECUTE em can_access_company/is_manager_or_platform apos o CREATE OR REPLACE');
select is(
  (select count(*)::int from unnest(array['can_access_company(uuid)', 'is_manager_or_platform(uuid)']) as fn
    where has_function_privilege('authenticated', ('public.' || fn)::regprocedure, 'EXECUTE')),
  2, 'authenticated mantem EXECUTE em can_access_company/is_manager_or_platform (grants preservados pelo CREATE OR REPLACE)');

-- anon tambem nao altera status diretamente (sem grant de UPDATE)
set local role anon;
select throws_ok(
  $$update public.companies set status = 'suspensa' where id = 'e1eeeeee-1111-1111-1111-111111111111'$$,
  '42501', null, 'anon nao consegue UPDATE direto em companies.status (sem grant)');
reset role;

-- Manager/Seller nao alteram status diretamente (sem grant de UPDATE —
-- falha antes mesmo de qualquer policy ser avaliada)
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.companies set status = 'suspensa' where id = 'e1eeeeee-1111-1111-1111-111111111111'$$,
  '42501', null, 'Manager nao consegue UPDATE direto em companies.status (sem grant)');
reset role;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.companies set status = 'suspensa' where id = 'e1eeeeee-1111-1111-1111-111111111111'$$,
  '42501', null, 'Seller nao consegue UPDATE direto em companies.status (sem grant)');
reset role;

-- ADMIN legado (mesmo com a policy antiga companies_update_admin) tambem
-- nao consegue — confirma que a policy pre-existente continua inalcancavel
-- por falta de GRANT de tabela, exatamente como antes desta migration
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.companies set status = 'suspensa' where id = 'e2eeeeee-2222-2222-2222-222222222222'$$,
  '42501', null, 'ADMIN legado (mesmo dono da propria empresa via policy antiga) tambem nao consegue UPDATE direto em companies.status');
reset role;

-- nenhuma das tentativas negadas acima (anon/Manager/Seller/ADMIN legado)
-- alterou o status real — throws_ok roda em SAVEPOINT, mas confirmado
-- aqui explicitamente por completude
select is(
  (select status::text from public.companies where id = 'e1eeeeee-1111-1111-1111-111111111111'),
  'ativa', 'status de e1 permanece inalterado apos todas as tentativas de UPDATE direto negadas');
select is(
  (select status::text from public.companies where id = 'e2eeeeee-2222-2222-2222-222222222222'),
  'suspensa', 'status de e2 permanece inalterado apos a tentativa de UPDATE direto do ADMIN legado');

-- ADMIN legado nao vira Super Admin
select is(
  (select platform_role from public.profiles where id = 'e9000000-0000-0000-0000-000000000002'),
  null::public.platform_role, 'ADMIN legado (e9legacyadmin) nao e Super Admin');

-- ATUALIZAÇÃO (M1-F S3-A): esta asserção originalmente provava que NENHUMA
-- das cinco RPCs (incluindo create_company) existia como limite do S1.1.
-- O S3-A (etapa posterior, aprovada separadamente) cria create_company()
-- de propósito — as RPCs de TRANSIÇÃO de status (suspend/reactivate/
-- cancel/set_company_status) continuam fora de escopo, inclusive do
-- S3-A, e sua ausência permanece verificada abaixo.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'suspend_company', 'reactivate_company', 'cancel_company', 'set_company_status'
    )),
  0, 'nenhuma RPC de transicao de status foi criada (create_company e tratado separadamente pelo S3-A)');

-- nenhum Super Admin real criado por este arquivo (fixture revertida pelo
-- rollback, contada aqui apenas para provar que nao sobra alem da fixture
-- esperada)
select is(
  (select count(*)::int from public.profiles where platform_role = 'super_admin'),
  1, 'exatamente 1 Super Admin (a fixture deste arquivo, revertida pelo rollback) — nenhum outro criado');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE
-- ═══════════════════════════════════════════════════════════════════════

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')), 9, 'as 9 RPCs do M1-E continuam existindo, sem duplicata');

select has_function('public'::name, 'current_profile_company_id'::name, array[]::name[]);
select has_function('public'::name, 'current_profile_role'::name, array[]::name[]);
select has_function('public'::name, 'current_profile_seller_id'::name, array[]::name[]);
select has_function('public'::name, 'is_manager_or_admin'::name, array[]::name[]);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'policy de leads inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'policy de lead_timeline_entries inalterada (1 policy)');

-- runtime legado continua operando leads normalmente mesmo com o novo
-- status presente no schema
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S11 Compat Teste', '(11) 90000-7777', 'HB20')).id$$,
  'SELLER legado (usuario seedado) ainda cria lead normalmente apos o S1.1');
reset role;

select * from finish();
rollback;
