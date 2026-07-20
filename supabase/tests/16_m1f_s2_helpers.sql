-- M1-F S2 — testes de semântica dos 7 helpers de autorização (pgTAP).
-- Roda como postgres (fixtures) e authenticated (comportamento real via
-- SET ROLE + request.jwt.claims). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures: duas empresas, manager/seller de cada, um Super Admin
--    temporário (revertido pelo rollback do arquivo) ────────────────────
insert into public.companies (id, name) values
  ('11eeeeee-1111-1111-1111-111111111111', 'Empresa Helper 1'),
  ('22eeeeee-2222-2222-2222-222222222222', 'Empresa Helper 2');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'h1manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'h1seller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'h2manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a9000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'h9superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a9000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'h9normal@test.local', now(), now(), now());

insert into public.sellers (id, company_id, name, first_name) values
  ('hSeller1', '11eeeeee-1111-1111-1111-111111111111', 'Seller Helper 1', 'S1'),
  ('hSellerInactive', '11eeeeee-1111-1111-1111-111111111111', 'Seller Inativo', 'SI');

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('a1000000-0000-0000-0000-000000000001', '11eeeeee-1111-1111-1111-111111111111', 'H1 Manager', 'h1manager@test.local', 'manager', true),
  ('a1000000-0000-0000-0000-000000000002', '11eeeeee-1111-1111-1111-111111111111', 'H1 Seller',  'h1seller@test.local',  'seller',  true),
  ('a2000000-0000-0000-0000-000000000001', '22eeeeee-2222-2222-2222-222222222222', 'H2 Manager', 'h2manager@test.local', 'manager', true),
  ('a9000000-0000-0000-0000-000000000001', '11eeeeee-1111-1111-1111-111111111111', 'H9 SuperAdmin (fixture)', 'h9superadmin@test.local', 'seller', true),
  ('a9000000-0000-0000-0000-000000000002', '11eeeeee-1111-1111-1111-111111111111', 'H9 Normal',  'h9normal@test.local',  'seller',  true);

update public.sellers set profile_id = 'a1000000-0000-0000-0000-000000000002' where id = 'hSeller1';

insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('11eeeeee-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'manager', true),
  ('11eeeeee-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'seller',  true),
  ('22eeeeee-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'manager', true);
update public.sellers set membership_id = (
  select id from public.company_memberships where profile_id = 'a1000000-0000-0000-0000-000000000002'
) where id = 'hSeller1';

-- h9superadmin: profile marcado platform_role='super_admin' SÓ para este
-- teste (como postgres, fora de qualquer caminho de authenticated/anon —
-- não é uma autopromoção, é a fixture necessária para testar o ramo
-- Super Admin dos helpers). Revertido pelo rollback do arquivo.
update public.profiles set platform_role = 'super_admin' where id = 'a9000000-0000-0000-0000-000000000001';

-- ── is_platform_super_admin() ────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_platform_super_admin(), false, 'is_platform_super_admin: false para usuario normal');
reset role;

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_platform_super_admin(), true, 'is_platform_super_admin: true para profile explicitamente marcado (fixture do teste)');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_platform_super_admin(), false, 'is_platform_super_admin: ADMIN legado (role=admin) NAO e Super Admin');
reset role;

-- ── current_membership_company_id() / current_membership_role() ─────────
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_membership_company_id(), '11eeeeee-1111-1111-1111-111111111111'::uuid, 'current_membership_company_id: retorna a empresa correta do manager');
select is(public.current_membership_role(), 'manager'::public.company_role, 'current_membership_role: retorna manager corretamente');
reset role;

-- membership inativa -> current_membership_company_id/role retornam null
update public.company_memberships set is_active = false where profile_id = 'a1000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_membership_company_id(), null::uuid, 'current_membership_company_id: null quando a unica membership esta inativa');
select is(public.current_membership_role(), null::public.company_role, 'current_membership_role: null quando a unica membership esta inativa');
reset role;
update public.company_memberships set is_active = true where profile_id = 'a1000000-0000-0000-0000-000000000002';

-- Super Admin nao recebe empresa implicita (nunca tem membership)
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_membership_company_id(), null::uuid, 'current_membership_company_id: Super Admin nao recebe empresa implicita');
reset role;

-- ── can_access_company(target) ───────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('11eeeeee-1111-1111-1111-111111111111'), true, 'can_access_company: Manager acessa a propria empresa');
select is(public.can_access_company('22eeeeee-2222-2222-2222-222222222222'), false, 'can_access_company: Manager NAO acessa outra empresa');
select is(public.can_access_company(null), false, 'can_access_company: target null retorna false');
select is(public.can_access_company('99999999-9999-9999-9999-999999999999'), false, 'can_access_company: empresa inexistente retorna false');
reset role;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('11eeeeee-1111-1111-1111-111111111111'), true, 'can_access_company: Seller acessa a propria empresa');
select is(public.can_access_company('22eeeeee-2222-2222-2222-222222222222'), false, 'can_access_company: Seller NAO acessa outra empresa');
reset role;

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.can_access_company('11eeeeee-1111-1111-1111-111111111111'), true, 'can_access_company: Super Admin acessa empresa 1 (existe)');
select is(public.can_access_company('22eeeeee-2222-2222-2222-222222222222'), true, 'can_access_company: Super Admin acessa empresa 2 tambem (global)');
select is(public.can_access_company('99999999-9999-9999-9999-999999999999'), false, 'can_access_company: Super Admin tambem nega empresa inexistente');
reset role;

-- ── require_company_access(target) ───────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.require_company_access('11eeeeee-1111-1111-1111-111111111111'), '11eeeeee-1111-1111-1111-111111111111'::uuid, 'require_company_access: devolve a empresa quando autorizado');
select throws_ok($$select public.require_company_access('22eeeeee-2222-2222-2222-222222222222')$$, '42501', null, 'require_company_access: levanta insufficient_privilege (42501) quando negado');
select throws_ok($$select public.require_company_access(null)$$, '42501', null, 'require_company_access: nega target null com o mesmo erro generico');
reset role;

-- ── is_manager_or_platform(target) ───────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_manager_or_platform('11eeeeee-1111-1111-1111-111111111111'), true, 'is_manager_or_platform: true para Manager da propria empresa');
reset role;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_manager_or_platform('11eeeeee-1111-1111-1111-111111111111'), false, 'is_manager_or_platform: false para Seller');
reset role;

select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_manager_or_platform('11eeeeee-1111-1111-1111-111111111111'), false, 'is_manager_or_platform: false para Manager de OUTRA empresa');
reset role;

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_manager_or_platform('11eeeeee-1111-1111-1111-111111111111'), true, 'is_manager_or_platform: true para Super Admin com acesso a empresa alvo');
reset role;

-- ── current_profile_seller_id_for_company(target) ────────────────────────
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_profile_seller_id_for_company('11eeeeee-1111-1111-1111-111111111111'), 'hSeller1', 'current_profile_seller_id_for_company: retorna o seller correto');
reset role;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_profile_seller_id_for_company('11eeeeee-1111-1111-1111-111111111111'), null::text, 'current_profile_seller_id_for_company: Manager NAO recebe seller');
reset role;

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_profile_seller_id_for_company('11eeeeee-1111-1111-1111-111111111111'), null::text, 'current_profile_seller_id_for_company: Super Admin NAO recebe seller artificial');
reset role;

-- seller de outra empresa nao e retornado: h2manager nao tem seller, mas
-- confirmamos que um seller H1 nao "vaza" para uma consulta de empresa 2
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.current_profile_seller_id_for_company('22eeeeee-2222-2222-2222-222222222222')$$,
  '42501', null, 'current_profile_seller_id_for_company: seller de outra empresa nem valida acesso (require_company_access nega primeiro)');
reset role;

-- ambiguidade real: sellers.membership_id nao tem constraint UNIQUE no
-- schema atual (pre-existente desde m1f_s1_01) — nada estruturalmente
-- impede duas linhas de sellers apontarem para a MESMA membership. Prova
-- empirica de que a funcao falha fechado (NULL) nesse cenario, em vez de
-- escolher uma linha arbitrariamente ou lancar erro de "mais de uma linha".
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id) values (
  'hSeller1Dup', '11eeeeee-1111-1111-1111-111111111111', 'Seller Helper 1 Duplicado', 'S1D',
  'a1000000-0000-0000-0000-000000000002',
  (select id from public.company_memberships where profile_id = 'a1000000-0000-0000-0000-000000000002')
);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_profile_seller_id_for_company('11eeeeee-1111-1111-1111-111111111111'), null::text,
  'current_profile_seller_id_for_company: duas linhas de sellers para a mesma membership -> NULL (falha fechado, nao escolha arbitraria)');
reset role;
delete from public.sellers where id = 'hSeller1Dup';

select * from finish();
rollback;
