-- M1-E E1 — testes de archive_lead/unarchive_lead (pgTAP). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('aaaaaaaa-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000001', 'Ar Um', '(11) 90000-0061', 'C1',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4');

-- ── seller nunca arquiva ────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.archive_lead('aaaaaaaa-0000-0000-0000-000000000061', 1)$$,
  'forbidden', 'seller nao arquiva');
select throws_ok($$select public.unarchive_lead('aaaaaaaa-0000-0000-0000-000000000061', 1)$$,
  'forbidden', 'seller nao restaura');
reset role;

-- ── manager: arquivamento com a ordem idempotente exata do design ───────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

-- mudanca real exige versao atual
select throws_ok($$select public.archive_lead('aaaaaaaa-0000-0000-0000-000000000061', 99)$$,
  'stale_write', 'arquivar com versao divergente falha');

create temp table t_ar as select * from public.archive_lead('aaaaaaaa-0000-0000-0000-000000000061', 1);
select ok((select archived_at from t_ar) is not null, 'arquivado com versao correta');
select is((select version from t_ar), 2, 'mudanca real incrementa version exatamente uma vez');
select is((select updated_by_profile_id from t_ar),
  '22222222-2222-2222-2222-222222222222'::uuid, 'updated_by definido no arquivamento');

-- estado ja alcancado: retorna a linha SEM update, SEM bump, SEM stale_write
-- mesmo com versao antiga
create temp table t_ar2 as select * from public.archive_lead('aaaaaaaa-0000-0000-0000-000000000061', 1);
select ok((select archived_at from t_ar2) is not null, 'arquivar ja-arquivado retorna a linha');
select is((select version from t_ar2), 2, 'idempotente: version NAO incrementa');

-- restaurar: versao divergente falha; correta restaura e incrementa
select throws_ok($$select public.unarchive_lead('aaaaaaaa-0000-0000-0000-000000000061', 1)$$,
  'stale_write', 'restaurar com versao divergente falha');
create temp table t_un as select * from public.unarchive_lead('aaaaaaaa-0000-0000-0000-000000000061', 2);
select is((select archived_at from t_un), null::timestamptz, 'restaurado com versao correta');
select is((select version from t_un), 3, 'restauracao real incrementa version');

-- restaurar lead ativo: idempotente mesmo com versao antiga
create temp table t_un2 as select * from public.unarchive_lead('aaaaaaaa-0000-0000-0000-000000000061', 1);
select is((select archived_at from t_un2), null::timestamptz, 'restaurar ja-ativo retorna a linha');
select is((select version from t_un2), 3, 'idempotente: version NAO incrementa na restauracao repetida');

select throws_ok($$select public.archive_lead('aaaaaaaa-0000-0000-0000-000000000099', 1)$$,
  'lead_not_found', 'lead inexistente');
reset role;

select * from finish();
rollback;
