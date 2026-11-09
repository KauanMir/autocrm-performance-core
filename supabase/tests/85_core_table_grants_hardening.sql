-- Core table grants hardening (20261109100000_core_table_grants_hardening.sql).
-- Guards the grant layer independently of RLS: (1) anon holds no table
-- privilege in public; (2) authenticated holds at most SELECT at table level;
-- (3) service_role keeps only the narrow column reads that server code uses on
-- profiles/invites and nothing on memberships/rate-limit tables; (4) real
-- statements fail with permission denied (42501), not merely with zero rows.
-- Creates its own fixtures (no dependency on supabase/seed.sql), so it also
-- runs on a restored production copy. Rollback at the end.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into public.companies (id, name, status) values
  ('cb100000-0000-0000-0000-000000000001', 'Grants85 Empresa', 'ativa');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'grants85-manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cb200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'grants85-seller@test.local', now(), now(), now());
insert into public.profiles (id, name, email, is_active, platform_role) values
  ('cb200000-0000-0000-0000-000000000001', 'Grants85 Manager', 'grants85-manager@test.local', true, null),
  ('cb200000-0000-0000-0000-000000000002', 'Grants85 Seller', 'grants85-seller@test.local', true, null);
insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('cb300000-0000-0000-0000-000000000001', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'manager', true),
  ('cb300000-0000-0000-0000-000000000002', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'seller', true);
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id) values
  ('grants85Seller', 'cb100000-0000-0000-0000-000000000001', 'Grants85 Seller', 'Grants85',
   'cb200000-0000-0000-0000-000000000002', 'cb300000-0000-0000-0000-000000000002');

-- ── catalog: whole public schema (extension-owned relations, such as the
--    pgTAP views created by `create extension pgtap`, are excluded) ─────────
create or replace function pg_temp.is_extension_relation(p_name text) returns boolean as $$
  select exists (
    select 1 from pg_depend d join pg_class c on c.oid = d.objid
     where d.classid = 'pg_class'::regclass and d.deptype = 'e'
       and c.relnamespace = 'public'::regnamespace and c.relname = p_name);
$$ language sql stable;

select is(
  (select coalesce(string_agg(distinct table_name, ',' order by table_name), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon' and not pg_temp.is_extension_relation(table_name)),
  '', 'anon has no table privilege on any public table or view');

select is(
  (select coalesce(string_agg(distinct table_name || ':' || privilege_type, ',' order by table_name || ':' || privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
      and not pg_temp.is_extension_relation(table_name)),
  '', 'authenticated has no table-level privilege other than SELECT on any public table');

select is(
  (select coalesce(string_agg(distinct table_name, ',' order by table_name), '')
     from information_schema.role_column_grants
    where table_schema = 'public' and grantee = 'anon' and not pg_temp.is_extension_relation(table_name)),
  '', 'anon has no column privilege on any public table');

-- ── companies / sellers / profiles ──────────────────────────────────────────
select is(
  (select array_agg(privilege_type::text order by privilege_type::text) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'companies' and grantee = 'authenticated'),
  array['SELECT'], 'authenticated keeps exactly table SELECT on companies (S3-A; RLS decides the rows)');
select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'sellers' and grantee in ('anon', 'authenticated')),
  0, 'sellers: no table or column privilege for anon/authenticated');
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated'),
  array['email', 'id', 'is_active', 'name', 'platform_role'],
  'authenticated: SELECT on exactly the 5 profile columns read by _loadProfile(), nothing else');

-- ── service_role: narrow server reads only ──────────────────────────────────
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'service_role'
      and table_name in ('profiles', 'invites', 'company_memberships', 'invite_rate_limit_events', 'invite_activation_rate_limit_events')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0, 'service_role has no table-level data privilege on profiles/invites/memberships/rate-limit tables');
select is(
  (select array_agg(table_name || '.' || column_name || ':' || privilege_type order by table_name, column_name) from information_schema.role_column_grants
    where table_schema = 'public' and grantee = 'service_role'
      and table_name in ('profiles', 'invites', 'company_memberships', 'invite_rate_limit_events', 'invite_activation_rate_limit_events')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  array['invites.delivery_status:SELECT', 'invites.id:SELECT', 'profiles.id:SELECT'],
  'service_role column reads: invites(id, delivery_status) for the delivery fallback, profiles(id) for the bootstrap probe');
select is(has_function_privilege('service_role', 'public.accept_invite(text)', 'EXECUTE'), false,
  'service_role cannot execute accept_invite()');
select is(has_function_privilege('service_role', 'public.cancel_invite(uuid)', 'EXECUTE'), false,
  'service_role cannot execute cancel_invite()');
select is(has_function_privilege('authenticated', 'public.accept_invite(text)', 'EXECUTE'), true,
  'authenticated keeps EXECUTE on accept_invite()');
select is(has_function_privilege('authenticated', 'public.cancel_invite(uuid)', 'EXECUTE'), true,
  'authenticated keeps EXECUTE on cancel_invite()');

-- ── behaviour: anon ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select 1 from public.companies limit 1', '42501', null, 'anon: SELECT companies is denied by grant');
select throws_ok('select 1 from public.sellers limit 1', '42501', null, 'anon: SELECT sellers is denied by grant');
select throws_ok('select 1 from public.profiles limit 1', '42501', null, 'anon: SELECT profiles is denied by grant');
select throws_ok($$insert into public.companies (name) values ('anon insert')$$, '42501', null, 'anon: INSERT companies is denied by grant');
reset role;

-- ── behaviour: Manager ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"cb200000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.companies where id = 'cb100000-0000-0000-0000-000000000001'), 1,
  'Manager still reads the own company through RLS');
select is((select count(*)::int from public.profiles where id = 'cb200000-0000-0000-0000-000000000001'), 1,
  'Manager still reads the own profile (5 granted columns)');
select throws_ok($$update public.companies set name = name where id = 'cb100000-0000-0000-0000-000000000001'$$, '42501', null,
  'Manager: direct UPDATE companies is denied by grant');
select throws_ok('select created_at from public.profiles limit 1', '42501', null,
  'Manager: profile columns outside the 5 are denied');
select throws_ok('select 1 from public.sellers limit 1', '42501', null, 'Manager: SELECT sellers is denied by grant');
reset role;

-- ── behaviour: Seller ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"cb200000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$delete from public.sellers where company_id = 'cb100000-0000-0000-0000-000000000001'$$, '42501', null,
  'Seller: direct DELETE sellers is denied by grant');
select throws_ok($$delete from public.companies where id = 'cb100000-0000-0000-0000-000000000001'$$, '42501', null,
  'Seller: direct DELETE companies is denied by grant');
reset role;

-- ── behaviour: service_role ─────────────────────────────────────────────────
set local role service_role;
select lives_ok('select id, delivery_status from public.invites limit 1', 'service_role: delivery fallback read still works');
select lives_ok('select id from public.profiles limit 1', 'service_role: profile existence probe still works');
select throws_ok('select token_hash from public.invites limit 1', '42501', null, 'service_role: invite token hashes are not readable');
select throws_ok('select email from public.profiles limit 1', '42501', null, 'service_role: profile data columns are not readable');
select throws_ok('select 1 from public.company_memberships limit 1', '42501', null, 'service_role: memberships only through RPCs');
select lives_ok('select 1 from public.companies limit 1', 'service_role keeps access to companies (fixtures/operator tooling)');
reset role;

select * from finish();
rollback;
