-- CRM-BULK-IMPORT-B1 — bulk_import_leads + import_batches + insert_lead_row
-- + create_lead (regressão pós-extração do helper). Prova: (1) autorização
-- espelha resolve_lead_mutation_context (Manager/Super Admin/Seller/sem
-- sessão); (2) validação em lote (name/phone/car/seller/temperature);
-- (3) fallback de veículo nunca silencioso; (4) duplicidade existente e
-- intra-lote SEMPRE skip, nunca error, nunca merge; (5) nenhuma informação
-- do Lead colidido vaza na resposta; (6) stage sempre 'new'; (7) timeline
-- "Lead criado" para todo importado; (8) import parcial não aborta linhas
-- boas; (9) idempotência real por (company_id, client_request_id) —
-- replay exato, nenhum Lead duplicado; (10) limite de 2000 linhas;
-- (11) RLS de import_batches; (12) create_lead preserva assinatura,
-- grants e comportamento externo após a extração de insert_lead_row.
-- Rollback ao final — nenhum dado permanece.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ═══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, status) values
  ('b1000000-0000-0000-0000-000000000001', 'BULK Empresa A Ativa', 'ativa'),
  ('b1000000-0000-0000-0000-000000000002', 'BULK Empresa B Ativa (outra)', 'ativa'),
  ('b1000000-0000-0000-0000-000000000003', 'BULK Empresa C Suspensa', 'suspensa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'b1100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bulk-superadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bulk-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1100000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'bulk-seller-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1100000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'bulk-manager-c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1100000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'bulk-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1100000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'bulk-nomembership@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('b1100000-0000-0000-0000-000000000001', 'Super Admin Bulk', 'bulk-superadmin@test.local', true, 'super_admin'),
  ('b1100000-0000-0000-0000-000000000002', 'Manager A Bulk', 'bulk-manager-a@test.local', true, null),
  ('b1100000-0000-0000-0000-000000000003', 'Seller A Bulk', 'bulk-seller-a@test.local', true, null),
  ('b1100000-0000-0000-0000-000000000004', 'Manager C Bulk (suspensa)', 'bulk-manager-c@test.local', true, null),
  ('b1100000-0000-0000-0000-000000000005', 'Manager B Bulk', 'bulk-manager-b@test.local', true, null),
  ('b1100000-0000-0000-0000-000000000006', 'Sem Membership Bulk', 'bulk-nomembership@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('b1200000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'b1100000-0000-0000-0000-000000000002', 'manager', true),
  ('b1200000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'b1100000-0000-0000-0000-000000000003', 'seller', true),
  ('b1200000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000003', 'b1100000-0000-0000-0000-000000000004', 'manager', true),
  ('b1200000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000002', 'b1100000-0000-0000-0000-000000000005', 'manager', true);

insert into public.sellers (id, company_id, profile_id, membership_id, name, first_name, is_active) values
  ('bulkSellerA1',   'b1000000-0000-0000-0000-000000000001', 'b1100000-0000-0000-0000-000000000003', 'b1200000-0000-0000-0000-000000000003', 'Vendedor A1 Bulk', 'A1', true),
  ('bulkSellerA1Ina','b1000000-0000-0000-0000-000000000001', null, null, 'Vendedor Inativo Bulk', 'Inat', false),
  ('bulkSellerOther','b1000000-0000-0000-0000-000000000002', null, null, 'Vendedor Outra Empresa Bulk', 'Outra', true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('b1400000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('b1400000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'new', 'Novo', 0),
  ('b1400000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', 'new', 'Novo', 0);

-- Lead pré-existente em BI1, telefone conhecido — alvo da prova de
-- duplicidade "já existente no banco".
insert into public.leads (id, company_id, name, phone, car, stage_id) values
  ('b1500000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Lead Pre-existente', '(11) 90000-1001', 'HB20',
   'b1400000-0000-0000-0000-000000000001');
-- Lead com o MESMO telefone em BI2 (outra empresa) — prova de isolamento:
-- nunca deve contar como duplicado para um lote rodando em BI1.
insert into public.leads (id, company_id, name, phone, car, stage_id) values
  ('b1500000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Lead Outra Empresa', '(11) 90000-2002', 'Onix',
   'b1400000-0000-0000-0000-000000000002');

-- ═══════════════════════════════════════════════════════════════════════
-- CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bulk_import_leads'),
  1, 'bulk_import_leads: uma única assinatura');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'insert_lead_row'),
  1, 'insert_lead_row: uma única assinatura');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bulk_import_leads'),
  'bulk_import_leads: SECURITY DEFINER');
select ok(
  (select exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bulk_import_leads'),
  'bulk_import_leads: search_path configurado explicitamente');

select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'bulk_import_leads' and grantee = 'authenticated'),
  1, 'bulk_import_leads: authenticated tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'bulk_import_leads' and grantee = 'anon'),
  0, 'bulk_import_leads: anon NAO tem EXECUTE');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'insert_lead_row' and grantee = 'authenticated'),
  0, 'insert_lead_row: authenticated NAO tem EXECUTE (helper interno, nunca porta publica)');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'insert_lead_row' and grantee = 'anon'),
  0, 'insert_lead_row: anon NAO tem EXECUTE');

-- import_batches: RLS ligada, exatamente 1 policy (SELECT), sem grants de
-- escrita para authenticated.
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'import_batches'),
  1, 'import_batches: exatamente 1 policy (SELECT)');
select ok(
  (select relrowsecurity from pg_class where relname = 'import_batches' and relnamespace = 'public'::regnamespace),
  'import_batches: RLS habilitada');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'import_batches' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'import_batches: authenticated sem INSERT/UPDATE/DELETE');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'import_batches' and grantee = 'authenticated'
      and privilege_type = 'SELECT'),
  1, 'import_batches: authenticated tem SELECT (filtrado por RLS)');

-- create_lead (regressão pós-extração): assinatura pública, grants e
-- SECURITY DEFINER inalterados.
select is(
  (select pg_get_function_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_lead'),
  'p_name text, p_phone text, p_car text, p_seller_id text DEFAULT NULL::text, p_temperature lead_temperature DEFAULT NULL::lead_temperature, p_payment_preference text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid',
  'create_lead: assinatura publica inalterada apos extracao do helper');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'create_lead' and grantee = 'authenticated'),
  1, 'create_lead: authenticated continua com EXECUTE (CREATE OR REPLACE preservou o grant)');

-- ═══════════════════════════════════════════════════════════════════════
-- DRY-RUN — MANAGER (BI1)
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1100000-0000-0000-0000-000000000002'); -- Manager A (BI1 ativa)
set local role authenticated;

create temp table t_dry1 as
  select public.bulk_import_leads(
    jsonb_build_array(
      jsonb_build_object('row_number', 1, 'name', 'Cliente Um', 'phone', '(11) 91111-0001', 'car', 'HB20'),
      jsonb_build_object('row_number', 2, 'name', '', 'phone', '(11) 91111-0002', 'car', 'Onix'),
      jsonb_build_object('row_number', 3, 'name', 'Cliente Tres', 'phone', '', 'car', 'Onix'),
      jsonb_build_object('row_number', 4, 'name', 'Cliente Quatro', 'phone', '(11) 91111-0004', 'car', null),
      jsonb_build_object('row_number', 5, 'name', 'Cliente Cinco', 'phone', '(11) 90000-1001', 'car', 'Civic'),
      jsonb_build_object('row_number', 6, 'name', 'Cliente Seis', 'phone', '(11) 91111-0006', 'car', 'Civic', 'seller_id', 'bulkSellerOther'),
      jsonb_build_object('row_number', 7, 'name', 'Cliente Sete', 'phone', '(11) 91111-0007', 'car', 'Civic', 'seller_id', 'bulkSellerA1'),
      jsonb_build_object('row_number', 8, 'name', 'Cliente Oito', 'phone', '(11) 91111-0007', 'car', 'HRV'),
      jsonb_build_object('row_number', 9, 'name', 'Cliente Nove', 'phone', '(11) 91111-0009', 'car', 'Civic', 'temperature', 'quente')
    ),
    'aaaa0000-0000-0000-0000-000000000001'::uuid, 'clientes.csv', false, true
  ) as resp;

select is((select (resp->>'total_rows')::int from t_dry1), 9, 'dry-run: total_rows = 9');
select is((select (resp->>'valid_count')::int from t_dry1), 3, 'dry-run: 3 linhas validas (1, 7, 9)');
select is((select (resp->>'duplicate_count')::int from t_dry1), 2, 'dry-run: 2 duplicadas (5=banco, 8=intra-lote)');
select is((select (resp->>'error_count')::int from t_dry1), 4, 'dry-run: 4 erros (2=nome, 3=telefone, 4=carro, 6=seller cross-company)');

select is(
  (select r->>'status' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 1),
  'valid', 'linha 1: valid');
select is(
  (select r->>'code' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 2),
  'name_required', 'linha 2: name_required');
select is(
  (select r->>'code' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 3),
  'phone_required', 'linha 3: phone_required');
select is(
  (select r->>'code' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 4),
  'car_required', 'linha 4 (sem fallback): car_required');
select is(
  (select r->>'status' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 5),
  'duplicate', 'linha 5 (telefone ja existente no banco): duplicate, nunca error');
select ok(
  not (select r ? 'lead_id' or r->'normalized' ? 'lead_id' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 5),
  'linha 5 duplicada: resposta nunca expõe o Lead existente colidido');
select is(
  (select r->>'code' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 6),
  'seller_not_found', 'linha 6: vendedor de outra empresa rejeitado');
select is(
  (select r->>'status' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 7),
  'valid', 'linha 7: vendedor ativo da propria empresa aceito');
select is(
  (select r->>'status' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 8),
  'duplicate', 'linha 8 (mesmo telefone da linha 7, intra-lote): duplicate');
select is(
  (select r->>'code' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 9),
  'invalid_temperature', 'linha 9: alias pt-BR nao reconhecido no servidor -> invalid_temperature');
select is(
  (select r->>'status' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 9),
  'valid', 'linha 9: invalid_temperature e AVISO, nunca bloqueia a linha');
select is(
  (select r->'normalized'->>'temperature' from t_dry1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 9),
  null, 'linha 9: temperature normalizada fica NULL, nunca o texto invalido');

select is((select count(*)::int from public.leads where company_id = 'b1000000-0000-0000-0000-000000000001'
    and name like 'Cliente %'), 0, 'dry-run nunca cria Lead');
select is((select count(*)::int from public.import_batches), 0, 'dry-run nunca grava import_batches');

-- fallback explícito de veículo
create temp table t_dry_fallback as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'Sem Carro', 'phone', '(11) 92222-0001', 'car', null)),
    'aaaa0000-0000-0000-0000-000000000002'::uuid, 'clientes2.csv', true, true
  ) as resp;
select is(
  (select r->>'status' from t_dry_fallback, jsonb_array_elements(resp->'rows') r),
  'valid', 'car ausente COM fallback habilitado: valid');
select is(
  (select r->'normalized'->>'car' from t_dry_fallback, jsonb_array_elements(resp->'rows') r),
  'Não informado', 'fallback grava exatamente "Não informado", preview mostra o valor final');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- COMMIT — MANAGER (BI1): parcial, timeline, stage, seller
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1100000-0000-0000-0000-000000000002');
set local role authenticated;

select is((select count(*)::int from public.leads where company_id = 'b1000000-0000-0000-0000-000000000001'), 1,
  'antes do commit: so o lead pre-existente da fixture');

create temp table t_commit1 as
  select public.bulk_import_leads(
    jsonb_build_array(
      jsonb_build_object('row_number', 1, 'name', 'Importado Um', 'phone', '(11) 93333-0001', 'car', 'HB20', 'seller_id', 'bulkSellerA1'),
      jsonb_build_object('row_number', 2, 'name', '', 'phone', '(11) 93333-0002', 'car', 'Onix'),
      jsonb_build_object('row_number', 3, 'name', 'Importado Tres', 'phone', '(11) 90000-1001', 'car', 'Civic')
    ),
    'bbbb0000-0000-0000-0000-000000000001'::uuid, 'commit1.csv', false, false
  ) as resp;

select is((select resp->>'status' from t_commit1), 'partial', 'commit parcial: 1 valido + 1 duplicado + 1 erro -> partial');
select is((select (resp->>'imported_count')::int from t_commit1), 1, 'commit parcial: imported_count = 1');
select is((select (resp->>'duplicate_count')::int from t_commit1), 1, 'commit parcial: duplicate_count = 1');
select is((select (resp->>'error_count')::int from t_commit1), 1, 'commit parcial: error_count = 1');
select is((select count(*)::int from public.leads where company_id = 'b1000000-0000-0000-0000-000000000001'
    and phone = '(11) 93333-0001'), 1, 'a linha valida foi realmente inserida');
select is((select count(*)::int from public.leads where company_id = 'b1000000-0000-0000-0000-000000000001'
    and phone = '(11) 93333-0002'), 0, 'a linha com nome vazio nunca foi inserida (linha ruim nao aborta as boas)');

select is(
  (select stage_id from public.leads where phone = '(11) 93333-0001'),
  'b1400000-0000-0000-0000-000000000001'::uuid, 'lead importado nasce sempre no estagio code=new');
select is(
  (select seller_id from public.leads where phone = '(11) 93333-0001'),
  'bulkSellerA1', 'seller informado e valido foi de fato gravado');
select is(
  (select count(*)::int from public.lead_timeline_entries lte
     join public.leads l on l.id = lte.lead_id
    where l.phone = '(11) 93333-0001' and lte.label = 'Lead criado'),
  1, 'lead importado recebe exatamente o mesmo evento "Lead criado" da criacao manual');
select is(
  (select count(*)::int from public.lead_timeline_entries lte
     join public.leads l on l.id = lte.lead_id
    where l.phone = '(11) 93333-0001'),
  1, 'nenhum evento extra ("Lead importado" ou de notas) e criado');

select is((select r->>'status' from t_commit1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 1),
  'imported', 'resposta commit linha 1: imported');
select ok((select r ? 'lead_id' from t_commit1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 1),
  'resposta commit linha 1: lead_id presente');
select is((select r->>'status' from t_commit1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 3),
  'duplicate', 'resposta commit linha 3 (telefone ja existente): duplicate, nunca error');
select ok(
  not (select r ? 'lead_id' from t_commit1, jsonb_array_elements(resp->'rows') r where (r->>'row_number')::int = 3),
  'linha duplicada no commit: sem lead_id, sem dado do lead colidido');

-- lote 100% duplicado -> completed, imported=0 (nunca "failed" so por nao
-- ter importado nada quando a causa e duplicidade, nao erro)
create temp table t_commit_alldup as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'X', 'phone', '(11) 90000-1001', 'car', 'X')),
    'bbbb0000-0000-0000-0000-000000000002'::uuid, 'dup.csv', false, false
  ) as resp;
select is((select resp->>'status' from t_commit_alldup), 'completed', 'lote 100% duplicado: completed (error_count=0)');
select is((select (resp->>'imported_count')::int from t_commit_alldup), 0, 'lote 100% duplicado: imported_count=0');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- IDEMPOTÊNCIA — mesmo client_request_id nao reprocessa
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1100000-0000-0000-0000-000000000002');
set local role authenticated;

select is((select count(*)::int from public.leads where phone = '(11) 94444-0001'), 0, 'antes: nenhum lead com este telefone');

create temp table t_idem1 as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'Idempotente', 'phone', '(11) 94444-0001', 'car', 'HB20')),
    'cccc0000-0000-0000-0000-000000000001'::uuid, 'idem.csv', false, false
  ) as resp;
select is((select count(*)::int from public.leads where phone = '(11) 94444-0001'), 1, 'primeira chamada: 1 lead criado');

create temp table t_idem2 as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'Idempotente', 'phone', '(11) 94444-0001', 'car', 'HB20')),
    'cccc0000-0000-0000-0000-000000000001'::uuid, 'idem.csv', false, false
  ) as resp;
select is((select count(*)::int from public.leads where phone = '(11) 94444-0001'), 1,
  'segunda chamada com o MESMO client_request_id: nenhum lead novo criado');
select is((select resp->>'batch_id' from t_idem1), (select resp->>'batch_id' from t_idem2),
  'mesmo client_request_id: mesmo batch_id devolvido (replay exato)');
select is((select resp->>'rows' from t_idem1), (select resp->>'rows' from t_idem2),
  'mesmo client_request_id: rows[] identico byte a byte (result_json permite replay exato)');
select is((select count(*)::int from public.import_batches
    where company_id = 'b1000000-0000-0000-0000-000000000001' and client_request_id = 'cccc0000-0000-0000-0000-000000000001'),
  1, 'apenas 1 linha de import_batches persistida, mesmo com 2 chamadas');

-- novo client_request_id com o MESMO arquivo/telefone = nova tentativa;
-- telefone ja importado antes vira duplicate, nunca cria outro Lead.
create temp table t_reupload as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'Idempotente', 'phone', '(11) 94444-0001', 'car', 'HB20')),
    'cccc0000-0000-0000-0000-000000000099'::uuid, 'idem.csv', false, false
  ) as resp;
select is((select resp->>'status' from t_reupload), 'completed', 'reenvio com novo client_request_id: completed (duplicate, nao erro)');
select is((select count(*)::int from public.leads where phone = '(11) 94444-0001'), 1,
  'reenvio do mesmo arquivo (novo client_request_id): telefone ja importado nunca duplica o Lead');

reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- LIMITE DE LINHAS
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.bulk_import_leads(
      (select jsonb_agg(jsonb_build_object('row_number', g, 'name', 'X', 'phone', '(11) 9' || g, 'car', 'X'))
         from generate_series(1, 2001) g),
      'dddd0000-0000-0000-0000-000000000001'::uuid, 'grande.csv', false, true)$$,
  'bulk_import_limit_exceeded', 'mais de 2000 linhas: bulk_import_limit_exceeded');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- AUTORIZAÇÃO — SUPER ADMIN / SELLER / SEM MEMBERSHIP / EMPRESA SUSPENSA / ANON
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1100000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'eeee0000-0000-0000-0000-000000000001'::uuid, 'x.csv', false, true)$$,
  'company_required', 'Super Admin sem p_company_id: company_required');
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'eeee0000-0000-0000-0000-000000000002'::uuid, 'x.csv', false, true, '00000000-0000-0000-0000-00000000ffff')$$,
  'company_not_found', 'Super Admin com empresa inexistente: company_not_found');
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'eeee0000-0000-0000-0000-000000000003'::uuid, 'x.csv', false, true, 'b1000000-0000-0000-0000-000000000003')$$,
  'company_read_only', 'Super Admin em empresa suspensa: company_read_only (dry-run usa o MESMO gate do commit)');

create temp table t_sa_dry as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'SA Cliente', 'phone', '(11) 95555-0001', 'car', 'HB20')),
    'eeee0000-0000-0000-0000-000000000004'::uuid, 'sa.csv', false, true, 'b1000000-0000-0000-0000-000000000001'
  ) as resp;
select is((select (resp->>'valid_count')::int from t_sa_dry), 1, 'Super Admin contextual: dry-run funciona com p_company_id explicito');

create temp table t_sa_commit as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'SA Cliente', 'phone', '(11) 95555-0001', 'car', 'HB20')),
    'eeee0000-0000-0000-0000-000000000005'::uuid, 'sa.csv', false, false, 'b1000000-0000-0000-0000-000000000001'
  ) as resp;
reset role;
-- leads so eh legivel sob RLS por manager/seller da propria empresa; Super
-- Admin NAO tem company_id/membership, entao leads_select nunca libera
-- leitura direta da tabela para ele — verificacao roda como postgres, apos
-- reset role, mesmo padrao do restante deste arquivo/teste 42.
select is((select count(*)::int from public.leads where phone = '(11) 95555-0001'
    and created_by_profile_id is null), 1,
  'Super Admin commit: created_by_profile_id NULL (mesma regra de create_lead, via insert_lead_row)');

select is(
  (select count(*)::int from public.audit_log where action = 'lead_bulk_imported'
     and company_id = 'b1000000-0000-0000-0000-000000000001'),
  1, 'Super Admin bulk import: exatamente 1 audit_log');
select is(
  (select actor_profile_id from public.import_batches
     where client_request_id = 'eeee0000-0000-0000-0000-000000000005'),
  'b1100000-0000-0000-0000-000000000001'::uuid,
  'import_batches.actor_profile_id guarda o ator REAL do Super Admin (FK simples p/ profiles, diferente de leads)');

select pg_temp.as_user('b1100000-0000-0000-0000-000000000003'); -- Seller A (BI1)
set local role authenticated;
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'ffff0000-0000-0000-0000-000000000001'::uuid, 'x.csv', false, true)$$,
  'forbidden', 'Seller: dry-run negado incondicionalmente');
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'ffff0000-0000-0000-0000-000000000002'::uuid, 'x.csv', false, false)$$,
  'forbidden', 'Seller: commit negado incondicionalmente');
reset role;

select pg_temp.as_user('b1100000-0000-0000-0000-000000000004'); -- Manager C (BI3 suspensa)
set local role authenticated;
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'ffff0000-0000-0000-0000-000000000003'::uuid, 'x.csv', false, true)$$,
  'forbidden', 'Manager de empresa suspensa: forbidden');
reset role;

select pg_temp.as_user('b1100000-0000-0000-0000-000000000006'); -- sem membership
set local role authenticated;
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'ffff0000-0000-0000-0000-000000000004'::uuid, 'x.csv', false, true)$$,
  'forbidden', 'sem membership/sem platform_role: forbidden');
reset role;

set local role anon;
select throws_ok(
  $$select public.bulk_import_leads('[]'::jsonb, 'ffff0000-0000-0000-0000-000000000005'::uuid, 'x.csv', false, true)$$,
  '42501', null, 'anon nao executa bulk_import_leads');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- ISOLAMENTO ENTRE EMPRESAS
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1100000-0000-0000-0000-000000000005'); -- Manager B (BI2)
set local role authenticated;
create temp table t_isolation as
  select public.bulk_import_leads(
    jsonb_build_array(jsonb_build_object('row_number', 1, 'name', 'Isolado', 'phone', '(11) 90000-1001', 'car', 'X')),
    '11110000-0000-0000-0000-000000000001'::uuid, 'iso.csv', false, true
  ) as resp;
select is((select (resp->>'valid_count')::int from t_isolation), 1,
  'telefone ja usado em BI1 NAO conta como duplicado para um lote rodando em BI2 (isolamento por empresa)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS DE import_batches
-- ═══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1100000-0000-0000-0000-000000000002'); -- Manager A (BI1)
set local role authenticated;
select ok(
  (select count(*)::int from public.import_batches where company_id = 'b1000000-0000-0000-0000-000000000001') > 0,
  'Manager A ve batches da propria empresa (BI1)');
select is(
  (select count(*)::int from public.import_batches where company_id <> 'b1000000-0000-0000-0000-000000000001'),
  0, 'Manager A NAO ve batches de outra empresa');
reset role;

select pg_temp.as_user('b1100000-0000-0000-0000-000000000003'); -- Seller A (BI1)
set local role authenticated;
select is((select count(*)::int from public.import_batches), 0, 'Seller: zero linhas de import_batches, mesmo da propria empresa');
reset role;

select pg_temp.as_user('b1100000-0000-0000-0000-000000000001'); -- Super Admin
set local role authenticated;
select ok(
  (select count(*)::int from public.import_batches where company_id = 'b1000000-0000-0000-0000-000000000001') > 0,
  'Super Admin ve batches de qualquer empresa autorizada');
reset role;

select * from finish();
rollback;
