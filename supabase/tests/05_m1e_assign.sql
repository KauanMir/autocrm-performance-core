-- M1-E E1 — testes de assign_lead_seller (pgTAP). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ────────────────────────────────────────────────────────────
insert into public.companies (id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B Teste');
insert into public.sellers (id, company_id, name, first_name)
  values ('sB1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Vendedor B', 'Vend');
update public.sellers set is_active = false where id = 's3';
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('aaaaaaaa-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000001', 'As Um',  '(11) 90000-0051', 'C1',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), null, null),
  ('aaaaaaaa-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000001', 'As Arq', '(11) 90000-0052', 'C2',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4', now());

-- ── manager atribui / remove ────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

create temp table t_as as
  select * from public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 's1', 1);
select is((select seller_id from t_as), 's1', 'manager atribui a seller ativo');
select is((select version from t_as), 2, 'atribuicao incrementa version');
select is((select updated_by_profile_id from t_as),
  '22222222-2222-2222-2222-222222222222'::uuid, 'updated_by derivado');

select is((select seller_id from public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', null, 2)),
  null, 'null remove o vendedor');

select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 's1', 2)$$,
  'stale_write', 'versao antiga gera stale_write — atribuicao nunca e LWW');
select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 's1', null)$$,
  'stale_write', 'expected_version null rejeitado');
select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 'sB1', 3)$$,
  'seller_not_found', 'seller de outra empresa rejeitado');
select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 's3', 3)$$,
  'seller_not_found', 'seller inativo rejeitado');
select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000052', 's1', 1)$$,
  'lead_archived', 'lead arquivado nao pode ser reatribuido');
reset role;

-- ── seller nunca chama ──────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 's4', 3)$$,
  'forbidden', 'seller nao executa atribuicao');
reset role;

-- ── sequencia com versao antiga (sem sobrescrita silenciosa) ────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 's2', 3)$$,
  'admin atribui com a versao atual');
select throws_ok($$select public.assign_lead_seller('aaaaaaaa-0000-0000-0000-000000000051', 's5', 3)$$,
  'stale_write', 'segunda atribuicao com a mesma versao antiga falha');
reset role;

select * from finish();
rollback;
