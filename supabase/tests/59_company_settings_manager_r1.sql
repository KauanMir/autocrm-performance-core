-- COMPANY-SETTINGS-R1-EXEC — RPC update_company_settings
-- (20260825100000_company_settings_manager_r1.sql). Cobre autorização
-- (Manager da própria empresa / Manager de outra empresa / Seller / sem
-- sessão / Super Admin), regra de status (implantacao/ativa permitem,
-- suspensa/cancelada bloqueiam para QUALQUER ator), validação de timezone
-- IANA real, normalização de phone, campos intocados (name/cnpj/status) e
-- audit_log. Fixtures sintéticas @test.local, transação com rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('c5910000-0000-0000-0000-000000000001', 'C59 Empresa Ativa',       '00.000.000/0001-01', '(11) 4000-0001', 'America/Sao_Paulo', 'ativa'),
  ('c5910000-0000-0000-0000-000000000002', 'C59 Empresa Outra',       '00.000.000/0001-02', '(11) 4000-0002', 'America/Sao_Paulo', 'ativa'),
  ('c5910000-0000-0000-0000-000000000003', 'C59 Empresa Implantacao', '00.000.000/0001-03', null,             'America/Sao_Paulo', 'implantacao'),
  ('c5910000-0000-0000-0000-000000000004', 'C59 Empresa Suspensa',    null,                  null,             'America/Sao_Paulo', 'suspensa'),
  ('c5910000-0000-0000-0000-000000000005', 'C59 Empresa Cancelada',   null,                  null,             'America/Sao_Paulo', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c5920000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c59-manager-ativa@test.local',       now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5920000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c59-seller-ativa@test.local',        now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5920000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'c59-manager-outra@test.local',       now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5920000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'c59-manager-implantacao@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5920000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'c59-manager-suspensa@test.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5920000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'c59-manager-cancelada@test.local',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5920000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'c59-superadmin@test.local',          now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('c5920000-0000-0000-0000-000000000001', 'C59 Manager Ativa',       'c59-manager-ativa@test.local',       true, null),
  ('c5920000-0000-0000-0000-000000000002', 'C59 Seller Ativa',        'c59-seller-ativa@test.local',        true, null),
  ('c5920000-0000-0000-0000-000000000003', 'C59 Manager Outra',       'c59-manager-outra@test.local',       true, null),
  ('c5920000-0000-0000-0000-000000000004', 'C59 Manager Implantacao', 'c59-manager-implantacao@test.local', true, null),
  ('c5920000-0000-0000-0000-000000000005', 'C59 Manager Suspensa',    'c59-manager-suspensa@test.local',    true, null),
  ('c5920000-0000-0000-0000-000000000006', 'C59 Manager Cancelada',   'c59-manager-cancelada@test.local',   true, null),
  ('c5920000-0000-0000-0000-000000000007', 'C59 Super Admin',         'c59-superadmin@test.local',          true, 'super_admin');

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('c5930000-0000-0000-0000-000000000001', 'c5910000-0000-0000-0000-000000000001', 'c5920000-0000-0000-0000-000000000001', 'manager', true),
  ('c5930000-0000-0000-0000-000000000002', 'c5910000-0000-0000-0000-000000000001', 'c5920000-0000-0000-0000-000000000002', 'seller',  true),
  ('c5930000-0000-0000-0000-000000000003', 'c5910000-0000-0000-0000-000000000002', 'c5920000-0000-0000-0000-000000000003', 'manager', true),
  ('c5930000-0000-0000-0000-000000000004', 'c5910000-0000-0000-0000-000000000003', 'c5920000-0000-0000-0000-000000000004', 'manager', true),
  ('c5930000-0000-0000-0000-000000000005', 'c5910000-0000-0000-0000-000000000004', 'c5920000-0000-0000-0000-000000000005', 'manager', true),
  ('c5930000-0000-0000-0000-000000000006', 'c5910000-0000-0000-0000-000000000005', 'c5920000-0000-0000-0000-000000000006', 'manager', true);
-- c5920000-...-000007 (Super Admin) deliberadamente sem membership.

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO / ASSINATURA / SEGURANÇA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'update_company_settings' and pronamespace = 'public'::regnamespace),
  1, 'update_company_settings existe exatamente uma vez (sem overload)');

select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'update_company_settings'),
  'p_company_id uuid, p_phone text, p_timezone text',
  'update_company_settings aceita exatamente 3 parametros, na ordem esperada');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.update_company_settings(uuid,text,text)'::regprocedure),
  true, 'update_company_settings e SECURITY DEFINER');

select is(
  (select p.provolatile from pg_proc p where p.oid = 'public.update_company_settings(uuid,text,text)'::regprocedure),
  'v', 'update_company_settings e VOLATILE');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'update_company_settings'
      and (p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'])),
  1, 'update_company_settings tem search_path vazio configurado');

select is(
  has_function_privilege('public', 'public.update_company_settings(uuid,text,text)', 'EXECUTE'),
  false, 'PUBLIC sem EXECUTE em update_company_settings');
select is(
  has_function_privilege('anon', 'public.update_company_settings(uuid,text,text)', 'EXECUTE'),
  false, 'anon sem EXECUTE em update_company_settings');
select is(
  has_function_privilege('authenticated', 'public.update_company_settings(uuid,text,text)', 'EXECUTE'),
  true, 'authenticated com EXECUTE em update_company_settings (autorizacao real e interna)');

-- Nenhum grant direto de UPDATE na tabela companies foi criado por este lote.
select is(
  has_table_privilege('authenticated', 'public.companies', 'UPDATE'),
  false, 'authenticated continua sem UPDATE direto em public.companies');

-- ══════════════════════════════════════════════════════════════════════
-- 2. AUTORIZAÇÃO
-- ══════════════════════════════════════════════════════════════════════

-- anon nunca teve EXECUTE concedido nesta funcao (mesmo padrao de
-- activate_company/create_company) — Postgres nega no nivel do GRANT, antes
-- mesmo do corpo da funcao rodar, entao o erro observavel e 42501 (permissao
-- do Postgres), nunca chega a 28000 (checagem interna de auth.uid()).
set local role anon;
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  '42501', null, 'sem autenticacao (anon): permission denied (sem EXECUTE)');
reset role;

select pg_temp.as_user('c5920000-0000-0000-0000-000000000002'); -- Seller Ativa
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  '42501', null, 'Seller da propria empresa: forbidden (nunca autorizado)');
reset role;

select pg_temp.as_user('c5920000-0000-0000-0000-000000000003'); -- Manager Outra
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  '42501', null, 'Manager de OUTRA empresa: forbidden, mesmo enviando p_company_id de uma empresa real');
reset role;

-- nenhuma das tentativas negadas acima alterou a Empresa Ativa
select is(
  (select phone from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  '(11) 4000-0001', 'phone da Empresa Ativa permanece inalterado apos as tentativas negadas');

-- ══════════════════════════════════════════════════════════════════════
-- 3. COMPANY INEXISTENTE / NULL
-- ══════════════════════════════════════════════════════════════════════

-- Um Manager alvo de empresa inexistente e indistinguivel de "empresa de
-- outra pessoa" (current_membership_company_id() nunca bate) — 42501,
-- nunca P0002 (nao revela existencia). P0002 so e alcancavel para um ator
-- ja autorizado (Super Admin), testado abaixo.
select pg_temp.as_user('c5920000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('99999999-9999-9999-9999-999999999999'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  '42501', null, 'Manager + company inexistente: forbidden (nunca revela se a empresa existe)');
reset role;

select pg_temp.as_user('c5920000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('99999999-9999-9999-9999-999999999999'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  'P0002', null, 'Super Admin + company inexistente: company_not_found (P0002)');
reset role;

select pg_temp.as_user('c5920000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings(null, '(11) 9999-0000', 'America/Bahia')$$,
  'P0002', null, 'p_company_id NULL retorna company_not_found (P0002) mesmo para Super Admin, nunca uma empresa implicita');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. STATUS: bloqueia suspensa/cancelada, permite implantacao/ativa
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c5920000-0000-0000-0000-000000000005'); -- Manager Suspensa
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000004'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  'P0001', null, 'empresa suspensa: company_status_conflict, mesmo para o Manager legitimo dela');
reset role;

select pg_temp.as_user('c5920000-0000-0000-0000-000000000006'); -- Manager Cancelada
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000005'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  'P0001', null, 'empresa cancelada: company_status_conflict, mesmo para o Manager legitimo dela');
reset role;

-- Super Admin tambem e bloqueado em suspensa/cancelada (regra propria desta
-- RPC, mais estrita que can_access_company/is_manager_or_platform).
select pg_temp.as_user('c5920000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000004'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  'P0001', null, 'Super Admin tambem recebe company_status_conflict em empresa suspensa (escrita e mais estrita que leitura)');
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000005'::uuid, '(11) 9999-0000', 'America/Bahia')$$,
  'P0001', null, 'Super Admin tambem recebe company_status_conflict em empresa cancelada');
reset role;

select is(
  (select phone from public.companies where id = 'c5910000-0000-0000-0000-000000000004'),
  null, 'phone da Empresa Suspensa permanece null apos as tentativas negadas (nenhuma escrita ocorreu)');

select pg_temp.as_user('c5920000-0000-0000-0000-000000000004'); -- Manager Implantacao
set local role authenticated;
select lives_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000003'::uuid, '(11) 5000-0003', 'America/Bahia')$$,
  'empresa em implantacao: Manager consegue configurar phone/timezone (permitido durante a implantacao)');
reset role;

select is(
  (select phone from public.companies where id = 'c5910000-0000-0000-0000-000000000003'),
  '(11) 5000-0003', 'phone da Empresa Implantacao foi atualizado');
select is(
  (select timezone from public.companies where id = 'c5910000-0000-0000-0000-000000000003'),
  'America/Bahia', 'timezone da Empresa Implantacao foi atualizado');

-- ══════════════════════════════════════════════════════════════════════
-- 5. TIMEZONE: obrigatorio, trim, validacao IANA real
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c5920000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '(11) 9999-0000', '')$$,
  '22023', null, 'timezone vazio (apos trim): invalid_parameter_value, nunca grava');
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '(11) 9999-0000', '   ')$$,
  '22023', null, 'timezone só espaços (apos trim vira vazio): invalid_parameter_value');
select throws_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '(11) 9999-0000', 'Nao/Existe_Timezone')$$,
  '22023', null, 'timezone invalido (nao reconhecido pelo tzdata do servidor): invalid_parameter_value, PostgreSQL rejeita, nunca so o browser');
-- ACHADO (nao um requisito deste EXEC, so documentado): o parser de
-- timezone do Postgres e mais permissivo do que "só nomes IANA exatos" —
-- 'Sao Paulo (GMT-3)' (a string de display antiga do fixture local) NAO
-- lanca 22023, é interpretada via o sufixo 'GMT-3' e resolve para um
-- offset fixo plausível. create_company() usa exatamente a mesma técnica
-- (perform now() at time zone) e herda a mesma leniência — não é uma
-- regressão introduzida aqui. A UI (<datalist> com sugestões IANA reais,
-- §18 do EXEC) é a mitigação prática: nunca convida o usuário a digitar
-- essa forma antiga. Not asserted as a rejection here — seria um teste
-- falso.
reset role;

-- nenhuma das tentativas de timezone invalido alterou a Empresa Ativa
select is(
  (select phone from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  '(11) 4000-0001', 'phone da Empresa Ativa continua o original apos as tentativas de timezone invalido');
select is(
  (select timezone from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  'America/Sao_Paulo', 'timezone da Empresa Ativa continua o original apos as tentativas de timezone invalido');

-- ══════════════════════════════════════════════════════════════════════
-- 6. SUCESSO REAL (Manager da propria empresa, ativa) + CAMPOS INTOCADOS
--    + AUDIT LOG
-- ══════════════════════════════════════════════════════════════════════

-- Escopado por company_id (nunca contagem global): a Empresa Implantacao
-- (secao 4) ja gerou 1 evento real antes deste ponto — só a Empresa Ativa
-- interessa aqui.
select is(
  (select count(*)::int from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000001'),
  0, 'nenhum evento company_settings_updated para a Empresa Ativa antes da escrita real');

select pg_temp.as_user('c5920000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select lives_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '  (11) 98888-7777  ', '  America/Bahia  ')$$,
  'Manager da propria empresa (ativa) atualiza phone/timezone com sucesso');
reset role;

select is(
  (select phone from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  '(11) 98888-7777', 'phone foi atualizado e trimado');
select is(
  (select timezone from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  'America/Bahia', 'timezone foi atualizado e trimado');
select is(
  (select name from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  'C59 Empresa Ativa', 'name permanece intocado');
select is(
  (select cnpj from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  '00.000.000/0001-01', 'cnpj permanece intocado');
select is(
  (select status::text from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  'ativa', 'status permanece intocado');

select is(
  (select count(*)::int from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000001'),
  1, 'exatamente 1 entrada de audit_log company_settings_updated para a empresa');
select is(
  (select actor_profile_id from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000001'),
  'c5920000-0000-0000-0000-000000000001'::uuid, 'actor_profile_id do audit_log e o Manager real que executou a acao');
select is(
  (select entity_type from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000001'),
  'company', 'entity_type do audit_log e company');
select is(
  (select result from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000001'),
  'success', 'result do audit_log e success');
select is(
  (select before_data from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000001'),
  jsonb_build_object('phone', '(11) 4000-0001', 'timezone', 'America/Sao_Paulo'),
  'before_data contem SOMENTE phone/timezone anteriores');
select is(
  (select after_data from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000001'),
  jsonb_build_object('phone', '(11) 98888-7777', 'timezone', 'America/Bahia'),
  'after_data contem SOMENTE phone/timezone novos');

-- ══════════════════════════════════════════════════════════════════════
-- 7. PHONE: string vazia (apos trim) vira NULL
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c5920000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select lives_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000001'::uuid, '   ', 'America/Bahia')$$,
  'phone em branco (so espacos) e aceito, vira NULL');
reset role;

select is(
  (select phone from public.companies where id = 'c5910000-0000-0000-0000-000000000001'),
  null, 'phone foi normalizado para NULL (nao string vazia)');

-- ══════════════════════════════════════════════════════════════════════
-- 8. SUPER ADMIN — sucesso com empresa valida explicita (future-proof)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c5920000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select lives_ok(
  $$select public.update_company_settings('c5910000-0000-0000-0000-000000000002'::uuid, '(11) 7000-0002', 'America/Manaus')$$,
  'Super Admin atualiza empresa valida (ativa) fornecendo p_company_id explicito');
reset role;

select is(
  (select phone from public.companies where id = 'c5910000-0000-0000-0000-000000000002'),
  '(11) 7000-0002', 'Super Admin: phone da Empresa Outra foi atualizado');
select is(
  (select actor_profile_id from public.audit_log where action = 'company_settings_updated' and company_id = 'c5910000-0000-0000-0000-000000000002'),
  'c5920000-0000-0000-0000-000000000007'::uuid, 'audit_log registra o Super Admin real como actor, nunca um ator "efetivo"');

select * from finish();
rollback;
