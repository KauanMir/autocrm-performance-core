-- M1-F S1 — testes de compatibilidade (pgTAP): helpers, policies e as 9
-- RPCs do M1-E continuam funcionando exatamente como antes, mesmo com
-- company_memberships/platform_role/sellers.membership_id presentes no
-- schema. Roda contra o estado seedado por supabase/seed.sql (os 4
-- usuários legados de sempre) — que, no momento em que este arquivo roda,
-- NÃO têm nenhuma company_memberships (o backfill de m1f_s1_02 executa
-- ANTES do seed.sql, ver nota lá): isso é exatamente o que prova que o
-- runtime atual não depende da tabela nova. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── usuários seedados não têm nenhuma membership ────────────────────────
select is(
  (select count(*)::int from public.company_memberships
    where profile_id in (
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444')),
  0, 'usuarios seedados (ADMIN/MANAGER/2 SELLER) nao tem membership — backfill roda antes do seed.sql');

-- ── helpers de RLS continuam retornando exatamente o que retornavam ─────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select public.current_profile_company_id()),
  '00000000-0000-0000-0000-000000000001'::uuid, 'current_profile_company_id() do ADMIN legado inalterado');
select is((select public.current_profile_role()::text), 'admin', 'current_profile_role() do ADMIN legado inalterado');
select is((select public.is_manager_or_admin()), true, 'is_manager_or_admin() do ADMIN legado inalterado (ainda true)');
reset role;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select is((select public.current_profile_seller_id()), 's4', 'current_profile_seller_id() do SELLER legado inalterado');
select is((select public.is_manager_or_admin()), false, 'is_manager_or_admin() do SELLER legado inalterado (ainda false)');
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select is((select public.is_manager_or_admin()), true, 'is_manager_or_admin() do MANAGER legado inalterado (ainda true)');
reset role;

-- ── policies de leads/timeline continuam com a mesma matriz de M1-E ─────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select count(*) from public.leads$$, 'seller legado ainda le leads normalmente');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.leads where company_id <> '00000000-0000-0000-0000-000000000001'), 0,
  'admin legado continua sem ver nenhuma linha de outra empresa');
reset role;

-- ── as 9 RPCs do M1-E continuam existindo, sem duplicata, mesma contagem ─
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')), 9, 'as 9 RPCs do M1-E ainda existem, sem duplicata');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')
    and p.prosecdef), 9, 'as 9 RPCs continuam SECURITY DEFINER');

-- ── comportamento vivo: seller legado ainda cria lead normalmente via
--    create_lead, sem que a RPC toque em company_memberships ────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('Compat Teste', '(11) 90000-9999', 'Carro Compat')).id$$,
  'seller legado ainda cria lead normalmente via create_lead (RPC nao alterada pelo S1)'
);
reset role;

-- ── nenhum acesso global aparece por platform_role sem o S2 ──────────────
-- Setar platform_role manualmente (como postgres, fora de qualquer fluxo
-- de produto) não muda absolutamente nada no que o manager legado vê —
-- prova viva de que "platform_role ainda não produz acesso global" e
-- "nenhuma policy passa a confiar nesse campo ainda" (requisitos desta
-- etapa). Este arquivo é uma transação isolada (não herda fixtures de
-- outros arquivos de teste): o único lead existente neste ponto é o criado
-- pelo teste anterior (create_lead do seller legado), então a contagem
-- esperada para o manager é 1, não os 4 de 01_m1e_grants_rls.sql (fixture
-- de outro arquivo, outra transação).
update public.profiles set platform_role = 'super_admin' where id = '22222222-2222-2222-2222-222222222222';
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.leads), 1, 'setar platform_role manualmente nao muda o que o manager ve (S2 ainda nao existe)');
select is((select count(*)::int from public.leads where company_id <> '00000000-0000-0000-0000-000000000001'), 0,
  'platform_role sozinho NAO da acesso a outra empresa (nenhuma policy/RPC confia nele ainda)');
reset role;

-- ── grants de sellers/profiles/companies para anon/authenticated não
--    foram alterados pelo S1 (fora de escopo — confirmação, não mudança) ─
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='sellers'
      and grantee in ('anon','authenticated') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'sellers continua sem grants DML para anon/authenticated (pre-existente, S1 nao alterou)');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='profiles'
      and grantee in ('anon','authenticated') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  0, 'profiles continua sem grants DML para anon/authenticated (pre-existente, S1 nao alterou)');

select * from finish();
rollback;
