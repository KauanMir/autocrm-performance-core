-- M1-F S2 — testes de segurança dos 7 helpers de autorização (pgTAP):
-- grants, search_path, ausência de parâmetro profile_id, resistência a
-- forjar target_company_id, ausência de qualquer estado persistido de
-- empresa. Roda como postgres (catálogo) e anon/authenticated (tentativas
-- reais). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures mínimas: duas empresas, um manager em cada ─────────────────
insert into public.companies (id, name) values
  ('33eeeeee-3333-3333-3333-333333333333', 'Empresa Security 1'),
  ('44eeeeee-4444-4444-4444-444444444444', 'Empresa Security 2');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '5ec00000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'secmanager1@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('5ec00000-0000-0000-0000-000000000001', '33eeeeee-3333-3333-3333-333333333333', 'Sec Manager 1', 'secmanager1@test.local', 'manager', true);
insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('33eeeeee-3333-3333-3333-333333333333', '5ec00000-0000-0000-0000-000000000001', 'manager', true);

-- ── PUBLIC não possui EXECUTE em nenhum dos 7 helpers ────────────────────
select is(
  (select count(*)::int from unnest(array[
    'is_platform_super_admin()',
    'current_membership_company_id()',
    'current_membership_role()',
    'can_access_company(uuid)',
    'require_company_access(uuid)',
    'is_manager_or_platform(uuid)',
    'current_profile_seller_id_for_company(uuid)'
  ]) as fn
    where has_function_privilege('public', ('public.' || fn)::regprocedure, 'EXECUTE')),
  0, 'PUBLIC nao possui EXECUTE em nenhum dos 7 helpers novos');

-- ── anon não possui EXECUTE em nenhum dos 7 (helpers administrativos) ───
select is(
  (select count(*)::int from unnest(array[
    'is_platform_super_admin()',
    'current_membership_company_id()',
    'current_membership_role()',
    'can_access_company(uuid)',
    'require_company_access(uuid)',
    'is_manager_or_platform(uuid)',
    'current_profile_seller_id_for_company(uuid)'
  ]) as fn
    where has_function_privilege('anon', ('public.' || fn)::regprocedure, 'EXECUTE')),
  0, 'anon nao possui EXECUTE em nenhum dos 7 helpers novos');

-- ── authenticated possui EXECUTE em todos os 7 (são exatamente os
--    destinados a operações autenticadas) ───────────────────────────────
select is(
  (select count(*)::int from unnest(array[
    'is_platform_super_admin()',
    'current_membership_company_id()',
    'current_membership_role()',
    'can_access_company(uuid)',
    'require_company_access(uuid)',
    'is_manager_or_platform(uuid)',
    'current_profile_seller_id_for_company(uuid)'
  ]) as fn
    where has_function_privilege('authenticated', ('public.' || fn)::regprocedure, 'EXECUTE')),
  7, 'authenticated possui EXECUTE em todos os 7 helpers novos');

-- ── anon: tentativa real de execução falha (nao so ausencia no catalogo) ─
set local role anon;
select throws_ok($$select public.is_platform_super_admin()$$, '42501', null, 'anon: chamar is_platform_super_admin() falha de verdade');
select throws_ok($$select public.can_access_company('33eeeeee-3333-3333-3333-333333333333')$$, '42501', null, 'anon: chamar can_access_company() falha de verdade');
reset role;

-- ── search_path seguro: todos os 7 com search_path = '' ──────────────────
select is(
  (select count(*)::int from unnest(array[
    'is_platform_super_admin','current_membership_company_id','current_membership_role',
    'can_access_company','require_company_access','is_manager_or_platform',
    'current_profile_seller_id_for_company'
  ]) as fn
    join pg_proc p on p.proname = fn and p.pronamespace = 'public'::regnamespace
    where p.proconfig @> array['search_path=']
       or p.proconfig @> array['search_path=""']),
  7, 'todos os 7 helpers tem search_path vazio configurado');

-- ── 6 dos 7 são SECURITY DEFINER (leem tabela diretamente); require_
--    company_access é SECURITY INVOKER de propósito — delega inteiramente
--    a can_access_company() e não lê nenhuma tabela por conta própria, e
--    rodar como INVOKER é minimização deliberada (defesa em profundidade),
--    nao uma omissao ──────────────────────────────────────────────────────
select is(
  (select count(*)::int from unnest(array[
    'is_platform_super_admin','current_membership_company_id','current_membership_role',
    'can_access_company','is_manager_or_platform',
    'current_profile_seller_id_for_company'
  ]) as fn
    join pg_proc p on p.proname = fn and p.pronamespace = 'public'::regnamespace
    where p.prosecdef),
  6, 'os 6 helpers que leem tabela diretamente sao SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
    where p.proname = 'require_company_access' and p.pronamespace = 'public'::regnamespace),
  false, 'require_company_access e SECURITY INVOKER deliberado (delega tudo a can_access_company, sem leitura de tabela propria)');

-- ── nenhum dos 7 aceita profile_id como parâmetro (todos derivam de
--    auth.uid() — nenhum caminho de "verificar acesso de outra pessoa") ──
select is(
  (select count(*)::int from unnest(array[
    'is_platform_super_admin','current_membership_company_id','current_membership_role',
    'can_access_company','require_company_access','is_manager_or_platform',
    'current_profile_seller_id_for_company'
  ]) as fn
    join pg_proc p on p.proname = fn and p.pronamespace = 'public'::regnamespace
    where pg_get_function_arguments(p.oid) ilike '%profile_id%'),
  0, 'nenhum dos 7 helpers aceita profile_id como parametro externo');

-- ── Manager/Seller não conseguem forjar target_company_id (reforço de
--    16_m1f_s2_helpers.sql, com foco explicito em "tentativa de forjar") ─
select set_config('request.jwt.claims', '{"sub":"5ec00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.can_access_company('44eeeeee-4444-4444-4444-444444444444'),
  false,
  'Manager tentando forjar target_company_id de OUTRA empresa e negado (nao amplia acesso)');
select throws_ok(
  $$select public.require_company_access('44eeeeee-4444-4444-4444-444444444444')$$,
  '42501', null,
  'Manager forjando target em require_company_access recebe insufficient_privilege, nao acesso');
reset role;

-- ── platform_role null não concede acesso (reforço) ─────────────────────
select set_config('request.jwt.claims', '{"sub":"5ec00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_platform_super_admin(), false, 'platform_role null (manager comum) nao concede is_platform_super_admin');
reset role;

-- ── nenhum estado persistido de empresa existe (design §7 — Revisão 2) ──
select hasnt_table('public'::name, 'super_admin_active_company'::name, 'super_admin_active_company NAO existe (Revisao 1 rejeitada, nao recriada)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('select_active_company', 'effective_company_id')),
  0, 'select_active_company()/effective_company_id() NAO existem — nenhum estado persistido de empresa foi criado');

select * from finish();
rollback;
