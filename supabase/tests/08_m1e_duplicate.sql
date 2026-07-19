-- M1-E E1 — testes de check_lead_phone_duplicate (pgTAP). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ────────────────────────────────────────────────────────────
-- Telefone duplicado '11988880001' presente em: D1 (s4 ativo), D2 (s11
-- ativo), D3 (sem vendedor), D4 (s4 arquivado) e DB (empresa B — nunca
-- aparece). created_at fixos para a ordenacao deterministica.
insert into public.companies (id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B Teste');
insert into public.pipeline_stages (id, company_id, code, name, sort_order)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'new', 'Novo', 0);
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at, created_at) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Dup Um',     '(11) 98888-0001', 'C1',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  null,  '2026-01-04'),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Dup Dois',   '(11) 98888-0001', 'C2',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's11', null,  '2026-01-03'),
  ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Dup Tres',   '(11) 98888-0001', 'C3',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), null,  null,  '2026-01-02'),
  ('d0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Dup Quatro', '(11) 98888-0001', 'C4',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  now(), '2026-01-05'),
  ('d0000000-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Dup B',      '(11) 98888-0001', 'CB',
   'bbbbbbbb-0000-0000-0000-00000000000b', null, null, '2026-01-01'),
  ('d0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Dup Outro',  '(11) 98888-0002', 'C5',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's11', null,  '2026-01-01');

-- ── admin: todos os duplicados da empresa, ordenacao deterministica ─────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select status::text, lead_id::text, lead_archived from public.check_lead_phone_duplicate('(11) 98888-0001')$$,
  $$values ('accessible', 'd0000000-0000-0000-0000-000000000001', false),
           ('accessible', 'd0000000-0000-0000-0000-000000000002', false),
           ('accessible', 'd0000000-0000-0000-0000-000000000003', false),
           ('accessible', 'd0000000-0000-0000-0000-000000000004', true)$$,
  'admin: 4 acessiveis, ativos primeiro por created_at desc, arquivado por ultimo, sem empresa B');
select is((select count(*)::int from public.check_lead_phone_duplicate('(11) 90000-9999')), 1,
  'sem duplicado: exatamente uma linha');
select is((select status::text from public.check_lead_phone_duplicate('(11) 90000-9999')), 'none',
  'sem duplicado: status none');
select throws_ok($$select * from public.check_lead_phone_duplicate('abc-def')$$,
  'invalid_phone', 'telefone sem digitos gera invalid_phone');
reset role;

-- ── seller: dados so dos proprios ativos; restritos colapsam em 1 linha ─
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 98888-0001')$$,
  $$values ('accessible', 'd0000000-0000-0000-0000-000000000001'),
           ('restricted', null)$$,
  'seller: proprio ativo como accessible + UMA unica linha restricted');
select is((select count(*)::int from public.check_lead_phone_duplicate('(11) 98888-0001')
    where status = 'restricted'), 1,
  'varios restritos (alheio, sem vendedor, arquivado) colapsam sem revelar quantidade');
select is((select count(*)::int from public.check_lead_phone_duplicate('(11) 98888-0001')
    where status = 'restricted' and (lead_id is not null or lead_name is not null or lead_archived is not null)), 0,
  'linha restricted nao carrega id, nome nem flag de arquivado');
-- telefone que so existe em lead alheio: apenas restricted
select results_eq(
  $$select status::text, lead_id::text from public.check_lead_phone_duplicate('(11) 98888-0002')$$,
  $$values ('restricted', null)$$,
  'somente lead alheio: uma linha restricted sem dados');
-- a checagem nunca bloqueia a criacao ("criar mesmo assim")
select lives_ok($$select public.create_lead('Dup Novo', '(11) 98888-0001', 'C9')$$,
  'create_lead permanece permitido com telefone duplicado');
reset role;

select * from finish();
rollback;
