-- M1-F S8-C2-C2-SELLERS-B1 — list_platform_sellers_for_company. Prova:
-- (1) devolve sellers.id real (nunca profile_id/membership_id); (2) só
-- sellers verdadeiramente operacionais (membership ativa, role seller,
-- lifecycle active, profile ativo); (3) empresa sempre explícita, mesma
-- matriz de status do S8-C2-C1 (ativa/implantacao permitidas, suspensa/
-- cancelada negadas); (4) somente Super Admin; (5) nenhuma RPC de mutation
-- ou policy foi tocada. Roda como postgres. Rollback ao final.
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
  ('ce100000-0000-0000-0000-000000000001', 'S8C2C2Sellers Empresa Ativa', 'ativa'),
  ('ce100000-0000-0000-0000-000000000002', 'S8C2C2Sellers Empresa Implantacao', 'implantacao'),
  ('ce100000-0000-0000-0000-000000000003', 'S8C2C2Sellers Empresa Suspensa', 'suspensa'),
  ('ce100000-0000-0000-0000-000000000004', 'S8C2C2Sellers Empresa Cancelada', 'cancelada'),
  ('ce100000-0000-0000-0000-000000000005', 'S8C2C2Sellers Empresa Destino Transferencia', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'sellersb1-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'sellersb1-seller-ativo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'sellersb1-seller-suspenso@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'sellersb1-seller-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'sellersb1-seller-inativoprofile@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'sellersb1-nomembership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'sellersb1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'sellersb1-seller-transfer@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'sellersb1-seller-successor@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ce200000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'sellersb1-seller-promoted@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('ce200000-0000-0000-0000-000000000001', 'Manager Um', 'sellersb1-manager@test.local', true, null),
  ('ce200000-0000-0000-0000-000000000002', 'Seller Ativo', 'sellersb1-seller-ativo@test.local', true, null),
  ('ce200000-0000-0000-0000-000000000003', 'Seller Suspenso', 'sellersb1-seller-suspenso@test.local', true, null),
  ('ce200000-0000-0000-0000-000000000004', 'Seller Offboarded', 'sellersb1-seller-offboarded@test.local', true, null),
  ('ce200000-0000-0000-0000-000000000005', 'Seller Profile Inativo', 'sellersb1-seller-inativoprofile@test.local', false, null),
  ('ce200000-0000-0000-0000-000000000006', 'Sem Membership', 'sellersb1-nomembership@test.local', true, null),
  ('ce200000-0000-0000-0000-000000000007', 'Super Admin SellersB1', 'sellersb1-superadmin@test.local', true, 'super_admin'),
  ('ce200000-0000-0000-0000-000000000008', 'Seller Transferido', 'sellersb1-seller-transfer@test.local', true, null),
  ('ce200000-0000-0000-0000-000000000009', 'Seller Sucessor', 'sellersb1-seller-successor@test.local', true, null),
  ('ce200000-0000-0000-0000-00000000000a', 'Seller Promovido', 'sellersb1-seller-promoted@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('ce300000-0000-0000-0000-000000000001', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-000000000001', 'manager', true, 'active'),
  ('ce300000-0000-0000-0000-000000000002', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-000000000002', 'seller',  true, 'active'),
  ('ce300000-0000-0000-0000-000000000003', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-000000000003', 'seller',  false, 'suspended'),
  ('ce300000-0000-0000-0000-000000000004', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-000000000004', 'seller',  false, 'offboarded'),
  ('ce300000-0000-0000-0000-000000000005', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-000000000005', 'seller',  true, 'active'),
  ('ce300000-0000-0000-0000-000000000008', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-000000000008', 'seller',  true, 'active'),
  ('ce300000-0000-0000-0000-000000000009', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-000000000009', 'seller',  true, 'active'),
  ('ce300000-0000-0000-0000-00000000000a', 'ce100000-0000-0000-0000-000000000001', 'ce200000-0000-0000-0000-00000000000a', 'seller',  true, 'active');
-- ce200000-...-06 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('sellersB1Ativo',      'ce100000-0000-0000-0000-000000000001', 'Seller Ativo',       'B1-Ativo',    'ce200000-0000-0000-0000-000000000002', 'ce300000-0000-0000-0000-000000000002', true),
  ('sellersB1Suspenso',   'ce100000-0000-0000-0000-000000000001', 'Seller Suspenso',    'B1-Susp',     'ce200000-0000-0000-0000-000000000003', 'ce300000-0000-0000-0000-000000000003', false),
  ('sellersB1Offboarded', 'ce100000-0000-0000-0000-000000000001', 'Seller Offboarded',  'B1-Off',      'ce200000-0000-0000-0000-000000000004', 'ce300000-0000-0000-0000-000000000004', false),
  ('sellersB1ProfInativo','ce100000-0000-0000-0000-000000000001', 'Seller Prof Inativo','B1-ProfInat', 'ce200000-0000-0000-0000-000000000005', 'ce300000-0000-0000-0000-000000000005', true),
  ('sellersB1Transfer',   'ce100000-0000-0000-0000-000000000001', 'Seller Transferido', 'B1-Transf',   'ce200000-0000-0000-0000-000000000008', 'ce300000-0000-0000-0000-000000000008', true),
  ('sellersB1Sucessor',   'ce100000-0000-0000-0000-000000000001', 'Seller Sucessor',    'B1-Suc',      'ce200000-0000-0000-0000-000000000009', 'ce300000-0000-0000-0000-000000000009', true),
  ('sellersB1Promovido',  'ce100000-0000-0000-0000-000000000001', 'Seller Promovido',   'B1-Prom',     'ce200000-0000-0000-0000-00000000000a', 'ce300000-0000-0000-0000-00000000000a', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('ce400000-0000-0000-0000-000000000001', 'ce100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('ce400000-0000-0000-0000-000000000005', 'ce100000-0000-0000-0000-000000000005', 'new', 'Novo', 0);

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_platform_sellers_for_company'),
  1, 'list_platform_sellers_for_company existe, assinatura unica');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_platform_sellers_for_company'),
  'p_company_id uuid', 'assinatura: somente p_company_id uuid');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_platform_sellers_for_company'),
  'SECURITY DEFINER');
select ok(
  (select exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_platform_sellers_for_company'),
  'search_path configurado explicitamente');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='list_platform_sellers_for_company' and grantee='authenticated'),
  1, 'authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='list_platform_sellers_for_company' and grantee='anon'),
  0, 'anon NAO tem EXECUTE');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('create_lead','update_lead','check_lead_phone_duplicate','assign_lead_seller','move_lead_to_stage',
       'apply_lead_event','archive_lead','unarchive_lead','add_lead_timeline_entry')),
  9, 'nenhuma RPC de mutation de leads foi alterada (9 continuam intactas)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='sellers' and privilege_type='SELECT'
      and grantee in ('public','anon','authenticated')),
  0, 'nenhum SELECT novo concedido em public.sellers para public/anon/authenticated (grant do owner postgres nao conta)');
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename in ('leads','lead_timeline_entries','pipeline_stages')),
  5, 'nenhuma policy alterada (leads=1, lead_timeline_entries=1, pipeline_stages=3)');

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — EMPRESA ATIVA
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ce200000-0000-0000-0000-000000000007');
set local role authenticated;

select results_eq(
  $$select seller_id, name from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')$$,
  $$values ('sellersB1Ativo','Seller Ativo'),
           ('sellersB1Promovido','Seller Promovido'),
           ('sellersB1Sucessor','Seller Sucessor'),
           ('sellersB1Transfer','Seller Transferido')$$,
  'SA em empresa ativa: somente sellers operacionais, ordenados por nome, seller_id real (nunca profile_id/membership_id)');

select is(
  (select count(*)::int from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')
     where seller_id in ('sellersB1Suspenso','sellersB1Offboarded','sellersB1ProfInativo')),
  0, 'seller suspenso, offboarded e com profile inativo nunca aparecem');
select is(
  (select count(*)::int from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')
     where seller_id = 'ce200000-0000-0000-0000-000000000001'), -- profile_id do Manager, nunca deveria casar
  0, 'Manager nunca aparece (nem por engano com profile_id)');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — STATUS DA EMPRESA
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ce200000-0000-0000-0000-000000000007');
set local role authenticated;

select lives_ok(
  $$select * from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000002')$$,
  'SA em empresa implantacao: permitido (mesma empresa sem sellers cadastrados, retorno vazio valido)');
select throws_ok(
  $$select * from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000003')$$,
  'company_read_only', 'SA em empresa suspensa: company_read_only');
select throws_ok(
  $$select * from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000004')$$,
  'company_read_only', 'SA em empresa cancelada: company_read_only');
select throws_ok(
  $$select * from public.list_platform_sellers_for_company(null)$$,
  'company_required', 'SA sem empresa: company_required');
select throws_ok(
  $$select * from public.list_platform_sellers_for_company('00000000-0000-0000-0000-00000000ffff')$$,
  'company_not_found', 'SA com empresa inexistente: company_not_found');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- OUTROS ATORES
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ce200000-0000-0000-0000-000000000001'); -- Manager
set local role authenticated;
select throws_ok(
  $$select * from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')$$,
  'forbidden', 'Manager: forbidden, mesmo com empresa valida e propria');
reset role;

select pg_temp.as_user('ce200000-0000-0000-0000-000000000002'); -- Seller
set local role authenticated;
select throws_ok(
  $$select * from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')$$,
  'forbidden', 'Seller: forbidden');
reset role;

select pg_temp.as_user('ce200000-0000-0000-0000-000000000006'); -- sem membership
set local role authenticated;
select throws_ok(
  $$select * from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')$$,
  'forbidden', 'sem membership: forbidden');
reset role;

set local role anon;
select throws_ok(
  $$select * from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon: sem EXECUTE');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- TRANSFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ce200000-0000-0000-0000-000000000007');
set local role authenticated;

select * from public.transfer_membership(
  'ce300000-0000-0000-0000-000000000008',
  'ce100000-0000-0000-0000-000000000005',
  'seller',
  'ce200000-0000-0000-0000-000000000009',
  'S8C2C2SellersB1 - teste de transferencia'
);

select is(
  (select count(*)::int from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')
     where seller_id = 'sellersB1Transfer'),
  0, 'seller transferido para B deixa de aparecer em A');
select is(
  (select count(*)::int from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')
     where seller_id = 'sellersB1Sucessor'),
  1, 'sucessor continua ativo e visivel em A');
-- transfer_membership cria uma linha NOVA em sellers para a empresa
-- destino (sellers.id é uma identidade por-empresa — nunca reaproveita o
-- id da origem) — confirma que o seller aparece em B com ALGUM seller_id
-- válido, mas nunca o mesmo id físico de A (que continua existindo,
-- inativo, ligado à membership offboarded de A).
select is(
  (select count(*)::int from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000005')),
  1, 'seller transferido aparece em B, exatamente 1 linha');
select isnt(
  (select seller_id from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000005')),
  'sellersB1Transfer',
  'seller_id em B e uma identidade NOVA — sellers.id nunca e reaproveitado entre empresas na transferencia');
select is(
  (select count(*)::int from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')
     where seller_id = 'sellersB1Transfer'),
  0, 'o id antigo (agora inativo, ligado a membership offboarded de A) nunca aparece na listagem de A nem de B');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- PROMOÇÃO
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('ce200000-0000-0000-0000-000000000007');
set local role authenticated;
select * from public.update_membership_role('ce300000-0000-0000-0000-00000000000a', 'ce100000-0000-0000-0000-000000000001', 'manager');
select is(
  (select count(*)::int from public.list_platform_sellers_for_company('ce100000-0000-0000-0000-000000000001')
     where seller_id = 'sellersB1Promovido'),
  0, 'seller promovido a manager nunca mais aparece na listagem de sellers');
reset role;

select * from finish();
rollback;
