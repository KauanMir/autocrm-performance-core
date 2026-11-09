-- Core table grants hardening (2026-11-09).
--
-- Problem: public.companies, public.sellers and public.profiles were created
-- by 20260708120000_m1b without explicit REVOKEs, so they inherited the
-- Supabase default privileges of role postgres in schema public
-- (GRANT ALL ON TABLES TO anon, authenticated, service_role). Later tables
-- revoke explicitly; these three never did. The 2026-11-06 production backup
-- shows the same state in production: anon and authenticated hold
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN on
-- companies and sellers, and table-wide SELECT on profiles (every column).
-- RLS currently blocks every row (companies: SELECT policy for authenticated
-- only; sellers: no policy; profiles: own row only), so no row is reachable
-- through PostgREST/GraphQL today, but the pgTAP contracts (13, 20, 21, 27,
-- 30, 31, 33, 35-39, 44, 50-52, 59, 60) require the grant layer itself to deny
-- access, independently of RLS.
--
-- The same default privileges also gave service_role full data access to
-- tables and functions that the contracts (23, 24, 26, 27, 28, 29) restrict to
-- SECURITY DEFINER RPCs. Narrowed here to what server code actually uses:
--   * invites: SELECT (id, delivery_status) only — lib/server/invites/delivery.ts
--     re-reads delivery_status after a lost finalize response (design §18);
--   * profiles: SELECT (id) only — scripts/whatsapp/bootstrap-test-connection-core.ts
--     existence probe.
-- service_role keeps its access to companies and sellers (server fixtures and
-- operator tooling; not covered by any restricting contract).
--
-- Kept on purpose:
--   * authenticated SELECT on companies (M1-F S3-A; RLS companies_select_accessible,
--     also read inside leads/tasks/deals/... SELECT policies);
--   * authenticated SELECT (id, name, email, is_active, platform_role) on profiles
--     (M1-F S4-C2C, used by _loadProfile()).
-- REVOKE ALL ON TABLE also removes the column privileges of that grantee, so
-- the intended column grants are re-issued afterwards. Idempotent; no data,
-- RLS policy or function body changes.

-- ── companies ───────────────────────────────────────────────────────────────
revoke all on table public.companies from public, anon, authenticated;
grant select on table public.companies to authenticated;

-- ── sellers (client access only through RPCs) ───────────────────────────────
revoke all on table public.sellers from public, anon, authenticated;

-- ── profiles ────────────────────────────────────────────────────────────────
revoke all on table public.profiles from public, anon, authenticated;
grant select (id, name, email, is_active, platform_role) on table public.profiles to authenticated;
revoke select, insert, update, delete on table public.profiles from service_role;
grant select (id) on table public.profiles to service_role;

-- ── invites / memberships / rate limits (service_role) ──────────────────────
revoke select, insert, update, delete on table public.invites from service_role;
grant select (id, delivery_status) on table public.invites to service_role;
revoke select, insert, update, delete on table public.company_memberships from service_role;
revoke select, insert, update, delete on table public.invite_rate_limit_events from service_role;
revoke select, insert, update, delete on table public.invite_activation_rate_limit_events from service_role;

-- ── client RPCs that service_role never calls ───────────────────────────────
revoke execute on function public.accept_invite(text) from service_role;
revoke execute on function public.cancel_invite(uuid) from service_role;
