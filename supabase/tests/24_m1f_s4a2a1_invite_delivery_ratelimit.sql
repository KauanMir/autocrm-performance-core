-- M1-F S4-A2A.1 — testes de status de entrega e fundação de rate limit
-- (pgTAP): enum/colunas/constraints de invites.delivery_status,
-- create_invite()/resend_invite() sem auditoria prematura,
-- complete_invite_resend_delivery(), invite_rate_limit_events e
-- reserve_invite_rate_limit(). Nenhum token bruto, Route Handler,
-- Supabase Auth ou usuário real é usado — tudo com token_hash sintético
-- e fixtures de rollback, mesmo padrão de 22/23. Roda como postgres
-- (fixtures), service_role (create/resend/finalização/rate limit) e
-- authenticated/anon (ACL negativa). Rollback ao final — nada persiste.
--
-- Convenção já estabelecida em 23 (reaplicada aqui): as RPCs são
-- VOLATILE, nunca se invoca a mesma chamada duas vezes para verificar
-- campos diferentes do retorno; cada token_hash é usado uma única vez;
-- IDs são recuperados por token_hash (leitura direta como postgres, ou
-- via tabela temporária com GRANT quando é preciso ler como
-- service_role, que não tem SELECT direto em invites fora deste teste).
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ─────────────────────────────────────────────────────────────
insert into public.companies (id, name, status) values
  ('aa100000-0000-0000-0000-000000000001', 'Empresa H1', 'ativa'),
  ('aa200000-0000-0000-0000-000000000002', 'Empresa H2', 'ativa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'aa900000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'h9managerh1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa900000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'h9managerh2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa900000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'h9superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa900000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'h9sellerh1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa900000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'h9inativo@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'H9 Manager H1', 'h9managerh1@test.local', 'manager', true),
  ('aa900000-0000-0000-0000-000000000002', 'aa200000-0000-0000-0000-000000000002', 'H9 Manager H2', 'h9managerh2@test.local', 'manager', true),
  ('aa900000-0000-0000-0000-000000000003', null,                                   'H9 Super Admin', 'h9superadmin@test.local', 'seller', true),
  ('aa900000-0000-0000-0000-000000000004', 'aa100000-0000-0000-0000-000000000001', 'H9 Seller H1', 'h9sellerh1@test.local', 'seller', true),
  ('aa900000-0000-0000-0000-000000000005', 'aa100000-0000-0000-0000-000000000001', 'H9 Inativo', 'h9inativo@test.local', 'manager', false);

update public.profiles set platform_role = 'super_admin' where id = 'aa900000-0000-0000-0000-000000000003';

insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('aa100000-0000-0000-0000-000000000001', 'aa900000-0000-0000-0000-000000000001', 'manager', true),
  ('aa200000-0000-0000-0000-000000000002', 'aa900000-0000-0000-0000-000000000002', 'manager', true),
  ('aa100000-0000-0000-0000-000000000001', 'aa900000-0000-0000-0000-000000000004', 'seller',  true);

-- Conveniência EXCLUSIVA deste teste (dentro da transação com rollback):
-- permite buscar id de convite por token_hash enquanto "set local role
-- service_role" está ativo. Mesmo padrão e mesma justificativa do
-- teste 23 — nunca persiste, nunca altera o grant real de produção.
grant select on public.invites to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA — enum, colunas, defaults, constraints
-- ═══════════════════════════════════════════════════════════════════════

select has_enum('public'::name, 'invite_delivery_status'::name, 'enum invite_delivery_status existe');
select enum_has_labels('public'::name, 'invite_delivery_status'::name, array['not_sent','sent','failed'],
  'invite_delivery_status tem exatamente os 3 valores esperados');

select has_column('public'::name, 'invites'::name, 'delivery_status'::name, 'invites.delivery_status existe');
select col_type_is('public'::name, 'invites'::name, 'delivery_status'::name, 'invite_delivery_status', 'invites.delivery_status é invite_delivery_status');
select col_not_null('public'::name, 'invites'::name, 'delivery_status'::name, 'invites.delivery_status é NOT NULL');
select col_default_is('public'::name, 'invites'::name, 'delivery_status'::name, 'not_sent', 'default de invites.delivery_status é not_sent');

select has_column('public'::name, 'invites'::name, 'delivery_attempted_at'::name, 'invites.delivery_attempted_at existe');
select col_type_is('public'::name, 'invites'::name, 'delivery_attempted_at'::name, 'timestamp with time zone', 'invites.delivery_attempted_at é timestamptz');
select col_is_null('public'::name, 'invites'::name, 'delivery_attempted_at'::name, 'invites.delivery_attempted_at é nullable');

select has_column('public'::name, 'invites'::name, 'email_sent_at'::name, 'invites.email_sent_at existe');
select col_type_is('public'::name, 'invites'::name, 'email_sent_at'::name, 'timestamp with time zone', 'invites.email_sent_at é timestamptz');
select col_is_null('public'::name, 'invites'::name, 'email_sent_at'::name, 'invites.email_sent_at é nullable');

select has_column('public'::name, 'invites'::name, 'last_delivery_error_code'::name, 'invites.last_delivery_error_code existe');
select col_type_is('public'::name, 'invites'::name, 'last_delivery_error_code'::name, 'text', 'invites.last_delivery_error_code é text');
select col_is_null('public'::name, 'invites'::name, 'last_delivery_error_code'::name, 'invites.last_delivery_error_code é nullable');

-- backfill: qualquer linha criada por create_invite() (equivalente a uma
-- linha "histórica" no sentido desta migration, já que nasce antes de
-- qualquer finalização de entrega) reflete exatamente o default esperado
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'backfillcheck@exemplo.com', 'Backfill Check', 'seller', repeat('b1', 32));
reset role;
select ok(
  (select delivery_status = 'not_sent' and delivery_attempted_at is null and email_sent_at is null and last_delivery_error_code is null
     from public.invites where token_hash = repeat('b1', 32)),
  'linha nova (equivalente ao backfill de uma linha histórica) nasce not_sent com as 3 colunas de entrega NULL');

-- constraints de coerência — testadas via INSERT direto na tabela, como
-- postgres (bypassa RLS/grants, exercita só as CHECK constraints).
-- expires_at é NOT NULL desde o S4-A1 — sempre incluído.
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck1@exemplo.com', 'CK1', 'seller', repeat('c1', 32), now() + interval '7 days', 'not_sent', now(), null, null)$$,
  '23514', null, 'not_sent com delivery_attempted_at preenchido viola invites_delivery_coherence_ck');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck2@exemplo.com', 'CK2', 'seller', repeat('c2', 32), now() + interval '7 days', 'sent', null, now(), null)$$,
  '23514', null, 'sent sem delivery_attempted_at viola invites_delivery_coherence_ck');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck3@exemplo.com', 'CK3', 'seller', repeat('c3', 32), now() + interval '7 days', 'sent', now(), null, null)$$,
  '23514', null, 'sent sem email_sent_at viola invites_delivery_coherence_ck');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck4@exemplo.com', 'CK4', 'seller', repeat('c4', 32), now() + interval '7 days', 'sent', now(), now(), 'auth_email_failed')$$,
  '23514', null, 'sent com last_delivery_error_code preenchido viola invites_delivery_coherence_ck');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck5@exemplo.com', 'CK5', 'seller', repeat('c5', 32), now() + interval '7 days', 'failed', now(), null, null)$$,
  '23514', null, 'failed sem last_delivery_error_code viola invites_delivery_coherence_ck');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck6@exemplo.com', 'CK6', 'seller', repeat('c6', 32), now() + interval '7 days', 'failed', now(), now(), 'auth_email_failed')$$,
  '23514', null, 'failed com email_sent_at preenchido viola invites_delivery_coherence_ck');
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck7@exemplo.com', 'CK7', 'seller', repeat('c7', 32), now() + interval '7 days', 'failed', now(), null, '   ')$$,
  '23514', null, 'failed com last_delivery_error_code em branco viola invites_delivery_coherence_ck');
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck8@exemplo.com', 'CK8', 'seller', repeat('c8', 32), now() + interval '7 days', 'sent', now(), now(), null)$$,
  'sent com attempted_at e email_sent_at preenchidos e error null é válido');
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck9@exemplo.com', 'CK9', 'seller', repeat('c9', 32), now() + interval '7 days', 'failed', now(), null, 'auth_rate_limited')$$,
  'failed com attempted_at e error preenchidos e sent_at null é válido');

-- catálogo fechado de last_delivery_error_code
select throws_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, delivery_status, delivery_attempted_at, email_sent_at, last_delivery_error_code)
    values ('aa100000-0000-0000-0000-000000000001', 'ck10@exemplo.com', 'CK10', 'seller', repeat('ca', 32), now() + interval '7 days', 'failed', now(), null, 'algo_nao_catalogado')$$,
  '23514', null, 'last_delivery_error_code fora do catálogo fechado viola invites_delivery_error_code_ck');

-- delivery_status não é apagado por transições de invites.status
-- (superseded/canceled/accepted preservam o histórico de entrega) —
-- ck8 já está 'sent'; transiciona o invites.status dela para canceled e
-- confirma que delivery_status/timestamps permanecem intactos
update public.invites set status = 'canceled' where token_hash = repeat('c8', 32);
select ok(
  (select delivery_status = 'sent' and delivery_attempted_at is not null and email_sent_at is not null
     from public.invites where token_hash = repeat('c8', 32)),
  'transição de invites.status para canceled NÃO apaga delivery_status/timestamps já registrados (histórico de entrega preservado)');

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA — supersedes_invite_id (proveniência explícita; correção
-- direcionada pós-auditoria — ver comentário completo na migration junto
-- à coluna: heurística de compatibilidade não é prova de proveniência)
-- ═══════════════════════════════════════════════════════════════════════

select has_column('public'::name, 'invites'::name, 'supersedes_invite_id'::name, 'invites.supersedes_invite_id existe');
select col_type_is('public'::name, 'invites'::name, 'supersedes_invite_id'::name, 'uuid', 'invites.supersedes_invite_id é uuid');
select col_is_null('public'::name, 'invites'::name, 'supersedes_invite_id'::name, 'invites.supersedes_invite_id é nullable (NULL = criado por create_invite())');
select fk_ok('public'::name, 'invites'::name, array['supersedes_invite_id']::name[], 'public'::name, 'invites'::name, array['id']::name[],
  'FK invites.supersedes_invite_id -> invites.id existe (auto-referência)');

-- nenhum backfill heurístico de reenvios históricos foi inventado —
-- nenhuma migration M1-F foi aplicada ao remoto e não existem convites
-- reais persistidos (mesma condição documentada na migration); qualquer
-- linha criada por create_invite() nesta própria migration confirma o
-- default correto (NULL)
select is(
  (select supersedes_invite_id from public.invites where token_hash = repeat('b1', 32)),
  null, 'linha criada por create_invite() nasce com supersedes_invite_id NULL (nenhum backfill heurístico)');

-- CHECK: nenhum convite pode apontar para si mesmo
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'selfref@exemplo.com', 'Self Ref', 'seller', repeat('30', 32));
reset role;
select throws_ok(
  format($$update public.invites set supersedes_invite_id = id where token_hash = %L$$, repeat('30', 32)),
  '23514', null, 'invites_supersedes_not_self_ck impede um convite de apontar para si mesmo');

-- ON DELETE RESTRICT: excluir um convite ainda referenciado como
-- "anterior" por outro é NEGADO — a relação histórica nunca desaparece
-- silenciosamente (mesmo princípio já aplicado a invites.company_id)
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'restrictpai@exemplo.com', 'Restrict Pai', 'seller', repeat('31', 32));
reset role;
set local role service_role;
select public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('31', 32)), repeat('32', 32));
reset role;
select throws_ok(
  format($$delete from public.invites where token_hash = %L$$, repeat('31', 32)),
  '23503', null, 'excluir um convite ainda referenciado por supersedes_invite_id de outro é NEGADO (ON DELETE RESTRICT — sem CASCADE, sem SET NULL)');
select is((select count(*)::int from public.invites where token_hash in (repeat('31', 32), repeat('32', 32))), 2,
  'ambos os convites (anterior e o que o referencia) continuam existindo após a tentativa de exclusão negada');

-- índice único parcial: no máximo UM convite novo pode apontar para um
-- mesmo convite anterior (relação um-para-um, nunca um-para-muitos)
select throws_ok(
  format($$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id, supersedes_invite_id)
    values ('aa100000-0000-0000-0000-000000000001', 'unisegundo@exemplo.com', 'Uni Segundo', 'seller', %L, now() + interval '7 days', 'aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = %L))$$,
    repeat('34', 32), repeat('31', 32)),
  '23505', null, 'invites_supersedes_invite_id_uidx impede uma SEGUNDA linha apontar para o mesmo convite anterior (repeat(31) já é apontado por repeat(32))');

-- duas linhas com supersedes_invite_id NULL nunca colidem (o índice é
-- PARCIAL: WHERE supersedes_invite_id IS NOT NULL)
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id, supersedes_invite_id)
    values ('aa100000-0000-0000-0000-000000000001', 'nulo1@exemplo.com', 'Nulo Um', 'seller', repeat('35', 32), now() + interval '7 days', 'aa900000-0000-0000-0000-000000000001', null)$$,
  'primeira linha com supersedes_invite_id NULL é aceita');
select lives_ok(
  $$insert into public.invites (company_id, email, name, role_kind, token_hash, expires_at, invited_by_profile_id, supersedes_invite_id)
    values ('aa100000-0000-0000-0000-000000000001', 'nulo2@exemplo.com', 'Nulo Dois', 'seller', repeat('36', 32), now() + interval '7 days', 'aa900000-0000-0000-0000-000000000001', null)$$,
  'segunda linha com supersedes_invite_id também NULL é aceita (NULL nunca colide com NULL no índice parcial)');

-- ═══════════════════════════════════════════════════════════════════════
-- ACL da tabela de rate limit — RLS ativa, zero policy, zero grant
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select relrowsecurity from pg_class where oid = 'public.invite_rate_limit_events'::regclass),
  true, 'RLS está ativa em invite_rate_limit_events');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'invite_rate_limit_events'),
  0, 'zero policies em invite_rate_limit_events');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'invite_rate_limit_events'
      and grantee in ('public', 'anon', 'authenticated')),
  0, 'zero grants em invite_rate_limit_events para PUBLIC/anon/authenticated');
-- service_role recebe TRUNCATE/REFERENCES/TRIGGER por default privilege
-- padrão do Supabase local (mesmo comportamento de qualquer tabela nova,
-- não concedido por esta migration, confirmado empiricamente) — mas
-- NUNCA os 4 privilégios que importam para confidencialidade dos dados
-- (SELECT/INSERT/UPDATE/DELETE). Mesmo padrão de checagem já usado para
-- audit_log no teste 22 (que também exclui service_role da lista "zero
-- grants" pelo mesmo motivo).
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'invite_rate_limit_events'
      and grantee = 'service_role' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0, 'service_role não tem SELECT/INSERT/UPDATE/DELETE em invite_rate_limit_events (só acesso via a função, nunca leitura/escrita direta de dados)');

set local role anon;
select throws_ok(
  $$select count(*) from public.invite_rate_limit_events$$,
  '42501', null, 'anon não lê invite_rate_limit_events diretamente');
reset role;
set local role authenticated;
select throws_ok(
  $$select count(*) from public.invite_rate_limit_events$$,
  '42501', null, 'authenticated não lê invite_rate_limit_events diretamente');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- CREATE_INVITE / RESEND_INVITE — assinaturas e ACL preservadas
-- ═══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'create_invite'::name,
  array['uuid','uuid','text','text','invite_role_kind','text']::name[], 'create_invite() mantém a assinatura exata');
select has_function('public'::name, 'resend_invite'::name,
  array['uuid','uuid','text']::name[], 'resend_invite() mantém a assinatura exata');
select has_function('public'::name, 'cancel_invite'::name,
  array['uuid']::name[], 'cancel_invite() mantém a assinatura exata (não foi tocada nesta etapa)');

select is(has_function_privilege('service_role', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), true,
  'service_role mantém EXECUTE em create_invite()');
select is(has_function_privilege('authenticated', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), false,
  'authenticated continua sem EXECUTE em create_invite()');
select is(has_function_privilege('anon', 'public.create_invite(uuid,uuid,text,text,invite_role_kind,text)', 'EXECUTE'), false,
  'anon continua sem EXECUTE em create_invite()');
select is(has_function_privilege('service_role', 'public.resend_invite(uuid,uuid,text)', 'EXECUTE'), true,
  'service_role mantém EXECUTE em resend_invite()');
select is(has_function_privilege('authenticated', 'public.resend_invite(uuid,uuid,text)', 'EXECUTE'), false,
  'authenticated continua sem EXECUTE em resend_invite()');
select is(has_function_privilege('authenticated', 'public.cancel_invite(uuid)', 'EXECUTE'), true,
  'authenticated mantém EXECUTE em cancel_invite() (função não alterada nesta etapa)');

-- create_invite: linha nasce not_sent, ZERO audit_log success ANTES da
-- finalização; falhas de domínio continuam auditadas
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'novacriacao@exemplo.com', 'Nova Criacao', 'seller', repeat('d1', 32));
reset role;
select ok(
  (select delivery_status = 'not_sent' from public.invites where token_hash = repeat('d1', 32)),
  'create_invite(): linha nasce not_sent');
select is(
  (select count(*)::int from public.audit_log where action = 'invite_sent' and result = 'success'),
  0, 'create_invite(): ZERO audit_log invite_sent/success existe em todo o arquivo até este ponto (nenhuma auditoria prematura)');

set local role service_role;
select ok(
  (with r as (select * from public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', '   ', 'Nome Vazio', 'seller', repeat('d2', 32)))
   select not r.success and r.code = 'invalid_input' from r),
  'create_invite(): falha de domínio (invalid_input) continua auditada normalmente');
reset role;
select ok(
  (select count(*)::int from public.audit_log where action = 'invite_sent' and result = 'failure' and reason = 'invalid_input') > 0,
  'falha de domínio invalid_input gravou audit_log/failure normalmente (comportamento do S4-A2A preservado)');

-- resend_invite: novo convite nasce not_sent; antigo permanece
-- superseded preservando seu próprio delivery_status; ZERO audit_log
-- invite_resent/success antes da finalização
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'preparaResend@exemplo.com', 'Prepara Resend', 'seller', repeat('d3', 32));
reset role;
set local role service_role;
select public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('d3', 32)), repeat('d4', 32));
reset role;
select ok(
  (select delivery_status = 'not_sent' from public.invites where token_hash = repeat('d4', 32)),
  'resend_invite(): novo convite nasce not_sent');
select ok(
  (select status = 'superseded' and delivery_status = 'not_sent' from public.invites where token_hash = repeat('d3', 32)),
  'resend_invite(): convite antigo vira superseded preservando seu próprio delivery_status (not_sent, nunca alterado)');
select is(
  (select count(*)::int from public.audit_log where action = 'invite_resent' and result = 'success'),
  0, 'resend_invite(): ZERO audit_log invite_resent/success existe até este ponto (nenhuma auditoria prematura)');

-- proveniência explícita: create_invite() nasce NULL; resend_invite()
-- aponta EXATAMENTE para o convite anterior, gravado internamente
select is(
  (select supersedes_invite_id from public.invites where token_hash = repeat('d1', 32)),
  null, 'create_invite(): supersedes_invite_id nasce NULL (nunca é parâmetro aceito de fora — não há p_supersedes_invite_id nesta assinatura)');
select is(
  (select supersedes_invite_id from public.invites where token_hash = repeat('d4', 32)),
  (select id from public.invites where token_hash = repeat('d3', 32)),
  'resend_invite(): supersedes_invite_id do novo convite é EXATAMENTE o id do convite anterior, gravado internamente pelo banco');

set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'resendFalhaDominio@exemplo.com', 'Resend Falha Dominio', 'seller', repeat('d5', 32));
reset role;
update public.companies set status = 'suspensa' where id = 'aa100000-0000-0000-0000-000000000001';
set local role service_role;
select ok(
  (with old as (select id from public.invites where token_hash = repeat('d5', 32)),
        r as (select rr.* from public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from old), repeat('d6', 32)) rr)
   select not r.success and r.code = 'company_not_operational' from r),
  'resend_invite(): falha de domínio (company_not_operational) continua auditada normalmente');
reset role;
update public.companies set status = 'ativa' where id = 'aa100000-0000-0000-0000-000000000001';
select ok(
  (select count(*)::int from public.audit_log where action = 'invite_resent' and result = 'failure' and reason = 'company_not_operational') > 0,
  'falha de domínio company_not_operational gravou audit_log/failure normalmente');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPLETE_INVITE_DELIVERY — finalização do CREATE (correção
-- direcionada: agora implementável porque supersedes_invite_id IS NULL
-- prova ESTRUTURALMENTE que a linha nasceu de create_invite(), nunca de
-- resend_invite() — sem depender de nenhuma heurística de compatibilidade)
-- ═══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'complete_invite_delivery'::name,
  array['uuid','uuid','boolean','text']::name[], 'complete_invite_delivery() existe com a assinatura exata');

-- ACL: só service_role
select is(has_function_privilege('service_role', 'public.complete_invite_delivery(uuid,uuid,boolean,text)', 'EXECUTE'), true,
  'service_role tem EXECUTE em complete_invite_delivery()');
select is(has_function_privilege('authenticated', 'public.complete_invite_delivery(uuid,uuid,boolean,text)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em complete_invite_delivery()');
select is(has_function_privilege('anon', 'public.complete_invite_delivery(uuid,uuid,boolean,text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em complete_invite_delivery()');
select is(has_function_privilege('public', 'public.complete_invite_delivery(uuid,uuid,boolean,text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em complete_invite_delivery()');

set local role authenticated;
select throws_ok(
  $$select * from public.complete_invite_delivery(null, gen_random_uuid(), true, null)$$,
  '42501', null, 'authenticated não executa complete_invite_delivery() diretamente');
reset role;
set local role anon;
select throws_ok(
  $$select * from public.complete_invite_delivery(null, gen_random_uuid(), true, null)$$,
  '42501', null, 'anon não executa complete_invite_delivery() diretamente');
reset role;

-- ator inexistente/inativo é negado (forbidden) — mesmo padrão das
-- demais RPCs de convite
set local role service_role;
select throws_ok(
  $$select * from public.complete_invite_delivery('99999999-9999-9999-9999-999999999999'::uuid, gen_random_uuid(), true, null)$$,
  '42501', null, 'ator inexistente é negado (forbidden)');
select throws_ok(
  $$select * from public.complete_invite_delivery('aa900000-0000-0000-0000-000000000005'::uuid, gen_random_uuid(), true, null)$$,
  '42501', null, 'ator inativo é negado (forbidden)');
reset role;

-- convite inexistente -> invite_not_found
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery('aa900000-0000-0000-0000-000000000001', gen_random_uuid(), true, null) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'convite inexistente -> invite_not_found');
reset role;

-- Manager sem autoridade sobre a linha (nunca convidou, empresa
-- diferente) -> invite_not_found (colapso anti-enumeração, nunca
-- forbidden — mesmo padrão de resend_invite()/cancel_invite())
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'semautoridade@exemplo.com', 'Sem Autoridade', 'seller', repeat('40', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000002',
      (select id from public.invites where token_hash = repeat('40', 32)),
      true, null) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'Manager H2 (nunca convidou, empresa diferente) finalizando convite de H1 -> invite_not_found, nunca forbidden');
reset role;
select is((select delivery_status from public.invites where token_hash = repeat('40', 32)), 'not_sent'::public.invite_delivery_status,
  'a tentativa sem autoridade não alterou delivery_status');

-- sucesso: delivery_status=sent, timestamps corretos, audit_log
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('40', 32)),
      true, null) rr)
   select r.success and r.code = 'ok' from r),
  'complete_invite_delivery(sucesso): success=true, code=ok');
reset role;
select ok(
  (select delivery_status = 'sent' and delivery_attempted_at is not null and email_sent_at is not null and last_delivery_error_code is null
     from public.invites where token_hash = repeat('40', 32)),
  'finalização de sucesso: delivery_status=sent, attempted_at e email_sent_at preenchidos, error null (coerente)');
select is(
  (select count(*)::int from public.audit_log
    where action = 'invite_sent' and result = 'success'
      and entity_id = (select id from public.invites where token_hash = repeat('40', 32))::text),
  1, 'exatamente UMA entrada invite_sent/success gravada para este convite');

-- chamada duplicada é negada (delivery_status já não é not_sent), sem
-- gravar um segundo audit_log
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('40', 32)),
      true, null) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'chamada duplicada de finalização é negada (invite_not_actionable)');
reset role;
select is(
  (select count(*)::int from public.audit_log
    where action = 'invite_sent' and result = 'success'
      and entity_id = (select id from public.invites where token_hash = repeat('40', 32))::text),
  1, 'a chamada duplicada NÃO produziu um segundo audit_log de sucesso — continua exatamente 1');

-- falha: delivery_status=failed, convite permanece pending
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'finalizacreatefalha@exemplo.com', 'Finaliza Create Falha', 'seller', repeat('41', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('41', 32)),
      false, 'auth_email_failed') rr)
   select r.success and r.code = 'ok' from r),
  'complete_invite_delivery(falha): a FINALIZAÇÃO em si é bem-sucedida (registrou a falha corretamente) — success=true, code=ok');
reset role;
select ok(
  (select delivery_status = 'failed' and delivery_attempted_at is not null and email_sent_at is null and last_delivery_error_code = 'auth_email_failed'
     from public.invites where token_hash = repeat('41', 32)),
  'finalização de falha: delivery_status=failed, attempted_at preenchido, email_sent_at NULL, error=auth_email_failed (coerente)');
select ok(
  (select status = 'pending' from public.invites where token_hash = repeat('41', 32)),
  'convite com falha de entrega permanece pending (nunca cancelado automaticamente) — poderá ser reenviado depois');
select is(
  (select count(*)::int from public.audit_log
    where action = 'invite_sent' and result = 'failure' and reason = 'auth_email_failed'
      and entity_id = (select id from public.invites where token_hash = repeat('41', 32))::text),
  1, 'audit_log real de falha gravado, com o código de erro seguro em reason');

-- expired negado, delivery_status inalterado
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'finalizacreateexpired@exemplo.com', 'Finaliza Create Expired', 'seller', repeat('42', 32));
reset role;
update public.invites set expires_at = now() - interval '1 hour' where token_hash = repeat('42', 32);
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('42', 32)),
      true, null) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'convite pending VENCIDO (expires_at no passado) -> invite_not_actionable, nunca finaliza um convite morto');
reset role;
select is((select delivery_status from public.invites where token_hash = repeat('42', 32)), 'not_sent'::public.invite_delivery_status,
  'delivery_status permanece not_sent após a tentativa negada por vencimento');

-- coerência de entrada: mesmas 3 regras de complete_invite_resend_delivery
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'coerenciacreate@exemplo.com', 'Coerencia Create', 'seller', repeat('43', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('43', 32)),
      true, 'auth_email_failed') rr)
   select not r.success and r.code = 'invalid_input' from r),
  'success=true combinado com error_code preenchido -> invalid_input');
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('43', 32)),
      false, null) rr)
   select not r.success and r.code = 'invalid_input' from r),
  'success=false sem error_code -> invalid_input');
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('43', 32)),
      false, 'codigo_nao_catalogado') rr)
   select not r.success and r.code = 'invalid_input' from r),
  'success=false com error_code fora do catálogo fechado -> invalid_input');
reset role;
select is(
  (select delivery_status from public.invites where token_hash = repeat('43', 32)),
  'not_sent'::public.invite_delivery_status,
  'nenhuma das 3 tentativas de entrada incoerente alterou delivery_status — permanece not_sent');

-- PROVA CENTRAL: um convite de RESEND (supersedes_invite_id preenchido)
-- nunca pode ser finalizado como CREATE — rejeitado antes mesmo de
-- checar status/delivery_status/expiração
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'rejeitaresend@exemplo.com', 'Rejeita Resend', 'seller', repeat('44', 32));
reset role;
set local role service_role;
select public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('44', 32)), repeat('45', 32));
reset role;
select ok(
  (select supersedes_invite_id is not null from public.invites where token_hash = repeat('45', 32)),
  'pré-condição: o convite gerado por resend_invite() tem supersedes_invite_id preenchido');
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('45', 32)),
      true, null) rr)
   select not r.success and r.code = 'invalid_relationship' from r),
  'PROVA CENTRAL: convite nascido de resend_invite() (supersedes_invite_id preenchido) é REJEITADO por complete_invite_delivery() — invalid_relationship, nunca finalizado como se fosse um create');
reset role;
select is((select delivery_status from public.invites where token_hash = repeat('45', 32)), 'not_sent'::public.invite_delivery_status,
  'a tentativa rejeitada não alterou delivery_status do convite de resend');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPLETE_INVITE_RESEND_DELIVERY
-- ═══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'complete_invite_resend_delivery'::name,
  array['uuid','uuid','uuid','boolean','text']::name[], 'complete_invite_resend_delivery() existe com a assinatura exata');
-- complete_invite_delivery() já foi verificada acima, na seção
-- COMPLETE_INVITE_DELIVERY (correção direcionada: a lacuna que impedia
-- sua criação foi fechada por supersedes_invite_id — ver migration).

-- ACL: só service_role
select is(has_function_privilege('service_role', 'public.complete_invite_resend_delivery(uuid,uuid,uuid,boolean,text)', 'EXECUTE'), true,
  'service_role tem EXECUTE em complete_invite_resend_delivery()');
select is(has_function_privilege('authenticated', 'public.complete_invite_resend_delivery(uuid,uuid,uuid,boolean,text)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em complete_invite_resend_delivery()');
select is(has_function_privilege('anon', 'public.complete_invite_resend_delivery(uuid,uuid,uuid,boolean,text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em complete_invite_resend_delivery()');
select is(has_function_privilege('public', 'public.complete_invite_resend_delivery(uuid,uuid,uuid,boolean,text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em complete_invite_resend_delivery()');

set local role authenticated;
select throws_ok(
  $$select * from public.complete_invite_resend_delivery(null, gen_random_uuid(), gen_random_uuid(), true, null)$$,
  '42501', null, 'authenticated não executa complete_invite_resend_delivery() diretamente');
reset role;
set local role anon;
select throws_ok(
  $$select * from public.complete_invite_resend_delivery(null, gen_random_uuid(), gen_random_uuid(), true, null)$$,
  '42501', null, 'anon não executa complete_invite_resend_delivery() diretamente');
reset role;

-- fluxo completo: create -> resend -> finalização sucesso
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'finalizasucesso@exemplo.com', 'Finaliza Sucesso', 'seller', repeat('e1', 32));
reset role;
set local role service_role;
select public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e1', 32)), repeat('e2', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('e2', 32)),
      (select id from public.invites where token_hash = repeat('e1', 32)),
      true, null) rr)
   select r.success and r.code = 'ok' from r),
  'complete_invite_resend_delivery(sucesso): success=true, code=ok');
reset role;
select ok(
  (select delivery_status = 'sent' and delivery_attempted_at is not null and email_sent_at is not null and last_delivery_error_code is null
     from public.invites where token_hash = repeat('e2', 32)),
  'finalização de sucesso: delivery_status=sent, attempted_at e email_sent_at preenchidos, error null (coerente)');
select ok(
  (select count(*)::int from public.audit_log
    where action = 'invite_resent' and result = 'success'
      and entity_id = (select id from public.invites where token_hash = repeat('e2', 32))::text) = 1,
  'exatamente UMA entrada invite_resent/success gravada, referenciando o convite novo');

-- chamada duplicada é negada (delivery_status já não é not_sent)
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('e2', 32)),
      (select id from public.invites where token_hash = repeat('e1', 32)),
      true, null) rr)
   select not r.success and r.code = 'invite_not_actionable' from r),
  'chamada duplicada de finalização é negada (invite_not_actionable)');
reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'invite_resent' and result = 'success'
    and entity_id = (select id from public.invites where token_hash = repeat('e2', 32))::text),
  1, 'a chamada duplicada NÃO produziu um segundo audit_log de sucesso — continua exatamente 1');

-- fluxo completo: create -> resend -> finalização com FALHA
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'finalizafalha@exemplo.com', 'Finaliza Falha', 'seller', repeat('e3', 32));
reset role;
set local role service_role;
select public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e3', 32)), repeat('e4', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('e4', 32)),
      (select id from public.invites where token_hash = repeat('e3', 32)),
      false, 'auth_email_failed') rr)
   select r.success and r.code = 'ok' from r),
  'complete_invite_resend_delivery(falha): a FINALIZAÇÃO em si é bem-sucedida (registrou a falha corretamente) — success=true, code=ok');
reset role;
select ok(
  (select delivery_status = 'failed' and delivery_attempted_at is not null and email_sent_at is null and last_delivery_error_code = 'auth_email_failed'
     from public.invites where token_hash = repeat('e4', 32)),
  'finalização de falha: delivery_status=failed, attempted_at preenchido, email_sent_at NULL, error=auth_email_failed (coerente)');
select ok(
  (select status = 'pending' from public.invites where token_hash = repeat('e4', 32)),
  'convite com falha de entrega permanece pending (nunca cancelado automaticamente) — poderá ser reenviado depois');
select ok(
  (select status = 'superseded' from public.invites where token_hash = repeat('e3', 32)),
  'convite anterior continua superseded mesmo após a falha de entrega do novo — nenhuma restauração');
select ok(
  (select count(*)::int from public.audit_log
    where action = 'invite_resent' and result = 'failure' and reason = 'auth_email_failed'
      and entity_id = (select id from public.invites where token_hash = repeat('e4', 32))::text) = 1,
  'audit_log real de falha gravado, com o código de erro seguro em reason');

-- convite inexistente é negado
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), true, null) rr)
   select not r.success and r.code = 'invite_not_found' from r),
  'convite (novo) inexistente -> invite_not_found');
reset role;

-- ator inválido/inexistente é negado (forbidden)
set local role service_role;
select throws_ok(
  format($$select * from public.complete_invite_resend_delivery('99999999-9999-9999-9999-999999999999'::uuid, %L::uuid, %L::uuid, true, null)$$,
    (select id from public.invites where token_hash = repeat('e2', 32)),
    (select id from public.invites where token_hash = repeat('e1', 32))),
  '42501', null, 'ator inexistente é negado (forbidden)');
select throws_ok(
  format($$select * from public.complete_invite_resend_delivery('aa900000-0000-0000-0000-000000000005'::uuid, %L::uuid, %L::uuid, true, null)$$,
    (select id from public.invites where token_hash = repeat('e2', 32)),
    (select id from public.invites where token_hash = repeat('e1', 32))),
  '42501', null, 'ator inativo é negado (forbidden)');
reset role;

-- IDs incoerentes são negados (invalid_relationship) — empresa/e-mail/
-- papel diferentes entre o convite novo e o "anterior" informado
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'semrelacaoA@exemplo.com', 'Sem Relacao A', 'seller', repeat('e5', 32));
select public.create_invite('aa900000-0000-0000-0000-000000000002', 'aa200000-0000-0000-0000-000000000002', 'semrelacaoB@exemplo.com', 'Sem Relacao B', 'seller', repeat('e6', 32));
reset role;
update public.invites set status = 'superseded' where token_hash = repeat('e6', 32);
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('e5', 32)),
      (select id from public.invites where token_hash = repeat('e6', 32)),
      true, null) rr)
   select not r.success and r.code = 'invalid_relationship' from r),
  'previous_invite_id de empresa/e-mail/papel diferentes -> invalid_relationship (nunca aceito só porque o parâmetro foi informado)');
reset role;

-- previous_invite_id que não está superseded é negado
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'naosuperseded@exemplo.com', 'Nao Superseded', 'seller', repeat('e7', 32));
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'naosuperseded2@exemplo.com', 'Nao Superseded 2', 'seller', repeat('e8', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('e7', 32)),
      (select id from public.invites where token_hash = repeat('e8', 32)),
      true, null) rr)
   select not r.success and r.code = 'invalid_relationship' from r),
  'previous_invite_id que ainda está pending (não superseded) -> invalid_relationship');
reset role;

-- entrada incoerente (success=true com error_code, ou success=false sem
-- código válido) é negada
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'entradaincoerenteA@exemplo.com', 'Entrada Incoerente A', 'seller', repeat('e9', 32));
reset role;
set local role service_role;
select public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('e9', 32)), repeat('ea', 32));
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('ea', 32)),
      (select id from public.invites where token_hash = repeat('e9', 32)),
      true, 'auth_email_failed') rr)
   select not r.success and r.code = 'invalid_input' from r),
  'success=true combinado com error_code preenchido -> invalid_input');
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('ea', 32)),
      (select id from public.invites where token_hash = repeat('e9', 32)),
      false, null) rr)
   select not r.success and r.code = 'invalid_input' from r),
  'success=false sem error_code -> invalid_input');
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('ea', 32)),
      (select id from public.invites where token_hash = repeat('e9', 32)),
      false, 'codigo_nao_catalogado') rr)
   select not r.success and r.code = 'invalid_input' from r),
  'success=false com error_code fora do catálogo fechado -> invalid_input');
reset role;
select is(
  (select delivery_status from public.invites where token_hash = repeat('ea', 32)),
  'not_sent'::public.invite_delivery_status,
  'nenhuma das 3 tentativas de entrada incoerente alterou delivery_status — permanece not_sent, ainda finalizável corretamente depois');

-- PROVA CENTRAL (inversa): um convite de CREATE (supersedes_invite_id
-- NULL) nunca pode ser finalizado como RESEND — rejeitado pela mesma
-- checagem obrigatória, mesmo informando um p_previous_invite_id REAL e
-- VÁLIDO (superseded, mesma empresa/e-mail/papel, anterior no tempo)
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'criadoisolado@exemplo.com', 'Criado Isolado', 'seller', repeat('50', 32));
reset role;
select ok(
  (select supersedes_invite_id is null from public.invites where token_hash = repeat('50', 32)),
  'pré-condição: o convite criado por create_invite() tem supersedes_invite_id NULL');
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('50', 32)),
      (select id from public.invites where token_hash = repeat('e1', 32)),
      true, null) rr)
   select not r.success and r.code = 'invalid_relationship' from r),
  'PROVA CENTRAL (inversa): convite nascido de create_invite() (supersedes_invite_id NULL) é REJEITADO por complete_invite_resend_delivery() mesmo com um previous_invite_id real e superseded informado — invalid_relationship, nunca finalizado como se fosse um resend');
reset role;
select is((select delivery_status from public.invites where token_hash = repeat('50', 32)), 'not_sent'::public.invite_delivery_status,
  'a tentativa rejeitada não alterou delivery_status do convite de create');

-- ═══════════════════════════════════════════════════════════════════════
-- REGRESSÃO — FALSO POSITIVO DA HEURÍSTICA ANTIGA (cenário concreto que
-- motivou esta correção direcionada): 1. convite A é criado; 2. A é
-- reenviado e vira superseded, gerando B; 3. B é resolvido (cancelado
-- aqui) liberando o slot pending; 4. cria-se um convite honesto C, para
-- o MESMO e-mail/empresa/papel de A, mas SEM NENHUMA relação real com A;
-- 5-6. tenta-se finalizar C como se fosse o resend de A — confirma-se
-- negado porque C.supersedes_invite_id é NULL, nunca por causa de
-- timestamps ou qualquer outro critério de compatibilidade.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. convite A
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'falsopositivo@exemplo.com', 'Falso Positivo', 'seller', repeat('60', 32));
reset role;

-- 2. A é reenviado -> B (A vira superseded)
set local role service_role;
select public.resend_invite('aa900000-0000-0000-0000-000000000001', (select id from public.invites where token_hash = repeat('60', 32)), repeat('61', 32));
reset role;
select is((select status from public.invites where token_hash = repeat('60', 32)), 'superseded'::public.invite_status,
  'passo 2: convite A vira superseded após o reenvio para B');

-- 3. B é resolvido (cancelado) — materializado diretamente, mesmo padrão
--    já usado no restante deste arquivo para simular estados terminais
update public.invites set status = 'canceled' where token_hash = repeat('61', 32);

-- 4. cria-se C: MESMO e-mail/empresa/papel de A, mas SEM NENHUMA relação
--    real com A — create_invite() aceita porque B (que ocupava o slot
--    pending) já não está mais pending
set local role service_role;
select public.create_invite('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'falsopositivo@exemplo.com', 'Falso Positivo C', 'seller', repeat('62', 32));
reset role;
select is(
  (select count(*)::int from public.invites where token_hash = repeat('62', 32) and status = 'pending'),
  1, 'passo 4: convite C foi criado normalmente (honesto, via create_invite(), sem relação com A)');

-- confirma a PRÉ-CONDIÇÃO do falso positivo: A e C são COMPATÍVEIS sob a
-- heurística antiga (mesma empresa, mesmo e-mail normalizado, mesmo
-- papel, A criado antes/no mesmo instante de C) — se a checagem
-- obrigatória de supersedes_invite_id não existisse, a heurística antiga
-- teria aceitado este par como se fosse uma relação real
select ok(
  (select a.company_id = c.company_id
      and a.email_normalized = c.email_normalized
      and a.role_kind = c.role_kind
      and a.created_at <= c.created_at
     from public.invites a, public.invites c
    where a.token_hash = repeat('60', 32) and c.token_hash = repeat('62', 32)),
  'PRÉ-CONDIÇÃO CONFIRMADA: A e C são compatíveis sob todos os critérios da heurística antiga (empresa/e-mail/papel/ordem temporal) — o falso positivo é real, não hipotético');

-- 5-6. tenta-se finalizar C como se fosse o resend de A — negado porque
--      C.supersedes_invite_id é NULL, não porque timestamps ou qualquer
--      outro campo de compatibilidade divergem (eles NÃO divergem, como
--      acabou de ser confirmado acima)
select is(
  (select supersedes_invite_id from public.invites where token_hash = repeat('62', 32)),
  null, 'confirmação direta: C.supersedes_invite_id é NULL (C nasceu de create_invite(), nunca de resend_invite())');
set local role service_role;
select ok(
  (with r as (select rr.* from public.complete_invite_resend_delivery(
      'aa900000-0000-0000-0000-000000000001',
      (select id from public.invites where token_hash = repeat('62', 32)),
      (select id from public.invites where token_hash = repeat('60', 32)),
      true, null) rr)
   select not r.success and r.code = 'invalid_relationship' from r),
  'REGRESSÃO FECHADA: complete_invite_resend_delivery(C, A) é NEGADO (invalid_relationship) — a referência explícita (supersedes_invite_id) é quem decide, nunca a compatibilidade de empresa/e-mail/papel/data, que sozinha teria aprovado este par indevidamente');
reset role;
select is((select delivery_status from public.invites where token_hash = repeat('62', 32)), 'not_sent'::public.invite_delivery_status,
  'C permanece not_sent após a tentativa negada — nenhum efeito colateral do falso positivo bloqueado');

-- ═══════════════════════════════════════════════════════════════════════
-- RESERVE_INVITE_RATE_LIMIT
-- ═══════════════════════════════════════════════════════════════════════

select has_function('public'::name, 'reserve_invite_rate_limit'::name,
  array['uuid','uuid','text','text']::name[], 'reserve_invite_rate_limit() existe com a assinatura exata');

select is(has_function_privilege('service_role', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), true,
  'service_role tem EXECUTE em reserve_invite_rate_limit()');
select is(has_function_privilege('authenticated', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), false,
  'authenticated NÃO tem EXECUTE em reserve_invite_rate_limit()');
select is(has_function_privilege('anon', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), false,
  'anon NÃO tem EXECUTE em reserve_invite_rate_limit()');
select is(has_function_privilege('public', 'public.reserve_invite_rate_limit(uuid,uuid,text,text)', 'EXECUTE'), false,
  'PUBLIC NÃO tem EXECUTE em reserve_invite_rate_limit()');

set local role authenticated;
select throws_ok(
  $$select * from public.reserve_invite_rate_limit(null, null, 'x@exemplo.com', 'create')$$,
  '42501', null, 'authenticated não executa reserve_invite_rate_limit() diretamente');
reset role;
set local role anon;
select throws_ok(
  $$select * from public.reserve_invite_rate_limit(null, null, 'x@exemplo.com', 'create')$$,
  '42501', null, 'anon não executa reserve_invite_rate_limit() diretamente');
reset role;

-- retorno mínimo (nenhum dado interno exposto)
select is(
  (select array(select o.parameter_name::text from information_schema.parameters o
    join information_schema.routines r on r.specific_name = o.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'reserve_invite_rate_limit' and o.parameter_mode = 'OUT'
    order by o.ordinal_position)),
  array['allowed','code','retry_after_seconds'],
  'reserve_invite_rate_limit() retorna EXATAMENTE allowed/code/retry_after_seconds — nenhuma contagem interna exposta');

-- ator inexistente/inativo é negado (forbidden)
set local role service_role;
select throws_ok(
  $$select * from public.reserve_invite_rate_limit('99999999-9999-9999-9999-999999999999'::uuid, null, 'x@exemplo.com', 'create')$$,
  '42501', null, 'ator inexistente é negado (forbidden)');
select throws_ok(
  $$select * from public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000005'::uuid, null, 'x@exemplo.com', 'create')$$,
  '42501', null, 'ator inativo é negado (forbidden)');
reset role;

-- validação de entrada
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', '   ', 'create') rr)
   select not r.allowed and r.code = 'invalid_input' from r),
  'e-mail em branco -> invalid_input');
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'x@exemplo.com', 'bogus_operation') rr)
   select not r.allowed and r.code = 'invalid_operation' from r),
  'operação fora de create/resend -> invalid_operation');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events),
  0, 'nenhuma das validações rejeitadas acima inseriu evento (só allowed=true insere)');

-- 20 reservas do MESMO ator (create+resend alternados, provando que
-- contam juntos) são permitidas; a 21a é bloqueada
set local role service_role;
do $$
declare
  i int;
  r record;
begin
  for i in 1..20 loop
    select * into r from public.reserve_invite_rate_limit(
      'aa900000-0000-0000-0000-000000000001',
      'aa100000-0000-0000-0000-000000000001',
      'ratorquota' || i || '@exemplo.com',
      case when i % 2 = 0 then 'create' else 'resend' end
    );
    if not r.allowed then
      raise exception 'reserva % deveria ter sido permitida, mas foi negada com code=%', i, r.code;
    end if;
  end loop;
end $$;
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'aa900000-0000-0000-0000-000000000001'),
  20, '20 reservas do mesmo ator (create+resend alternados) foram todas permitidas e inseridas');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit(
      'aa900000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', 'ratorquota21@exemplo.com', 'create') rr)
   select not r.allowed and r.code = 'actor_rate_limited' and r.retry_after_seconds > 0 from r),
  '21a reserva do mesmo ator em 15 minutos é bloqueada (actor_rate_limited, retry_after_seconds positivo)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where actor_profile_id = 'aa900000-0000-0000-0000-000000000001'),
  20, 'a 21a tentativa (bloqueada) NÃO inseriu evento — continua exatamente 20');

-- 3 reservas do MESMO e-mail+empresa (ator diferente, para não colidir
-- com a quota de 20 já usada acima) são permitidas; a 4a é bloqueada
set local role service_role;
select public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000002', 'aa100000-0000-0000-0000-000000000001', 'mesmoescopo@exemplo.com', 'create');
select public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000002', 'aa100000-0000-0000-0000-000000000001', 'mesmoescopo@exemplo.com', 'resend');
select public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000002', 'aa100000-0000-0000-0000-000000000001', 'mesmoescopo@exemplo.com', 'create');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'mesmoescopo@exemplo.com' and company_id = 'aa100000-0000-0000-0000-000000000001'),
  3, '3 reservas do mesmo e-mail+empresa foram permitidas e inseridas');

set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit(
      'aa900000-0000-0000-0000-000000000002', 'aa100000-0000-0000-0000-000000000001', 'mesmoescopo@exemplo.com', 'create') rr)
   select not r.allowed and r.code = 'email_scope_rate_limited' and r.retry_after_seconds > 0 from r),
  '4a reserva do mesmo e-mail+empresa em 24h é bloqueada (email_scope_rate_limited, retry_after_seconds positivo)');
reset role;
select is(
  (select count(*)::int from public.invite_rate_limit_events where email_normalized = 'mesmoescopo@exemplo.com' and company_id = 'aa100000-0000-0000-0000-000000000001'),
  3, 'a 4a tentativa (bloqueada) NÃO inseriu evento — continua exatamente 3');

-- outro e-mail (mesmo ator h9...002, ainda longe da quota de 20) NÃO
-- compartilha o limite de e-mail+escopo
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit(
      'aa900000-0000-0000-0000-000000000002', 'aa100000-0000-0000-0000-000000000001', 'outroemailescopo@exemplo.com', 'create') rr)
   select r.allowed from r),
  'outro e-mail (mesma empresa) NÃO compartilha o limite de e-mail+escopo já esgotado');
reset role;

-- mesmo e-mail, OUTRA empresa (escopo diferente) NÃO compartilha o
-- limite já esgotado em h1
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit(
      'aa900000-0000-0000-0000-000000000002', 'aa200000-0000-0000-0000-000000000002', 'mesmoescopo@exemplo.com', 'create') rr)
   select r.allowed from r),
  'mesmo e-mail, empresa DIFERENTE (h2) NÃO compartilha o limite de e-mail+escopo esgotado em h1 — escopos isolados');
reset role;

-- company_id null (escopo de plataforma) é isolado corretamente do
-- escopo de qualquer empresa real, mesmo para o MESMO e-mail
set local role service_role;
select public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000003', null, 'escopoplataforma@exemplo.com', 'create');
select public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000003', null, 'escopoplataforma@exemplo.com', 'create');
select public.reserve_invite_rate_limit('aa900000-0000-0000-0000-000000000003', null, 'escopoplataforma@exemplo.com', 'create');
reset role;
set local role service_role;
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit(
      'aa900000-0000-0000-0000-000000000003', null, 'escopoplataforma@exemplo.com', 'create') rr)
   select not r.allowed and r.code = 'email_scope_rate_limited' from r),
  '4a reserva do mesmo e-mail no escopo de PLATAFORMA (company_id null) é bloqueada, mesma regra de 3/24h');
select ok(
  (with r as (select rr.* from public.reserve_invite_rate_limit(
      'aa900000-0000-0000-0000-000000000003', 'aa100000-0000-0000-0000-000000000001', 'escopoplataforma@exemplo.com', 'create') rr)
   select r.allowed from r),
  'o MESMO e-mail, mas em escopo de EMPRESA (company_id preenchido), não compartilha o limite já esgotado no escopo de plataforma — isolamento correto de company_id null');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- AUDIT_LOG — conteúdo, nunca só contagem
-- ═══════════════════════════════════════════════════════════════════════

-- nenhuma mentira de "sent"/"resent" antes da API: toda entrada
-- invite_sent/invite_resent com result=success em TODO o arquivo até
-- aqui só pode ter vindo das funções de finalização (complete_invite_
-- delivery / complete_invite_resend_delivery), nunca de create_invite()/
-- resend_invite() diretamente — confirmado indiretamente: já provamos
-- acima que create_invite()/resend_invite() gravam ZERO success sozinhas
-- (checado logo após cada chamada, antes de qualquer finalização). A
-- única entrada invite_sent/success existente neste ponto é exatamente a
-- de repeat('40',32) (seção COMPLETE_INVITE_DELIVERY), gravada por
-- complete_invite_delivery(sucesso); a única entrada invite_resent/
-- success é exatamente a de repeat('e2',32), gravada por complete_
-- invite_resend_delivery(sucesso) — confere que ambos os totais batem.
select is(
  (select count(*)::int from public.audit_log where action = 'invite_resent' and result = 'success'),
  1, 'existe EXATAMENTE 1 entrada invite_resent/success em todo o arquivo — a única gravada por complete_invite_resend_delivery(sucesso)');
select is(
  (select count(*)::int from public.audit_log where action = 'invite_sent' and result = 'success'),
  1, 'existe EXATAMENTE 1 entrada invite_sent/success em todo o arquivo — a única gravada por complete_invite_delivery(sucesso), nunca por create_invite() diretamente');

-- successes/failures reais, nunca token/mensagem bruta
select ok(
  (select count(*)::int from public.audit_log where action = 'invite_resent' and result = 'failure' and reason = 'auth_email_failed') > 0,
  'existe failure real de entrega (invite_resent, reason=auth_email_failed)');

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'invite'
      and (before_data::text ilike '%token%' or after_data::text ilike '%token%'
        or before_data::text ilike '%' || repeat('e2', 4) || '%' or after_data::text ilike '%' || repeat('e2', 4) || '%')),
  0, 'nenhum before_data/after_data de audit_log contém a palavra "token" ou fragmento de hash sintético');
select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'invite'
      and (before_data::text ilike '%password%' or after_data::text ilike '%password%'
        or before_data::text ilike '%session%' or after_data::text ilike '%session%'
        or before_data::text ilike '%service_role%' or after_data::text ilike '%service_role%'
        or before_data::text ilike '%access_token%' or after_data::text ilike '%access_token%'
        or before_data::text ilike '%refresh_token%' or after_data::text ilike '%refresh_token%')),
  0, 'nenhum before_data/after_data contém senha, sessão, service_role ou access/refresh token');

-- rate-limit events não contêm token (a tabela nem tem coluna para isso,
-- checagem estrutural adicional)
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'invite_rate_limit_events'
      and column_name in ('token', 'token_hash', 'password', 'access_token', 'refresh_token', 'secret')),
  0, 'invite_rate_limit_events não possui nenhuma coluna de token/senha/segredo');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accept_invite'),
  0, 'accept_invite() continua inexistente (S4-C, fora de escopo)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_invite', 'resend_invite', 'cancel_invite',
      'complete_invite_delivery', 'complete_invite_resend_delivery', 'reserve_invite_rate_limit')),
  6, 'exatamente as 6 RPCs de convite esperadas existem (create/resend/cancel + as 3 novas), sem duplicata');

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
  1, 'policy de invites inalterada (1 policy, SELECT do S4-A1)');

-- runtime legado continua operando leads normalmente
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S4A2A1 Compat Teste', '(11) 90000-7777', 'Onix')).id$$,
  'SELLER legado (usuário seedado) ainda cria lead normalmente após o S4-A2A.1');
reset role;

select * from finish();
rollback;
