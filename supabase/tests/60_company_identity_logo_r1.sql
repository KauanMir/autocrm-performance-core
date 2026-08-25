-- COMPANY-IDENTITY-LOGO-R1-EXEC — coluna companies.logo_path, bucket
-- company-logos (público, contrato de MIME/tamanho), policies de Storage
-- (INSERT/DELETE, Manager própria empresa / Super Admin explícito) e RPC
-- update_company_logo. Mesmo molde de 59_company_settings_manager_r1.sql:
-- fixtures sintéticas @test.local, transação com rollback.
--
-- NOTA (§41 do EXEC): limite de tamanho (2 MB) e whitelist de MIME
-- (image/png|jpeg|webp) são contrato do BUCKET (storage.buckets.
-- file_size_limit/allowed_mime_types), aplicados pelo serviço Storage API
-- no upload real — não são policies de RLS e não há caminho para exercitar
-- esse enforcement via SQL direto em storage.objects (um INSERT direto não
-- carrega bytes nem Content-Type de requisição HTTP). A seção 5 abaixo
-- confirma que o bucket está configurado com esses limites; o enforcement
-- em si fica coberto por smoke test manual (§48 do EXEC), nunca fingido
-- aqui como cobertura pgTAP.
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
  ('c6010000-0000-0000-0000-000000000001', 'C60 Empresa Ativa',       '00.000.000/0002-01', '(11) 4100-0001', 'America/Sao_Paulo', 'ativa'),
  ('c6010000-0000-0000-0000-000000000002', 'C60 Empresa Outra',       '00.000.000/0002-02', '(11) 4100-0002', 'America/Sao_Paulo', 'ativa'),
  ('c6010000-0000-0000-0000-000000000003', 'C60 Empresa Implantacao', '00.000.000/0002-03', null,             'America/Sao_Paulo', 'implantacao'),
  ('c6010000-0000-0000-0000-000000000004', 'C60 Empresa Suspensa',    null,                  null,             'America/Sao_Paulo', 'suspensa'),
  ('c6010000-0000-0000-0000-000000000005', 'C60 Empresa Cancelada',   null,                  null,             'America/Sao_Paulo', 'cancelada');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c6020000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c60-manager-ativa@test.local',       now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c6020000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c60-seller-ativa@test.local',        now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c6020000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'c60-manager-outra@test.local',       now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c6020000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'c60-manager-implantacao@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c6020000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'c60-manager-suspensa@test.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c6020000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'c60-manager-cancelada@test.local',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c6020000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'c60-superadmin@test.local',          now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('c6020000-0000-0000-0000-000000000001', 'C60 Manager Ativa',       'c60-manager-ativa@test.local',       true, null),
  ('c6020000-0000-0000-0000-000000000002', 'C60 Seller Ativa',        'c60-seller-ativa@test.local',        true, null),
  ('c6020000-0000-0000-0000-000000000003', 'C60 Manager Outra',       'c60-manager-outra@test.local',       true, null),
  ('c6020000-0000-0000-0000-000000000004', 'C60 Manager Implantacao', 'c60-manager-implantacao@test.local', true, null),
  ('c6020000-0000-0000-0000-000000000005', 'C60 Manager Suspensa',    'c60-manager-suspensa@test.local',    true, null),
  ('c6020000-0000-0000-0000-000000000006', 'C60 Manager Cancelada',   'c60-manager-cancelada@test.local',   true, null),
  ('c6020000-0000-0000-0000-000000000007', 'C60 Super Admin',         'c60-superadmin@test.local',          true, 'super_admin');

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('c6030000-0000-0000-0000-000000000001', 'c6010000-0000-0000-0000-000000000001', 'c6020000-0000-0000-0000-000000000001', 'manager', true),
  ('c6030000-0000-0000-0000-000000000002', 'c6010000-0000-0000-0000-000000000001', 'c6020000-0000-0000-0000-000000000002', 'seller',  true),
  ('c6030000-0000-0000-0000-000000000003', 'c6010000-0000-0000-0000-000000000002', 'c6020000-0000-0000-0000-000000000003', 'manager', true),
  ('c6030000-0000-0000-0000-000000000004', 'c6010000-0000-0000-0000-000000000003', 'c6020000-0000-0000-0000-000000000004', 'manager', true),
  ('c6030000-0000-0000-0000-000000000005', 'c6010000-0000-0000-0000-000000000004', 'c6020000-0000-0000-0000-000000000005', 'manager', true),
  ('c6030000-0000-0000-0000-000000000006', 'c6010000-0000-0000-0000-000000000005', 'c6020000-0000-0000-0000-000000000006', 'manager', true);
-- c6020000-...-000007 (Super Admin) deliberadamente sem membership.

-- ══════════════════════════════════════════════════════════════════════
-- 1. COLUNA companies.logo_path
-- ══════════════════════════════════════════════════════════════════════

select has_column('public', 'companies', 'logo_path', 'companies.logo_path existe');
select col_type_is('public', 'companies', 'logo_path', 'text', 'companies.logo_path e text');
select col_is_null('public', 'companies', 'logo_path', 'companies.logo_path aceita NULL (empresa sem logo)');
select is(
  (select logo_path from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  null, 'companies.logo_path comeca NULL para uma empresa nova (nenhum default fake)');

-- ══════════════════════════════════════════════════════════════════════
-- 2. RPC update_company_logo — CATÁLOGO / ASSINATURA / SEGURANÇA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'update_company_logo' and pronamespace = 'public'::regnamespace),
  1, 'update_company_logo existe exatamente uma vez (sem overload)');

select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'update_company_logo'),
  'p_company_id uuid, p_logo_path text',
  'update_company_logo aceita exatamente 2 parametros, na ordem esperada');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.update_company_logo(uuid,text)'::regprocedure),
  true, 'update_company_logo e SECURITY DEFINER');

select is(
  (select p.provolatile from pg_proc p where p.oid = 'public.update_company_logo(uuid,text)'::regprocedure),
  'v', 'update_company_logo e VOLATILE');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'update_company_logo'
      and (p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'])),
  1, 'update_company_logo tem search_path vazio configurado');

select is(
  has_function_privilege('public', 'public.update_company_logo(uuid,text)', 'EXECUTE'),
  false, 'PUBLIC sem EXECUTE em update_company_logo');
select is(
  has_function_privilege('anon', 'public.update_company_logo(uuid,text)', 'EXECUTE'),
  false, 'anon sem EXECUTE em update_company_logo');
select is(
  has_function_privilege('authenticated', 'public.update_company_logo(uuid,text)', 'EXECUTE'),
  true, 'authenticated com EXECUTE em update_company_logo (autorizacao real e interna)');

select is(
  has_table_privilege('authenticated', 'public.companies', 'UPDATE'),
  false, 'authenticated continua sem UPDATE direto em public.companies');

-- ══════════════════════════════════════════════════════════════════════
-- 3. RPC update_company_logo — AUTORIZAÇÃO
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, null)$$,
  '42501', null, 'sem autenticacao (anon): permission denied (sem EXECUTE)');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000002'); -- Seller Ativa
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000001/logos/x.png')$$,
  '42501', null, 'Seller da propria empresa: forbidden (nunca autorizado)');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000003'); -- Manager Outra
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000001/logos/x.png')$$,
  '42501', null, 'Manager de OUTRA empresa: forbidden, mesmo enviando p_company_id de uma empresa real');
reset role;

select is(
  (select logo_path from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  null, 'logo_path da Empresa Ativa permanece NULL apos as tentativas negadas');

select pg_temp.as_user('c6020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('99999999-9999-9999-9999-999999999999'::uuid, null)$$,
  '42501', null, 'Manager + company inexistente: forbidden (nunca revela se a empresa existe)');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('99999999-9999-9999-9999-999999999999'::uuid, null)$$,
  'P0002', null, 'Super Admin + company inexistente: company_not_found (P0002)');
select throws_ok(
  $$select public.update_company_logo(null, null)$$,
  'P0002', null, 'p_company_id NULL retorna company_not_found (P0002) mesmo para Super Admin, nunca empresa implicita');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. RPC update_company_logo — STATUS
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c6020000-0000-0000-0000-000000000005'); -- Manager Suspensa
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000004'::uuid, 'c6010000-0000-0000-0000-000000000004/logos/x.png')$$,
  'P0001', null, 'empresa suspensa: company_status_conflict, mesmo para o Manager legitimo dela');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000006'); -- Manager Cancelada
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000005'::uuid, 'c6010000-0000-0000-0000-000000000005/logos/x.png')$$,
  'P0001', null, 'empresa cancelada: company_status_conflict, mesmo para o Manager legitimo dela');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000004'::uuid, null)$$,
  'P0001', null, 'Super Admin tambem recebe company_status_conflict em empresa suspensa (escrita mais estrita que leitura)');
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000005'::uuid, null)$$,
  'P0001', null, 'Super Admin tambem recebe company_status_conflict em empresa cancelada');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000004'); -- Manager Implantacao
set local role authenticated;
select lives_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000003'::uuid, 'c6010000-0000-0000-0000-000000000003/logos/impl.png')$$,
  'empresa em implantacao: Manager consegue configurar logo (permitido durante a implantacao)');
reset role;

select is(
  (select logo_path from public.companies where id = 'c6010000-0000-0000-0000-000000000003'),
  'c6010000-0000-0000-0000-000000000003/logos/impl.png', 'logo_path da Empresa Implantacao foi atualizado');

-- ══════════════════════════════════════════════════════════════════════
-- 5. RPC update_company_logo — VALIDAÇÃO DE PATH
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c6020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000002/logos/x.png')$$,
  '22023', null, 'path de OUTRA empresa (primeiro segmento nao bate com p_company_id): logo_path_invalid');
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000001/assets/x.png')$$,
  '22023', null, 'segundo segmento diferente de "logos": logo_path_invalid');
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000001/logos/')$$,
  '22023', null, 'filename vazio: logo_path_invalid');
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000001/logos/../x.png')$$,
  '22023', null, 'path contendo "..": logo_path_invalid');
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'https://evil.example/c6010000-0000-0000-0000-000000000001/logos/x.png')$$,
  '22023', null, 'URL completa (nunca so object path): logo_path_invalid');
select throws_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000001/logos/sub/x.png')$$,
  '22023', null, 'mais de 3 segmentos (subpasta extra): logo_path_invalid');
reset role;

select is(
  (select logo_path from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  null, 'logo_path da Empresa Ativa continua NULL apos as tentativas de path invalido');

-- ══════════════════════════════════════════════════════════════════════
-- 6. RPC update_company_logo — SUCESSO REAL + CAMPOS INTOCADOS + AUDIT LOG
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  0, 'nenhum evento company_logo_updated para a Empresa Ativa antes da escrita real');

select pg_temp.as_user('c6020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select lives_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, 'c6010000-0000-0000-0000-000000000001/logos/550e8400-0000-0000-0000-000000000000.png')$$,
  'Manager da propria empresa (ativa) define a logo com sucesso');
reset role;

select is(
  (select logo_path from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  'c6010000-0000-0000-0000-000000000001/logos/550e8400-0000-0000-0000-000000000000.png', 'logo_path foi atualizado');
select is(
  (select name from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  'C60 Empresa Ativa', 'name permanece intocado');
select is(
  (select cnpj from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  '00.000.000/0002-01', 'cnpj permanece intocado');
select is(
  (select phone from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  '(11) 4100-0001', 'phone permanece intocado');
select is(
  (select timezone from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  'America/Sao_Paulo', 'timezone permanece intocado');
select is(
  (select status::text from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  'ativa', 'status permanece intocado');

select is(
  (select count(*)::int from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  1, 'exatamente 1 entrada de audit_log company_logo_updated para a empresa');
select is(
  (select actor_profile_id from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  'c6020000-0000-0000-0000-000000000001'::uuid, 'actor_profile_id do audit_log e o Manager real que executou a acao');
select is(
  (select entity_type from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  'company', 'entity_type do audit_log e company');
select is(
  (select result from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  'success', 'result do audit_log e success');
select is(
  (select before_data from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  jsonb_build_object('logo_path', null),
  'before_data contem SOMENTE logo_path anterior (null)');
select is(
  (select after_data from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  jsonb_build_object('logo_path', 'c6010000-0000-0000-0000-000000000001/logos/550e8400-0000-0000-0000-000000000000.png'),
  'after_data contem SOMENTE o logo_path novo');

-- ══════════════════════════════════════════════════════════════════════
-- 7. RPC update_company_logo — REMOÇÃO (NULL sempre permitido)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c6020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select lives_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000001'::uuid, null)$$,
  'Manager remove a logo (NULL) com sucesso');
reset role;

select is(
  (select logo_path from public.companies where id = 'c6010000-0000-0000-0000-000000000001'),
  null, 'logo_path foi removido (NULL)');
select is(
  (select count(*)::int from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001'),
  2, '2a entrada de audit_log company_logo_updated (definir + remover)');
select is(
  (select after_data from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000001' order by ctid desc limit 1),
  jsonb_build_object('logo_path', null),
  'after_data da remocao contem logo_path null (occurred_at empata dentro da mesma transacao — ordena por ctid, ordem fisica de insercao)');

-- ══════════════════════════════════════════════════════════════════════
-- 8. RPC update_company_logo — SUPER ADMIN (empresa explicita, future-proof)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c6020000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select lives_ok(
  $$select public.update_company_logo('c6010000-0000-0000-0000-000000000002'::uuid, 'c6010000-0000-0000-0000-000000000002/logos/sa.png')$$,
  'Super Admin define logo de empresa valida (ativa) fornecendo p_company_id explicito');
reset role;

select is(
  (select logo_path from public.companies where id = 'c6010000-0000-0000-0000-000000000002'),
  'c6010000-0000-0000-0000-000000000002/logos/sa.png', 'Super Admin: logo_path da Empresa Outra foi atualizado');
select is(
  (select actor_profile_id from public.audit_log where action = 'company_logo_updated' and company_id = 'c6010000-0000-0000-0000-000000000002'),
  'c6020000-0000-0000-0000-000000000007'::uuid, 'audit_log registra o Super Admin real como actor, nunca um ator "efetivo"');

-- ══════════════════════════════════════════════════════════════════════
-- 9. STORAGE — BUCKET company-logos
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from storage.buckets where id = 'company-logos'),
  1, 'bucket company-logos existe');
select is(
  (select public from storage.buckets where id = 'company-logos'),
  true, 'bucket company-logos e publico');
select is(
  (select file_size_limit from storage.buckets where id = 'company-logos'),
  2097152::bigint, 'bucket company-logos limita 2 MB por arquivo');
select is(
  (select allowed_mime_types from storage.buckets where id = 'company-logos'),
  array['image/png', 'image/jpeg', 'image/webp'],
  'bucket company-logos aceita somente png/jpeg/webp (nunca svg/gif/octet-stream)');

-- ══════════════════════════════════════════════════════════════════════
-- 10. STORAGE — POLICIES (catálogo: INSERT/DELETE/SELECT, zero UPDATE)
-- ══════════════════════════════════════════════════════════════════════
-- SELECT existe (achado documentado na migration): sem uma policy de
-- SELECT aplicável, Postgres nunca enxerga a linha-alvo para DELETE, mesmo
-- com a policy de DELETE satisfeita — por isso as duas policies de SELECT
-- têm o MESMO escopo de DELETE (Manager própria empresa / Super Admin
-- explícito), nunca `using (true)` — a leitura pública de qualquer
-- visitante continua vindo da rota HTTP pública do Storage, sem RLS.

select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'company_logos_%'),
  6, 'exatamente 6 policies de company_logos em storage.objects (insert/delete/select x manager/super_admin)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'company_logos_%' and cmd = 'SELECT'),
  2, 'exatamente 2 policies de SELECT para company_logos (Manager propria empresa / Super Admin explicito — exigidas para DELETE funcionar, nunca abertas)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'company_logos_%' and cmd = 'UPDATE'),
  0, 'nenhuma policy de UPDATE para company_logos (paths versionados: INSERT novo + DELETE antigo)');

-- Escopo real da SELECT (RLS via linha em storage.objects, inserida como
-- postgres, que contorna RLS por ser dono da tabela).
insert into storage.objects (bucket_id, name) values
  ('company-logos', 'c6010000-0000-0000-0000-000000000001/logos/select-own.png'),
  ('company-logos', 'c6010000-0000-0000-0000-000000000002/logos/select-other.png');

select pg_temp.as_user('c6020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/select-own.png'),
  1, 'Manager consegue ver (SELECT) objeto da PROPRIA empresa');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000002/logos/select-other.png'),
  0, 'Manager NAO ve (SELECT) objeto de OUTRA empresa');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000002'); -- Seller Ativa
set local role authenticated;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/select-own.png'),
  0, 'Seller NUNCA ve (SELECT) objeto via RLS, mesmo da propria empresa (leitura publica real vem da rota HTTP, nunca de RLS)');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000002/logos/select-other.png'),
  1, 'Super Admin consegue ver (SELECT) objeto de empresa explicita acessivel');
reset role;

set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'company-logos' and name in (
  'c6010000-0000-0000-0000-000000000001/logos/select-own.png',
  'c6010000-0000-0000-0000-000000000002/logos/select-other.png'
);

-- ══════════════════════════════════════════════════════════════════════
-- 11. STORAGE — INSERT (RLS real, via linha em storage.objects)
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-logos', 'c6010000-0000-0000-0000-000000000001/logos/anon.png')$$,
  '42501', null, 'anon: nenhuma policy de INSERT cobre este role, RLS nega');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-logos', 'c6010000-0000-0000-0000-000000000001/logos/manager-own.png')$$,
  'Manager insere objeto na PROPRIA pasta (<company_id>/logos/...)');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-logos', 'c6010000-0000-0000-0000-000000000002/logos/manager-outra.png')$$,
  '42501', null, 'Manager NAO insere objeto na pasta de OUTRA empresa');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000002'); -- Seller Ativa
set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-logos', 'c6010000-0000-0000-0000-000000000001/logos/seller.png')$$,
  '42501', null, 'Seller NUNCA insere objeto (mesmo na propria empresa)');
reset role;

select pg_temp.as_user('c6020000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-logos', 'c6010000-0000-0000-0000-000000000002/logos/sa-insert.png')$$,
  'Super Admin insere objeto em empresa explicita acessivel');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-logos', '99999999-9999-9999-9999-999999999999/logos/sa-invalid.png')$$,
  '42501', null, 'Super Admin NAO insere objeto em empresa inexistente (can_access_company falha)');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-logos', 'not-a-uuid/logos/sa-badformat.png')$$,
  '42501', null, 'Super Admin NAO insere objeto com primeiro segmento fora do formato uuid (nega, nunca lanca excecao de cast)');
reset role;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000002/logos/manager-outra.png'),
  0, 'nenhum objeto foi criado na tentativa negada de Manager em pasta de outra empresa');

-- ══════════════════════════════════════════════════════════════════════
-- 12. STORAGE — DELETE (RLS real; fixtures inseridas como postgres, que
--     contorna RLS por ser dono da tabela — mesma técnica de qualquer
--     fixture de teste). storage.allow_delete_query habilita o DELETE
--     direto (guard trigger da extensão Storage, não é RLS — só protege
--     contra apagar tabelas do Storage fora da Storage API) UMA VEZ para
--     o resto desta transação (SET LOCAL vale até o rollback final, não
--     por statement) — a RLS de baixo continua sendo a autoridade real
--     testada aqui. DELETE nunca lança exceção quando a policy nega: a
--     policy USING é um filtro silencioso (0 linhas afetadas), diferente
--     de INSERT (WITH CHECK falho lança 42501) — por isso os asserts
--     abaixo checam EXISTÊNCIA da linha após o DELETE, nunca throws_ok.
-- ══════════════════════════════════════════════════════════════════════

set local storage.allow_delete_query = 'true';

insert into storage.objects (bucket_id, name) values
  ('company-logos', 'c6010000-0000-0000-0000-000000000001/logos/to-delete-own.png'),
  ('company-logos', 'c6010000-0000-0000-0000-000000000002/logos/to-delete-other.png');

select pg_temp.as_user('c6020000-0000-0000-0000-000000000002'); -- Seller Ativa
set local role authenticated;
delete from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/to-delete-own.png';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/to-delete-own.png'),
  1, 'Seller NUNCA remove objeto (mesmo na propria empresa) — RLS nega silenciosamente, linha continua existindo');

select pg_temp.as_user('c6020000-0000-0000-0000-000000000003'); -- Manager Outra
set local role authenticated;
delete from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/to-delete-own.png';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/to-delete-own.png'),
  1, 'Manager de OUTRA empresa nao remove objeto da Empresa Ativa (RLS nega, linha continua existindo)');

select pg_temp.as_user('c6020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
delete from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/to-delete-own.png';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000001/logos/to-delete-own.png'),
  0, 'Manager da PROPRIA empresa remove o proprio objeto com sucesso');

select pg_temp.as_user('c6020000-0000-0000-0000-000000000007'); -- Super Admin
set local role authenticated;
delete from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000002/logos/to-delete-other.png';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-logos' and name = 'c6010000-0000-0000-0000-000000000002/logos/to-delete-other.png'),
  0, 'Super Admin remove objeto de empresa explicita acessivel');

select * from finish();
rollback;
