-- M1-F S8-C2-B1 — backend seguro de leitura comercial
-- (20260728160000_m1f_s8c2b1_leads_timeline_membership_access.sql +
-- 20260728170000_m1f_s8c2b1_platform_commercial_read_rpcs.sql). Prova:
-- (1) leads_select/lead_timeline_select migraram para
-- current_membership_company_id()/current_membership_role(), exigem
-- empresa 'ativa' (nunca 'implantacao'/'suspensa'/'cancelada' para
-- Manager/Seller — mais restritivo que Pipeline, de propósito, §31.5);
-- (2) nenhuma policy global de Super Admin foi criada; (3) as quatro
-- RPCs estreitas (list_commercial_companies, list_platform_leads_for_
-- company, list_platform_lead_timeline, list_pipeline_stages_for_
-- company) autorizam Super Admin com empresa sempre explícita, leitura
-- histórica permitida em suspensa/cancelada; (4) nenhuma RPC de
-- mutation, nenhuma policy de pipeline_stages, nenhum helper legado foi
-- alterado. Roda como postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ── fixtures ──────────────────────────────────────────────────────────
-- Empresa A (ativa, cenário principal), Empresa B (ativa, isolamento
-- cruzado), Empresa C (implantacao), Empresa D (suspensa), Empresa E
-- (cancelada) — as quatro cobrindo a matriz de status completa.
insert into public.companies (id, name, status) values
  ('cc100000-0000-0000-0000-000000000001', 'S8C2B1 Empresa A', 'ativa'),
  ('cc100000-0000-0000-0000-000000000002', 'S8C2B1 Empresa B', 'ativa'),
  ('cc100000-0000-0000-0000-000000000003', 'S8C2B1 Empresa C Implantacao', 'implantacao'),
  ('cc100000-0000-0000-0000-000000000004', 'S8C2B1 Empresa D Suspensa', 'suspensa'),
  ('cc100000-0000-0000-0000-000000000005', 'S8C2B1 Empresa E Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's8c2b1-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's8c2b1-seller-a1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's8c2b1-seller-a2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's8c2b1-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's8c2b1-seller-d@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 's8c2b1-manager-e@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 's8c2b1-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 's8c2b1-nomembership@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 's8c2b1-suspended@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 's8c2b1-offboarded@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc200000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 's8c2b1-inactive-profile@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('cc200000-0000-0000-0000-000000000001', 'Manager A', 's8c2b1-manager-a@test.local', true, null),
  ('cc200000-0000-0000-0000-000000000002', 'Seller A1', 's8c2b1-seller-a1@test.local', true, null),
  ('cc200000-0000-0000-0000-000000000003', 'Seller A2', 's8c2b1-seller-a2@test.local', true, null),
  ('cc200000-0000-0000-0000-000000000004', 'Manager C', 's8c2b1-manager-c@test.local', true, null),
  ('cc200000-0000-0000-0000-000000000005', 'Seller D', 's8c2b1-seller-d@test.local', true, null),
  ('cc200000-0000-0000-0000-000000000006', 'Manager E', 's8c2b1-manager-e@test.local', true, null),
  ('cc200000-0000-0000-0000-000000000007', 'Super Admin S8C2B1', 's8c2b1-superadmin@test.local', true, 'super_admin'),
  ('cc200000-0000-0000-0000-000000000008', 'Sem Membership', 's8c2b1-nomembership@test.local', true, null),
  ('cc200000-0000-0000-0000-000000000009', 'Manager Suspenso', 's8c2b1-suspended@test.local', true, null),
  ('cc200000-0000-0000-0000-00000000000a', 'Manager Desligado', 's8c2b1-offboarded@test.local', true, null),
  ('cc200000-0000-0000-0000-00000000000b', 'Profile Inativo', 's8c2b1-inactive-profile@test.local', false, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active, lifecycle_status) values
  ('cc300000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'cc200000-0000-0000-0000-000000000001', 'manager', true, 'active'),
  ('cc300000-0000-0000-0000-000000000002', 'cc100000-0000-0000-0000-000000000001', 'cc200000-0000-0000-0000-000000000002', 'seller',  true, 'active'),
  ('cc300000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000001', 'cc200000-0000-0000-0000-000000000003', 'seller',  true, 'active'),
  ('cc300000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000003', 'cc200000-0000-0000-0000-000000000004', 'manager', true, 'active'),
  ('cc300000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000004', 'cc200000-0000-0000-0000-000000000005', 'seller',  true, 'active'),
  ('cc300000-0000-0000-0000-000000000006', 'cc100000-0000-0000-0000-000000000005', 'cc200000-0000-0000-0000-000000000006', 'manager', true, 'active'),
  ('cc300000-0000-0000-0000-000000000009', 'cc100000-0000-0000-0000-000000000001', 'cc200000-0000-0000-0000-000000000009', 'manager', false, 'suspended'),
  ('cc300000-0000-0000-0000-00000000000a', 'cc100000-0000-0000-0000-000000000001', 'cc200000-0000-0000-0000-00000000000a', 'manager', false, 'offboarded'),
  ('cc300000-0000-0000-0000-00000000000b', 'cc100000-0000-0000-0000-000000000001', 'cc200000-0000-0000-0000-00000000000b', 'manager', true, 'active');
-- cc200000-...-08 (Sem Membership) deliberadamente sem nenhuma linha.

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('s8c2b1SellerA1', 'cc100000-0000-0000-0000-000000000001', 'Seller A1', 'S8C2B1-A1', 'cc200000-0000-0000-0000-000000000002', 'cc300000-0000-0000-0000-000000000002', true),
  ('s8c2b1SellerA2', 'cc100000-0000-0000-0000-000000000001', 'Seller A2', 'S8C2B1-A2', 'cc200000-0000-0000-0000-000000000003', 'cc300000-0000-0000-0000-000000000003', true),
  ('s8c2b1SellerD',  'cc100000-0000-0000-0000-000000000004', 'Seller D',  'S8C2B1-D',  'cc200000-0000-0000-0000-000000000005', 'cc300000-0000-0000-0000-000000000005', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('cc400000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('cc400000-0000-0000-0000-000000000002', 'cc100000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('cc400000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000004', 'new', 'Novo', 0),
  ('cc400000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000005', 'new', 'Novo', 0);

-- Leads da empresa A: A1 (Seller A1, ativo), A2 (Seller A2, ativo),
-- A3 (sem seller, ativo), A4 (Seller A1, ARQUIVADO). Lead da empresa B:
-- B1 (ativo) — só para isolamento cruzado.
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('cc500000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'Lead A1', '(11) 90000-0001', 'Onix',
   'cc400000-0000-0000-0000-000000000001', 's8c2b1SellerA1', null),
  ('cc500000-0000-0000-0000-000000000002', 'cc100000-0000-0000-0000-000000000001', 'Lead A2', '(11) 90000-0002', 'HB20',
   'cc400000-0000-0000-0000-000000000001', 's8c2b1SellerA2', null),
  ('cc500000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000001', 'Lead A3', '(11) 90000-0003', 'Gol',
   'cc400000-0000-0000-0000-000000000001', null, null),
  ('cc500000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000001', 'Lead A4', '(11) 90000-0004', 'Argo',
   'cc400000-0000-0000-0000-000000000001', 's8c2b1SellerA1', now()),
  ('cc500000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000002', 'Lead B1', '(11) 90000-0005', 'Onix',
   'cc400000-0000-0000-0000-000000000002', null, null);

insert into public.lead_timeline_entries (id, company_id, lead_id, icon, color, label, occurred_at) values
  ('cc600000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'cc500000-0000-0000-0000-000000000001', 'phone', '#1', 'T-A1', now()),
  ('cc600000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000001', 'cc500000-0000-0000-0000-000000000004', 'phone', '#4', 'T-A4', now()),
  ('cc600000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000002', 'cc500000-0000-0000-0000-000000000005', 'phone', '#5', 'T-B1', now());

-- ══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ══════════════════════════════════════════════════════════════════════

select is((select relrowsecurity from pg_class where oid = 'public.leads'::regclass), true, 'RLS habilitada em public.leads');
select is((select relrowsecurity from pg_class where oid = 'public.lead_timeline_entries'::regclass), true, 'RLS habilitada em public.lead_timeline_entries');

select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_select'),
  1, 'policy leads_select existe');
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='lead_timeline_entries' and policyname='lead_timeline_select'),
  1, 'policy lead_timeline_select existe');
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='leads'),
  1, 'leads tem exatamente 1 policy — nenhuma policy global de Super Admin foi adicionada');
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='lead_timeline_entries'),
  1, 'lead_timeline_entries tem exatamente 1 policy — nenhuma policy global de Super Admin foi adicionada');

select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename in ('leads','lead_timeline_entries')
      and (coalesce(qual, '') ilike '%current_profile_company_id%'
        or coalesce(qual, '') ilike '%current_profile_role%'
        or coalesce(qual, '') ilike '%current_profile_seller_id(%'
        or coalesce(qual, '') ilike '%is_manager_or_admin%')),
  0, 'nenhuma das duas policies usa helpers legados (current_profile_company_id/role/seller_id, is_manager_or_admin)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'list_commercial_companies','list_platform_leads_for_company',
      'list_platform_lead_timeline','list_pipeline_stages_for_company')),
  4, 'as quatro RPCs estreitas existem');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'list_commercial_companies','list_platform_leads_for_company',
      'list_platform_lead_timeline','list_pipeline_stages_for_company')
      and p.prosecdef),
  4, 'as quatro RPCs sao SECURITY DEFINER');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public' and routine_name in (
      'list_commercial_companies','list_platform_leads_for_company',
      'list_platform_lead_timeline','list_pipeline_stages_for_company')
      and grantee='anon'),
  0, 'anon nao tem EXECUTE em nenhuma das quatro RPCs');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public' and routine_name in (
      'list_commercial_companies','list_platform_leads_for_company',
      'list_platform_lead_timeline','list_pipeline_stages_for_company')
      and grantee='authenticated' and privilege_type='EXECUTE'),
  4, 'authenticated tem EXECUTE nas quatro RPCs');

-- Nenhuma RPC de mutation ou reorder foi alterada por esta etapa.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_lead','update_lead','move_lead_to_stage','apply_lead_event',
      'assign_lead_seller','archive_lead','unarchive_lead',
      'add_lead_timeline_entry','check_lead_phone_duplicate','reorder_pipeline_stages')),
  10, 'as 9 RPCs de mutation de leads + reorder_pipeline_stages continuam no catalogo, intocadas');
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='pipeline_stages'),
  3, 'pipeline_stages continua com exatamente as 3 policies do S8-C1-B (nenhuma alterada)');

-- ══════════════════════════════════════════════════════════════════════
-- MANAGER ATIVO (Empresa A, status ativa)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000001'),
  4, 'Manager A ve os 4 leads da empresa (incl. sem seller e arquivado)');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000002'),
  0, 'Manager A NAO ve leads da empresa B');
select is(
  (select count(*)::int from public.lead_timeline_entries where company_id='cc100000-0000-0000-0000-000000000001'),
  2, 'Manager A ve as 2 entradas de timeline da propria empresa (incl. lead arquivado)');
select is(
  (select count(*)::int from public.lead_timeline_entries where company_id='cc100000-0000-0000-0000-000000000002'),
  0, 'Manager A NAO ve timeline da empresa B');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- SELLER ATIVO (Empresa A)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.leads),
  1, 'Seller A1 ve somente 1 lead (o proprio, ativo)');
select is(
  (select id from public.leads), 'cc500000-0000-0000-0000-000000000001'::uuid,
  'Seller A1 ve exatamente o Lead A1');
select is(
  (select count(*)::int from public.leads where id='cc500000-0000-0000-0000-000000000002'),
  0, 'Seller A1 NAO ve o Lead A2 (de outro Seller)');
select is(
  (select count(*)::int from public.leads where id='cc500000-0000-0000-0000-000000000003'),
  0, 'Seller A1 NAO ve o Lead A3 (sem Seller)');
select is(
  (select count(*)::int from public.leads where id='cc500000-0000-0000-0000-000000000004'),
  0, 'Seller A1 NAO ve o proprio Lead A4 (arquivado)');
select is(
  (select count(*)::int from public.lead_timeline_entries),
  1, 'Seller A1 ve somente a timeline do proprio lead ativo (T-A1), nunca T-A4 (arquivado) nem T-B1');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.leads),
  1, 'Seller A2 ve somente 1 lead (o proprio)');
select is(
  (select id from public.leads), 'cc500000-0000-0000-0000-000000000002'::uuid,
  'Seller A2 ve exatamente o Lead A2, nunca o de Seller A1');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- MANAGER/SELLER — EMPRESA IMPLANTACAO/SUSPENSA/CANCELADA (negado)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000003'),
  0, 'Manager C (empresa em implantacao): leitura de Leads negada — mais restritivo que Pipeline, de proposito');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000004'),
  0, 'Seller D (empresa suspensa): leitura de Leads negada');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000006');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000005'),
  0, 'Manager E (empresa cancelada): leitura de Leads negada');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- MEMBERSHIP AUSENTE / SUSPENSA / OFFBOARDED / PROFILE INATIVO
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000008');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000001'),
  0, 'Sem membership: zero leads (profile ativo, zero company_memberships)');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000009');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000001'),
  0, 'Membership suspensa: zero leads');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000001'),
  0, 'Membership offboarded: zero leads');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from public.leads where company_id='cc100000-0000-0000-0000-000000000001'),
  0, 'Profile globalmente inativo: zero leads (helpers ja filtram profiles.is_active)');
reset role;

-- NOTA M1-F S8-E2: a seção "LEGADO DIVERGENTE" que existia aqui provava
-- que profiles.company_id/role divergentes eram ignorados pela
-- autorização real (company_memberships). As colunas foram removidas
-- fisicamente do catálogo nesta etapa — não há mais nenhum campo legado
-- capaz de divergir, logo o cenário deixou de ser estruturalmente
-- possível. A garantia em si (autorização deriva exclusivamente de
-- company_memberships) continua coberta pelos blocos MANAGER/SELLER
-- ATIVO acima.

-- ══════════════════════════════════════════════════════════════════════
-- SUPER ADMIN — SELECT DIRETO (sempre negado, sem policy global)
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from public.leads),
  0, 'Super Admin: SELECT direto em leads devolve zero linhas (sem policy global)');
select is(
  (select count(*)::int from public.lead_timeline_entries),
  0, 'Super Admin: SELECT direto em timeline devolve zero linhas');
select is(
  (select count(*)::int from public.pipeline_stages),
  0, 'Super Admin: SELECT direto em pipeline_stages continua negado (S8-C1-B intocado)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- LIST_COMMERCIAL_COMPANIES
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from public.list_commercial_companies() where id::text like 'cc1%'),
  5, 'Super Admin: list_commercial_companies devolve as 5 empresas da fixture, incluindo cancelada');
select is(
  (select count(*)::int from public.list_commercial_companies() where status = 'cancelada' and id::text like 'cc1%'),
  1, 'list_commercial_companies inclui empresa cancelada');
select results_eq(
  $$select id, name, status from public.list_commercial_companies() where id = 'cc100000-0000-0000-0000-000000000005'$$,
  $$values ('cc100000-0000-0000-0000-000000000005'::uuid, 'S8C2B1 Empresa E Cancelada'::text, 'cancelada'::public.company_status)$$,
  'list_commercial_companies devolve id/name/status corretos para a empresa cancelada');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.list_commercial_companies()$$,
  null, 'forbidden', 'Manager: list_commercial_companies negado (forbidden)');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.list_commercial_companies()$$,
  null, 'forbidden', 'Seller: list_commercial_companies negado (forbidden)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- LIST_PLATFORM_LEADS_FOR_COMPANY
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000001', false)),
  3, 'Super Admin (Empresa A ativa): 3 leads ativos (A1, A2, A3)');
select is(
  (select count(*)::int from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000001', true)),
  1, 'Super Admin (Empresa A ativa): 1 lead arquivado (A4)');
select is(
  (select count(*)::int from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000003', false)),
  0, 'Super Admin (Empresa C implantacao, sem leads na fixture): leitura permitida, zero linhas');
select lives_ok(
  $$select * from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000004', false)$$,
  'Super Admin: leitura de Empresa D (suspensa) permitida — leitura historica');
select lives_ok(
  $$select * from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000005', false)$$,
  'Super Admin: leitura de Empresa E (cancelada) permitida — leitura historica');
select is(
  (select count(*)::int from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000002', false)),
  1, 'Super Admin: consulta explicita da Empresa B devolve somente o lead da Empresa B, nunca misturado com A');
select throws_ok(
  $$select * from public.list_platform_leads_for_company(null, false)$$,
  null, 'company_required', 'Super Admin: p_company_id null falha com company_required');
select throws_ok(
  $$select * from public.list_platform_leads_for_company('00000000-0000-0000-0000-000000009999', false)$$,
  null, 'company_not_found', 'Super Admin: empresa inexistente falha com company_not_found');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000001', false)$$,
  null, 'forbidden', 'Manager A: list_platform_leads_for_company negado mesmo enviando a propria empresa (RPC e so de Super Admin)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- LIST_PLATFORM_LEAD_TIMELINE
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from public.list_platform_lead_timeline('cc100000-0000-0000-0000-000000000001', 'cc500000-0000-0000-0000-000000000001')),
  1, 'Super Admin: timeline correta do Lead A1');
select throws_ok(
  $$select * from public.list_platform_lead_timeline('cc100000-0000-0000-0000-000000000002', 'cc500000-0000-0000-0000-000000000001')$$,
  null, 'lead_not_found', 'Super Admin: Lead A1 (Empresa A) consultado com Empresa B falha com lead_not_found (nao vaza que o lead existe em outra empresa)');
select throws_ok(
  $$select * from public.list_platform_lead_timeline(null, 'cc500000-0000-0000-0000-000000000001')$$,
  null, 'company_required', 'Super Admin: p_company_id null falha com company_required');
select throws_ok(
  $$select * from public.list_platform_lead_timeline('cc100000-0000-0000-0000-000000000001', null)$$,
  null, 'lead_required', 'Super Admin: p_lead_id null falha com lead_required');
select throws_ok(
  $$select * from public.list_platform_lead_timeline('00000000-0000-0000-0000-000000009999', 'cc500000-0000-0000-0000-000000000001')$$,
  null, 'company_not_found', 'Super Admin: empresa inexistente falha com company_not_found');
select throws_ok(
  $$select * from public.list_platform_lead_timeline('cc100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000009999')$$,
  null, 'lead_not_found', 'Super Admin: lead inexistente falha com lead_not_found');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.list_platform_lead_timeline('cc100000-0000-0000-0000-000000000001', 'cc500000-0000-0000-0000-000000000001')$$,
  null, 'forbidden', 'Seller: list_platform_lead_timeline negado');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- LIST_PIPELINE_STAGES_FOR_COMPANY
-- ══════════════════════════════════════════════════════════════════════

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from public.list_pipeline_stages_for_company('cc100000-0000-0000-0000-000000000001')),
  1, 'Super Admin: etapas da Empresa A (ativa)');
select lives_ok(
  $$select * from public.list_pipeline_stages_for_company('cc100000-0000-0000-0000-000000000004')$$,
  'Super Admin: etapas da Empresa D (suspensa) — leitura permitida');
select lives_ok(
  $$select * from public.list_pipeline_stages_for_company('cc100000-0000-0000-0000-000000000005')$$,
  'Super Admin: etapas da Empresa E (cancelada) — leitura permitida');
select is(
  (select count(*)::int from public.list_pipeline_stages_for_company('cc100000-0000-0000-0000-000000000002')),
  1, 'Super Admin: etapas da Empresa B, nunca misturadas com as da Empresa A');
select throws_ok(
  $$select * from public.list_pipeline_stages_for_company(null)$$,
  null, 'company_required', 'Super Admin: p_company_id null falha com company_required');
select throws_ok(
  $$select * from public.list_pipeline_stages_for_company('00000000-0000-0000-0000-000000009999')$$,
  null, 'company_not_found', 'Super Admin: empresa inexistente falha com company_not_found');
-- Confirma que a RPC NUNCA concede escrita: sort_order continua fora do
-- alcance de authenticated mesmo para Super Admin.
select throws_ok(
  $$update public.pipeline_stages set sort_order = 99 where company_id = 'cc100000-0000-0000-0000-000000000001'$$,
  '42501', null, 'Super Admin: mesmo apos a RPC de leitura, UPDATE direto de sort_order continua negado (coluna fora do grant)');
reset role;

set local role authenticated;
select pg_temp.as_user('cc200000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.list_pipeline_stages_for_company('cc100000-0000-0000-0000-000000000001')$$,
  null, 'forbidden', 'Manager A: list_pipeline_stages_for_company negado (RPC e so de Super Admin; Manager continua no caminho RLS normal)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- UNAUTHENTICATED / ANON
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok($$select count(*) from public.leads$$, '42501', null, 'anon: SELECT direto em leads falha');
select throws_ok($$select count(*) from public.lead_timeline_entries$$, '42501', null, 'anon: SELECT direto em timeline falha');
select throws_ok($$select * from public.list_commercial_companies()$$, '42501', null, 'anon: list_commercial_companies falha (sem EXECUTE)');
select throws_ok($$select * from public.list_platform_leads_for_company('cc100000-0000-0000-0000-000000000001', false)$$, '42501', null, 'anon: list_platform_leads_for_company falha (sem EXECUTE)');
select throws_ok($$select * from public.list_platform_lead_timeline('cc100000-0000-0000-0000-000000000001', 'cc500000-0000-0000-0000-000000000001')$$, '42501', null, 'anon: list_platform_lead_timeline falha (sem EXECUTE)');
select throws_ok($$select * from public.list_pipeline_stages_for_company('cc100000-0000-0000-0000-000000000001')$$, '42501', null, 'anon: list_pipeline_stages_for_company falha (sem EXECUTE)');
reset role;

select finish();
rollback;
