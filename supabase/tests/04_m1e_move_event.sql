-- M1-E E1 — testes de move_lead_to_stage e apply_lead_event (pgTAP).
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ────────────────────────────────────────────────────────────
-- Empresa B com SOMENTE o estagio 'new' (para stage_not_found no evento).
-- M1-F S8-C2-D1: status 'ativa' explícito — a nova autorização via
-- resolve_lead_mutation_context nega Manager/Seller em 'implantacao'
-- (default da coluna), mesmo padrão já aplicado em 01_m1e_grants_rls.sql/
-- 02_m1e_create_lead.sql.
insert into public.companies (id, name, status) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B Teste', 'ativa');
insert into public.pipeline_stages (id, company_id, code, name, sort_order)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'new', 'Novo', 0);
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', 'b1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'adminb@test.local', now(), now(), now());
insert into public.profiles (id, name, email)
  values ('b1111111-1111-1111-1111-111111111111', 'Admin B', 'adminb@test.local');
-- M1-F S8-C2-D1: Admin B precisa de membership real (apply_lead_event agora
-- deriva empresa/papel de resolve_lead_mutation_context, nunca mais de
-- profiles.company_id/role) — legado 'admin' -> company_memberships.role='manager'
-- (mesmo mapeamento já usado pelo backfill real do M1-F S1/seed.sql).
insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1111111-1111-1111-1111-111111111111', 'manager', true);
insert into public.leads (id, company_id, name, phone, car, stage_id) values
  ('aaaaaaaa-0000-0000-0000-00000000004b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Lead B', '(11) 90000-004b', 'CB',
   'bbbbbbbb-0000-0000-0000-00000000000b');

insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, archived_at) values
  ('aaaaaaaa-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001', 'Mv Um',   '(11) 90000-0041', 'C1',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  null),
  ('aaaaaaaa-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000001', 'Mv Dois', '(11) 90000-0042', 'C2',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's11', null),
  ('aaaaaaaa-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000001', 'Mv Arq',  '(11) 90000-0043', 'C3',
   (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4',  now());

-- ── move_lead_to_stage ──────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;

create temp table t_mv as
  select * from public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000041',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='negotiation'));
select is((select ps.code from t_mv m join public.pipeline_stages ps on ps.id = m.stage_id),
  'negotiation', 'seller move o proprio lead (sem versao = LWW do drag)');
select is((select version from t_mv), 2, 'move incrementa version');
select is((select updated_by_profile_id from t_mv),
  '33333333-3333-3333-3333-333333333333'::uuid, 'updated_by derivado no move');

-- LWW documentado: segundo move sem versao tambem passa, o ultimo vence.
select is((select ps.code from public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000041',
    (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='qualified')) m
  join public.pipeline_stages ps on ps.id = m.stage_id),
  'qualified', 'segundo move LWW vence sem erro');

select throws_ok($$select public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000041',
  (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='closing'), 1)$$,
  'stale_write', 'move com expected_version divergente falha');
select throws_ok($$select public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000042',
  (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='closing'))$$,
  'forbidden', 'seller nao move lead alheio');
select throws_ok($$select public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000041',
  'bbbbbbbb-0000-0000-0000-00000000000b')$$,
  'stage_not_found', 'stage de outra empresa rejeitado');
select throws_ok($$select public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000041',
  'ffffffff-0000-0000-0000-00000000000f')$$,
  'stage_not_found', 'stage inexistente rejeitado');
select throws_ok($$select public.move_lead_to_stage('aaaaaaaa-0000-0000-0000-000000000043',
  (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='closing'))$$,
  'lead_archived', 'lead arquivado nao pode ser movido');
reset role;

-- ── apply_lead_event: mapeamento completo dos 18 eventos ────────────────
-- Um lead NOVO (stage 'new', s4) por evento; o resultado esperado inclui
-- urgency|alert|last|stage_code|version — stage_code 'new' quando o evento
-- nao muda estagio; version 2 prova exatamente um UPDATE atomico.
create temp table exp_events (event public.lead_event_type, expected text);
insert into exp_events values
  ('call_outcome_visit',          'amber|Agendar visita|Aguardando agendamento|qualified|2'),
  ('call_outcome_proposal',       'amber|Montar proposta|Agora|negotiation|2'),
  ('call_outcome_callback',       'amber|Fazer follow-up|Agora|new|2'),
  ('call_outcome_no_answer',      'amber|Tentar contato novamente|Agora|new|2'),
  ('visit_scheduled_complete',    'green|Visita agendada|No prazo|visit_scheduled|2'),
  ('visit_scheduled_incomplete',  'amber|Agendar visita|Aguardando agendamento|qualified|2'),
  ('visit_confirmed',             'green|Visita confirmada|Cliente confirmou presença|new|2'),
  ('visit_canceled',              'red|Visita cancelada — retomar contato|Cliente cancelou a visita|new|2'),
  ('visit_rescheduled',           'amber|Visita remarcada — confirmar novo horário|Aguardando nova confirmação|new|2'),
  ('deal_created_needs_approval', 'amber|Acompanhar proposta|Proposta enviada|negotiation|2'),
  ('deal_created_direct',         'green|Proposta enviada|Aguardando resposta do cliente|negotiation|2'),
  ('deal_approved',               'green|Proposta aprovada — fechar venda|Aprovada pelo gestor|new|2'),
  ('deal_rejected',               'amber|Renegociar proposta|Recusada pelo gestor|new|2'),
  ('sale_registered',             'green|Venda registrada|Concluído|closing|2'),
  ('sale_canceled',               'amber|Venda cancelada|Retomar negociação|negotiation|2'),
  ('visit_result_done',           'green|Próximo passo comercial|Visita realizada|negotiation|2'),
  ('visit_result_thinking',       'amber|Acompanhar cliente|Cliente ficou de pensar|negotiation|2'),
  ('visit_result_no_interest',    'amber|Sem interesse no momento|Registrar motivo de perda futuramente|new|2');

create temp table evt_leads (event public.lead_event_type, lead_id uuid);
insert into evt_leads
  select e.event, gen_random_uuid() from exp_events e;
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id)
  select el.lead_id, '00000000-0000-0000-0000-000000000001', 'Evt ' || el.event::text, '(11) 90000-0044', 'CE',
         (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4'
    from evt_leads el;

create temp table act_events (event public.lead_event_type, actual text);
grant all on act_events, evt_leads, exp_events to public;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  r record;
  v_row public.leads;
  v_code text;
begin
  for r in select event, lead_id from evt_leads loop
    v_row := public.apply_lead_event(r.lead_id, r.event);
    select ps.code into v_code from public.pipeline_stages ps where ps.id = v_row.stage_id;
    insert into act_events values (r.event,
      v_row.urgency::text || '|' || v_row.alert_label || '|' || v_row.last_activity_label
        || '|' || v_code || '|' || v_row.version::text);
  end loop;
end $$;

select results_eq(
  'select event::text, actual from act_events order by 1',
  'select event::text, expected from exp_events order by 1',
  'mapeamento evento -> health/labels/estagio identico ao design (18 eventos, atomicos)');

-- negativos do evento
select throws_ok($$select public.apply_lead_event('aaaaaaaa-0000-0000-0000-000000000042', 'visit_confirmed')$$,
  'forbidden', 'seller nao aplica evento em lead alheio');
select throws_ok($$select public.apply_lead_event('aaaaaaaa-0000-0000-0000-000000000043', 'visit_confirmed')$$,
  'lead_archived', 'evento em lead arquivado rejeitado');
select throws_ok($$select public.apply_lead_event('aaaaaaaa-0000-0000-0000-000000000041', 'evento_invalido')$$,
  '22P02', null, 'evento fora do enum falha no cast');
reset role;

-- stage code ausente na empresa: B so tem 'new'
select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.apply_lead_event('aaaaaaaa-0000-0000-0000-00000000004b', 'call_outcome_visit')$$,
  'stage_not_found', 'evento que exige code inexistente na empresa falha');
reset role;

select * from finish();
rollback;
