-- PLATFORM-COMPANY-ACTIVATION-A1 — testes de public.activate_company()
-- (pgTAP): transição implantacao -> ativa, autorização exclusiva de Super
-- Admin, idempotência, conflito de status (suspensa/cancelada), audit_log,
-- grants. Reaproveita os 4 usuários seedados (11111111 ADMIN legado,
-- 22222222 MANAGER, 33333333/44444444 SELLER) da company seedada
-- '00000000-...-0001' para os testes de autorização negativa — mesmo
-- padrão de 21_m1f_s3a_company_creation.sql. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixture: Super Admin temporário só para este teste (como postgres,
--    fora de qualquer caminho de authenticated/anon) — id próprio, nunca
--    colide com a fixture de 21_ (transações de teste isoladas). ────────
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fa000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fa58superadmin@test.local', now(), now(), now());
insert into public.profiles (id, name, email, is_active) values
  ('fa000000-0000-0000-0000-000000000001', 'F58 SuperAdmin (fixture)', 'fa58superadmin@test.local', true);
update public.profiles set platform_role = 'super_admin' where id = 'fa000000-0000-0000-0000-000000000001';

-- fixture: empresa nova, criada via create_company() (nunca INSERT direto)
-- para nascer exatamente como o produto cria — status 'implantacao'.
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_company('Empresa A1 Ativacao')$$,
  'fixture: Super Admin cria a empresa alvo dos testes de ativacao');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- AUTORIZAÇÃO
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select public.activate_company((select id from public.companies where name = 'Empresa A1 Ativacao'))$$,
  '42501', null, 'anon nao executa activate_company');
reset role;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.activate_company('00000000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'Seller nao ativa empresa (nem a propria)');
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.activate_company('00000000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'Manager nao ativa empresa (nem a propria, membership nunca e autoridade aqui)');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.activate_company('00000000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'ADMIN legado (platform_role null) nao ativa empresa');
reset role;

-- nenhuma das tentativas negadas acima mudou o status da empresa seedada
-- (que ja e 'ativa' desde o seed — confirma que nada foi escrito)
select is(
  (select status::text from public.companies where id = '00000000-0000-0000-0000-000000000001'),
  'ativa', 'status da empresa seedada permanece inalterado apos as tentativas negadas');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPANY INEXISTENTE
-- ═══════════════════════════════════════════════════════════════════════

select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.activate_company('99999999-9999-9999-9999-999999999999'::uuid)$$,
  'P0002', null, 'company inexistente retorna company_not_found (P0002)');
select throws_ok(
  $$select public.activate_company(null)$$,
  'P0002', null, 'p_company_id NULL retorna company_not_found (P0002), nunca ativa a empresa errada');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ATIVAÇÃO REAL (Super Admin) + AUDIT
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.audit_log where action = 'company_activated'),
  0, 'nenhum evento company_activated antes da ativacao real');

select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.activate_company((select id from public.companies where name = 'Empresa A1 Ativacao'))$$,
  'Super Admin ativa empresa em implantacao (implantacao -> ativa)');
reset role;

select is(
  (select status::text from public.companies where name = 'Empresa A1 Ativacao'),
  'ativa', 'status da empresa alvo agora e ativa');

select is(
  (select count(*)::int from public.audit_log where action = 'company_activated' and company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  1, 'exatamente 1 entrada de audit_log company_activated para a empresa');

select is(
  (select actor_profile_id from public.audit_log where action = 'company_activated' and company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  'fa000000-0000-0000-0000-000000000001'::uuid, 'actor_profile_id do audit_log e o Super Admin real que executou a acao');

select is(
  (select entity_type from public.audit_log where action = 'company_activated' and company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  'company', 'entity_type do audit_log e company');

select is(
  (select result from public.audit_log where action = 'company_activated' and company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  'success', 'result do audit_log e success');

select is(
  (select before_data ->> 'status' from public.audit_log where action = 'company_activated' and company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  'implantacao', 'before_data.status registra o estado anterior (implantacao)');

select is(
  (select after_data ->> 'status' from public.audit_log where action = 'company_activated' and company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  'ativa', 'after_data.status registra o novo estado (ativa)');

-- ═══════════════════════════════════════════════════════════════════════
-- IDEMPOTÊNCIA (empresa já ativa)
-- ═══════════════════════════════════════════════════════════════════════

select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.activate_company((select id from public.companies where name = 'Empresa A1 Ativacao'))$$,
  'ativar uma empresa ja ativa nao lanca erro (idempotente)');
reset role;

select is(
  (select status::text from public.companies where name = 'Empresa A1 Ativacao'),
  'ativa', 'status continua ativa apos a chamada idempotente');

select is(
  (select count(*)::int from public.audit_log where action = 'company_activated' and company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  1, 'chamada idempotente NAO cria uma segunda entrada de audit_log');

-- ativar a empresa seedada (ja 'ativa' desde o seed.sql) tambem e idempotente
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.activate_company('00000000-0000-0000-0000-000000000001'::uuid)$$,
  'ativar a empresa seedada (ja ativa) e idempotente, sem erro');
reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'company_activated' and company_id = '00000000-0000-0000-0000-000000000001'::uuid),
  0, 'empresa que ja estava ativa ANTES desta RPC existir nunca gera audit_log ao ser "reativada" (idempotente = sem escrita)');

-- ═══════════════════════════════════════════════════════════════════════
-- CONFLITO DE STATUS (suspensa / cancelada)
-- ═══════════════════════════════════════════════════════════════════════

-- fixtures de status suspensa/cancelada: UPDATE direto como postgres, fora
-- de qualquer caminho authenticated/anon (nao existe RPC de suspensao/
-- cancelamento de empresa ainda — mesmo raciocinio do trigger de falha
-- forcada em 21_m1f_s3a_company_creation.sql, so para preparar o cenario
-- de teste, revertido pelo rollback do arquivo).
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_company('Empresa A1 Suspensa')$$,
  'fixture: empresa criada para o cenario suspensa');
select lives_ok(
  $$select public.create_company('Empresa A1 Cancelada')$$,
  'fixture: empresa criada para o cenario cancelada');
reset role;

-- ids capturados ANTES da mudanca de status: can_access_company() nega
-- leitura de empresa 'cancelada' mesmo para Super Admin (m1f_s11, §7.4/§8),
-- entao um SELECT por nome DEPOIS de cancelar retornaria NULL — o id
-- literal e usado diretamente nas chamadas de activate_company abaixo
-- (a propria RPC, SECURITY DEFINER, sempre enxerga a linha independente de
-- RLS, exatamente como qualquer outra RPC deste projeto).
select id as v58_suspensa_id from public.companies where name = 'Empresa A1 Suspensa' \gset
select id as v58_cancelada_id from public.companies where name = 'Empresa A1 Cancelada' \gset

update public.companies set status = 'suspensa' where name = 'Empresa A1 Suspensa';
update public.companies set status = 'cancelada' where name = 'Empresa A1 Cancelada';

select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  format($$select public.activate_company(%L::uuid)$$, :'v58_suspensa_id'),
  'P0001', null, 'empresa suspensa nao e ativada (company_status_conflict)');
select throws_ok(
  format($$select public.activate_company(%L::uuid)$$, :'v58_cancelada_id'),
  'P0001', null, 'empresa cancelada nao e ativada (company_status_conflict)');
reset role;

select is(
  (select status::text from public.companies where name = 'Empresa A1 Suspensa'),
  'suspensa', 'empresa suspensa permanece suspensa apos a tentativa negada');
select is(
  (select status::text from public.companies where name = 'Empresa A1 Cancelada'),
  'cancelada', 'empresa cancelada permanece cancelada apos a tentativa negada');
select is(
  (select count(*)::int from public.audit_log where action = 'company_activated' and company_id in (
    select id from public.companies where name in ('Empresa A1 Suspensa', 'Empresa A1 Cancelada')
  )),
  0, 'nenhum audit_log company_activated foi criado pelas tentativas de conflito');

-- ═══════════════════════════════════════════════════════════════════════
-- ESCOPO: nenhum outro gate/transição foi criado
-- ═══════════════════════════════════════════════════════════════════════

-- nenhuma RPC de suspend/reactivate/cancel de empresa foi criada neste lote
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('suspend_company', 'reactivate_company', 'cancel_company')),
  0, 'nenhuma RPC de suspend/reactivate/cancel de empresa foi criada por este lote (fora de escopo)');

-- enum company_status permanece com exatamente os mesmos 4 valores
select is(
  (select array_agg(enumlabel::text order by enumsortorder) from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'company_status'),
  array['implantacao','ativa','suspensa','cancelada'],
  'company_status continua com exatamente os mesmos 4 valores (nenhum enum novo)');

-- ═══════════════════════════════════════════════════════════════════════
-- ASSINATURA / GRANTS / SEGURANÇA
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'activate_company'),
  'p_company_id uuid',
  'activate_company aceita exatamente 1 parametro (p_company_id), sem p_note nesta V1');

select is(
  has_function_privilege('public', 'public.activate_company(uuid)', 'EXECUTE'),
  false, 'PUBLIC sem EXECUTE em activate_company');
select is(
  has_function_privilege('anon', 'public.activate_company(uuid)', 'EXECUTE'),
  false, 'anon sem EXECUTE em activate_company');
select is(
  has_function_privilege('authenticated', 'public.activate_company(uuid)', 'EXECUTE'),
  true, 'authenticated com EXECUTE em activate_company (autorizacao real e interna, via is_platform_super_admin)');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'activate_company'
      and (p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'])),
  1, 'activate_company tem search_path vazio configurado');
select is(
  (select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'activate_company'),
  true, 'activate_company e SECURITY DEFINER');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE: gates comerciais existentes continuam exigindo 'ativa'
-- ═══════════════════════════════════════════════════════════════════════

-- Seller da empresa recem-ativada ainda nao existe (nenhum membership foi
-- criado por create_company/activate_company) — confirma que a ativacao
-- por si so nao concede nenhum acesso comercial a ninguem, so remove o
-- bloqueio de status para quem ja tem membership valida
select is(
  (select count(*)::int from public.company_memberships where company_id = (select id from public.companies where name = 'Empresa A1 Ativacao')),
  0, 'activate_company nao cria nenhuma membership (nao concede acesso, so remove o bloqueio de status)');

select * from finish();
rollback;
