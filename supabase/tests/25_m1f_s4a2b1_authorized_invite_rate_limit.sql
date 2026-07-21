-- M1-F S4-A2B.1 — rate limit de convites AUTORIZADO (pgTAP)
-- Fonte: auditoria adversarial pós-S4-A2B (Route Handler) — vulnerabilidade
-- real reproduzida empiricamente antes desta migration: reserve_invite_
-- rate_limit() só validava existência do ator + formato, NUNCA autorização
-- — um Seller/Manager inativo/ADMIN legado/qualquer autenticado tentando
-- convite de plataforma conseguia CONSUMIR o rate limit antes de
-- create_invite()/resend_invite() rejeitarem com forbidden (negação de
-- serviço real contra convites legítimos do mesmo e-mail/escopo).
--
-- Cobre: ACL do helper genérico (rebaixado, sem EXECUTE para service_role)
-- e das 2 novas funções (reserve_create_invite_rate_limit/reserve_resend_
-- invite_rate_limit, só service_role); autorização/elegibilidade completa
-- revalidada ANTES de reservar, para os mesmos papéis/cenários já cobertos
-- em create_invite()/resend_invite() (S4-A2A); confirmação de que SOMENTE
-- uma operação autorizada e elegível insere evento em invite_rate_limit_
-- events; thresholds (20/15min por ator, 3/24h por e-mail+escopo)
-- continuam valendo através dos wrappers. Nenhum token bruto, Route
-- Handler, Supabase Auth ou usuário real — fixtures sintéticas, rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ─────────────────────────────────────────────────────────────
insert into public.companies (id, name, status) values
  ('cc100000-0000-0000-0000-000000000001', 'H1 Empresa Ativa', 'ativa'),
  ('cc200000-0000-0000-0000-000000000002', 'H2 Empresa Ativa (outra)', 'ativa'),
  ('cc300000-0000-0000-0000-000000000003', 'H3 Empresa Suspensa', 'suspensa'),
  ('cc400000-0000-0000-0000-000000000004', 'H4 Empresa Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'r25managerh1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'r25managerh2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'r25superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'r25sellerh1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'r25managerinativoh1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'r25adminlegado@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'r25profileinativo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'r25managerh3suspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc900000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'r25managerh4cancelada@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'R25 Manager H1',            'r25managerh1@test.local',        'manager', true),
  ('cc900000-0000-0000-0000-000000000002', 'cc200000-0000-0000-0000-000000000002', 'R25 Manager H2',            'r25managerh2@test.local',        'manager', true),
  ('cc900000-0000-0000-0000-000000000003', null,                                   'R25 Super Admin',           'r25superadmin@test.local',       'seller',  true),
  ('cc900000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000001', 'R25 Seller H1',             'r25sellerh1@test.local',         'seller',  true),
  ('cc900000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000001', 'R25 Manager Inativo H1',    'r25managerinativoh1@test.local', 'manager', true),
  ('cc900000-0000-0000-0000-000000000006', 'cc100000-0000-0000-0000-000000000001', 'R25 Admin Legado',          'r25adminlegado@test.local',      'admin',   true),
  ('cc900000-0000-0000-0000-000000000007', 'cc100000-0000-0000-0000-000000000001', 'R25 Profile Inativo',       'r25profileinativo@test.local',   'manager', false),
  ('cc900000-0000-0000-0000-000000000008', 'cc300000-0000-0000-0000-000000000003', 'R25 Manager H3 Suspensa',   'r25managerh3suspensa@test.local', 'manager', true),
  ('cc900000-0000-0000-0000-000000000009', 'cc400000-0000-0000-0000-000000000004', 'R25 Manager H4 Cancelada',  'r25managerh4cancelada@test.local', 'manager', true);

update public.profiles set platform_role = 'super_admin' where id = 'cc900000-0000-0000-0000-000000000003';

insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('cc100000-0000-0000-0000-000000000001', 'cc900000-0000-0000-0000-000000000001', 'manager', true),
  ('cc200000-0000-0000-0000-000000000002', 'cc900000-0000-0000-0000-000000000002', 'manager', true),
  ('cc100000-0000-0000-0000-000000000001', 'cc900000-0000-0000-0000-000000000004', 'seller',  true),
  ('cc100000-0000-0000-0000-000000000001', 'cc900000-0000-0000-0000-000000000005', 'manager', false),
  ('cc300000-0000-0000-0000-000000000003', 'cc900000-0000-0000-0000-000000000008', 'manager', true),
  ('cc400000-0000-0000-0000-000000000004', 'cc900000-0000-0000-0000-000000000009', 'manager', true);
-- cc900000-...-06 (ADMIN legado) recebe ZERO company_memberships de propósito.

-- Conveniência exclusiva deste teste (dentro da transação, rollback):
-- permite ler invites/invite_rate_limit_events por seus próprios ids
-- enquanto "set local role service_role" está ativo — mesmo padrão e
-- mesma justificativa dos testes 23/24.
grant select on public.invites to service_role;
grant select on public.invite_rate_limit_events to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- ACL — helper genérico rebaixado
-- ═══════════════════════════════════════════════════════════════════════

select is(has_function_privilege('service_role', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), false,
  'service_role NÃO tem mais EXECUTE direto em reserve_invite_rate_limit() (rebaixado a helper interno)');
select is(has_function_privilege('authenticated', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), false,
  'authenticated continua sem EXECUTE em reserve_invite_rate_limit()');
select is(has_function_privilege('anon', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), false,
  'anon continua sem EXECUTE em reserve_invite_rate_limit()');
select is(has_function_privilege('public', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), false,
  'PUBLIC continua sem EXECUTE em reserve_invite_rate_limit()');

set local role service_role;
select throws_ok(
  $$select * from public.reserve_invite_rate_limit('cc900000-0000-0000-0000-000000000001'::uuid, 'cc100000-0000-0000-0000-000000000001'::uuid, 'x@exemplo.com', 'create')$$,
  '42501', null, 'service_role não consegue mais chamar reserve_invite_rate_limit() diretamente (permission denied)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ACL — reserve_create_invite_rate_limit / reserve_resend_invite_rate_limit
-- ═══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'reserve_create_invite_rate_limit'::name,
  array['uuid','uuid','text','invite_role_kind']::name[], 'reserve_create_invite_rate_limit() existe com a assinatura exata');
select has_function('public'::name, 'reserve_resend_invite_rate_limit'::name,
  array['uuid','uuid']::name[], 'reserve_resend_invite_rate_limit() existe com a assinatura exata');

select is(has_function_privilege('service_role', 'public.reserve_create_invite_rate_limit(uuid,uuid,text,invite_role_kind)', 'EXECUTE'), true,
  'service_role tem EXECUTE em reserve_create_invite_rate_limit()');
select is(has_function_privilege('authenticated', 'public.reserve_create_invite_rate_limit(uuid,uuid,text,invite_role_kind)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em reserve_create_invite_rate_limit()');
select is(has_function_privilege('anon', 'public.reserve_create_invite_rate_limit(uuid,uuid,text,invite_role_kind)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em reserve_create_invite_rate_limit()');
select is(has_function_privilege('public', 'public.reserve_create_invite_rate_limit(uuid,uuid,text,invite_role_kind)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em reserve_create_invite_rate_limit()');

select is(has_function_privilege('service_role', 'public.reserve_resend_invite_rate_limit(uuid,uuid)', 'EXECUTE'), true,
  'service_role tem EXECUTE em reserve_resend_invite_rate_limit()');
select is(has_function_privilege('authenticated', 'public.reserve_resend_invite_rate_limit(uuid,uuid)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em reserve_resend_invite_rate_limit()');
select is(has_function_privilege('anon', 'public.reserve_resend_invite_rate_limit(uuid,uuid)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em reserve_resend_invite_rate_limit()');
select is(has_function_privilege('public', 'public.reserve_resend_invite_rate_limit(uuid,uuid)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em reserve_resend_invite_rate_limit()');

set local role authenticated;
select throws_ok(
  $$select * from public.reserve_create_invite_rate_limit(null, null, 'x@exemplo.com', 'seller')$$,
  '42501', null, 'authenticated não executa reserve_create_invite_rate_limit() diretamente');
select throws_ok(
  $$select * from public.reserve_resend_invite_rate_limit(null, gen_random_uuid())$$,
  '42501', null, 'authenticated não executa reserve_resend_invite_rate_limit() diretamente');
reset role;
set local role anon;
select throws_ok(
  $$select * from public.reserve_create_invite_rate_limit(null, null, 'x@exemplo.com', 'seller')$$,
  '42501', null, 'anon não executa reserve_create_invite_rate_limit() diretamente');
select throws_ok(
  $$select * from public.reserve_resend_invite_rate_limit(null, gen_random_uuid())$$,
  '42501', null, 'anon não executa reserve_resend_invite_rate_limit() diretamente');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- CREATE — autorização/elegibilidade ANTES de reservar
-- ═══════════════════════════════════════════════════════════════════════

-- Seller: forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, %L, 'r25.seller.target@exemplo.com', 'seller')$$,
    'cc900000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000001'),
  '42501', null, 'Seller H1 é negado (forbidden) ao tentar reservar create');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000004'),
  0, 'Seller H1: ZERO evento de rate limit inserido');

-- ADMIN legado sem membership real: forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, %L, 'r25.adminlegado.target@exemplo.com', 'seller')$$,
    'cc900000-0000-0000-0000-000000000006', 'cc100000-0000-0000-0000-000000000001'),
  '42501', null, 'ADMIN legado sem company_memberships de manager real é negado (forbidden)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000006'),
  0, 'ADMIN legado: ZERO evento de rate limit inserido');

-- Manager com membership INATIVA: forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, %L, 'r25.managerinativo.target@exemplo.com', 'seller')$$,
    'cc900000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000001'),
  '42501', null, 'Manager com membership inativa é negado (forbidden)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000005'),
  0, 'Manager inativo: ZERO evento de rate limit inserido');

-- Profile inativo (is_active=false em profiles): forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, %L, 'r25.profileinativo.target@exemplo.com', 'seller')$$,
    'cc900000-0000-0000-0000-000000000007', 'cc100000-0000-0000-0000-000000000001'),
  '42501', null, 'profile inativo é negado (forbidden)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000007'),
  0, 'profile inativo: ZERO evento de rate limit inserido');

-- Manager de OUTRA empresa (H2) tentando reservar para H1: forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, %L, 'r25.manageroutraempresa.target@exemplo.com', 'seller')$$,
    'cc900000-0000-0000-0000-000000000002', 'cc100000-0000-0000-0000-000000000001'),
  '42501', null, 'Manager H2 tentando reservar create para H1 (empresa alheia) é negado (forbidden)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000002' and company_id = 'cc100000-0000-0000-0000-000000000001'),
  0, 'Manager de outra empresa: ZERO evento de rate limit inserido no escopo alheio');

-- Manager tentando convidar MANAGER (só pode seller): forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, %L, 'r25.managerparamanager.target@exemplo.com', 'manager')$$,
    'cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001'),
  '42501', null, 'Manager tentando reservar convite de role_kind=manager é negado (forbidden — só pode seller)');
reset role;

-- Manager tentando convidar SUPER_ADMIN: forbidden, ZERO reserva (também
-- viola a coerência estrutural role/company, mas a autorização já barra antes)
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, null, 'r25.managerparasuperadmin.target@exemplo.com', 'super_admin')$$,
    'cc900000-0000-0000-0000-000000000001'),
  '42501', null, 'Manager tentando reservar convite de role_kind=super_admin é negado (forbidden)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.managerparasuperadmin.target@exemplo.com' and company_id is null),
  0, 'Manager tentando plataforma: ZERO evento no escopo de plataforma');

-- usuário comum (Seller) tentando convite de PLATAFORMA (company_id null,
-- role_kind super_admin): forbidden, ZERO reserva — cenário central
-- reportado na auditoria
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_create_invite_rate_limit(%L, null, 'r25.sellerplataforma.target@exemplo.com', 'super_admin')$$,
    'cc900000-0000-0000-0000-000000000004'),
  '42501', null, 'Seller tentando reservar convite de PLATAFORMA é negado (forbidden)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.sellerplataforma.target@exemplo.com' and company_id is null),
  0, 'Seller tentando plataforma: ZERO evento no escopo de plataforma (bloqueia DoS contra convite legítimo de Super Admin)');

-- empresa suspensa: company_not_operational, ZERO reserva
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000008', 'cc300000-0000-0000-0000-000000000003', 'r25.empresasuspensa@exemplo.com', 'seller') rr)
   select not r.allowed and r.code = 'company_not_operational' from r),
  'empresa suspensa: allowed=false, code=company_not_operational');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.empresasuspensa@exemplo.com'),
  0, 'empresa suspensa: ZERO evento de rate limit inserido');

-- empresa cancelada: company_not_operational, ZERO reserva
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000009', 'cc400000-0000-0000-0000-000000000004', 'r25.empresacancelada@exemplo.com', 'seller') rr)
   select not r.allowed and r.code = 'company_not_operational' from r),
  'empresa cancelada: allowed=false, code=company_not_operational');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.empresacancelada@exemplo.com'),
  0, 'empresa cancelada: ZERO evento de rate limit inserido');

-- already_member: Seller H1 já é membro de H1 — Manager H1 tentando
-- convidá-lo de novo (mesmo e-mail) -> already_member, ZERO reserva
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25sellerh1@test.local', 'seller') rr)
   select not r.allowed and r.code = 'already_member' from r),
  'already_member: allowed=false, code=already_member');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25sellerh1@test.local'),
  0, 'already_member: ZERO evento de rate limit inserido');

-- not_eligible: Seller H1 (membro ativo de H1) sendo convidado pelo
-- Manager H2 para H2 -> not_eligible, ZERO reserva
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000002', 'cc200000-0000-0000-0000-000000000002', 'r25sellerh1@test.local', 'seller') rr)
   select not r.allowed and r.code = 'not_eligible' from r),
  'not_eligible: allowed=false, code=not_eligible');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000002' and company_id = 'cc200000-0000-0000-0000-000000000002'),
  0, 'not_eligible: ZERO evento de rate limit inserido');

-- duplicate_pending: já existe um convite pending para este e-mail+empresa
-- (criado via create_invite() real, chamado como service_role) — nova
-- tentativa de reserva -> duplicate_pending, ZERO NOVO evento
set local role service_role;
select public.create_invite('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.duplicatepending@exemplo.com', 'Duplicate Pending', 'seller', repeat('d0', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.duplicatepending@exemplo.com', 'seller') rr)
   select not r.allowed and r.code = 'duplicate_pending' from r),
  'duplicate_pending: allowed=false, code=duplicate_pending');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.duplicatepending@exemplo.com'),
  0, 'duplicate_pending: ZERO evento de rate limit inserido (create_invite() em si não usa invite_rate_limit_events)');

-- ── operação AUTORIZADA e ELEGÍVEL: reserva exatamente 1 evento ────────
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.autorizado.manager@exemplo.com', 'seller') rr)
   select r.allowed and r.code = 'ok' from r),
  'Manager H1 autorizado (convidando seller): allowed=true, code=ok');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000001' and email_normalized = 'r25.autorizado.manager@exemplo.com'),
  1, 'Manager H1 autorizado: EXATAMENTE 1 evento de rate limit inserido');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000001', 'r25.autorizado.superadmin1@exemplo.com', 'manager') rr)
   select r.allowed and r.code = 'ok' from r),
  'Super Admin autorizado (convidando manager para H1): allowed=true, code=ok');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000003' and email_normalized = 'r25.autorizado.superadmin1@exemplo.com'),
  1, 'Super Admin autorizado (manager): EXATAMENTE 1 evento de rate limit inserido');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000003', null, 'r25.autorizado.superadmin2@exemplo.com', 'super_admin') rr)
   select r.allowed and r.code = 'ok' from r),
  'Super Admin autorizado (convidando outro super_admin, plataforma): allowed=true, code=ok');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000003' and email_normalized = 'r25.autorizado.superadmin2@exemplo.com'),
  1, 'Super Admin autorizado (plataforma): EXATAMENTE 1 evento de rate limit inserido');

-- ── threshold ainda vale ATRAVÉS do wrapper: 3/24h por e-mail+escopo ───
-- IMPORTANTE: nenhuma destas 3 reservas cria um convite de verdade (nunca
-- chamamos create_invite() para este e-mail) — se um convite pending
-- realmente existisse para r25.threshold@exemplo.com, as reservas
-- seguintes cairiam em duplicate_pending (checado ANTES do threshold),
-- nunca chegando a exercitar o contador de 3/24h em si.
set local role service_role;
select public.reserve_create_invite_rate_limit('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.threshold@exemplo.com', 'seller');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.threshold@exemplo.com'),
  1, 'threshold: 1ª reserva autorizada foi inserida');

set local role service_role;
select public.reserve_create_invite_rate_limit('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.threshold@exemplo.com', 'seller');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.threshold@exemplo.com'),
  2, 'threshold: 2ª reserva autorizada inserida (total 2/3)');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.threshold@exemplo.com', 'seller') rr)
   select r.allowed from r),
  'threshold: 3ª reserva ainda permitida (dentro da quota)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.threshold@exemplo.com'),
  3, 'threshold: 3ª reserva inserida (total 3/3)');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_create_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.threshold@exemplo.com', 'seller') rr)
   select not r.allowed and r.code = 'email_scope_rate_limited' and r.retry_after_seconds > 0 from r),
  'threshold: 4ª reserva do mesmo e-mail+escopo é bloqueada (email_scope_rate_limited), MESMO sendo autorizada e elegível — thresholds inalterados');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.threshold@exemplo.com'),
  3, 'threshold: 4ª tentativa bloqueada NÃO inseriu evento — continua exatamente 3');

-- ═══════════════════════════════════════════════════════════════════════
-- RESEND — autorização/elegibilidade ANTES de reservar
-- ═══════════════════════════════════════════════════════════════════════

-- convite base, criado pelo Manager H1, para os cenários de resend abaixo
set local role service_role;
select public.create_invite('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.resendbase@exemplo.com', 'Resend Base', 'seller', repeat('f0', 32));
reset role;

-- Super Admin: autorizado, reserva
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000003',
      (select id from public.invites where token_hash = repeat('f0', 32))) rr)
   select r.allowed and r.code = 'ok' from r),
  'Super Admin autorizado a reenviar qualquer convite elegível: allowed=true, code=ok');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000003' and operation = 'resend'),
  1, 'Super Admin resend autorizado: EXATAMENTE 1 evento inserido');

-- Manager H2 (não é o convidador, empresa alheia): invite_not_found
-- (colapso anti-enumeração), ZERO reserva
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000002',
      (select id from public.invites where token_hash = repeat('f0', 32))) rr)
   select not r.allowed and r.code = 'invite_not_found' from r),
  'Manager H2 (empresa alheia, não convidador) reenviando convite de H1: allowed=false, code=invite_not_found (colapso anti-enumeração)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000002' and operation = 'resend'),
  0, 'Manager alheio: ZERO evento de rate limit inserido');

-- Manager H1 com membership INATIVA: forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_resend_invite_rate_limit(%L, %L)$$,
    'cc900000-0000-0000-0000-000000000005',
    (select id::text from public.invites where token_hash = repeat('f0', 32))),
  '42501', null, 'Manager com membership inativa é negado (forbidden) ao tentar reservar resend');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000005'),
  0, 'Manager inativo: ZERO evento de rate limit inserido (resend)');

-- Seller: forbidden, ZERO reserva
set local role service_role;
select throws_ok(
  format($$select * from public.reserve_resend_invite_rate_limit(%L, %L)$$,
    'cc900000-0000-0000-0000-000000000004',
    (select id::text from public.invites where token_hash = repeat('f0', 32))),
  '42501', null, 'Seller é negado (forbidden) ao tentar reservar resend');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000004'),
  0, 'Seller: ZERO evento de rate limit inserido (resend)');

-- convite inexistente: invite_not_found, ZERO reserva
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001', gen_random_uuid()) rr)
   select not r.allowed and r.code = 'invite_not_found' from r),
  'convite inexistente: allowed=false, code=invite_not_found');
reset role;

-- convite CANCELED: invite_not_actionable, ZERO reserva
set local role service_role;
select public.create_invite('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.canceled@exemplo.com', 'Canceled Target', 'seller', repeat('f1', 32));
reset role;
update public.invites set status = 'canceled' where token_hash = repeat('f1', 32);
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('f1', 32))) rr)
   select not r.allowed and r.code = 'invite_not_actionable' from r),
  'convite CANCELED: allowed=false, code=invite_not_actionable');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.canceled@exemplo.com'),
  0, 'convite canceled: ZERO evento de rate limit inserido');

-- convite SUPERSEDED: invite_not_actionable, ZERO reserva
set local role service_role;
select public.create_invite('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.superseded@exemplo.com', 'Superseded Target', 'seller', repeat('f2', 32));
reset role;
set local role service_role;
select public.resend_invite('cc900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('f2', 32)), repeat('f3', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('f2', 32))) rr)
   select not r.allowed and r.code = 'invite_not_actionable' from r),
  'convite SUPERSEDED (já reenviado): allowed=false, code=invite_not_actionable');
reset role;
-- resend_invite() foi chamado DIRETAMENTE acima (só para preparar o
-- estado "superseded" da fixture) — nunca passou por reserve_resend_
-- invite_rate_limit(), então nenhum evento deveria existir para este
-- e-mail/ator/operação antes mesmo da tentativa (negada) testada aqui.
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.superseded@exemplo.com' and actor_profile_id = 'cc900000-0000-0000-0000-000000000001' and operation = 'resend'),
  0, 'convite superseded: ZERO evento de rate limit — nem a preparação da fixture (resend_invite direto) nem a tentativa negada de reserva inseriram nada');

-- convite ACCEPTED: invite_not_actionable, ZERO reserva
set local role service_role;
select public.create_invite('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.accepted@exemplo.com', 'Accepted Target', 'seller', repeat('f4', 32));
reset role;
update public.invites
   set status = 'accepted', accepted_at = now(), accepted_profile_id = 'cc900000-0000-0000-0000-000000000004'
 where token_hash = repeat('f4', 32);
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('f4', 32))) rr)
   select not r.allowed and r.code = 'invite_not_actionable' from r),
  'convite ACCEPTED: allowed=false, code=invite_not_actionable');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.accepted@exemplo.com'),
  0, 'convite accepted: ZERO evento de rate limit inserido');

-- empresa suspensa: company_not_operational, ZERO reserva (convite
-- criado enquanto a empresa ainda estava ativa, depois suspensa)
set local role service_role;
select public.create_invite('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.resendsuspensa@exemplo.com', 'Resend Suspensa', 'seller', repeat('f5', 32));
reset role;
update public.companies set status = 'suspensa' where id = 'cc100000-0000-0000-0000-000000000001';
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('f5', 32))) rr)
   select not r.allowed and r.code = 'company_not_operational' from r),
  'empresa suspensa (resend): allowed=false, code=company_not_operational');
reset role;
update public.companies set status = 'ativa' where id = 'cc100000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'r25.resendsuspensa@exemplo.com'),
  0, 'empresa suspensa (resend): ZERO evento de rate limit inserido');

-- Manager AUTOR do convite, com membership ATIVA: autorizado, reserva
set local role service_role;
select public.create_invite('cc900000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'r25.resendautorizado@exemplo.com', 'Resend Autorizado', 'seller', repeat('f6', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_resend_invite_rate_limit(
      'cc900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('f6', 32))) rr)
   select r.allowed and r.code = 'ok' from r),
  'Manager H1 (autor do convite, membership ativa): allowed=true, code=ok');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'cc900000-0000-0000-0000-000000000001' and email_normalized = 'r25.resendautorizado@exemplo.com' and operation = 'resend'),
  1, 'Manager H1 autorizado (resend): EXATAMENTE 1 evento inserido');

-- e-mail/company DERIVADOS do convite, nunca do chamador: o evento
-- inserido reflete o company_id/email REAIS do convite (cc100000...001 /
-- r25.resendautorizado@exemplo.com), nunca algo que o Route Handler
-- pudesse ter enviado — a assinatura da função nem aceita esses params.
select is(
  (select count(*)::int from public.invite_rate_limit_events
    where company_id = 'cc100000-0000-0000-0000-000000000001'
      and email_normalized = 'r25.resendautorizado@exemplo.com'
      and operation = 'resend'),
  1, 'o evento de rate limit reflete company_id/email DERIVADOS do convite (a função só recebe p_invite_id, nunca p_company_id/p_email)');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_invite', 'resend_invite', 'cancel_invite',
      'complete_invite_delivery', 'complete_invite_resend_delivery', 'reserve_invite_rate_limit',
      'reserve_create_invite_rate_limit', 'reserve_resend_invite_rate_limit')),
  8, 'exatamente as 8 RPCs de convite esperadas existem (6 anteriores + as 2 novas desta etapa), sem duplicata');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accept_invite'),
  0, 'accept_invite() continua inexistente (S4-C, fora de escopo)');

-- create_invite()/resend_invite() continuam revalidando tudo de novo —
-- não confiam cegamente em reserve_create/resend_invite_rate_limit() ter
-- passado. Prova direta: um Seller que (hipoteticamente) conseguisse
-- burlar a reserva ainda seria barrado por create_invite() diretamente.
set local role service_role;
select throws_ok(
  format($$select * from public.create_invite(%L, %L, 'r25.deveserbarrado@exemplo.com', 'Deve Ser Barrado', 'seller', repeat('f7', 32))$$,
    'cc900000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000001'),
  '42501', null, 'create_invite() continua sendo autoridade final — Seller é barrado mesmo chamando-a diretamente, sem depender da reserva');
reset role;

-- runtime legado continua operando leads normalmente
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S4A2B1 Compat Teste', '(11) 90000-8888', 'HB20')).id$$,
  'SELLER legado (usuário seedado) ainda cria lead normalmente após o S4-A2B.1');
reset role;

select * from finish();
rollback;
