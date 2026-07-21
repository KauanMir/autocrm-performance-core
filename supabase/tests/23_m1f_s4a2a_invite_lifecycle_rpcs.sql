-- M1-F S4-A2A — testes das RPCs de ciclo de vida de convites (pgTAP):
-- create_invite()/resend_invite()/cancel_invite(). Nenhum token bruto,
-- Route Handler, Supabase Auth ou usuário real é usado — tudo com
-- token_hash sintético (hex de 64 chars) e fixtures de rollback, mesmo
-- padrão de 16/17/20/21/22. Roda como postgres (fixtures), service_role
-- (create/resend) e authenticated/anon (ACL negativa e cancel). Rollback
-- ao final — nada persiste.
--
-- Convenção desta suíte (as 3 RPCs são VOLATILE, cada chamada tem efeito
-- colateral real): NUNCA se invoca a mesma chamada duas vezes para
-- verificar campos diferentes do retorno (duplicaria a escrita e quebraria
-- duplicate_pending/token_conflict). Cada token_hash sintético é usado
-- exatamente uma vez em todo o arquivo. IDs de convites já criados são
-- recuperados por token_hash (leitura direta como postgres, mesmo padrão
-- já usado no teste 22), nunca por \gset. Quando mais de um campo do
-- MESMO retorno precisa ser checado, usa-se uma única chamada dentro de
-- uma CTE, combinada num único booleano via ok() — nunca comparação de
-- tupla (a,b,c), para não depender de coerção de tipo implícita entre
-- invite_status e text.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ─────────────────────────────────────────────────────────────
insert into public.companies (id, name, status) values
  ('d1000000-0000-0000-0000-000000000001', 'Empresa Alpha', 'ativa'),
  ('d2000000-0000-0000-0000-000000000002', 'Empresa Beta',  'ativa'),
  ('d3000000-0000-0000-0000-000000000003', 'Empresa Gamma', 'implantacao'),
  ('d4000000-0000-0000-0000-000000000004', 'Empresa Susp',  'suspensa'),
  ('d5000000-0000-0000-0000-000000000005', 'Empresa Canc',  'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'd9manageralpha@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'd9managerbeta@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'd9selleralpha@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'd9superadmin@test.local',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'd9adminlegado@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'd9inativo@test.local',      now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'd9membroinativo@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'd9membrobeta@test.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'd9superexistente@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'd9managergamma@test.local',  now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Manager Alpha',    'd9manageralpha@test.local',   'manager', true),
  ('d9000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'Manager Beta',     'd9managerbeta@test.local',    'manager', true),
  ('d9000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 'Seller Alpha',     'd9selleralpha@test.local',    'seller',  true),
  ('d9000000-0000-0000-0000-000000000004', null,                                   'Super Admin (fx)', 'd9superadmin@test.local',     'seller',  true),
  ('d9000000-0000-0000-0000-000000000005', null,                                   'Admin Legado',     'd9adminlegado@test.local',    'admin',   true),
  ('d9000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000001', 'Inativo',          'd9inativo@test.local',        'manager', false),
  ('d9000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000001', 'Membro Inativo',   'd9membroinativo@test.local',  'seller',  true),
  ('d9000000-0000-0000-0000-000000000008', 'd2000000-0000-0000-0000-000000000002', 'Membro Beta',      'd9membrobeta@test.local',     'seller',  true),
  ('d9000000-0000-0000-0000-000000000009', null,                                   'Super Existente',  'd9superexistente@test.local', 'seller',  true),
  ('d9000000-0000-0000-0000-000000000010', 'd1000000-0000-0000-0000-000000000001', 'Manager Gamma',    'd9managergamma@test.local',   'manager', true);

update public.profiles set platform_role = 'super_admin' where id in
  ('d9000000-0000-0000-0000-000000000004', 'd9000000-0000-0000-0000-000000000009');

-- Admin Legado (d9...005) PROPOSITALMENTE não recebe nenhuma linha de
-- company_memberships — prova que create_invite()/resend_invite()/
-- cancel_invite() nunca leem profiles.role='admin' como fonte de
-- autoridade (coluna legada/deprecated, §5.2 do design). O ADMIN legado
-- REAL do backfill (m1f_s1_02) ganha uma membership de manager de
-- verdade e, para estas RPCs, é indistinguível de um Manager legítimo —
-- por isso este fixture isola exatamente o caso "só a coluna legada, sem
-- membership real", que é o caso que deve ser negado.
insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('d1000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001', 'manager', true),
  ('d2000000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-000000000002', 'manager', true),
  ('d1000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000003', 'seller',  true),
  ('d1000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000007', 'seller',  false),
  ('d2000000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-000000000008', 'seller',  true),
  ('d1000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000010', 'manager', true);

-- ═══════════════════════════════════════════════════════════════════════
-- ACL — nenhuma função pode depender de "service_role ignora GRANT"
-- ═══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'create_invite'::name,
  array['uuid','uuid','text','text','invite_role_kind','text']::name[], 'create_invite() existe com a assinatura exata');
select has_function('public'::name, 'resend_invite'::name,
  array['uuid','uuid','text']::name[], 'resend_invite() existe com a assinatura exata');
select has_function('public'::name, 'cancel_invite'::name,
  array['uuid']::name[], 'cancel_invite() existe com a assinatura exata');

-- service_role TEM BYPASSRLS — isso é ortogonal a EXECUTE. Provado abaixo
-- que o GRANT explícito é necessário (a revogação temporária derruba a
-- chamada mesmo para service_role).
select is(
  (select rolbypassrls from pg_roles where rolname = 'service_role'),
  true, 'service_role possui BYPASSRLS (fato à parte, não relacionado a EXECUTE)');

select is(has_function_privilege('service_role', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), true,
  'service_role tem EXECUTE explícito em create_invite()');
select is(has_function_privilege('authenticated', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em create_invite()');
select is(has_function_privilege('anon', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em create_invite()');
select is(has_function_privilege('public', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em create_invite()');

select is(has_function_privilege('service_role', 'public.resend_invite(uuid,uuid,text)', 'EXECUTE'), true,
  'service_role tem EXECUTE explícito em resend_invite()');
select is(has_function_privilege('authenticated', 'public.resend_invite(uuid,uuid,text)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em resend_invite()');
select is(has_function_privilege('anon', 'public.resend_invite(uuid,uuid,text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em resend_invite()');
select is(has_function_privilege('public', 'public.resend_invite(uuid,uuid,text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em resend_invite()');

select is(has_function_privilege('authenticated', 'public.cancel_invite(uuid)', 'EXECUTE'), true,
  'authenticated tem EXECUTE em cancel_invite()');
select is(has_function_privilege('anon', 'public.cancel_invite(uuid)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em cancel_invite()');
select is(has_function_privilege('public', 'public.cancel_invite(uuid)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em cancel_invite()');
select is(has_function_privilege('service_role', 'public.cancel_invite(uuid)', 'EXECUTE'), false,
  'service_role NÃO tem EXECUTE em cancel_invite() (nunca precisou ser concedido — RPC pública comum)');

-- Prova empírica de que EXECUTE de service_role NÃO é implícito: revoga,
-- confirma falha mesmo com BYPASSRLS ativo, regrava o GRANT original.
revoke execute on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) from service_role;
set local role service_role;
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'semgrant@exemplo.com', 'Sem Grant', 'seller'::public.invite_role_kind, repeat('a', 64))$$,
  '42501', null, 'service_role SEM o GRANT explícito falha ao chamar create_invite() — BYPASSRLS não substitui EXECUTE');
reset role;
grant execute on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) to service_role;
select is(has_function_privilege('service_role', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), true,
  'GRANT EXECUTE de create_invite() para service_role restaurado após a prova');
select is(
  (select count(*)::int from public.invites where email = 'semgrant@exemplo.com'),
  0, 'a tentativa sem grant não criou nenhuma linha (a exceção ocorreu antes de qualquer escrita, no nível de ACL do Postgres)');

-- Manager usando PostgREST/JWT comum (authenticated) não executa direto
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'diretomanager@exemplo.com', 'X', 'seller'::public.invite_role_kind, repeat('a1', 32))$$,
  '42501', null, 'Manager via JWT comum (authenticated) não executa create_invite() diretamente');
reset role;

-- Super Admin usando JWT comum também não executa direto
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000004'::uuid, null, 'diretosuper@exemplo.com', 'Y', 'super_admin'::public.invite_role_kind, repeat('a2', 32))$$,
  '42501', null, 'Super Admin via JWT comum (authenticated) não executa create_invite() diretamente');
reset role;

-- anon nunca executa nenhuma das três
set local role anon;
select throws_ok(
  $$select * from public.create_invite(null, null, 'diretoanon@exemplo.com', 'Z', 'seller'::public.invite_role_kind, repeat('a3', 32))$$,
  '42501', null, 'anon não executa create_invite()');
select throws_ok(
  $$select * from public.resend_invite(null, gen_random_uuid(), repeat('a4', 32))$$,
  '42501', null, 'anon não executa resend_invite()');
select throws_ok(
  $$select * from public.cancel_invite(gen_random_uuid())$$,
  '42501', null, 'anon não executa cancel_invite()');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- CREATE_INVITE
-- ═══════════════════════════════════════════════════════════════════════

set local role service_role;

-- Super Admin cria Manager em empresa ativa
select public.create_invite('d9000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'novomanager@exemplo.com', 'Novo Manager', 'manager', repeat('1', 64));
-- Super Admin cria Seller em empresa em implantação
select public.create_invite('d9000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000003', 'sellergamma@exemplo.com', 'Seller Gamma', 'seller', repeat('2', 64));
-- Super Admin cria convite de plataforma (company_id null)
select public.create_invite('d9000000-0000-0000-0000-000000000004', null, 'novosuperadmin@exemplo.com', 'Novo Super', 'super_admin', repeat('3', 64));
-- Manager cria Seller na própria empresa
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'sellernovo@exemplo.com', 'Seller Novo', 'seller', repeat('6', 64));

reset role;

select is((select count(*)::int from public.invites where token_hash = repeat('1', 64) and status = 'pending'), 1,
  'Super Admin cria convite de Manager em empresa ativa (linha pending existe)');
select is((select count(*)::int from public.invites where token_hash = repeat('2', 64) and status = 'pending'), 1,
  'Super Admin cria convite de Seller em empresa em implantação');
select ok(
  (select company_id is null and role_kind = 'super_admin' and status = 'pending' from public.invites where token_hash = repeat('3', 64)),
  'Super Admin cria convite de plataforma (company_id null) com sucesso');
select is((select invited_by_profile_id from public.invites where token_hash = repeat('6', 64)),
  'd9000000-0000-0000-0000-000000000001', 'convite de Manager Alpha registra invited_by_profile_id correto');

-- Super Admin bloqueado em empresa suspensa/cancelada
set local role service_role;
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000004', 'd4000000-0000-0000-0000-000000000004', 'susp@exemplo.com', 'Susp', 'manager', repeat('4', 64)))
   select not r.success and r.code = 'company_not_operational' from r),
  'Super Admin é bloqueado ao tentar convite empresarial em empresa suspensa (can_access_company sozinha permitiria; checagem extra nega)');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000004', 'd5000000-0000-0000-0000-000000000005', 'canc@exemplo.com', 'Canc', 'seller', repeat('5', 64)))
   select not r.success and r.code = 'company_not_operational' from r),
  'Super Admin é bloqueado ao tentar convite empresarial em empresa cancelada');
reset role;

-- Manager não cria Manager/Super Admin/outra empresa; Seller/ADMIN
-- legado/inativo/inexistente negados (forbidden, via service_role com
-- p_actor_profile_id — prova que a autorização é revalidada no banco,
-- nunca confiada do chamador)
set local role service_role;
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'outromanager@exemplo.com', 'Outro Manager', 'manager'::public.invite_role_kind, repeat('a5', 32))$$,
  '42501', null, 'Manager não cria convite de role_kind=manager (forbidden, revalidado no banco)');
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000001'::uuid, null, 'outrosuper@exemplo.com', 'Outro Super', 'super_admin'::public.invite_role_kind, repeat('a6', 32))$$,
  '42501', null, 'Manager não cria convite de role_kind=super_admin (forbidden)');
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000001'::uuid, 'd2000000-0000-0000-0000-000000000002'::uuid, 'outroempresa@exemplo.com', 'Outra Empresa', 'seller'::public.invite_role_kind, repeat('a7', 32))$$,
  '42501', null, 'Manager Alpha não escolhe a empresa Beta (não é a própria membership)');
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000003'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'sellertenta@exemplo.com', 'Seller Tenta', 'seller'::public.invite_role_kind, repeat('a8', 32))$$,
  '42501', null, 'Seller (ator) é negado — nenhuma capacidade administrativa');
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000005'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'admintenta@exemplo.com', 'Admin Tenta', 'seller'::public.invite_role_kind, repeat('a9', 32))$$,
  '42501', null, 'ADMIN legado SEM membership de manager real é negado (profiles.role nunca é lido como autoridade)');
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000006'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'inativotenta@exemplo.com', 'Inativo Tenta', 'seller'::public.invite_role_kind, repeat('aa', 32))$$,
  '42501', null, 'Profile inativo (mesmo com membership de manager) é negado');
select throws_ok(
  $$select * from public.create_invite('99999999-9999-9999-9999-999999999999'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'fantasma@exemplo.com', 'Fantasma', 'seller'::public.invite_role_kind, repeat('ab', 32))$$,
  '42501', null, 'Ator inexistente é negado');
reset role;

select is((select count(*)::int from public.invites where email in
  ('outromanager@exemplo.com','outrosuper@exemplo.com','outroempresa@exemplo.com','sellertenta@exemplo.com','admintenta@exemplo.com','inativotenta@exemplo.com','fantasma@exemplo.com')),
  0, 'nenhuma das 7 tentativas forbidden acima criou qualquer linha em invites');

-- validações de entrada
set local role service_role;
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'seminvite@exemplo.com', '   ', 'seller', repeat('ac', 32)))
   select not r.success and r.code = 'invalid_input' from r),
  'nome em branco -> invalid_input');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', '   ', 'Nome Ok', 'seller', repeat('ad', 32)))
   select not r.success and r.code = 'invalid_input' from r),
  'e-mail em branco -> invalid_input');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'hashcurto@exemplo.com', 'Hash Curto', 'seller', 'abc123'))
   select not r.success and r.code = 'invalid_token_hash' from r),
  'token_hash fora do formato ^[0-9a-f]{64}$ (curto) -> invalid_token_hash');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'hashmaiusculo@exemplo.com', 'Hash Maiusculo', 'seller', upper(repeat('a', 64))))
   select not r.success and r.code = 'invalid_token_hash' from r),
  'token_hash com letras maiúsculas -> invalid_token_hash (só hex minúsculo)');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'superindevido@exemplo.com', 'Super Indevido', 'super_admin', repeat('ae', 32)))
   select not r.success and r.code = 'invalid_role' from r),
  'role_kind=super_admin com company_id preenchido -> invalid_role (Super Admin, incoerência estrutural)');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000004', null, 'semempresa@exemplo.com', 'Sem Empresa', 'seller', repeat('af', 32)))
   select not r.success and r.code = 'invalid_role' from r),
  'role_kind=seller com company_id null -> invalid_role');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000000', 'empresafalsa@exemplo.com', 'Empresa Falsa', 'seller', repeat('b1', 32)))
   select not r.success and r.code = 'invalid_company' from r),
  'company_id inexistente -> invalid_company');
reset role;

-- pending duplicado / token duplicado (estrutural, via índices do S4-A1)
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'duplicado@exemplo.com', 'Duplicado', 'seller', repeat('b2', 32));
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'duplicado@exemplo.com', 'Duplicado 2', 'seller', repeat('b3', 32)))
   select not r.success and r.code = 'duplicate_pending' from r),
  'segundo convite PENDING para o mesmo e-mail/empresa -> duplicate_pending (prova também que uma 2a chamada nunca produz 2 pending)');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'conflitohash@exemplo.com', 'Conflito Hash', 'seller', repeat('b2', 32)))
   select not r.success and r.code = 'token_conflict' from r),
  'token_hash já usado por outro convite -> token_conflict (e-mail deliberadamente sem a palavra "token", para não colidir com a varredura de segredos da seção AUDIT_LOG abaixo — falso positivo, não vazamento real)');
reset role;
select is((select count(*)::int from public.invites where email = 'duplicado@exemplo.com'), 1,
  'apenas UM convite existe para duplicado@exemplo.com, mesmo após a tentativa de duplicidade');

-- REGRESSÃO/AUDITORIA: uma unique_violation vinda de uma constraint
-- DESCONHECIDA (nem invites_token_hash_key, nem os 2 índices parciais de
-- pending) NUNCA deve ser silenciosamente classificada como
-- duplicate_pending/token_conflict — deve propagar (RAISE) e reverter a
-- transação inteira. Índice temporário criado e removido só para esta
-- prova, sem qualquer relação com os índices reais do S4-A1.
create unique index t23_bogus_uidx on public.invites (name) where status = 'pending' and name = 'BOGUS-CONSTRAINT-PROBE';
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'bogusprobe1@exemplo.com', 'BOGUS-CONSTRAINT-PROBE', 'seller', repeat('01', 32));
select throws_ok(
  $$select * from public.create_invite('d9000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'bogusprobe2@exemplo.com', 'BOGUS-CONSTRAINT-PROBE', 'seller'::public.invite_role_kind, repeat('02', 32))$$,
  '23505', null, 'unique_violation de uma constraint DESCONHECIDA propaga como erro real (RAISE), nunca é mascarada como duplicate_pending/token_conflict — falha estrutural alta, não erro de domínio catalogado');
reset role;
drop index public.t23_bogus_uidx;
select is((select count(*)::int from public.invites where name = 'BOGUS-CONSTRAINT-PROBE'), 1,
  'a segunda tentativa (que violaria a constraint desconhecida) não deixou nenhuma linha parcial — toda a transação da RPC reverteu');

-- já-membro (ativo e inativo) e não-elegível
set local role service_role;
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'D9SellerAlpha@Test.Local', 'Ja Membro', 'seller', repeat('b4', 32)))
   select not r.success and r.code = 'already_member' from r),
  'e-mail com membership ATIVA na mesma empresa -> already_member (case-insensitive)');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd9membroinativo@test.local', 'Ja Membro Inativo', 'seller', repeat('b5', 32)))
   select not r.success and r.code = 'already_member' from r),
  'e-mail com membership INATIVA na mesma empresa -> already_member (não é reativação por convite)');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd9membrobeta@test.local', 'Membro De Beta', 'seller', repeat('b6', 32)))
   select not r.success and r.code = 'not_eligible' from r),
  'Manager Alpha convidando profile com membership ativa em OUTRA empresa (Beta) -> not_eligible genérico');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'd9membrobeta@test.local', 'Membro De Beta Via Super', 'seller', repeat('b7', 32)))
   select r.success from r),
  'Super Admin PODE criar convite para profile de outra empresa (not_eligible só se aplica a Manager; aceite futuro revalida a restrição de membership única)');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000004', null, 'd9superexistente@test.local', 'Super Ja Existente', 'super_admin', repeat('b8', 32)))
   select not r.success and r.code = 'already_member' from r),
  'convite de plataforma para profile já platform_role=super_admin -> already_member');
reset role;

-- AUDITORIA: profiles_email_idx (M1-B) é UNIQUE só em lower(email), NUNCA
-- em lower(btrim(email)) — duas linhas que diferem apenas por espaço
-- externo NÃO violam esse índice, mas normalizam para o MESMO
-- v_email_normalized usado por create_invite(). Confirma-se que a função
-- FALHA FECHADO (nunca escolhe uma das duas arbitrariamente, nunca
-- derruba a chamada) quando essa ambiguidade pré-existente (M1-B, fora
-- de escopo desta migration corrigir — nenhuma constraint nova é
-- adicionada a profiles aqui) está presente: o convite é criado
-- normalmente porque a função não consegue afirmar com segurança que o
-- e-mail já é membro, mas TAMBÉM não falha nem revela qual dos dois
-- profiles ambíguos existe.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'ambiguo.a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', ' ambiguo.a@test.local ', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('d9000000-0000-0000-0000-000000000011', 'd1000000-0000-0000-0000-000000000001', 'Ambiguo A', 'ambiguo.a@test.local', 'seller', true),
  ('d9000000-0000-0000-0000-000000000012', 'd2000000-0000-0000-0000-000000000002', 'Ambiguo B', ' ambiguo.a@test.local ', 'seller', true);
select is(
  (select count(*)::int from public.profiles where lower(btrim(email)) = 'ambiguo.a@test.local'),
  2, 'confirmado: duas linhas de profiles normalizam para o MESMO e-mail canônico (lower+btrim) sem violar profiles_email_idx (que é só lower(email), sem btrim) — ambiguidade pré-existente do M1-B, real e reproduzível');
set local role service_role;
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'ambiguo.a@test.local', 'Ambiguo Convite', 'seller', repeat('bb', 32)))
   select r.success from r),
  'e-mail canonicamente ambíguo (2 profiles diferentes normalizam igual): create_invite() FALHA FECHADO — não crasha, não escolhe um profile arbitrariamente, não bloqueia com already_member indevido (não pode afirmar com segurança que já é membro de nenhum dos dois) — prossegue e cria o convite normalmente');
reset role;

-- forma/retorno do sucesso: status, expires_at ~7 dias, invited_by
-- correto, nenhum token no retorno
set local role service_role;
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'formaok@exemplo.com', 'Forma Ok', 'seller', repeat('b9', 32)))
   select r.status = 'pending' from r),
  'status do retorno de sucesso é pending');
select ok(
  (with r as (select * from public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'setedias@exemplo.com', 'Sete Dias', 'seller', repeat('ba', 32)))
   select abs(extract(epoch from (r.expires_at - (now() + interval '7 days')))) < 5 from r),
  'expires_at do retorno está a ~7 dias de now() (tolerância de 5s)');
reset role;

select is(
  (select array(select o.parameter_name::text from information_schema.parameters o
    join information_schema.routines r on r.specific_name = o.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'create_invite' and o.parameter_mode = 'OUT'
    order by o.ordinal_position)),
  array['success','code','invite_id','status','expires_at'],
  'create_invite() retorna EXATAMENTE success/code/invite_id/status/expires_at — sem token_hash, sem e-mail, sem invited_by_profile_id, sem profile/membership/audit_log');

-- nenhuma consulta direta a auth.users em nenhuma das 3 funções (checagem
-- estrutural do corpo compilado das 3 funções)
select is(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('create_invite','resend_invite','cancel_invite')
     and pg_get_functiondef(p.oid) ilike '%auth.users%'),
  0, 'nenhuma das 3 RPCs referencia auth.users no corpo (nenhuma consulta direta à tabela gerenciada pelo GoTrue)');

-- ═══════════════════════════════════════════════════════════════════════
-- RESEND_INVITE
-- ═══════════════════════════════════════════════════════════════════════

-- Conveniência EXCLUSIVA deste arquivo de teste (dentro da transação que
-- sofre rollback ao final — nunca persiste, nunca altera o grant real de
-- produção): permite que as consultas abaixo busquem o id de um convite
-- já existente por token_hash enquanto a sessão está com
-- "set local role service_role" ativo, para poder repassar esse id como
-- p_invite_id nas chamadas de resend_invite(). service_role nunca tem
-- SELECT direto em invites fora deste teste (confirmado na seção ACL
-- acima) — a leitura real de "qual convite reenviar" no fluxo de produção
-- é responsabilidade do Route Handler (S4-B, fora de escopo aqui), que
-- lê a lista de convites como o PRÓPRIO USUÁRIO autenticado (via
-- authenticated, já coberto pela RLS existente do S4-A1), nunca via
-- service_role.
grant select on public.invites to service_role;

-- pending reenviado com sucesso, antigo superseded, invited_by preservado
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend1@exemplo.com', 'Resend Um', 'seller', repeat('c1', 32));
reset role;

set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('c1', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('c2', 32)) rr)
   select r.success and r.code = 'ok' and r.status = 'pending' and r.previous_invite_id = (select id from old) from r),
  'resend de convite pending: sucesso, novo pending, previous_invite_id correto');
reset role;

select is((select status from public.invites where token_hash = repeat('c1', 32)), 'superseded'::public.invite_status,
  'convite antigo (pending) vira superseded após resend bem-sucedido');
select is((select invited_by_profile_id from public.invites where token_hash = repeat('c2', 32)),
  'd9000000-0000-0000-0000-000000000001', 'invited_by_profile_id ORIGINAL é preservado no novo convite gerado por resend');
select is((select token_hash from public.invites where id = (select id from public.invites where token_hash = repeat('c1', 32))),
  repeat('c1', 32), 'convite antigo mantém seu próprio token_hash original (nunca reescrito no lugar)');

-- expired reenviado
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend2@exemplo.com', 'Resend Dois', 'seller', repeat('c3', 32));
reset role;
update public.invites set status = 'expired' where token_hash = repeat('c3', 32);
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('c3', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('c4', 32)) rr)
   select r.success from r),
  'resend de convite JÁ expired (materializado manualmente): sucesso');
reset role;

-- pending vencido (expires_at no passado, status ainda pending) é
-- reenviado, registrando invite_expired antes de invite_resent
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend3@exemplo.com', 'Resend Tres', 'seller', repeat('c5', 32));
reset role;
update public.invites set expires_at = now() - interval '1 hour' where token_hash = repeat('c5', 32);
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('c5', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('c6', 32)) rr)
   select r.success from r),
  'resend de convite pending VENCIDO (expires_at no passado): sucesso, materializa expired antes de reenviar');
reset role;
select is((select status from public.invites where token_hash = repeat('c5', 32)), 'superseded'::public.invite_status,
  'convite pending-vencido termina superseded (passou por expired internamente, não fica preso em expired)');
select ok(
  (select count(*)::int from public.audit_log
    where action = 'invite_expired' and entity_id = (select id from public.invites where token_hash = repeat('c5', 32))::text) > 0,
  'invite_expired foi registrado para o convite pending-vencido antes do resend');

-- canceled/superseded/accepted negados
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend4@exemplo.com', 'Resend Quatro', 'seller', repeat('c7', 32));
reset role;
update public.invites set status = 'canceled' where token_hash = repeat('c7', 32);
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('c7', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('c8', 32)) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'resend de convite canceled é negado');

select ok(
  (with r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001',
        (select id from public.invites where token_hash = repeat('c1', 32)), repeat('c9', 32)) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'resend de convite JÁ superseded (o de resend1, resendido no início desta seção) é negado');
reset role;

set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend5@exemplo.com', 'Resend Cinco', 'seller', repeat('ca', 32));
reset role;
update public.invites set status = 'accepted', accepted_at = now() where token_hash = repeat('ca', 32);
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('ca', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('cb', 32)) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'resend de convite accepted é negado');
reset role;

-- ator real registrado no audit (o Manager/Super Admin que executou o
-- resend, não necessariamente o convidador original)
-- ATUALIZAÇÃO (M1-F S4-A2A.1): resend_invite() não grava mais
-- audit_log/success sozinha (lacuna corrigida — auditava sucesso de
-- envio antes de qualquer tentativa real de entrega); essa gravação
-- passou para complete_invite_resend_delivery(), chamada aqui
-- explicitamente para preservar a garantia original deste teste (ator
-- real, não o convidador original, aparece no audit_log).
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend6@exemplo.com', 'Resend Seis', 'seller', repeat('cc', 32));
reset role;
set local role service_role;
select public.resend_invite('d9000000-0000-0000-0000-000000000004',
  (select id from public.invites where token_hash = repeat('cc', 32)), repeat('cd', 32));
reset role;
select is((select invited_by_profile_id from public.invites where token_hash = repeat('cd', 32)),
  'd9000000-0000-0000-0000-000000000001', 'mesmo com outro ator executando o resend, invited_by_profile_id do NOVO convite continua sendo o convidador ORIGINAL');
set local role service_role;
select public.complete_invite_resend_delivery(
  'd9000000-0000-0000-0000-000000000004',
  (select id from public.invites where token_hash = repeat('cd', 32)),
  (select id from public.invites where token_hash = repeat('cc', 32)),
  true, null);
reset role;
select is(
  (select actor_profile_id from public.audit_log
    where action = 'invite_resent' and result = 'success'
      and entity_id = (select id from public.invites where token_hash = repeat('cd', 32))::text),
  'd9000000-0000-0000-0000-000000000004',
  'audit_log (gravado por complete_invite_resend_delivery) registra o ATOR REAL do resend (Super Admin), mesmo o convite original tendo sido criado pelo Manager Alpha');

-- transação atômica: falha do INSERT novo preserva o convite antigo (não
-- fica superseded sem substituto) — força token_conflict no passo final
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend7@exemplo.com', 'Resend Sete', 'seller', repeat('ce', 32));
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'hashocupado@exemplo.com', 'Hash Ocupado', 'seller', repeat('cf', 32));
reset role;
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('ce', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('cf', 32)) rr)
   select not r.success and r.code = 'token_conflict' from r),
  'resend cujo NOVO token_hash já está em uso por outro convite falha com token_conflict');
reset role;
select is((select status from public.invites where token_hash = repeat('ce', 32)), 'pending'::public.invite_status,
  'convite antigo NÃO fica superseded quando o INSERT do novo falha — permanece pending intacto (rollback do savepoint interno)');

-- "duas chamadas concorrentes não produzem dois pending": sem
-- concorrência real disponível num único script pgTAP (uma conexão), a
-- garantia estrutural é provada sequencialmente acima — a 2a chamada de
-- resend sobre o MESMO convite já superseded é negada (invite_not_actionable);
-- o mesmo UPDATE ... WHERE status IN (...), combinado com o SELECT ...
-- FOR UPDATE que trava a linha primeiro, é o que serializaria
-- corretamente duas chamadas concorrentes reais.

-- empresa suspensa/cancelada bloqueada no resend
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000003', 'resend8@exemplo.com', 'Resend Oito', 'seller', repeat('d1', 32));
reset role;
update public.companies set status = 'suspensa' where id = 'd3000000-0000-0000-0000-000000000003';
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('d1', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000004', (select id from old), repeat('d2', 32)) rr)
   select not r.success and r.code = 'company_not_operational' from r),
  'resend de convite cuja empresa foi suspensa DEPOIS de criado é bloqueado');
reset role;
update public.companies set status = 'implantacao' where id = 'd3000000-0000-0000-0000-000000000003';

-- convite de plataforma: só Super Admin reenvia
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000004', null, 'resend9@exemplo.com', 'Resend Nove', 'super_admin', repeat('d3', 32));
reset role;
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('d3', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('d4', 32)) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'Manager não pode reenviar convite de plataforma — colapsa em invite_not_found (mesma regra anti-enumeração de "não é o convite deste ator/empresa", nunca forbidden: um convite de plataforma nunca é "empresa errada" para um Manager, é sempre "fora da sua autoridade", tratado de forma idêntica)');
select ok(
  (with old as (select id from public.invites where token_hash = repeat('d3', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000004', (select id from old), repeat('d5', 32)) rr)
   select r.success from r),
  'Super Admin reenvia convite de plataforma com sucesso');
reset role;

-- retorno de resend não expõe token
select is(
  (select array(select o.parameter_name::text from information_schema.parameters o
    join information_schema.routines r on r.specific_name = o.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'resend_invite' and o.parameter_mode = 'OUT'
    order by o.ordinal_position)),
  array['success','code','invite_id','previous_invite_id','status','expires_at'],
  'resend_invite() retorna EXATAMENTE os 6 campos mínimos — sem token_hash');

-- invite_not_found: id inexistente, e id de outra empresa/outro
-- convidador (colapsa no mesmo código, sem revelar detalhe)
set local role service_role;
select ok(
  (with r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('d6', 32)) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'resend de id inexistente -> invite_not_found');
select public.create_invite('d9000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'resend10@exemplo.com', 'Resend Dez', 'seller', repeat('d7', 32));
select ok(
  (with old as (select id from public.invites where token_hash = repeat('d7', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000001', (select id from old), repeat('d8', 32)) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'Manager Alpha tentando reenviar convite da empresa Beta -> invite_not_found (não revela que existe em outra empresa)');
reset role;

-- REGRESSÃO (auditoria adversarial pós-primeira-validação): convite cujo
-- invited_by_profile_id virou NULL (convidador original removido,
-- ON DELETE SET NULL do S4-A1) NÃO pode ser reenviado por outro Manager
-- da MESMA empresa que nunca foi o convidador — provado que
-- `v_authorized := EXISTS(...) AND NULL = ator` sem coalesce(...,false)
-- deixava v_authorized como NULL (não false), e `if not v_authorized`
-- silenciosamente pulava a negação (bug real, corrigido).
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'resend11@exemplo.com', 'Resend Onze', 'seller', repeat('d9', 32));
reset role;
update public.invites set invited_by_profile_id = null where token_hash = repeat('d9', 32);
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('d9', 32)),
        r as (select rr.* from public.resend_invite('d9000000-0000-0000-0000-000000000010', (select id from old), repeat('da', 32)) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'REGRESSÃO: Manager Gamma (nunca foi o convidador, só compartilha a empresa) NÃO reenvia um convite cujo invited_by_profile_id virou NULL — invite_not_found, nunca sucesso');
reset role;
select is((select status from public.invites where token_hash = repeat('d9', 32)), 'pending'::public.invite_status,
  'REGRESSÃO: o convite com invited_by_profile_id NULL permanece pending após a tentativa negada — nenhum efeito colateral');

-- ═══════════════════════════════════════════════════════════════════════
-- CANCEL_INVITE
-- ═══════════════════════════════════════════════════════════════════════

-- Super Admin cancela qualquer pending
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'cancel1@exemplo.com', 'Cancel Um', 'seller', repeat('e1', 32));
reset role;
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from public.invites where token_hash = repeat('e1', 32))) rr)
   select r.success and r.code = 'ok' and r.status = 'canceled' from r),
  'Super Admin cancela qualquer convite pending, mesmo não tendo sido o autor');
reset role;

-- Manager cancela o próprio pending
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'cancel2@exemplo.com', 'Cancel Dois', 'seller', repeat('e2', 32));
reset role;
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from public.invites where token_hash = repeat('e2', 32))) rr)
   select r.success and r.code = 'ok' from r),
  'Manager Alpha cancela convite que ELE MESMO criou');
reset role;

-- Manager não cancela convite alheio (outro Manager da MESMA empresa)
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000010', 'd1000000-0000-0000-0000-000000000001', 'cancel3@exemplo.com', 'Cancel Tres', 'seller', repeat('e3', 32));
reset role;
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from public.invites where token_hash = repeat('e3', 32))) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'Manager Alpha não cancela convite criado por Manager Gamma (outro convidador, mesma empresa) — colapsa em invite_not_found');
reset role;

-- REGRESSÃO (auditoria adversarial pós-primeira-validação): convite cujo
-- invited_by_profile_id virou NULL NÃO pode ser cancelado por outro
-- Manager da MESMA empresa que nunca foi o convidador — provado que
-- `v_authorized := NULL = auth.uid() AND EXISTS(...)` sem
-- coalesce(...,false) ficava NULL (não false), e `if not v_authorized`
-- silenciosamente pulava a negação, permitindo cancelamento indevido
-- (bug real, reproduzido com sucesso ANTES da correção — success=true,
-- status=canceled — e corrigido nesta versão).
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'cancel7@exemplo.com', 'Cancel Sete', 'seller', repeat('1e', 32));
reset role;
update public.invites set invited_by_profile_id = null where token_hash = repeat('1e', 32);
-- busca o id como postgres (nunca sob RLS de "authenticated"): com
-- invited_by_profile_id NULL, a policy invites_select_own_or_platform
-- (is_platform_super_admin() OR invited_by_profile_id = auth.uid())
-- esconderia a linha até de uma subquery de teste rodando como Manager
-- Gamma — o que faria o id resolver para NULL e o teste "passar" pelo
-- motivo ERRADO (id inexistente), sem nunca exercitar de fato o ramo de
-- autorização interno que está sendo testado aqui.
create temporary table t23_regressao_cancel as select id from public.invites where token_hash = repeat('1e', 32);
grant select on t23_regressao_cancel to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from t23_regressao_cancel)) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'REGRESSÃO: Manager Gamma (nunca foi o convidador, só compartilha a empresa) NÃO cancela um convite cujo invited_by_profile_id virou NULL — invite_not_found, nunca sucesso');
reset role;
drop table t23_regressao_cancel;
select is((select status from public.invites where token_hash = repeat('1e', 32)), 'pending'::public.invite_status,
  'REGRESSÃO: o convite com invited_by_profile_id NULL permanece pending após a tentativa negada — nenhum efeito colateral');

-- Manager inativo (membership desativada) não cancela mais, mesmo sendo o
-- autor original
update public.company_memberships set is_active = false
 where profile_id = 'd9000000-0000-0000-0000-000000000010' and company_id = 'd1000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  format($$select * from public.cancel_invite(%L::uuid)$$, (select id from public.invites where token_hash = repeat('e3', 32))),
  '42501', null, 'Manager Gamma com membership DESATIVADA não cancela mais nada — nenhuma capacidade administrativa (forbidden)');
reset role;

-- Seller / ADMIN legado negados
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.cancel_invite(gen_random_uuid())$$,
  '42501', null, 'Seller é negado ao tentar cancel_invite (forbidden, capacidade geral)');
reset role;

select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.cancel_invite(gen_random_uuid())$$,
  '42501', null, 'ADMIN legado sem membership real é negado ao tentar cancel_invite');
reset role;

-- empresa suspensa/cancelada NÃO impede cancelamento
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000003', 'cancel4@exemplo.com', 'Cancel Quatro', 'seller', repeat('e4', 32));
reset role;
update public.companies set status = 'suspensa' where id = 'd3000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from public.invites where token_hash = repeat('e4', 32))) rr)
   select r.success and r.code = 'ok' from r),
  'cancelamento de convite pending permanece permitido mesmo com a empresa agora suspensa (ação corretiva, sem gate operacional)');
reset role;
update public.companies set status = 'implantacao' where id = 'd3000000-0000-0000-0000-000000000003';

-- chamada repetida (idempotência de erro, não de sucesso)
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from public.invites where token_hash = repeat('e4', 32))) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'cancelar novamente um convite já canceled retorna invite_not_actionable, sem alterar nada');
reset role;
select is((select count(*)::int from public.invites where token_hash = repeat('e4', 32) and status = 'canceled'), 1,
  'a segunda chamada não produziu nenhum efeito colateral — o convite continua canceled, uma única vez');

-- pending vencido vira expired ao tentar cancelar
set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'cancel5@exemplo.com', 'Cancel Cinco', 'seller', repeat('e5', 32));
reset role;
update public.invites set expires_at = now() - interval '1 hour' where token_hash = repeat('e5', 32);
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from public.invites where token_hash = repeat('e5', 32))) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'cancelar um pending já VENCIDO materializa expired e retorna invite_not_actionable (nunca vira canceled)');
reset role;
select is((select status from public.invites where token_hash = repeat('e5', 32)), 'expired'::public.invite_status,
  'o convite vencido ficou expired (materializado), não canceled');

-- invite_not_found genérico (id inexistente e id de outra empresa
-- produzem exatamente o mesmo código)
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite(gen_random_uuid()) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'cancelar id inexistente -> invite_not_found');
reset role;

set local role service_role;
select public.create_invite('d9000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'cancel6@exemplo.com', 'Cancel Seis', 'seller', repeat('e6', 32));
reset role;
select set_config('request.jwt.claims', '{"sub":"d9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(
  (with r as (select rr.* from public.cancel_invite((select id from public.invites where token_hash = repeat('e6', 32))) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'Manager Alpha cancelando convite de OUTRA empresa (Beta) -> invite_not_found (mesmo código do id inexistente — sem enumeração)');
reset role;

-- retorno mínimo de cancel_invite
select is(
  (select array(select o.parameter_name::text from information_schema.parameters o
    join information_schema.routines r on r.specific_name = o.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'cancel_invite' and o.parameter_mode = 'OUT'
    order by o.ordinal_position)),
  array['success','code','invite_id','status'],
  'cancel_invite() retorna EXATAMENTE success/code/invite_id/status');

-- ═══════════════════════════════════════════════════════════════════════
-- AUDIT_LOG
-- ═══════════════════════════════════════════════════════════════════════

-- sucesso e falha de domínio persistem (não fazem rollback um do outro)
-- ATUALIZAÇÃO (M1-F S4-A2A.1): "existem entradas invite_sent/success"
-- foi REMOVIDA — create_invite() não grava mais audit_log de sucesso
-- sozinha (lacuna corrigida: auditava envio antes de qualquer tentativa
-- real de entrega). A finalização da entrega passou para duas funções
-- server-only dedicadas, ambas adicionadas nesta mesma etapa (S4-A2A.1):
-- complete_invite_delivery() finaliza SOMENTE convites de criação
-- inicial (a distinção é feita por supersedes_invite_id IS NULL — ver
-- migration m1f_s4a2a1) e complete_invite_resend_delivery() finaliza
-- SOMENTE convites com vínculo explícito (supersedes_invite_id) ao
-- convite anterior informado. Nenhum cenário deste arquivo (23) chama
-- complete_invite_delivery(), então nenhuma entrada invite_sent/success
-- é produzida legitimamente aqui — a cobertura detalhada de ambas as
-- funções de finalização (sucesso, falha, ACL, proveniência) está no
-- teste 24, não neste arquivo. A garantia equivalente para RESEND
-- continua coberta abaixo, porque complete_invite_resend_delivery() já
-- existe e é chamada mais acima neste arquivo (seção "ator real
-- registrado no audit").
select ok((select count(*)::int from public.audit_log where action = 'invite_sent' and result = 'failure') > 0,
  'existem entradas invite_sent/failure no audit_log (falhas de domínio, sem RAISE, preservadas)');
select ok((select count(*)::int from public.audit_log where action = 'invite_resent' and result = 'success') > 0,
  'existem entradas invite_resent/success no audit_log (gravada por complete_invite_resend_delivery(), chamada mais acima neste arquivo)');
select ok((select count(*)::int from public.audit_log where action = 'invite_resent' and result = 'failure') > 0,
  'existem entradas invite_resent/failure no audit_log');
select ok((select count(*)::int from public.audit_log where action = 'invite_canceled' and result = 'success') > 0,
  'existem entradas invite_canceled/success no audit_log');
select ok((select count(*)::int from public.audit_log where action = 'invite_canceled' and result = 'failure') > 0,
  'existem entradas invite_canceled/failure no audit_log');
select ok((select count(*)::int from public.audit_log where action = 'invite_expired') > 0,
  'existem entradas invite_expired no audit_log (materialização preguiçosa via resend/cancel)');

-- falta de autorização NÃO deixa escrita nenhuma (comparação de contagem
-- total antes/depois de uma tentativa forbidden)
create temporary table t23_audit_before as select count(*)::int as n from public.audit_log;

set local role service_role;
do $do$
begin
  begin
    perform public.create_invite('d9000000-0000-0000-0000-000000000003'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid, 'semaudit@exemplo.com', 'Sem Audit', 'seller'::public.invite_role_kind, repeat('e7', 32));
  exception when insufficient_privilege then null;
  end;
end $do$;
reset role;

select is(
  (select count(*)::int from public.audit_log),
  (select n from t23_audit_before), 'tentativa forbidden (Seller) não gravou NENHUMA linha nova em audit_log');
drop table t23_audit_before;

-- entity_id de tentativa existe mesmo sem invite criado (v_attempt_id) —
-- verificável indiretamente: toda falha de invalid_input tem entity_id
-- preenchido com formato de uuid, mesmo sem nenhum invite correspondente
select ok(
  (select bool_and(entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    from public.audit_log
   where action = 'invite_sent' and result = 'failure' and reason = 'invalid_input'),
  'entity_id de falha de create_invite (sem invite criado) é sempre um uuid de tentativa válido, nunca nulo/vazio/malformado');
select is(
  (select count(*)::int from public.audit_log al
    where al.action = 'invite_sent' and al.result = 'failure' and al.reason = 'invalid_input'
      and exists (select 1 from public.invites i where i.id::text = al.entity_id)),
  0, 'o entity_id de uma falha invalid_input nunca corresponde a um invite real (é sempre só o uuid de tentativa)');

-- before/after usam whitelist — nunca token_hash/token bruto/senha/sessão
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'invite'
      and (before_data::text ilike '%token%' or after_data::text ilike '%token%')),
  0, 'nenhum before_data/after_data de audit_log contém a palavra "token"');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'invite'
      and (before_data::text ilike '%password%' or after_data::text ilike '%password%'
        or before_data::text ilike '%session%' or after_data::text ilike '%session%'
        or before_data::text ilike '%access_token%' or after_data::text ilike '%access_token%'
        or before_data::text ilike '%refresh_token%' or after_data::text ilike '%refresh_token%'
        or before_data::text ilike '%service_role%' or after_data::text ilike '%service_role%')),
  0, 'nenhum before_data/after_data contém senha, sessão, access/refresh token ou service_role');

-- audit failure inesperado reverte a operação inteira: provado
-- estruturalmente — nenhuma das 3 funções usa "WHEN OTHERS" (captura
-- genérica); a única captura em torno de escrita é unique_violation/
-- check_violation nos INSERTs/UPDATEs de invites, nunca em torno do
-- INSERT de audit_log em si — logo qualquer falha inesperada ali
-- propaga e desfaz a transação inteira por definição da linguagem.
select is(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('create_invite','resend_invite','cancel_invite')
     and pg_get_functiondef(p.oid) ilike '%when others%'),
  0, 'nenhuma das 3 RPCs usa "WHEN OTHERS" (captura genérica) — uma falha inesperada em audit_log sempre propaga e reverte a transação inteira');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accept_invite'),
  0, 'accept_invite() continua inexistente (fora de escopo desta subetapa, S4-C)');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'policy de leads inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'policy de lead_timeline_entries inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'companies'),
  1, 'policy de companies inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'invites'),
  1, 'policy de invites inalterada (1 policy, SELECT do S4-A1 — nenhuma policy nova de escrita foi criada; a escrita continua exclusiva das 3 RPCs SECURITY DEFINER)');

-- runtime legado continua operando leads normalmente
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S4A2A Compat Teste', '(11) 90000-6666', 'Onix')).id$$,
  'SELLER legado (usuário seedado) ainda cria lead normalmente após o S4-A2A');
reset role;

select * from finish();
rollback;
