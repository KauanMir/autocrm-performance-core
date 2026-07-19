-- M1-E E1 — testes de create_lead (pgTAP). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ────────────────────────────────────────────────────────────
-- Empresa C SEM estagio 'new' (para initial_stage_missing) e seller s3
-- desativado na empresa A (para seller_not_found por inatividade).
insert into public.companies (id, name) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Empresa C Teste');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'adminc@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'inativo@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('c1111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Admin C', 'adminc@test.local', 'admin', true),
  ('d1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Inativo', 'inativo@test.local', 'seller', false);
update public.sellers set is_active = false where id = 's3';

-- ── seller: autoatribuicao obrigatoria ──────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;

create temp table t_seller_created as
  select * from public.create_lead('Cliente Seller', '(11) 98888-1001', 'Golf GTI');
select is((select seller_id from t_seller_created), 's4', 'seller autoatribuido ao proprio seller_id');
select is((select urgency::text from t_seller_created), 'red', 'urgency inicial red');
select is((select last_activity_label from t_seller_created), 'Sem contato ainda', 'label inicial de atividade');
select is((select alert_label from t_seller_created), 'Fazer primeiro contato', 'label inicial de alerta');
select is((select value_amount from t_seller_created), null::numeric, 'value_amount nasce null');
select is((select version from t_seller_created), 1, 'version nasce 1');
select is((select created_by_profile_id from t_seller_created),
  '33333333-3333-3333-3333-333333333333'::uuid, 'created_by derivado do auth.uid()');
select is((select updated_by_profile_id from t_seller_created),
  '33333333-3333-3333-3333-333333333333'::uuid, 'updated_by derivado do auth.uid()');
select is((select ps.code from t_seller_created c join public.pipeline_stages ps on ps.id = c.stage_id),
  'new', 'estagio inicial resolvido pelo code new');
select ok((select id from t_seller_created) is not null, 'UUID real gerado pelo banco');

select throws_ok($$select public.create_lead('Cliente X', '(11) 98888-1002', 'Onix', 's11')$$,
  'forbidden', 'seller nao escolhe outro seller');
select lives_ok($$select public.create_lead('Cliente Y', '(11) 98888-1003', 'Onix', 's4')$$,
  'seller pode informar o proprio seller_id');
reset role;

-- ── admin/manager: seller valido, null e invalidos ──────────────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select is((select seller_id from public.create_lead('Cliente Adm1', '(11) 98888-1004', 'HRV', 's1')),
  's1', 'admin atribui a seller ativo da empresa');
select is((select seller_id from public.create_lead('Cliente Adm2', '(11) 98888-1005', 'HRV', null)),
  null, 'admin cria sem vendedor definido');
select throws_ok($$select public.create_lead('Cliente Adm3', '(11) 98888-1006', 'HRV', 'sB1')$$,
  'seller_not_found', 'seller de outra empresa rejeitado');
select throws_ok($$select public.create_lead('Cliente Adm4', '(11) 98888-1007', 'HRV', 'sXX')$$,
  'seller_not_found', 'seller inexistente rejeitado');
select throws_ok($$select public.create_lead('Cliente Adm5', '(11) 98888-1008', 'HRV', 's3')$$,
  'seller_not_found', 'seller inativo rejeitado');
reset role;

-- ── estagio inicial ausente ─────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.create_lead('Cliente C', '(11) 98888-1009', 'Kicks')$$,
  'initial_stage_missing', 'empresa sem estagio code new falha com erro claro');
reset role;

-- ── profile inativo ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.create_lead('Cliente Inativo', '(11) 98888-1010', 'Polo')$$,
  'forbidden', 'profile inativo nao cria lead');
reset role;

select * from finish();
rollback;
