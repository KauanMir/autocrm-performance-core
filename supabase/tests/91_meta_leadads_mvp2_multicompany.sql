-- META-MVP2 — multiempresa (20261107100000_meta_leadads_mvp2_multicompany.sql).
-- Autorização por empresa desligada por padrão, isolamento entre empresas,
-- seleção de Página de uso único e atribuição de vendedor sem cruzar empresas.
-- Dados fictícios; rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ═══ A. catálogo e privilégios ══════════════════════════════════════════
select is(
  (select count(*)::int
     from unnest(array['public.company_meta_lead_ads_access', 'public.meta_oauth_page_selections', 'public.meta_leadgen_unrouted_events']) t,
          unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(r, t, p)),
  0, 'A1 zero grants diretos nas tabelas novas');
select ok((select relrowsecurity from pg_class where oid = 'public.meta_oauth_page_selections'::regclass), 'A2 RLS na seleção');

select ok(
  bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('authenticated', f, 'EXECUTE')),
  'A3 RPCs internas: só service_role')
from unnest(array[
  'public.meta_lead_ads_enabled_for(uuid)',
  'public.meta_connection_owner_for_ingestion(text)',
  'public.meta_connection_lookup_for_processing(uuid)',
  'public.meta_page_selection_create(uuid, uuid, jsonb, text, integer)',
  'public.meta_page_selection_list(uuid, uuid, uuid)',
  'public.meta_page_selection_consume(uuid, uuid, uuid, text)',
  'public.meta_leadgen_unrouted_record(text, text, text, timestamptz, text)',
  'public.meta_leadads_purge_expired()'
]) f;

select ok(
  bool_and(has_function_privilege('authenticated', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
  and not bool_or(has_function_privilege('service_role', f, 'EXECUTE')),
  'A4 habilitação/leitura: só authenticated (autorização dentro da função)')
from unnest(array[
  'public.meta_lead_ads_set_company_access(uuid, boolean)',
  'public.meta_lead_ads_company_access(uuid)',
  'public.meta_leadgen_unrouted_list(uuid)',
  'public.meta_leadgen_unrouted_adopt(uuid, text)'
]) f;

select is(public.meta_leadgen_error_kind('company_access_disabled'), 'operational', 'A5 company_access_disabled é operacional');

-- ═══ fixtures: duas concessionárias ═════════════════════════════════════
insert into public.companies (id, name, status) values
  ('fe100000-0000-0000-0000-00000000000a', 'MVP2 Concessionária A', 'ativa'),
  ('fe100000-0000-0000-0000-00000000000b', 'MVP2 Concessionária B', 'ativa');

insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values
  ('fe100000-0000-0000-0000-00000000000a', 'new', 'Novo', 0, false),
  ('fe100000-0000-0000-0000-00000000000b', 'new', 'Novo', 0, false);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fe200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mvp2-manager-a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fe200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'mvp2-seller-a@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fe200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mvp2-manager-b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fe200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'mvp2-seller-b@test.local',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fe200000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'mvp2-super@test.local',     now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('fe200000-0000-0000-0000-000000000001', 'MVP2 Manager A', 'mvp2-manager-a@test.local', true, null),
  ('fe200000-0000-0000-0000-000000000002', 'MVP2 Seller A',  'mvp2-seller-a@test.local',  true, null),
  ('fe200000-0000-0000-0000-000000000003', 'MVP2 Manager B', 'mvp2-manager-b@test.local', true, null),
  ('fe200000-0000-0000-0000-000000000004', 'MVP2 Seller B',  'mvp2-seller-b@test.local',  true, null),
  ('fe200000-0000-0000-0000-000000000005', 'MVP2 Super',     'mvp2-super@test.local',     true, 'super_admin');

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('fe300000-0000-0000-0000-000000000001', 'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001', 'manager', true),
  ('fe300000-0000-0000-0000-000000000002', 'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000002', 'seller',  true),
  ('fe300000-0000-0000-0000-000000000003', 'fe100000-0000-0000-0000-00000000000b', 'fe200000-0000-0000-0000-000000000003', 'manager', true),
  ('fe300000-0000-0000-0000-000000000004', 'fe100000-0000-0000-0000-00000000000b', 'fe200000-0000-0000-0000-000000000004', 'seller',  true);

insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('mvp2SellerA', 'fe100000-0000-0000-0000-00000000000a', 'MVP2 Seller A', 'SA', 'fe200000-0000-0000-0000-000000000002', 'fe300000-0000-0000-0000-000000000002', true),
  ('mvp2SellerB', 'fe100000-0000-0000-0000-00000000000b', 'MVP2 Seller B', 'SB', 'fe200000-0000-0000-0000-000000000004', 'fe300000-0000-0000-0000-000000000004', true);

insert into public.company_meta_integrations
  (id, company_id, page_id, page_name, access_token_ciphertext, token_key_version, granted_scopes, status, connected_at)
values
  ('fea00000-0000-0000-0000-00000000000a', 'fe100000-0000-0000-0000-00000000000a', '960000000009001', 'Página A',
   'fake-ct-a', 1, array['pages_show_list'], 'connected', now()),
  ('fea00000-0000-0000-0000-00000000000b', 'fe100000-0000-0000-0000-00000000000b', '960000000009002', 'Página B',
   'fake-ct-b', 1, array['pages_show_list'], 'connected', now());

-- ═══ B. desligado por padrão ════════════════════════════════════════════
select ok(not public.meta_lead_ads_enabled_for('fe100000-0000-0000-0000-00000000000a'), 'B1 empresa A nasce desabilitada');
select ok(not public.meta_lead_ads_enabled_for('fe100000-0000-0000-0000-00000000000b'), 'B2 empresa B nasce desabilitada');
select is((select count(*)::int from public.company_meta_lead_ads_access), 0, 'B3 a migration não cria nenhuma habilitação');

set local role service_role;
select is(
  (select string_agg(company_id::text || ':' || lead_ads_enabled::text, ',') from public.meta_connection_owner_for_ingestion('960000000009001')),
  'fe100000-0000-0000-0000-00000000000a:false', 'B4 ingestão vê a empresa dona da Página, desabilitada');
reset role;

-- ═══ C. quem pode habilitar ═════════════════════════════════════════════
select pg_temp.as_user('fe200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select throws_ok($$select * from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000a', true)$$,
  '42501', 'forbidden', 'C1 Manager não habilita a própria empresa (não amplia permissão)');
select is((select enabled from public.meta_lead_ads_company_access('fe100000-0000-0000-0000-00000000000a')), false,
  'C2 Manager A lê o estado da própria empresa');
select throws_ok($$select * from public.meta_lead_ads_company_access('fe100000-0000-0000-0000-00000000000b')$$,
  '42501', 'forbidden', 'C3 Manager A não lê o estado da empresa B');
reset role;

select pg_temp.as_user('fe200000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select throws_ok($$select * from public.meta_lead_ads_company_access('fe100000-0000-0000-0000-00000000000a')$$,
  '42501', 'forbidden', 'C4 Seller não lê o estado');
select throws_ok($$select * from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000a', true)$$,
  '42501', 'forbidden', 'C5 Seller não habilita');
reset role;

select pg_temp.as_user('fe200000-0000-0000-0000-000000000005'); -- Super Admin
set local role authenticated;
select is((select enabled from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000a', true)), true,
  'C6 Super Admin habilita a empresa A');
select throws_ok($$select * from public.meta_lead_ads_set_company_access('fe1fffff-0000-0000-0000-00000000000a', true)$$,
  'P0002', 'company_not_found', 'C7 empresa inexistente → company_not_found');
reset role;

set local role anon;
select throws_ok($$select * from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000a', true)$$,
  '42501', null, 'C8 anon sem EXECUTE');
reset role;

select ok(public.meta_lead_ads_enabled_for('fe100000-0000-0000-0000-00000000000a'), 'C9 A habilitada');
select ok(not public.meta_lead_ads_enabled_for('fe100000-0000-0000-0000-00000000000b'), 'C10 B continua desabilitada (isolamento)');
select ok(exists (select 1 from public.audit_log where action = 'meta_lead_ads_access_set'
                   and company_id = 'fe100000-0000-0000-0000-00000000000a'
                   and actor_profile_id = 'fe200000-0000-0000-0000-000000000005'), 'C11 habilitação auditada com o autor');

set local role service_role;
select is(
  (select out_lead_ads_enabled::text from public.meta_connection_lookup_for_processing('fea00000-0000-0000-0000-00000000000a')),
  'true', 'C12 processor vê A habilitada');
select is(
  (select out_lead_ads_enabled::text from public.meta_connection_lookup_for_processing('fea00000-0000-0000-0000-00000000000b')),
  'false', 'C13 processor vê B desabilitada');
reset role;

-- ═══ D. gravação respeita a habilitação e a empresa da Página ════════════
insert into public.meta_leadgen_events
  (id, integration_id, company_id, page_id, leadgen_id, status, received_at, next_attempt_at, attempts, lease_token, locked_until)
values
  ('fee00000-0000-0000-0000-000000000001', 'fea00000-0000-0000-0000-00000000000a', 'fe100000-0000-0000-0000-00000000000a',
   '960000000009001', '980000000000001', 'processing', now(), now(), 1, 'fe500000-0000-0000-0000-000000000001', now() + interval '5 minutes'),
  ('fee00000-0000-0000-0000-000000000002', 'fea00000-0000-0000-0000-00000000000b', 'fe100000-0000-0000-0000-00000000000b',
   '960000000009002', '980000000000002', 'processing', now(), now(), 1, 'fe500000-0000-0000-0000-000000000002', now() + interval '5 minutes'),
  ('fee00000-0000-0000-0000-000000000003', 'fea00000-0000-0000-0000-00000000000b', 'fe100000-0000-0000-0000-00000000000b',
   '960000000009002', '980000000000003', 'processing', now(), now(), 1, 'fe500000-0000-0000-0000-000000000003', now() + interval '5 minutes');

set local role service_role;
select is(
  (select out_outcome from public.meta_leadgen_event_complete_v2(
     'fee00000-0000-0000-0000-000000000002', 'fe500000-0000-0000-0000-000000000002', 'Cliente B', '62999990002', '[]'::jsonb)),
  'company_access_disabled', 'D1 empresa B desabilitada: nada é gravado');
select is(
  (select out_outcome from public.meta_leadgen_event_complete_v2(
     'fee00000-0000-0000-0000-000000000001', 'fe500000-0000-0000-0000-000000000001', 'Cliente A', '62999990001', '[]'::jsonb)),
  'created', 'D2 empresa A habilitada: lead criado');
reset role;

select is((select count(*)::int from public.leads where phone_digits = '62999990002'), 0, 'D3 nenhum lead na B');
select is((select company_id::text from public.leads where phone_digits = '62999990001'),
  'fe100000-0000-0000-0000-00000000000a', 'D4 lead da Página A ficou na empresa A');
select is((select seller_id from public.leads where phone_digits = '62999990001'), null, 'D5 lead novo entra sem vendedor');
select is((select status from public.meta_leadgen_events where id = 'fee00000-0000-0000-0000-000000000002'), 'processing',
  'D6 evento da B não virou processed (processor reagenda como operacional)');

-- Mesmo telefone em empresas diferentes não se mistura.
select pg_temp.as_user('fe200000-0000-0000-0000-000000000005');
set local role authenticated;
select ok((select enabled from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000b', true)), 'D7 Super Admin habilita B');
reset role;
set local role service_role;
select is(
  (select out_outcome from public.meta_leadgen_event_complete_v2(
     'fee00000-0000-0000-0000-000000000003', 'fe500000-0000-0000-0000-000000000003', 'Cliente Homônimo', '62999990001', '[]'::jsonb)),
  'created', 'D8 mesmo telefone na B cria lead próprio da B (não liga ao lead da A)');
reset role;
select is((select count(*)::int from public.leads where phone_digits = '62999990001'), 2, 'D9 um lead por empresa');

-- ═══ E. seleção de Página de uso único ══════════════════════════════════
set local role service_role;
select throws_ok($$select * from public.meta_page_selection_create('fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[{"page_id":"1","page_name":"X","ciphertext":"c"},{"page_id":"1","page_name":"Y","ciphertext":"d"}]'::jsonb, 'original_token')$$,
  'P0001', 'invalid_input', 'E1 Página repetida → invalid_input');
select throws_ok($$select * from public.meta_page_selection_create('fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[{"page_id":"abc","page_name":"X","ciphertext":"c"}]'::jsonb, 'original_token')$$,
  'P0001', 'invalid_input', 'E2 page_id inválido → invalid_input');
select throws_ok($$select * from public.meta_page_selection_create('fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[]'::jsonb, 'original_token')$$,
  'P0001', 'invalid_input', 'E3 lista vazia → invalid_input');

select set_config('mvp2.sel', (select out_selection_id::text from public.meta_page_selection_create(
  'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[{"page_id":"960000000009101","page_name":"Página A1","ciphertext":"ct-a1"},{"page_id":"960000000009102","page_name":"Página A2","ciphertext":"ct-a2"}]'::jsonb,
  'exchanged_long_lived')), false);

select is((select string_agg(out_page_id || ':' || out_page_name, ',' order by out_page_id)
             from public.meta_page_selection_list(current_setting('mvp2.sel')::uuid, 'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001')),
  '960000000009101:Página A1,960000000009102:Página A2', 'E4 lista só id e nome');
select is((select count(*)::int from public.meta_page_selection_list(current_setting('mvp2.sel')::uuid,
             'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000003')), 0,
  'E5 outro usuário não vê a seleção');
select is((select out_outcome from public.meta_page_selection_consume(current_setting('mvp2.sel')::uuid,
             'fe100000-0000-0000-0000-00000000000b', 'fe200000-0000-0000-0000-000000000001', '960000000009101')),
  'not_found', 'E6 consumir com outra empresa → not_found');
select is((select out_outcome from public.meta_page_selection_consume(current_setting('mvp2.sel')::uuid,
             'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001', '960000000009999')),
  'page_not_offered', 'E7 Página fora da lista → page_not_offered (seleção continua válida)');
select is((select out_outcome || ':' || out_ciphertext || ':' || out_token_origin from public.meta_page_selection_consume(current_setting('mvp2.sel')::uuid,
             'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001', '960000000009102')),
  'consumed:ct-a2:exchanged_long_lived', 'E8 consome só a escolhida');
select is((select out_outcome from public.meta_page_selection_consume(current_setting('mvp2.sel')::uuid,
             'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001', '960000000009101')),
  'already_consumed', 'E9 uso único');
select is((select count(*)::int from public.meta_page_selection_list(current_setting('mvp2.sel')::uuid,
             'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001')), 0,
  'E10 seleção consumida some da lista');
reset role;

select ok((select pages::text not like '%ct-a1%' and pages::text not like '%ct-a2%' from public.meta_oauth_page_selections
            where id = current_setting('mvp2.sel')::uuid), 'E11 depois de consumir, nenhum ciphertext fica guardado');

insert into public.meta_oauth_page_selections (id, company_id, profile_id, pages, token_origin, expires_at, created_at) values
  ('fef00000-0000-0000-0000-000000000001', 'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
   '[{"page_id":"960000000009103","page_name":"P","ciphertext":"ct"}]'::jsonb, 'original_token', now() - interval '1 minute', now() - interval '11 minutes');
set local role service_role;
select is((select out_outcome from public.meta_page_selection_consume('fef00000-0000-0000-0000-000000000001',
             'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001', '960000000009103')),
  'expired', 'E12 seleção vencida → expired');
reset role;

-- ═══ F. fila "Sem vendedor" e atribuição sem cruzar empresas ════════════
select set_config('mvp2.leadA', (select id::text from public.leads where company_id = 'fe100000-0000-0000-0000-00000000000a' and phone_digits = '62999990001'), false);
select set_config('mvp2.verA', (select version::text from public.leads where id = current_setting('mvp2.leadA')::uuid), false);

select pg_temp.as_user('fe200000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select is((select count(*)::int from public.leads where id = current_setting('mvp2.leadA')::uuid), 0,
  'F1 Seller A não vê o lead sem vendedor');
select throws_ok(format($$select * from public.assign_lead_seller(%L::uuid, 'mvp2SellerA', %s)$$,
  current_setting('mvp2.leadA'), current_setting('mvp2.verA')),
  'P0001', 'forbidden', 'F2 Seller não atribui');
reset role;

select pg_temp.as_user('fe200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select is((select count(*)::int from public.leads where id = current_setting('mvp2.leadA')::uuid and seller_id is null), 1,
  'F3 Manager A vê o lead na fila sem vendedor');
select throws_ok(format($$select * from public.assign_lead_seller(%L::uuid, 'mvp2SellerB', %s)$$,
  current_setting('mvp2.leadA'), current_setting('mvp2.verA')),
  'P0001', 'seller_not_found', 'F4 Manager A não atribui a vendedor da empresa B');
select is((select seller_id from public.assign_lead_seller(current_setting('mvp2.leadA')::uuid, 'mvp2SellerA', current_setting('mvp2.verA')::integer)),
  'mvp2SellerA', 'F5 Manager A atribui ao vendedor da própria empresa');
reset role;

select ok(exists (select 1 from public.lead_timeline_entries t where t.lead_id = current_setting('mvp2.leadA')::uuid
                   and t.label = 'Responsável alterado' and t.detail = 'Atribuído a MVP2 Seller A'),
  'F6 atribuição registrada no histórico');

select pg_temp.as_user('fe200000-0000-0000-0000-000000000003'); -- Manager B
set local role authenticated;
select throws_ok(format($$select * from public.assign_lead_seller(%L::uuid, 'mvp2SellerB', 99)$$, current_setting('mvp2.leadA')),
  'P0001', 'lead_not_found', 'F7 Manager B não mexe em lead da empresa A');
select is((select count(*)::int from public.leads where id = current_setting('mvp2.leadA')::uuid), 0, 'F8 Manager B não vê o lead da A');
reset role;

select pg_temp.as_user('fe200000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select is((select count(*)::int from public.leads where id = current_setting('mvp2.leadA')::uuid), 1,
  'F9 depois da atribuição o Seller A vê o lead');
select is((select count(*)::int from public.list_lead_form_submissions(current_setting('mvp2.leadA')::uuid)), 1,
  'F10 Seller A vê as respostas do formulário do lead atribuído');
reset role;

select pg_temp.as_user('fe200000-0000-0000-0000-000000000004'); -- Seller B
set local role authenticated;
select is((select count(*)::int from public.leads where id = current_setting('mvp2.leadA')::uuid), 0, 'F11 Seller B nunca vê o lead da A');
reset role;

-- ═══ G. habilitação só em empresa ativa ═════════════════════════════════
insert into public.companies (id, name, status) values
  ('fe100000-0000-0000-0000-00000000000c', 'MVP2 Em implantação', 'implantacao'),
  ('fe100000-0000-0000-0000-00000000000d', 'MVP2 Suspensa', 'ativa');

select pg_temp.as_user('fe200000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$select * from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000c', true)$$,
  '23514', 'company_not_active', 'G1 empresa em implantação não é habilitada');
select ok((select enabled from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000d', true)), 'G2 empresa ativa é habilitada');
reset role;
update public.companies set status = 'suspensa' where id = 'fe100000-0000-0000-0000-00000000000d';
select ok(not public.meta_lead_ads_enabled_for('fe100000-0000-0000-0000-00000000000d'), 'G3 empresa suspensa fica desligada, mesmo marcada');
set local role authenticated;
select lives_ok($$select * from public.meta_lead_ads_set_company_access('fe100000-0000-0000-0000-00000000000d', false)$$,
  'G4 desligar é permitido em qualquer status');
reset role;

-- ═══ H. ciclo de vida da seleção ════════════════════════════════════════
set local role service_role;
select throws_ok($$select * from public.meta_page_selection_create('fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[{"page_id":"1","page_name":"X","ciphertext":"c"}]'::jsonb, 'original_token', 601)$$,
  'P0001', 'invalid_input', 'H1 TTL acima de 10 minutos é recusado');
select lives_ok($$select * from public.meta_page_selection_create('fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[{"page_id":"1","page_name":"X","ciphertext":"c"}]'::jsonb, 'original_token', 600)$$, 'H2 TTL de 10 minutos é aceito');
reset role;
select throws_ok($$insert into public.meta_oauth_page_selections (company_id, profile_id, pages, token_origin, expires_at)
  values ('fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
          '[{"page_id":"1","page_name":"X","ciphertext":"c"}]'::jsonb, 'original_token', now() + interval '11 minutes')$$,
  '23514', null, 'H3 a tabela também recusa TTL acima de 10 minutos');

delete from public.meta_oauth_page_selections;
set local role service_role;
select set_config('mvp2.old', (select out_selection_id::text from public.meta_page_selection_create(
  'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[{"page_id":"11","page_name":"Antiga","ciphertext":"ct-old"}]'::jsonb, 'original_token')), false);
select set_config('mvp2.other', (select out_selection_id::text from public.meta_page_selection_create(
  'fe100000-0000-0000-0000-00000000000b', 'fe200000-0000-0000-0000-000000000003',
  '[{"page_id":"22","page_name":"Outra","ciphertext":"ct-other"}]'::jsonb, 'original_token')), false);
select set_config('mvp2.new', (select out_selection_id::text from public.meta_page_selection_create(
  'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000001',
  '[{"page_id":"33","page_name":"Nova","ciphertext":"ct-new"}]'::jsonb, 'original_token')), false);
reset role;

select is((select count(*)::int from public.meta_oauth_page_selections where id = current_setting('mvp2.old')::uuid), 0,
  'H4 novo OAuth invalida a seleção anterior do mesmo usuário na empresa');
select is((select count(*)::int from public.meta_oauth_page_selections where id = current_setting('mvp2.other')::uuid), 1,
  'H5 seleção de outro usuário e empresa fica intacta');

insert into public.meta_oauth_page_selections (id, company_id, profile_id, pages, token_origin, expires_at, created_at) values
  ('fef00000-0000-0000-0000-000000000002', 'fe100000-0000-0000-0000-00000000000b', 'fe200000-0000-0000-0000-000000000004',
   '[{"page_id":"44","page_name":"Vencida","ciphertext":"ct-expired"}]'::jsonb, 'original_token', now() - interval '1 second', now() - interval '5 minutes');
set local role service_role;
select is((select out_selections from public.meta_leadads_purge_expired()), 1, 'H6 expurgo remove a seleção vencida');
reset role;
select is((select count(*)::int from public.meta_oauth_page_selections where pages::text like '%ct-expired%'), 0,
  'H7 nenhum ciphertext de seleção vencida fica guardado');
select is((select count(*)::int from public.meta_oauth_page_selections), 2, 'H8 seleções vigentes não são expurgadas');

insert into public.meta_oauth_page_selections (id, company_id, profile_id, pages, token_origin, expires_at, created_at) values
  ('fef00000-0000-0000-0000-000000000003', 'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000002',
   '[{"page_id":"55","page_name":"Vencida","ciphertext":"ct-gone"}]'::jsonb, 'original_token', now() - interval '1 second', now() - interval '5 minutes');
set local role service_role;
select is((select out_outcome from public.meta_page_selection_consume('fef00000-0000-0000-0000-000000000003',
             'fe100000-0000-0000-0000-00000000000a', 'fe200000-0000-0000-0000-000000000002', '55')), 'expired', 'H9 consumir vencida → expired');
reset role;
select is((select count(*)::int from public.meta_oauth_page_selections where id = 'fef00000-0000-0000-0000-000000000003'), 0,
  'H10 a tentativa em seleção vencida já apaga o ciphertext');

-- ═══ I. posse da Página ═════════════════════════════════════════════════
update public.company_meta_integrations set status = 'error' where id = 'fea00000-0000-0000-0000-00000000000a';

set local role service_role;
select throws_ok($$select * from public.meta_connection_upsert_v2(
  'fe100000-0000-0000-0000-00000000000b', '960000000009001', 'Tomada', 'fake-ct', 1::smallint,
  array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
  now(), null, now(), 'exchanged_long_lived', now())$$,
  'P0001', 'page_already_connected', 'I1 Página em erro de outra empresa não pode ser tomada');
select lives_ok($$select * from public.meta_connection_upsert_v2(
  'fe100000-0000-0000-0000-00000000000a', '960000000009001', 'Página A', 'fake-ct-a2', 1::smallint,
  array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
  now(), null, now(), 'exchanged_long_lived', now())$$, 'I2 a dona reconecta a própria Página em erro');
reset role;
select is((select status from public.company_meta_integrations where id = 'fea00000-0000-0000-0000-00000000000a'), 'connected', 'I3 reconexão volta a connected');

update public.company_meta_integrations set status = 'disconnected', disconnected_at = now() where id = 'fea00000-0000-0000-0000-00000000000b';
set local role service_role;
select lives_ok($$select * from public.meta_connection_upsert_v2(
  'fe100000-0000-0000-0000-00000000000a', '960000000009002', 'Página liberada', 'fake-ct-c', 1::smallint,
  array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
  now(), null, now(), 'exchanged_long_lived', now())$$, 'I4 Página desconectada pode ser conectada por outra empresa');
reset role;
delete from public.company_meta_integrations where company_id = 'fe100000-0000-0000-0000-00000000000a' and page_id = '960000000009002';
update public.company_meta_integrations set status = 'connected', disconnected_at = null where id = 'fea00000-0000-0000-0000-00000000000b';

-- ═══ J. eventos sem dono ════════════════════════════════════════════════
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(r, 'public.meta_leadgen_unrouted_events', p)),
  0, 'J1 zero grants diretos na retenção');
select ok((select relrowsecurity from pg_class where oid = 'public.meta_leadgen_unrouted_events'::regclass), 'J2 RLS na retenção');
select hasnt_column('public', 'meta_leadgen_unrouted_events', 'company_id', 'J3 a retenção não guarda empresa');

set local role service_role;
select is((select out_status from public.meta_leadgen_unrouted_record('960000000009001', '981000000000001', 'no_connection', now(), '1086000000000001')),
  'recorded', 'J4 evento novo é retido');
select is((select out_status from public.meta_leadgen_unrouted_record('960000000009001', '981000000000001', 'company_disabled', now())),
  'repeated', 'J5 reentrega não duplica');
select is((select out_status from public.meta_leadgen_unrouted_record('960000000009001', '980000000000001', 'no_connection', now())),
  'already_registered', 'J6 evento já no ledger não é retido');
select throws_ok($$select * from public.meta_leadgen_unrouted_record('960000000009001', '981000000000002', 'qualquer', now())$$,
  'P0001', 'invalid_input', 'J7 motivo fora do catálogo → invalid_input');
select throws_ok($$select * from public.meta_leadgen_unrouted_record('abc', '981000000000002', 'no_connection', now())$$,
  'P0001', 'invalid_input', 'J8 Página inválida → invalid_input');
reset role;

select is((select delivery_count from public.meta_leadgen_unrouted_events where leadgen_id = '981000000000001'), 2, 'J9 conta as entregas');
select is((select reason from public.meta_leadgen_unrouted_events where leadgen_id = '981000000000001'), 'company_disabled', 'J10 guarda o motivo mais recente');

select pg_temp.as_user('fe200000-0000-0000-0000-000000000001'); -- Manager A
set local role authenticated;
select throws_ok($$select * from public.meta_leadgen_unrouted_list('fe100000-0000-0000-0000-00000000000a')$$,
  '42501', 'forbidden', 'J11 Manager não lê a retenção');
select throws_ok($$select * from public.meta_leadgen_unrouted_adopt('fe100000-0000-0000-0000-00000000000a', '960000000009001')$$,
  '42501', 'forbidden', 'J12 Manager não libera eventos');
reset role;

select pg_temp.as_user('fe200000-0000-0000-0000-000000000005'); -- Super Admin
set local role authenticated;
select is((select can_adopt from public.meta_leadgen_unrouted_list('fe100000-0000-0000-0000-00000000000a') where page_id = '960000000009001'), true,
  'J13 Página conectada na empresa aberta pode ser liberada');
select is((select can_adopt from public.meta_leadgen_unrouted_list('fe100000-0000-0000-0000-00000000000b') where page_id = '960000000009001'), false,
  'J14 a mesma Página não pode ser liberada para outra empresa');
select is((select out_outcome from public.meta_leadgen_unrouted_adopt('fe100000-0000-0000-0000-00000000000b', '960000000009001')), 'not_connected',
  'J15 liberar para quem não conectou a Página é recusado');
reset role;
select is((select count(*)::int from public.meta_leadgen_events where leadgen_id = '981000000000001'), 0, 'J16 nada entrou no ledger');

insert into public.meta_leadgen_unrouted_events (page_id, leadgen_id, reason, first_received_at, last_received_at) values
  ('960000000009001', '981000000000090', 'no_connection', now() - interval '91 days', now() - interval '91 days'),
  ('960000000009001', '981000000000008', 'no_connection', now() - interval '8 days', now() - interval '8 days');

set local role authenticated;
select is((select out_outcome || ':' || out_adopted || ':' || out_already_registered
             from public.meta_leadgen_unrouted_adopt('fe100000-0000-0000-0000-00000000000a', '960000000009001')),
  'adopted:2:0', 'J17 libera os eventos da Página, fora os além de 90 dias');
reset role;

select is((select company_id::text from public.meta_leadgen_events where leadgen_id = '981000000000001'),
  'fe100000-0000-0000-0000-00000000000a', 'J18 evento liberado é da empresa que conectou a Página');
select is((select status from public.meta_leadgen_events where leadgen_id = '981000000000008'), 'received', 'J19 entra no fluxo normal');
select ok((select last_requeued_at > now() - interval '1 minute' from public.meta_leadgen_events where leadgen_id = '981000000000008'),
  'J20 janela de 7 dias reinicia: evento antigo não expira ao ser liberado');
select is((select count(*)::int from public.meta_leadgen_events where leadgen_id = '981000000000090'), 0, 'J21 evento além dos 90 dias não entra');
select is((select resolution from public.meta_leadgen_unrouted_events where leadgen_id = '981000000000001'), 'adopted', 'J22 retenção marcada como liberada');
select is((select resolved_by::text from public.meta_leadgen_unrouted_events where leadgen_id = '981000000000001'),
  'fe200000-0000-0000-0000-000000000005', 'J23 registra quem liberou');
select ok(exists (select 1 from public.audit_log where action = 'meta_leadgen_unrouted_adopted'
                   and company_id = 'fe100000-0000-0000-0000-00000000000a'
                   and actor_profile_id = 'fe200000-0000-0000-0000-000000000005'), 'J24 liberação auditada');

-- Empresa B registrou o evento desta Página antes? Chave única impede duplicar.
insert into public.meta_leadgen_unrouted_events (page_id, leadgen_id, reason, first_received_at, last_received_at) values
  ('960000000009002', '980000000000002', 'company_disabled', now(), now());
set local role authenticated;
select is((select out_outcome || ':' || out_adopted || ':' || out_already_registered
             from public.meta_leadgen_unrouted_adopt('fe100000-0000-0000-0000-00000000000b', '960000000009002')),
  'adopted:0:1', 'J25 evento já no ledger não é duplicado');
select is((select out_outcome from public.meta_leadgen_unrouted_adopt('fe100000-0000-0000-0000-00000000000b', '960000000009002')),
  'nothing_pending', 'J26 liberar de novo não repete nada');
reset role;

update public.company_meta_integrations set status = 'error' where id = 'fea00000-0000-0000-0000-00000000000b';
insert into public.company_meta_integrations
  (id, company_id, page_id, page_name, access_token_ciphertext, token_key_version, granted_scopes, status, connected_at)
values
  ('fea00000-0000-0000-0000-00000000000c', 'fe100000-0000-0000-0000-00000000000a', '960000000009002', 'Página duplicada',
   'fake-ct-c', 1, array['pages_show_list'], 'connected', now());
insert into public.meta_leadgen_unrouted_events (page_id, leadgen_id, reason, first_received_at, last_received_at) values
  ('960000000009002', '981000000000003', 'ambiguous_owner', now(), now());
set local role authenticated;
select is((select out_outcome from public.meta_leadgen_unrouted_adopt('fe100000-0000-0000-0000-00000000000a', '960000000009002')),
  'owner_conflict', 'J27 com outra empresa ainda vinculada, nada é liberado');
reset role;

set local role service_role;
select is((select out_unrouted from public.meta_leadads_purge_expired()), 1, 'J28 expurgo remove só o evento além dos 90 dias');
reset role;
select is((select count(*)::int from public.meta_leadgen_unrouted_events where leadgen_id = '981000000000090'), 0, 'J29 evento vencido saiu');
select is((select count(*)::int from public.meta_leadgen_unrouted_events where leadgen_id = '981000000000003'), 1, 'J30 evento dentro do prazo ficou');

select * from finish();
rollback;
