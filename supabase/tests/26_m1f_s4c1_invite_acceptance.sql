-- M1-F S4-C1 — validação não destrutiva e aceite de convites (pgTAP)
-- Cobre: schema/ACL da tabela de rate limit de ativação,
-- reserve_invite_validation_rate_limit(), validate_invite_token(),
-- accept_invite() — identidade, provisionamento por papel (Super Admin/
-- Manager/Seller), conflito de membership, atomicidade, auditoria,
-- códigos de domínio. Nenhum token bruto, Route Handler, verifyOtp,
-- senha ou usuário real — fixtures sintéticas, rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ─────────────────────────────────────────────────────────────
insert into public.companies (id, name, status) values
  ('fa100000-0000-0000-0000-000000000001', 'H1 Empresa Ativa', 'ativa'),
  ('fa200000-0000-0000-0000-000000000002', 'H2 Empresa Ativa (outra)', 'ativa'),
  ('fa300000-0000-0000-0000-000000000003', 'H3 Empresa Suspensa', 'suspensa'),
  ('fa400000-0000-0000-0000-000000000004', 'H4 Empresa Cancelada', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fa900000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g6managerh1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa900000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g6managerh2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa900000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'g6superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa900000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'g6outrodono@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'G6 Manager H1', 'g6managerh1@test.local', 'manager', true),
  ('fa900000-0000-0000-0000-000000000002', 'fa200000-0000-0000-0000-000000000002', 'G6 Manager H2', 'g6managerh2@test.local', 'manager', true),
  ('fa900000-0000-0000-0000-000000000003', null, 'G6 Super Admin', 'g6superadmin@test.local', 'seller', true),
  ('fa900000-0000-0000-0000-000000000004', 'fa100000-0000-0000-0000-000000000001', 'G6 Outro Dono', 'g6identityconflict@test.local', 'seller', true);

update public.profiles set platform_role = 'super_admin' where id = 'fa900000-0000-0000-0000-000000000003';

insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('fa100000-0000-0000-0000-000000000001', 'fa900000-0000-0000-0000-000000000001', 'manager', true),
  ('fa200000-0000-0000-0000-000000000002', 'fa900000-0000-0000-0000-000000000002', 'manager', true);

-- Conveniência exclusiva deste teste (dentro da transação, rollback):
-- permite ler invites/company_memberships/sellers/invite_activation_rate_
-- limit_events por seus próprios ids enquanto "set local role
-- service_role" está ativo — mesmo padrão e mesma justificativa dos
-- testes 23/24/25.
grant select on public.invites to service_role;
grant select on public.company_memberships to service_role;
grant select on public.sellers to service_role;

-- Helper para autenticar como um auth.uid() específico dentro desta
-- transação (mesmo padrão de simulação de sessão já usado em outros
-- testes do projeto: set_config('request.jwt.claims', ...) + set local
-- role authenticated).
create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA — invite_activation_rate_limit_events
-- ═══════════════════════════════════════════════════════════════════════

select has_table('public'::name, 'invite_activation_rate_limit_events'::name, 'tabela invite_activation_rate_limit_events existe');
select has_column('public'::name, 'invite_activation_rate_limit_events'::name, 'dimension'::name, 'coluna dimension existe');
select has_column('public'::name, 'invite_activation_rate_limit_events'::name, 'key_hash'::name, 'coluna key_hash existe');
select has_column('public'::name, 'invite_activation_rate_limit_events'::name, 'invite_id'::name, 'coluna invite_id existe');
select has_column('public'::name, 'invite_activation_rate_limit_events'::name, 'actor_profile_id'::name, 'coluna actor_profile_id existe');

select is(
  (select relrowsecurity from pg_class where oid = 'public.invite_activation_rate_limit_events'::regclass),
  true, 'RLS está ativa em invite_activation_rate_limit_events');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'invite_activation_rate_limit_events'),
  0, 'zero policies em invite_activation_rate_limit_events');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'invite_activation_rate_limit_events'
      and grantee in ('public', 'anon', 'authenticated', 'service_role')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0, 'zero grants de dados (SELECT/INSERT/UPDATE/DELETE) para PUBLIC/anon/authenticated/service_role em invite_activation_rate_limit_events');

set local role anon;
select throws_ok(
  $$select count(*) from public.invite_activation_rate_limit_events$$,
  '42501', null, 'anon não lê invite_activation_rate_limit_events diretamente');
reset role;
set local role authenticated;
select throws_ok(
  $$select count(*) from public.invite_activation_rate_limit_events$$,
  '42501', null, 'authenticated não lê invite_activation_rate_limit_events diretamente');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ACL — reserve_invite_validation_rate_limit / validate_invite_token /
-- accept_invite
-- ═══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'reserve_invite_validation_rate_limit'::name, array['text','text']::name[],
  'reserve_invite_validation_rate_limit() existe com a assinatura exata');
select has_function('public'::name, 'validate_invite_token'::name, array['text']::name[],
  'validate_invite_token() existe com a assinatura exata');
select has_function('public'::name, 'accept_invite'::name, array['text']::name[],
  'accept_invite() existe com a assinatura exata');

select is(has_function_privilege('service_role', 'public.reserve_invite_validation_rate_limit(text,text)', 'EXECUTE'), true,
  'service_role tem EXECUTE em reserve_invite_validation_rate_limit()');
select is(has_function_privilege('authenticated', 'public.reserve_invite_validation_rate_limit(text,text)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em reserve_invite_validation_rate_limit()');
select is(has_function_privilege('anon', 'public.reserve_invite_validation_rate_limit(text,text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em reserve_invite_validation_rate_limit()');
select is(has_function_privilege('public', 'public.reserve_invite_validation_rate_limit(text,text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em reserve_invite_validation_rate_limit()');

select is(has_function_privilege('service_role', 'public.validate_invite_token(text)', 'EXECUTE'), true,
  'service_role tem EXECUTE em validate_invite_token()');
select is(has_function_privilege('authenticated', 'public.validate_invite_token(text)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em validate_invite_token() (fronteira congelada: só o futuro Route Handler)');
select is(has_function_privilege('anon', 'public.validate_invite_token(text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em validate_invite_token()');
select is(has_function_privilege('public', 'public.validate_invite_token(text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em validate_invite_token()');

select is(has_function_privilege('authenticated', 'public.accept_invite(text)', 'EXECUTE'), true,
  'authenticated tem EXECUTE em accept_invite()');
select is(has_function_privilege('anon', 'public.accept_invite(text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em accept_invite()');
select is(has_function_privilege('public', 'public.accept_invite(text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em accept_invite()');
select is(has_function_privilege('service_role', 'public.accept_invite(text)', 'EXECUTE'), false,
  'service_role NÃO é a superfície esperada de accept_invite() (é authenticated, chamada direta do cliente)');

set local role anon;
select throws_ok(
  $$select * from public.reserve_invite_validation_rate_limit(repeat('0', 64), repeat('0', 64))$$,
  '42501', null, 'anon não executa reserve_invite_validation_rate_limit() diretamente');
select throws_ok(
  $$select * from public.validate_invite_token(repeat('0', 64))$$,
  '42501', null, 'anon não executa validate_invite_token() diretamente');
select throws_ok(
  $$select * from public.accept_invite(repeat('0', 64))$$,
  '42501', null, 'anon não executa accept_invite() diretamente (sem sessão real, auth.uid() nulo)');
reset role;
set local role authenticated;
select throws_ok(
  $$select * from public.reserve_invite_validation_rate_limit(repeat('0', 64), repeat('0', 64))$$,
  '42501', null, 'authenticated não executa reserve_invite_validation_rate_limit() diretamente');
select throws_ok(
  $$select * from public.validate_invite_token(repeat('0', 64))$$,
  '42501', null, 'authenticated não executa validate_invite_token() diretamente');
reset role;

-- accept_invite() sem auth.uid() (authenticated mas sem claims de sessão) -> forbidden
set local role authenticated;
select throws_ok(
  $$select * from public.accept_invite(repeat('0', 64))$$,
  '42501', null, 'accept_invite() sem auth.uid() (sessão sem sub) é negado (forbidden)');
reset role;

-- nenhum parâmetro administrativo aceito — assinatura tem só 1 argumento
select is(
  (select count(*)::int from information_schema.parameters o
    join information_schema.routines r on r.specific_name = o.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'accept_invite' and o.parameter_mode = 'IN'),
  1, 'accept_invite() aceita EXATAMENTE 1 parâmetro de entrada (p_token_hash) — nenhum profile_id/company_id/role_kind/e-mail aceito de fora');

-- ═══════════════════════════════════════════════════════════════════════
-- RESERVE_INVITE_VALIDATION_RATE_LIMIT — formatos, limites, locks
-- ═══════════════════════════════════════════════════════════════════════

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_validation_rate_limit('nao-hex', repeat('a', 64)) rr)
   select not r.allowed and r.code = 'invalid_input' from r),
  'p_ip_hash fora do formato hex de 64 -> invalid_input');
select ok(
  (with r as (select rr.* from public.reserve_invite_validation_rate_limit(repeat('a', 64), 'nao-hex') rr)
   select not r.allowed and r.code = 'invalid_input' from r),
  'p_token_hash fora do formato hex de 64 -> invalid_input');
reset role;
select is(
  (select count(*)::int from public.invite_activation_rate_limit_events),
  0, 'nenhuma das validações de formato rejeitadas acima inseriu evento');

-- 30 reservas do MESMO ip_hash são permitidas; a 31a é bloqueada
set local role service_role;
do $$
declare
  i int;
  r record;
begin
  for i in 1..30 loop
    select * into r from public.reserve_invite_validation_rate_limit(repeat('c1', 32), lpad(to_hex(i), 64, '0'));
    if not r.allowed then
      raise exception 'reserva de IP % deveria ter sido permitida, mas foi negada com code=%', i, r.code;
    end if;
  end loop;
end $$;
reset role;
select is(
  (select count(*)::int from public.invite_activation_rate_limit_events where dimension = 'validate_ip' and key_hash = repeat('c1', 32)),
  30, '30 reservas do mesmo IP (tokens diferentes) foram todas permitidas e inseridas');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_validation_rate_limit(repeat('c1', 32), lpad(to_hex(31), 64, '0')) rr)
   select not r.allowed and r.code = 'ip_rate_limited' and r.retry_after_seconds > 0 from r),
  '31a reserva do mesmo IP em 15 minutos é bloqueada (ip_rate_limited, retry_after_seconds positivo)');
reset role;
select is(
  (select count(*)::int from public.invite_activation_rate_limit_events where dimension = 'validate_ip' and key_hash = repeat('c1', 32)),
  30, 'a 31a tentativa (bloqueada) NÃO inseriu evento — continua exatamente 30');

-- 5 reservas do MESMO token_hash (IP diferente a cada vez, para não
-- colidir com a quota de IP já usada acima) são permitidas; a 6a é
-- bloqueada
set local role service_role;
do $$
declare
  i int;
  r record;
begin
  for i in 1..5 loop
    select * into r from public.reserve_invite_validation_rate_limit(lpad(to_hex(100 + i), 64, '0'), repeat('c2', 32));
    if not r.allowed then
      raise exception 'reserva de token % deveria ter sido permitida, mas foi negada com code=%', i, r.code;
    end if;
  end loop;
end $$;
reset role;
select is(
  (select count(*)::int from public.invite_activation_rate_limit_events where dimension = 'validate_token' and key_hash = repeat('c2', 32)),
  5, '5 reservas do mesmo token_hash foram todas permitidas e inseridas');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_validation_rate_limit(lpad(to_hex(200), 64, '0'), repeat('c2', 32)) rr)
   select not r.allowed and r.code = 'token_rate_limited' and r.retry_after_seconds > 0 from r),
  '6a reserva do mesmo token_hash em 15 minutos é bloqueada (token_rate_limited, retry_after_seconds positivo)');
reset role;
select is(
  (select count(*)::int from public.invite_activation_rate_limit_events where dimension = 'validate_token' and key_hash = repeat('c2', 32)),
  5, 'a 6a tentativa (bloqueada) NÃO inseriu evento — continua exatamente 5');

-- retorno mínimo (nenhum dado interno exposto)
select is(
  (select array(select o.parameter_name::text from information_schema.parameters o
    join information_schema.routines r on r.specific_name = o.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'reserve_invite_validation_rate_limit' and o.parameter_mode = 'OUT'
    order by o.ordinal_position)),
  array['allowed','code','retry_after_seconds'],
  'reserve_invite_validation_rate_limit() retorna EXATAMENTE allowed/code/retry_after_seconds');

-- ═══════════════════════════════════════════════════════════════════════
-- VALIDATE_INVITE_TOKEN
-- ═══════════════════════════════════════════════════════════════════════

set local role service_role;
select ok(
  (with r as (select rr.* from public.validate_invite_token('nao-hex') rr)
   select not r.valid and r.code = 'invalid_token_hash' and r.masked_email is null from r),
  'hash em formato inválido -> invalid_token_hash, masked_email null');
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e0', 32)) rr)
   select not r.valid and r.code = 'invite_not_found' and r.masked_email is null from r),
  'token inexistente -> invite_not_found, masked_email null');
reset role;

set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.validate.pending@test.local', 'Validate Pending', 'seller', repeat('e1', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e1', 32)) rr)
   select not r.valid and r.code = 'invite_not_actionable' and r.masked_email is null from r),
  'convite pending mas delivery_status NOT_SENT (finalização nunca chamada) -> invite_not_actionable');
reset role;

set local role service_role;
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e1', 32)), true, null);
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e1', 32)) rr)
   select r.valid and r.code = 'ok' from r),
  'convite pending + sent + não expirado + empresa ativa -> valid=true, code=ok');
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e1', 32)) rr)
   select r.masked_email = 'g***@test.local' from r),
  'masked_email é mascarado corretamente (primeiro caractere + *** + domínio completo), SÓ quando valid=true');
reset role;
select is(
  (select status from public.invites where token_hash = repeat('e1', 32)),
  'pending'::public.invite_status, 'validate_invite_token() NUNCA fez UPDATE — status continua pending após validação bem-sucedida');

-- expirado
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.validate.expired@test.local', 'Validate Expired', 'seller', repeat('e2', 32));
reset role;
update public.invites set expires_at = now() - interval '1 hour' where token_hash = repeat('e2', 32);
set local role service_role;
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e2', 32)), true, null);
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e2', 32)) rr)
   select not r.valid and r.code = 'invite_expired' from r),
  'convite vencido -> invite_expired');
reset role;

-- canceled
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.validate.canceled@test.local', 'Validate Canceled', 'seller', repeat('e3', 32));
reset role;
set local role authenticated;
select pg_temp.as_user('fa900000-0000-0000-0000-000000000001');
select public.cancel_invite((select id from public.invites where token_hash = repeat('e3', 32)));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e3', 32)) rr)
   select not r.valid and r.code = 'invite_not_actionable' from r),
  'convite canceled -> invite_not_actionable');
reset role;

-- superseded
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.validate.superseded@test.local', 'Validate Superseded', 'seller', repeat('e4', 32));
reset role;
set local role service_role;
select public.resend_invite('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e4', 32)), repeat('e5', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e4', 32)) rr)
   select not r.valid and r.code = 'invite_not_actionable' from r),
  'convite superseded (token do convite ANTERIOR) -> invite_not_actionable');
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e5', 32)) rr)
   select not r.valid and r.code = 'invite_not_actionable' from r),
  'convite novo do resend, ainda not_sent (finalização nunca chamada) -> invite_not_actionable — proveniência não confere validade sozinha');
reset role;

-- accepted (via accept_invite real mais abaixo será reaproveitado; aqui
-- simulamos diretamente para testar validate isoladamente)
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.validate.accepted@test.local', 'Validate Accepted', 'seller', repeat('e6', 32));
reset role;
update public.invites
   set status = 'accepted', accepted_at = now(), accepted_profile_id = 'fa900000-0000-0000-0000-000000000001'
 where token_hash = repeat('e6', 32);
set local role service_role;
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e6', 32)) rr)
   select not r.valid and r.code = 'invite_already_used' from r),
  'convite accepted -> invite_already_used (código distinto de invite_not_actionable)');
reset role;

-- empresa suspensa / cancelada
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.validate.suspensa@test.local', 'Validate Suspensa', 'seller', repeat('e7', 32));
reset role;
update public.companies set status = 'suspensa' where id = 'fa100000-0000-0000-0000-000000000001';
set local role service_role;
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e7', 32)), true, null);
select ok(
  (with r as (select rr.* from public.validate_invite_token(repeat('e7', 32)) rr)
   select not r.valid and r.code = 'company_not_operational' from r),
  'empresa suspensa -> company_not_operational');
reset role;
update public.companies set status = 'ativa' where id = 'fa100000-0000-0000-0000-000000000001';

-- zero dados extras no retorno (só valid/code/masked_email)
select is(
  (select array(select o.parameter_name::text from information_schema.parameters o
    join information_schema.routines r on r.specific_name = o.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'validate_invite_token' and o.parameter_mode = 'OUT'
    order by o.ordinal_position)),
  array['valid','code','masked_email'],
  'validate_invite_token() retorna EXATAMENTE valid/code/masked_email — nenhum invite_id/company_id/role_kind/token_hash exposto');

-- ═══════════════════════════════════════════════════════════════════════
-- ACCEPT_INVITE — IDENTIDADE
-- ═══════════════════════════════════════════════════════════════════════

-- email_mismatch
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa910000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g6.diferente@test.local', now(), now(), now());
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.esperado@test.local', 'Mismatch Target', 'seller', repeat('f0', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('f0', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa910000-0000-0000-0000-000000000001');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('f0', 32)) rr)
   select not r.success and r.code = 'email_mismatch' from r),
  'e-mail autenticado diferente do e-mail do convite -> email_mismatch');
reset role;
select is((select status from public.invites where token_hash = repeat('f0', 32)), 'pending'::public.invite_status,
  'email_mismatch: convite permanece pending');
select is((select count(*)::int from public.profiles where id = 'fa910000-0000-0000-0000-000000000001'), 0,
  'email_mismatch: NENHUM profile foi criado para o ator');

-- identity_conflict: e-mail canônico já usado por outro profile (ID diferente)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa910000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g6identityconflict@test.local', now(), now(), now());
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6identityconflict@test.local', 'Identity Conflict Target', 'seller', repeat('f1', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('f1', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa910000-0000-0000-0000-000000000002');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('f1', 32)) rr)
   select not r.success and r.code = 'identity_conflict' from r),
  'e-mail canônico já pertence a OUTRO profile (fa900000-...-04) -> identity_conflict');
reset role;
select is((select status from public.invites where token_hash = repeat('f1', 32)), 'pending'::public.invite_status,
  'identity_conflict: convite permanece pending');
select is((select count(*)::int from public.profiles where id = 'fa910000-0000-0000-0000-000000000002'), 0,
  'identity_conflict: NENHUM profile foi criado para o ator (não reassocia, não apaga, não atualiza ID)');

-- ═══════════════════════════════════════════════════════════════════════
-- ACCEPT_INVITE — SUPER_ADMIN
-- ═══════════════════════════════════════════════════════════════════════

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa920000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g6.newsuper@test.local', now(), now(), now());
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', null, 'g6.newsuper@test.local', 'Novo Super Admin', 'super_admin', repeat('10', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('10', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa920000-0000-0000-0000-000000000001');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('10', 32)) rr)
   select r.success and r.code = 'ok' and r.company_id is null and r.role_kind = 'super_admin' from r),
  'SUPER_ADMIN: aceite bem-sucedido, company_id NULL, role_kind super_admin');
reset role;
select is((select platform_role from public.profiles where id = 'fa920000-0000-0000-0000-000000000001'), 'super_admin'::public.platform_role,
  'SUPER_ADMIN: profile.platform_role = super_admin');
select is((select count(*)::int from public.company_memberships where profile_id = 'fa920000-0000-0000-0000-000000000001'), 0,
  'SUPER_ADMIN: ZERO company_membership criada');
select is((select count(*)::int from public.sellers where profile_id = 'fa920000-0000-0000-0000-000000000001'), 0,
  'SUPER_ADMIN: ZERO seller criado');
select is((select status from public.invites where token_hash = repeat('10', 32)), 'accepted'::public.invite_status,
  'SUPER_ADMIN: convite marcado accepted');
select is((select accepted_profile_id from public.invites where token_hash = repeat('10', 32)), 'fa920000-0000-0000-0000-000000000001'::uuid,
  'SUPER_ADMIN: accepted_profile_id correto');

-- já é Super Admin -> already_member
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa920000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g6.jasuper@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active, platform_role)
values ('fa920000-0000-0000-0000-000000000002', null, 'Ja Super', 'g6.jasuper@test.local', 'seller', true, 'super_admin');
set local role service_role;
select ok(
  (with r as (select rr.* from public.create_invite('fa900000-0000-0000-0000-000000000003', null, 'g6.jasuper@test.local', 'Ja Super Admin Invite', 'super_admin', repeat('11', 32)) rr)
   select not r.success and r.code = 'already_member' from r),
  'já é Super Admin: create_invite() já recusa com already_member (checagem antecipada, accept_invite() nunca chega a ser exercitado neste caminho)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ACCEPT_INVITE — MANAGER
-- ═══════════════════════════════════════════════════════════════════════

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa930000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g6.newmanager@test.local', now(), now(), now());
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.newmanager@test.local', 'Novo Manager', 'manager', repeat('20', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('20', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa930000-0000-0000-0000-000000000001');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('20', 32)) rr)
   select r.success and r.code = 'ok' and r.company_id = 'fa100000-0000-0000-0000-000000000001' and r.role_kind = 'manager' from r),
  'MANAGER: aceite bem-sucedido');
reset role;
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa930000-0000-0000-0000-000000000001' and company_id = 'fa100000-0000-0000-0000-000000000001' and role = 'manager' and is_active),
  1, 'MANAGER: membership ativa criada com role=manager');
select is((select count(*)::int from public.sellers where profile_id = 'fa930000-0000-0000-0000-000000000001'), 0,
  'MANAGER: ZERO seller criado');

-- membership ativa na MESMA empresa -> already_member
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa930000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g6.jamembro@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa930000-0000-0000-0000-000000000002', 'fa100000-0000-0000-0000-000000000001', 'Ja Membro', 'g6.jamembro@test.local', 'manager', true);
insert into public.company_memberships (company_id, profile_id, role, is_active) values ('fa100000-0000-0000-0000-000000000001', 'fa930000-0000-0000-0000-000000000002', 'manager', true);
set local role service_role;
select ok(
  (with r as (select rr.* from public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.jamembro@test.local', 'Ja Membro Invite', 'manager', repeat('21', 32)) rr)
   select not r.success and r.code = 'already_member' from r),
  'já é membro ativo da mesma empresa: create_invite() já recusa com already_member (checagem antecipada)');
reset role;

-- membership INATIVA na MESMA empresa -> membership_conflict (nunca
-- reativada automaticamente) — simulado inserindo a membership inativa
-- DEPOIS do convite já criado, para não colidir com o already_member de
-- create_invite() (que também nega qualquer membership pré-existente,
-- ativa ou não — este cenário testa o accept_invite() diretamente via
-- criação simulada de uma linha órfã não coberta por create_invite())
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa930000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'g6.inativomesma@test.local', now(), now(), now());
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.inativomesma@test.local', 'Inativo Mesma Empresa', 'manager', repeat('22', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('22', 32)), true, null);
reset role;
-- injeta a membership inativa na mesma empresa DEPOIS do create_invite
-- (simula um estado histórico pré-existente que create_invite não viu
-- porque não existia no momento da criação do convite)
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa930000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'Inativo Mesma', 'g6.inativomesma@test.local', 'manager', true);
insert into public.company_memberships (company_id, profile_id, role, is_active) values ('fa100000-0000-0000-0000-000000000001', 'fa930000-0000-0000-0000-000000000003', 'manager', false);
set local role authenticated;
select pg_temp.as_user('fa930000-0000-0000-0000-000000000003');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('22', 32)) rr)
   select not r.success and r.code = 'membership_conflict' from r),
  'MANAGER: membership INATIVA na mesma empresa -> membership_conflict (nunca reativada automaticamente)');
reset role;
select is(
  (select is_active from public.company_memberships where profile_id = 'fa930000-0000-0000-0000-000000000003' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  false, 'a membership inativa continua inativa — nenhuma reativação automática ocorreu');
select is((select status from public.invites where token_hash = repeat('22', 32)), 'pending'::public.invite_status,
  'MANAGER membership_conflict: convite permanece pending');

-- membership ATIVA em OUTRA empresa -> membership_conflict (nunca
-- desativada/transferida)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa930000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'g6.outraempresa@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa930000-0000-0000-0000-000000000004', 'fa200000-0000-0000-0000-000000000002', 'Outra Empresa', 'g6.outraempresa@test.local', 'seller', true);
insert into public.company_memberships (company_id, profile_id, role, is_active) values ('fa200000-0000-0000-0000-000000000002', 'fa930000-0000-0000-0000-000000000004', 'seller', true);
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.outraempresa@test.local', 'Outra Empresa Invite', 'manager', repeat('23', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('23', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa930000-0000-0000-0000-000000000004');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('23', 32)) rr)
   select not r.success and r.code = 'membership_conflict' from r),
  'MANAGER: membership ATIVA em OUTRA empresa -> membership_conflict (nunca desativada/transferida automaticamente)');
reset role;
select is(
  (select is_active from public.company_memberships where profile_id = 'fa930000-0000-0000-0000-000000000004' and company_id = 'fa200000-0000-0000-0000-000000000002'),
  true, 'a membership da empresa ORIGINAL continua ativa e intacta');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa930000-0000-0000-0000-000000000004' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  0, 'nenhuma membership nova foi criada na empresa do convite');

-- empresa suspensa/cancelada (convite criado quando a empresa ainda era
-- ativa, suspensa/cancelada depois)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fa930000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'g6.empresasuspensa@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa930000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'g6.empresacancelada@test.local', now(), now(), now());
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.empresasuspensa@test.local', 'Empresa Suspensa Target', 'seller', repeat('24', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('24', 32)), true, null);
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.empresacancelada@test.local', 'Empresa Cancelada Target', 'seller', repeat('25', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('25', 32)), true, null);
reset role;
update public.companies set status = 'suspensa' where id = 'fa100000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.as_user('fa930000-0000-0000-0000-000000000005');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('24', 32)) rr)
   select not r.success and r.code = 'company_not_operational' from r),
  'empresa suspensa: accept_invite() -> company_not_operational');
reset role;
update public.companies set status = 'cancelada' where id = 'fa100000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.as_user('fa930000-0000-0000-0000-000000000006');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('25', 32)) rr)
   select not r.success and r.code = 'company_not_operational' from r),
  'empresa cancelada: accept_invite() -> company_not_operational');
reset role;
update public.companies set status = 'ativa' where id = 'fa100000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.profiles where id in ('fa930000-0000-0000-0000-000000000005', 'fa930000-0000-0000-0000-000000000006')), 0,
  'empresa não operacional: NENHUM profile foi criado em nenhum dos dois casos');

-- ═══════════════════════════════════════════════════════════════════════
-- ACCEPT_INVITE — SELLER
-- ═══════════════════════════════════════════════════════════════════════

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa940000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g6.newseller@test.local', now(), now(), now());
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000001', 'g6.newseller@test.local', 'Fulano Seller', 'seller', repeat('30', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('30', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa940000-0000-0000-0000-000000000001');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('30', 32)) rr)
   select r.success and r.code = 'ok' and r.role_kind = 'seller' from r),
  'SELLER: aceite bem-sucedido');
reset role;
select is(
  (select count(*)::int from public.profiles where id = 'fa940000-0000-0000-0000-000000000001'),
  1, 'SELLER: profile criado');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa940000-0000-0000-0000-000000000001' and role = 'seller' and is_active),
  1, 'SELLER: membership ativa criada com role=seller');
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa940000-0000-0000-0000-000000000001'),
  1, 'SELLER: linha real criada em public.sellers');
select ok(
  (select s.membership_id = cm.id
     from public.sellers s
     join public.company_memberships cm on cm.profile_id = s.profile_id and cm.company_id = s.company_id
    where s.profile_id = 'fa940000-0000-0000-0000-000000000001'),
  'SELLER: sellers.membership_id aponta EXATAMENTE para a membership criada na mesma transação');
select is(
  (select name from public.sellers where profile_id = 'fa940000-0000-0000-0000-000000000001'),
  'Fulano Seller', 'SELLER: sellers.name = invites.name');
select is(
  (select first_name from public.sellers where profile_id = 'fa940000-0000-0000-0000-000000000001'),
  'Fulano', 'SELLER: sellers.first_name derivado do primeiro nome de invites.name');

-- rollback em falha de provisionamento: convite SELLER para um profile
-- que já tem membership ativa em OUTRA empresa -> membership_conflict,
-- ZERO profile/membership/seller parcial (prova a reversão do bloco
-- único de provisionamento)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa940000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g6.sellerconflito@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa940000-0000-0000-0000-000000000002', 'fa200000-0000-0000-0000-000000000002', 'Seller Conflito', 'g6.sellerconflito@test.local', 'seller', true);
insert into public.company_memberships (company_id, profile_id, role, is_active) values ('fa200000-0000-0000-0000-000000000002', 'fa940000-0000-0000-0000-000000000002', 'seller', true);
-- convidador precisa ser Super Admin: create_invite() só pula a checagem
-- not_eligible (membership ativa em OUTRA empresa) quando o ator é
-- Super Admin (§9.3 do design) — um Manager sofreria not_eligible aqui
-- mesmo, antes de accept_invite() jamais ser exercitado.
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.sellerconflito@test.local', 'Seller Conflito Invite', 'seller', repeat('31', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('31', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa940000-0000-0000-0000-000000000002');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('31', 32)) rr)
   select not r.success and r.code = 'membership_conflict' from r),
  'SELLER com membership ativa em outra empresa: membership_conflict');
reset role;
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa940000-0000-0000-0000-000000000002' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  0, 'ROLLBACK: nenhuma membership parcial na empresa do convite');
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa940000-0000-0000-0000-000000000002' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  0, 'ROLLBACK: nenhum seller parcial criado na empresa do convite');
select is((select status from public.invites where token_hash = repeat('31', 32)), 'pending'::public.invite_status,
  'ROLLBACK: convite permanece pending');

-- ═══════════════════════════════════════════════════════════════════════
-- SELLER HISTÓRICO ENTRE EMPRESAS (correção pós-auditoria S4-C1.1 —
-- comprovado empiricamente antes desta correção: um Seller órfão em
-- OUTRA empresa, com membership_id NULL e zero company_membership
-- correspondente, não bloqueava nada — o aceite criava uma SEGUNDA linha
-- em sellers para o mesmo profile, uma órfã e uma válida)
-- ═══════════════════════════════════════════════════════════════════════

-- Seller órfão na MESMA empresa do convite -> provisioning_failed (já
-- coberto acima na seção SELLER, repetido aqui só para o vocabulário
-- exato desta subetapa)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa960000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g6.orfaomesmaempresa@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa960000-0000-0000-0000-000000000001', 'fa200000-0000-0000-0000-000000000002', 'Orfao Mesma Empresa', 'g6.orfaomesmaempresa@test.local', 'seller', true);
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active)
values (gen_random_uuid()::text, 'fa100000-0000-0000-0000-000000000001', null, 'fa960000-0000-0000-0000-000000000001', 'Orfao Mesma Empresa', 'Orfao', true);
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.orfaomesmaempresa@test.local', 'Orfao Mesma Empresa Invite', 'seller', repeat('45', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('45', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa960000-0000-0000-0000-000000000001');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('45', 32)) rr)
   select not r.success and r.code = 'provisioning_failed' from r),
  'Seller órfão na MESMA empresa do convite -> provisioning_failed');
reset role;
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa960000-0000-0000-0000-000000000001' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  1, 'continua exatamente 1 linha em sellers na empresa do convite — nenhuma segunda linha');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa960000-0000-0000-0000-000000000001'),
  0, 'ROLLBACK: nenhuma membership criada');
select is((select status from public.invites where token_hash = repeat('45', 32)), 'pending'::public.invite_status,
  'provisioning_failed: convite permanece pending');

-- Seller órfão em OUTRA empresa (membership_id NULL) -> provisioning_failed
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa960000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g6.orfaooutraempresa@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa960000-0000-0000-0000-000000000002', 'fa100000-0000-0000-0000-000000000001', 'Orfao Outra Empresa', 'g6.orfaooutraempresa@test.local', 'seller', true);
-- seller antigo em H1 (fa100000...), membership_id NULL, ZERO
-- company_memberships correspondente — profile NÃO tem nenhuma membership
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active)
values (gen_random_uuid()::text, 'fa100000-0000-0000-0000-000000000001', null, 'fa960000-0000-0000-0000-000000000002', 'Orfao Outra Empresa', 'Orfao', true);
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa200000-0000-0000-0000-000000000002', 'g6.orfaooutraempresa@test.local', 'Orfao Outra Empresa Invite', 'seller', repeat('46', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('46', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa960000-0000-0000-0000-000000000002');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('46', 32)) rr)
   select not r.success and r.code = 'provisioning_failed' from r),
  'Seller órfão em OUTRA empresa (membership_id NULL) -> provisioning_failed (nunca reutilizado/atualizado)');
reset role;
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa960000-0000-0000-0000-000000000002' and company_id = 'fa200000-0000-0000-0000-000000000002'),
  0, 'ZERO seller criado na empresa do convite');
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa960000-0000-0000-0000-000000000002'),
  1, 'continua exatamente 1 linha em sellers no total (a órfã original, intocada)');
select ok(
  (select membership_id is null from public.sellers where profile_id = 'fa960000-0000-0000-0000-000000000002' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  'o seller órfão original permanece com membership_id NULL — nenhuma reassociação/atualização automática');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa960000-0000-0000-0000-000000000002'),
  0, 'ROLLBACK: nenhuma membership criada');
select is((select status from public.invites where token_hash = repeat('46', 32)), 'pending'::public.invite_status,
  'provisioning_failed: convite permanece pending');

-- Seller de OUTRA empresa ligado a membership HISTÓRICA INATIVA e
-- CONSISTENTE -> aceite permitido (histórico válido, nunca bloqueia)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa960000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'g6.historicovalido@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa960000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'Historico Valido', 'g6.historicovalido@test.local', 'seller', true);
-- membership histórica INATIVA e CONSISTENTE (profile_id/company_id/role
-- batem exatamente com a linha sellers abaixo) — identificada depois por
-- subselect (profile_id, company_id, role) é única por
-- company_memberships_company_id_profile_id_key, não precisa de RETURNING.
insert into public.company_memberships (company_id, profile_id, role, is_active)
values ('fa100000-0000-0000-0000-000000000001', 'fa960000-0000-0000-0000-000000000003', 'seller', false);
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active)
values (
  gen_random_uuid()::text,
  'fa100000-0000-0000-0000-000000000001',
  (select id from public.company_memberships where profile_id = 'fa960000-0000-0000-0000-000000000003' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  'fa960000-0000-0000-0000-000000000003',
  'Historico Valido',
  'Historico',
  false
);

set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa200000-0000-0000-0000-000000000002', 'g6.historicovalido@test.local', 'Historico Valido Invite', 'seller', repeat('47', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('47', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa960000-0000-0000-0000-000000000003');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('47', 32)) rr)
   select r.success and r.code = 'ok' and r.role_kind = 'seller' from r),
  'Seller de OUTRA empresa ligado a membership HISTÓRICA INATIVA e CONSISTENTE -> aceite PERMITIDO (histórico válido nunca bloqueia)');
reset role;
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa960000-0000-0000-0000-000000000003' and company_id = 'fa200000-0000-0000-0000-000000000002'),
  1, 'novo seller criado, pertence SOMENTE à empresa do convite');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa960000-0000-0000-0000-000000000003' and company_id = 'fa200000-0000-0000-0000-000000000002' and role = 'seller' and is_active),
  1, 'nova membership ativa criada na empresa do convite');
select ok(
  (select not is_active from public.company_memberships where profile_id = 'fa960000-0000-0000-0000-000000000003' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  'a membership HISTÓRICA continua INATIVA e intocada — nenhuma reativação');
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa960000-0000-0000-0000-000000000003' and company_id = 'fa100000-0000-0000-0000-000000000001' and is_active = false),
  1, 'o Seller HISTÓRICO continua intacto (mesma linha, ainda inativo) — nunca reutilizado/atualizado/excluído');
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa960000-0000-0000-0000-000000000003'),
  2, 'total de 2 linhas em sellers para este profile: a histórica (H1, intocada) + a nova (empresa do convite)');

-- NOTA: membership ATIVA em outra empresa -> membership_conflict já está
-- coberto pela seção SELLER acima ("SELLER com membership ativa em outra
-- empresa", token repeat('31',32)) — não repetido aqui.


-- — 2 vulnerabilidades reais comprovadas empiricamente e corrigidas antes
-- deste teste: um Super Admin conseguia acumular company_membership real
-- aceitando convite de manager/seller; um Manager/Seller ativo conseguia
-- acumular platform_role='super_admin' mantendo a membership operacional
-- intacta — as duas violam a regra congelada "nunca operar
-- simultaneamente como Super Admin global e membro ativo de empresa")
-- ═══════════════════════════════════════════════════════════════════════

-- Super Admin aceitando convite de MANAGER (mesma empresa em que ele
-- próprio já é Super Admin, ou qualquer outra) -> invalid_relationship
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa950000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g6.superparamanager@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active, platform_role)
values ('fa950000-0000-0000-0000-000000000001', null, 'Super Virando Manager', 'g6.superparamanager@test.local', 'seller', true, 'super_admin');
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.superparamanager@test.local', 'Super Para Manager Invite', 'manager', repeat('40', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('40', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa950000-0000-0000-0000-000000000001');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('40', 32)) rr)
   select not r.success and r.code = 'invalid_relationship' from r),
  'Super Admin aceitando convite de MANAGER -> invalid_relationship (nunca acumula membership operacional)');
reset role;
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa950000-0000-0000-0000-000000000001'),
  0, 'Super Admin continua SEM nenhuma company_membership após a tentativa negada');
select is((select status from public.invites where token_hash = repeat('40', 32)), 'pending'::public.invite_status,
  'invalid_relationship: convite permanece pending');
select ok(
  (select count(*)::int from public.audit_log where action = 'invite_accepted' and result = 'failure' and reason = 'invalid_relationship') > 0,
  'invalid_relationship foi auditada (result=failure)');

-- Super Admin aceitando convite de SELLER -> mesmo código
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa950000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g6.superparaseller@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active, platform_role)
values ('fa950000-0000-0000-0000-000000000002', null, 'Super Virando Seller', 'g6.superparaseller@test.local', 'seller', true, 'super_admin');
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'g6.superparaseller@test.local', 'Super Para Seller Invite', 'seller', repeat('41', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('41', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa950000-0000-0000-0000-000000000002');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('41', 32)) rr)
   select not r.success and r.code = 'invalid_relationship' from r),
  'Super Admin aceitando convite de SELLER -> invalid_relationship');
reset role;
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa950000-0000-0000-0000-000000000002'),
  0, 'Super Admin continua SEM nenhum seller após a tentativa negada');

-- Manager ativo aceitando convite de SUPER_ADMIN -> membership_conflict,
-- membership original intacta, platform_role NUNCA atribuído
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa950000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'g6.managerparasuper@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa950000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000001', 'Manager Virando Super', 'g6.managerparasuper@test.local', 'manager', true);
insert into public.company_memberships (company_id, profile_id, role, is_active) values ('fa100000-0000-0000-0000-000000000001', 'fa950000-0000-0000-0000-000000000003', 'manager', true);
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', null, 'g6.managerparasuper@test.local', 'Manager Para Super Invite', 'super_admin', repeat('42', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('42', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa950000-0000-0000-0000-000000000003');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('42', 32)) rr)
   select not r.success and r.code = 'membership_conflict' from r),
  'Manager ATIVO aceitando convite de SUPER_ADMIN -> membership_conflict (nunca acumula platform_role mantendo a membership)');
reset role;
select is(
  (select platform_role from public.profiles where id = 'fa950000-0000-0000-0000-000000000003'),
  null::public.platform_role, 'platform_role NUNCA foi atribuído');
select is(
  (select is_active from public.company_memberships where profile_id = 'fa950000-0000-0000-0000-000000000003' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  true, 'a membership de MANAGER original continua ativa e intacta — nenhuma desativação automática');

-- membership HISTÓRICA INATIVA nunca bloqueia convite de Super Admin
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa950000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'g6.historicoinativosuper@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa950000-0000-0000-0000-000000000004', 'fa100000-0000-0000-0000-000000000001', 'Historico Inativo Super', 'g6.historicoinativosuper@test.local', 'seller', true);
insert into public.company_memberships (company_id, profile_id, role, is_active) values ('fa100000-0000-0000-0000-000000000001', 'fa950000-0000-0000-0000-000000000004', 'seller', false);
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', null, 'g6.historicoinativosuper@test.local', 'Historico Inativo Super Invite', 'super_admin', repeat('43', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('43', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa950000-0000-0000-0000-000000000004');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('43', 32)) rr)
   select r.success and r.code = 'ok' and r.role_kind = 'super_admin' from r),
  'membership HISTÓRICA INATIVA não bloqueia aceite de convite Super Admin (histórico preservado, não é vínculo operacional atual)');
reset role;
select is(
  (select platform_role from public.profiles where id = 'fa950000-0000-0000-0000-000000000004'),
  'super_admin'::public.platform_role, 'platform_role foi corretamente atribuído');
select is(
  (select is_active from public.company_memberships where profile_id = 'fa950000-0000-0000-0000-000000000004' and company_id = 'fa100000-0000-0000-0000-000000000001'),
  false, 'a membership histórica continua INTOCADA (ainda inativa) — nenhuma reativação, nenhuma alteração');

-- PLATFORM_ROLE LEGADO: o enum platform_role tem EXATAMENTE 1 valor
-- possível não-nulo ('super_admin') — não existe "outro papel de
-- plataforma" para ambiguidade nenhuma (confirmado no schema real, não
-- por suposição).
select enum_has_labels('public'::name, 'platform_role'::name, array['super_admin'],
  'platform_role tem EXATAMENTE 1 valor possível — nenhum "legado" diferente de super_admin é estruturalmente possível');

-- SELLER: linha órfã pré-existente em public.sellers para o MESMO
-- profile+empresa (profile_id setado, sem membership_id, sem nenhuma
-- company_memberships correspondente — create_invite() nunca vê
-- public.sellers, só company_memberships) -> provisioning_failed, nunca
-- reutiliza/atualiza automaticamente a linha antiga
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'fa950000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'g6.sellerorfao@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values ('fa950000-0000-0000-0000-000000000005', 'fa200000-0000-0000-0000-000000000002', 'Seller Orfao', 'g6.sellerorfao@test.local', 'seller', true);
insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active)
values (gen_random_uuid()::text, 'fa200000-0000-0000-0000-000000000002', null, 'fa950000-0000-0000-0000-000000000005', 'Seller Orfao', 'Seller', true);
set local role service_role;
select public.create_invite('fa900000-0000-0000-0000-000000000003', 'fa200000-0000-0000-0000-000000000002', 'g6.sellerorfao@test.local', 'Seller Orfao Invite', 'seller', repeat('44', 32));
select public.complete_invite_delivery('fa900000-0000-0000-0000-000000000003', (select id from public.invites where token_hash = repeat('44', 32)), true, null);
reset role;
set local role authenticated;
select pg_temp.as_user('fa950000-0000-0000-0000-000000000005');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('44', 32)) rr)
   select not r.success and r.code = 'provisioning_failed' from r),
  'SELLER com linha órfã pré-existente em public.sellers (mesmo profile+empresa) -> provisioning_failed, nunca reutiliza automaticamente');
reset role;
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa950000-0000-0000-0000-000000000005' and company_id = 'fa200000-0000-0000-0000-000000000002'),
  1, 'continua exatamente 1 linha em sellers para este profile+empresa — NENHUMA segunda linha foi criada');
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'fa950000-0000-0000-0000-000000000005'),
  0, 'nenhuma membership foi criada (rollback completo)');
select is((select status from public.invites where token_hash = repeat('44', 32)), 'pending'::public.invite_status,
  'provisioning_failed: convite permanece pending');

-- ═══════════════════════════════════════════════════════════════════════
-- CONCORRÊNCIA ESTRUTURAL / USO ÚNICO
-- ═══════════════════════════════════════════════════════════════════════

-- segunda chamada (mesmo ator, mesmo token, convite já accepted)
set local role authenticated;
select pg_temp.as_user('fa940000-0000-0000-0000-000000000001');
select ok(
  (with r as (select rr.* from public.accept_invite(repeat('30', 32)) rr)
   select not r.success and r.code = 'invite_already_used' from r),
  'segunda chamada de accept_invite() para um convite já aceito -> invite_already_used (idempotente, nunca duplica provisionamento)');
reset role;
select is(
  (select count(*)::int from public.sellers where profile_id = 'fa940000-0000-0000-0000-000000000001'),
  1, 'segunda chamada NÃO duplicou o seller — continua exatamente 1');

-- NOTA DE HONESTIDADE ESTRUTURAL: pgTAP roda cada arquivo de teste como
-- uma ÚNICA conexão/transação — é estruturalmente impossível simular
-- duas conexões concorrentes de verdade aqui (mesma limitação já
-- documentada e aceita em resend_invite()/cancel_invite()/reserve_invite_
-- rate_limit() nas etapas anteriores). O que ESTE teste prova
-- (sequencialmente, não concorrentemente) é que o SELECT ... FOR UPDATE
-- e o WHERE status='pending' defensivo do UPDATE final tornam uma
-- segunda tentativa SEQUENCIAL sempre seguramente rejeitada — a garantia
-- sob concorrência REAL vem do mecanismo em si (lock de linha do
-- Postgres), não deste teste. "Duas abas" e "cancel/resend concorrente"
-- resultam estruturalmente no mesmo caminho: quem chega depois do lock
-- (ou depois da coluna status já ter mudado) encontra um estado
-- diferente de 'pending' e é negado com o código apropriado — provado
-- acima pela segunda chamada sequencial e pelos testes de canceled/
-- superseded/accepted já cobertos em VALIDATE_INVITE_TOKEN.

-- ═══════════════════════════════════════════════════════════════════════
-- AUDITORIA
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.audit_log
    where action = 'invite_accepted' and result = 'success'
      and entity_id = (select id from public.invites where token_hash = repeat('30', 32))::text),
  1, 'exatamente 1 entrada invite_accepted/success para o aceite bem-sucedido do SELLER');
select ok(
  (select (after_data->>'membership_created')::boolean and (after_data->>'seller_created')::boolean
     from public.audit_log
    where action = 'invite_accepted' and result = 'success'
      and entity_id = (select id from public.invites where token_hash = repeat('30', 32))::text),
  'after_data contém membership_created=true e seller_created=true para o SELLER');
select ok(
  (select not (after_data->>'membership_created')::boolean and not (after_data->>'seller_created')::boolean
     from public.audit_log
    where action = 'invite_accepted' and result = 'success'
      and entity_id = (select id from public.invites where token_hash = repeat('10', 32))::text),
  'after_data contém membership_created=false e seller_created=false para o SUPER_ADMIN');

select ok(
  (select count(*)::int from public.audit_log where action = 'invite_accepted' and result = 'failure' and reason = 'email_mismatch') > 0,
  'falha de domínio email_mismatch foi auditada (result=failure)');
select ok(
  (select count(*)::int from public.audit_log where action = 'invite_accepted' and result = 'failure' and reason = 'membership_conflict') > 0,
  'falha de domínio membership_conflict foi auditada (result=failure)');
select ok(
  (select count(*)::int from public.audit_log where action = 'invite_accepted' and result = 'failure' and reason = 'identity_conflict') > 0,
  'falha de domínio identity_conflict foi auditada (result=failure)');

-- nunca token/hash/senha/sessão/e-mail em before_data/after_data
select is(
  (select count(*)::int from public.audit_log
    where action = 'invite_accepted'
      and (before_data::text ilike '%token%' or after_data::text ilike '%token%'
        or before_data::text ilike '%' || repeat('30', 4) || '%' or after_data::text ilike '%' || repeat('30', 4) || '%')),
  0, 'nenhum before_data/after_data de invite_accepted contém "token" ou fragmento de hash sintético');
select is(
  (select count(*)::int from public.audit_log
    where action = 'invite_accepted'
      and (before_data::text ilike '%password%' or after_data::text ilike '%password%'
        or before_data::text ilike '%session%' or after_data::text ilike '%session%'
        or before_data::text ilike '%jwt%' or after_data::text ilike '%jwt%'
        or before_data::text ilike '%@test.local%' or after_data::text ilike '%@test.local%')),
  0, 'nenhum before_data/after_data de invite_accepted contém senha, sessão, JWT ou e-mail');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_invite', 'resend_invite', 'cancel_invite',
      'complete_invite_delivery', 'complete_invite_resend_delivery', 'reserve_invite_rate_limit',
      'reserve_create_invite_rate_limit', 'reserve_resend_invite_rate_limit',
      'validate_invite_token', 'accept_invite', 'reserve_invite_validation_rate_limit')),
  11, 'exatamente as 11 RPCs de convite esperadas existem (8 anteriores + as 3 novas desta etapa), sem duplicata');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'policy de leads inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'invites'),
  1, 'policy de invites inalterada (1 policy, SELECT do S4-A1)');

-- runtime legado continua operando leads normalmente
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S4C1 Compat Teste', '(11) 90000-9999', 'Kicks')).id$$,
  'SELLER legado (usuário seedado) ainda cria lead normalmente após o S4-C1');
reset role;

select * from finish();
rollback;
