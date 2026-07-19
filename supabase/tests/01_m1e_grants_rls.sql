-- M1-E E1 — testes de grants e RLS (pgTAP). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures (como postgres) ────────────────────────────────────────────
insert into public.companies (id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B Teste');
insert into public.pipeline_stages (id, company_id, code, name, sort_order)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'new', 'Novo', 0);
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'b1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'adminb@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'inativo@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('b1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Admin B', 'adminb@test.local', 'admin', true),
  ('d1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Inativo', 'inativo@test.local', 'manager', false);

-- Leads: L1 (s4 ativo), L2 (s11 ativo), L3 (sem vendedor), L4 (s4 arquivado), LB (empresa B)
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('aaaaaaaa-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'L Um',    '(11) 90000-0011', 'C1',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  null),
  ('aaaaaaaa-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'L Dois',  '(11) 90000-0012', 'C2',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's11', null),
  ('aaaaaaaa-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'L Tres',  '(11) 90000-0013', 'C3',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), null,  null),
  ('aaaaaaaa-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'L Quatro','(11) 90000-0014', 'C4',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  now()),
  ('aaaaaaaa-0000-0000-0000-000000000015', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'L B',     '(11) 90000-0015', 'CB',
   'bbbbbbbb-0000-0000-0000-00000000000b', null, null);

-- Timeline: T1 em L1, T2 em L2, T4 em L4
insert into public.lead_timeline_entries (company_id, lead_id, icon, color, label) values
  ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000011', 'phone', '#1', 'T1'),
  ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000012', 'phone', '#2', 'T2'),
  ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000014', 'phone', '#4', 'T4');

-- ── anon: nenhuma leitura, nenhuma RPC ──────────────────────────────────
set local role anon;
select throws_ok('select count(*) from public.leads', '42501', null, 'anon nao le leads');
select throws_ok('select count(*) from public.lead_timeline_entries', '42501', null, 'anon nao le timeline');
select throws_ok($$select public.create_lead('a','(11) 9','c')$$, '42501', null, 'anon nao executa create_lead');
select throws_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000011', 1, 'a', '(11) 9', 'c')$$, '42501', null, 'anon nao executa update_lead');
select throws_ok($$select public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000011', 'bbbbbbbb-0000-0000-0000-00000000000b')$$, '42501', null, 'anon nao executa move_lead_to_stage');
select throws_ok($$select public.apply_lead_event('aaaaaaaa-0000-0000-0000-000000000011', 'visit_confirmed')$$, '42501', null, 'anon nao executa apply_lead_event');
select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000011', 's1', 1)$$, '42501', null, 'anon nao executa assign_lead_seller');
select throws_ok($$select public.archive_lead('aaaaaaaa-0000-0000-0000-000000000011', 1)$$, '42501', null, 'anon nao executa archive_lead');
select throws_ok($$select public.unarchive_lead('aaaaaaaa-0000-0000-0000-000000000011', 1)$$, '42501', null, 'anon nao executa unarchive_lead');
select throws_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000011', 'i', 'l', '#c')$$, '42501', null, 'anon nao executa add_lead_timeline_entry');
select throws_ok($$select * from public.check_lead_phone_duplicate('(11) 9')$$, '42501', null, 'anon nao executa check_lead_phone_duplicate');
reset role;

-- ── authenticated sem profile: zero linhas ──────────────────────────────
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.leads), 0, 'authenticated sem profile le zero leads');
reset role;

-- ── matriz de visibilidade de leads ─────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.leads), 1, 'seller1 ve somente o proprio lead ativo');
select is((select id from public.leads), 'aaaaaaaa-0000-0000-0000-000000000011'::uuid, 'seller1 ve exatamente L1');
select is((select count(*)::int from public.lead_timeline_entries), 1, 'seller1 ve somente timeline de L1 (sem arquivado)');
reset role;

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select is((select id from public.leads), 'aaaaaaaa-0000-0000-0000-000000000012'::uuid, 'seller2 ve exatamente L2');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.leads), 4, 'admin ve os 4 leads da empresa A (incl. arquivado)');
select is((select count(*)::int from public.lead_timeline_entries), 3, 'admin ve as 3 entradas de timeline');
select is((select count(*)::int from public.leads where company_id <> '00000000-0000-0000-0000-000000000001'), 0,
  'admin nao ve nenhuma linha de outra empresa');
-- escrita direta negada por grant (mesmo para admin)
select throws_ok($$insert into public.leads (company_id, name, phone, car, stage_id)
  values ('00000000-0000-0000-0000-000000000001', 'X', '(11) 9', 'C',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'))$$,
  '42501', null, 'INSERT direto em leads negado');
select throws_ok($$update public.leads set name = 'X' where id = 'aaaaaaaa-0000-0000-0000-000000000011'$$,
  '42501', null, 'UPDATE direto em leads negado');
select throws_ok($$delete from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000011'$$,
  '42501', null, 'DELETE direto em leads negado');
select throws_ok($$insert into public.lead_timeline_entries (company_id, lead_id, icon, color, label)
  values ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000011', 'i', '#c', 'l')$$,
  '42501', null, 'INSERT direto em timeline negado');
select throws_ok($$update public.lead_timeline_entries set label = 'X'$$,
  '42501', null, 'UPDATE direto em timeline negado');
select throws_ok($$delete from public.lead_timeline_entries$$,
  '42501', null, 'DELETE direto em timeline negado');
-- authenticated executa RPC permitida (leitura controlada como exemplo vivo)
select lives_ok($$select * from public.check_lead_phone_duplicate('(11) 90000-0011')$$,
  'authenticated com profile executa RPC');
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.leads), 4, 'manager ve os 4 leads da empresa A');
reset role;

select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select id from public.leads), 'aaaaaaaa-0000-0000-0000-000000000015'::uuid, 'admin B ve somente o lead da empresa B');
reset role;

select set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.leads), 0, 'profile inativo le zero leads');
select is((select count(*)::int from public.lead_timeline_entries), 0, 'profile inativo le zero timeline');
reset role;

select * from finish();
rollback;
