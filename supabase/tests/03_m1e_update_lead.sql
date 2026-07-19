-- M1-E E1 — testes de update_lead (pgTAP). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ────────────────────────────────────────────────────────────
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('aaaaaaaa-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'Upd Um',   '(11) 90000-0021', 'C1',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  null),
  ('aaaaaaaa-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'Upd Dois', '(11) 90000-0022', 'C2',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's11', null),
  ('aaaaaaaa-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'Upd Arq',  '(11) 90000-0023', 'C3',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  now());

-- ── seller: proprio lead ativo ──────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;

create temp table t_upd as
  select * from public.update_lead('aaaaaaaa-0000-0000-0000-000000000021', 1,
    'Upd Um Editado', '(11) 90000-0121', 'C1 Novo', 'hot', 'A vista', 'Showroom');
select is((select name from t_upd), 'Upd Um Editado', 'nome atualizado');
select is((select phone_digits from t_upd), '11900000121', 'phone_digits acompanha o novo telefone');
select is((select temperature::text from t_upd), 'hot', 'temperature atualizada');
select is((select version from t_upd), 2, 'version incrementada para 2');
select is((select updated_by_profile_id from t_upd),
  '33333333-3333-3333-3333-333333333333'::uuid, 'updated_by derivado corretamente');

select throws_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000021', 1,
  'X', '(11) 9', 'C')$$, 'stale_write', 'versao antiga gera stale_write');
select throws_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000022', 1,
  'X', '(11) 9', 'C')$$, 'forbidden', 'seller nao edita lead alheio');
select throws_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000023', 1,
  'X', '(11) 9', 'C')$$, 'lead_archived', 'lead arquivado nao e editavel');
select throws_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000099', 1,
  'X', '(11) 9', 'C')$$, 'lead_not_found', 'lead inexistente');
select throws_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000021', null,
  'X', '(11) 9', 'C')$$, 'stale_write', 'expected_version null e rejeitado');
reset role;

-- ── manager: qualquer lead ativo da empresa ─────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
create temp table t_upd2 as
  select * from public.update_lead('aaaaaaaa-0000-0000-0000-000000000022', 1,
    'Upd Dois Editado', '(11) 90000-0022', 'C2');
select is((select name from t_upd2), 'Upd Dois Editado', 'manager edita lead de qualquer seller');
select is((select updated_by_profile_id from t_upd2),
  '22222222-2222-2222-2222-222222222222'::uuid, 'updated_by reflete o manager');
select is((select temperature from t_upd2), null::public.lead_temperature,
  'substituicao integral: opcional omitido vira null');
reset role;

-- ── sequencia com versao antiga (base do teste de concorrencia) ─────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000021', 2,
  'Upd Um v3', '(11) 90000-0121', 'C1')$$, 'admin atualiza com a versao atual');
select throws_ok($$select public.update_lead('aaaaaaaa-0000-0000-0000-000000000021', 2,
  'Upd Um v4', '(11) 90000-0121', 'C1')$$, 'stale_write',
  'segunda escrita com a mesma versao antiga falha — sem sobrescrita silenciosa');
reset role;

select * from finish();
rollback;
