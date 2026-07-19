-- M1-E E1 — testes de add_lead_timeline_entry (pgTAP). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'inativo@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active)
  values ('d1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Inativo', 'inativo@test.local', 'seller', false);
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('aaaaaaaa-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001', 'Tl Um',  '(11) 90000-0071', 'C1',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  null),
  ('aaaaaaaa-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000001', 'Tl Dois','(11) 90000-0072', 'C2',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's11', null),
  ('aaaaaaaa-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000001', 'Tl Arq', '(11) 90000-0073', 'C3',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  now());

-- ── seller no proprio lead ativo ────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;

create temp table t_tl as
  select * from public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000071',
    'phone', 'Ligacao feita', '#27C75F', 'detalhe');
select is((select actor_profile_id from t_tl),
  '33333333-3333-3333-3333-333333333333'::uuid, 'actor derivado de auth.uid()');
select is((select company_id from t_tl),
  '00000000-0000-0000-0000-000000000001'::uuid, 'company derivada do profile');
select is((select occurred_at from t_tl), now(), 'occurred_at definido pelo servidor (now da transacao)');
select is((select detail from t_tl), 'detalhe', 'detail preservado');

select throws_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000072', 'i', 'l', '#c')$$,
  'forbidden', 'seller nao escreve timeline de lead alheio');
select throws_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000073', 'i', 'l', '#c')$$,
  'lead_archived', 'lead arquivado nao aceita nova entrada');
select throws_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000071', '  ', 'l', '#c')$$,
  '23514', null, 'icon em branco falha');
select throws_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000071', 'i', '  ', '#c')$$,
  '23514', null, 'label em branco falha');
select throws_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000071', 'i', 'l', '  ')$$,
  '23514', null, 'color em branco falha');
reset role;

-- ── manager em qualquer lead ativo ──────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000072', 'i', 'Entrada gestor', '#c')$$,
  'manager escreve timeline de qualquer lead ativo da empresa');
reset role;

-- ── profile inativo ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.add_lead_timeline_entry('aaaaaaaa-0000-0000-0000-000000000071', 'i', 'l', '#c')$$,
  'forbidden', 'profile inativo nao escreve timeline');
reset role;

select * from finish();
rollback;
