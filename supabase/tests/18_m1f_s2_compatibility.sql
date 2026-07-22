-- M1-F S2 — testes de compatibilidade final (pgTAP): helpers legados, as 9
-- RPCs do M1-E e as policies antigas continuam funcionando exatamente como
-- antes, mesmo com os 7 helpers novos e o catch-up do S2 presentes. Roda
-- contra os usuários seedados (agora COM company_memberships, via
-- seed.sql Parte 4). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── helpers LEGADOS continuam com assinatura e comportamento idênticos ──
select has_function('public'::name, 'current_profile_company_id'::name, array[]::name[]);
select has_function('public'::name, 'current_profile_role'::name, array[]::name[]);
select has_function('public'::name, 'current_profile_seller_id'::name, array[]::name[]);
select has_function('public'::name, 'is_manager_or_admin'::name, array[]::name[]);

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_profile_company_id(), '00000000-0000-0000-0000-000000000001'::uuid, 'helper legado: current_profile_company_id() do ADMIN legado inalterado (mesmo com membership existindo agora)');
select is(public.current_profile_role()::text, 'admin', 'helper legado: current_profile_role() do ADMIN legado inalterado');
select is(public.is_manager_or_admin(), true, 'helper legado: is_manager_or_admin() do ADMIN legado inalterado (ainda true)');
reset role;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_profile_seller_id(), 's4', 'helper legado: current_profile_seller_id() do SELLER legado inalterado');
select is(public.is_manager_or_admin(), false, 'helper legado: is_manager_or_admin() do SELLER legado inalterado (ainda false)');
reset role;

-- ── as 9 RPCs do M1-E continuam existindo, mesma contagem, mesma
--    assinatura observável ────────────────────────────────────────────
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')), 9, 'as 9 RPCs do M1-E ainda existem, sem duplicata');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate') and p.prosecdef), 9, 'as 9 RPCs continuam SECURITY DEFINER');

-- ── comportamento vivo: MANAGER e SELLER legados continuam operando leads
--    normalmente (RLS de leads/timeline nao foi tocada nesta etapa) ──────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S2 Compat Teste', '(11) 90000-8888', 'Carro S2')).id$$,
  'SELLER legado ainda cria lead normalmente via create_lead (RPC nao alterada pelo S2)');
select lives_ok($$select count(*) from public.leads$$, 'SELLER legado ainda le leads normalmente');
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select count(*) from public.leads$$, 'MANAGER legado ainda le leads normalmente');
select is((select count(*)::int from public.leads where company_id <> '00000000-0000-0000-0000-000000000001'), 0,
  'MANAGER legado continua sem ver nenhuma linha de outra empresa');
reset role;

-- ── policies antigas (leads/timeline/profiles/sellers/companies/stages)
--    permanecem com a MESMA contagem de antes do S2 (nenhuma foi
--    adicionada, removida ou trocada nesta etapa) ───────────────────────
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'policy de leads inalterada (1 policy, leads_select)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'policy de lead_timeline_entries inalterada (1 policy, lead_timeline_select)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  3, 'policies de profiles inalteradas (3: select_own, select_company, update_admin)');
-- ATUALIZAÇÃO (M1-F S4-F1, aprovada explicitamente): o S2 fechava
-- company_memberships por completo (0 policies). O S4-F1 introduziu o
-- primeiro consumidor real (leitura da própria membership pelo frontend)
-- e adicionou exatamente 1 policy — cobertura completa do contrato exato
-- (nome/comando/USING/grants) está em 10_m1f_s1_schema.sql e
-- 28_m1f_s4f1_01_own_membership_read.sql; aqui só confirmamos que isso não
-- regrediu por acidente (continua sendo exatamente 1, não mais).
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'company_memberships'),
  1, 'company_memberships tem exatamente 1 policy pós-S4-F1 (company_memberships_select_own — S2 fechava com 0)');

-- ── nenhum grant de ESCRITA nem de TABELA INTEIRA apareceu em
--    company_memberships. O S4-F1 concedeu SELECT por COLUNA (3 colunas,
--    ver teste 28) a authenticated, o que não aparece em
--    role_table_grants (só reflete grants de tabela inteira) — por isso a
--    contagem abaixo continua 0 mesmo após o S4-F1, de propósito ──────────
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='company_memberships' and grantee in ('anon','authenticated')),
  0, 'company_memberships continua sem GRANT de tabela inteira para anon/authenticated (S4-F1 concedeu só por coluna, ver teste 28)');

-- ── nenhuma promoção global apareceu por causa do S2 ─────────────────────
select is(
  (select count(*)::int from public.profiles where platform_role = 'super_admin'),
  0, 'nenhum profile seedado ou legado e SUPER_ADMIN apos o S2');

select * from finish();
rollback;
