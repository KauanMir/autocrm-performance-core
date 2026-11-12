-- LGPD — eliminação de titular (20261111130000) + recuperação de cursor e item rejeitado do KAPA Leads.
-- Dados fictícios; rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ═══ A. privilégios ═════════════════════════════════════════════════════
select ok(
  has_function_privilege('service_role', 'public.lgpd_erase_subject(text, text, text, boolean)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.lgpd_subject_lookup(text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.kapa_leads_link_rewind(uuid, timestamptz)', 'EXECUTE'),
  'A1 operador (service_role) executa');
select ok(
  not has_function_privilege('authenticated', 'public.lgpd_erase_subject(text, text, text, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.lgpd_erase_subject(text, text, text, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lgpd_subject_lookup(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.kapa_leads_link_rewind(uuid, timestamptz)', 'EXECUTE'),
  'A2 aplicação (authenticated/anon) nunca executa');
select ok(
  not has_function_privilege('service_role', 'public._lgpd_subject_leads(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._lgpd_subject_queue_events(text, text)', 'EXECUTE'),
  'A3 funções internas sem EXECUTE externo');

-- ═══ fixtures ═══════════════════════════════════════════════════════════
insert into public.companies (id, name, status) values
  ('fe100000-0000-0000-0000-00000000000a', 'LGPD Concessionária A', 'ativa'),
  ('fe100000-0000-0000-0000-00000000000b', 'LGPD Concessionária B', 'ativa');
insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values
  ('fe100000-0000-0000-0000-00000000000a', 'new', 'Novo', 0, false),
  ('fe100000-0000-0000-0000-00000000000b', 'new', 'Novo', 0, false);

-- Titular: telefone 62911110000 em A (lead com resposta, linha do tempo) e em B; outro cliente em A.
create temp table t_ids on commit drop as
select
  (select l.id from public.insert_lead_row('fe100000-0000-0000-0000-00000000000a', 'system', null,
     (select id from public.pipeline_stages where company_id = 'fe100000-0000-0000-0000-00000000000a' and code = 'new'),
     'Titular Teste', '62911110000', 'Onix', null, null, null, 'Fábrica (KAPA Leads)') l) as lead_a,
  (select l.id from public.insert_lead_row('fe100000-0000-0000-0000-00000000000b', 'system', null,
     (select id from public.pipeline_stages where company_id = 'fe100000-0000-0000-0000-00000000000b' and code = 'new'),
     'Titular Teste', '5562911110000', 'HB20', null, null, null, 'Meta') l) as lead_b,
  (select l.id from public.insert_lead_row('fe100000-0000-0000-0000-00000000000a', 'system', null,
     (select id from public.pipeline_stages where company_id = 'fe100000-0000-0000-0000-00000000000a' and code = 'new'),
     'Outro Cliente', '62922220000', 'Gol', null, null, null, 'Meta') l) as lead_other;

insert into public.lead_form_submissions (company_id, lead_id, source, outcome, contact_name, contact_phone, contact_email, answers)
select 'fe100000-0000-0000-0000-00000000000a'::uuid, lead_a, 'meta_lead_ads', 'created', 'Titular Teste', '62911110000', 'titular@example.test',
       '[{"key":"Campanha","values":["Fábrica"]}]'::jsonb from t_ids
union all
select 'fe100000-0000-0000-0000-00000000000a'::uuid, lead_other, 'meta_lead_ads', 'created', 'Outro Cliente', '62922220000', null, '[]'::jsonb from t_ids;
insert into public.lead_timeline_entries (company_id, lead_id, icon, color, label, detail)
select 'fe100000-0000-0000-0000-00000000000a', lead_a, 'note', '#000', 'Nota', 'Ligar para Titular Teste no 62911110000' from t_ids;

-- Vínculo KAPA Leads em A, ligado, com um evento já processado (lead_a) e um pendente do titular.
insert into public.kapa_leads_store_links (id, company_id, kapa_store_id, store_label, enabled, cursor_created_at, cursor_lead_id, activated_at)
values ('fe500000-0000-0000-0000-000000000001', 'fe100000-0000-0000-0000-00000000000a', 'fe900000-0000-0000-0000-0000000000a1',
        'RCAR', true, '2026-11-11T12:00:00Z', '00000000-0000-0000-0000-000000000000', '2026-11-11T12:00:00Z');
insert into public.kapa_leads_inbound_events (id, link_id, company_id, source_lead_id, source_campaign_id, source_campaign_slug,
  source_campaign_name, source_created_at, payload, status, outcome, crm_lead_id, processed_at)
select 'fe600000-0000-0000-0000-000000000001', 'fe500000-0000-0000-0000-000000000001', 'fe100000-0000-0000-0000-00000000000a',
       'fe700000-0000-0000-0000-000000000001', 'fe800000-0000-0000-0000-000000000001', 'fabrica', 'Fábrica',
       '2026-11-11T12:05:00Z', '{}'::jsonb, 'processed', 'created', lead_a, now() from t_ids;
insert into public.kapa_leads_inbound_events (id, link_id, company_id, source_lead_id, source_campaign_id, source_campaign_slug,
  source_campaign_name, source_created_at, payload, status)
values ('fe600000-0000-0000-0000-000000000002', 'fe500000-0000-0000-0000-000000000001', 'fe100000-0000-0000-0000-00000000000a',
        'fe700000-0000-0000-0000-000000000002', 'fe800000-0000-0000-0000-000000000001', 'fabrica', 'Fábrica',
        '2026-11-11T12:06:00Z',
        '{"contact":{"name":"Titular Teste","phone":"62911110000","email":null},"vehicle":null,"answers":[],"source_label":"Fábrica (KAPA Leads)"}'::jsonb,
        'pending');

-- ═══ B. validação de entrada ════════════════════════════════════════════
select throws_ok($$select * from public.lgpd_erase_subject(null, null, 'LGPD-2026-001')$$, '22023', 'phone_or_email_required', 'B1 exige telefone ou e-mail');
select throws_ok($$select * from public.lgpd_erase_subject('123', null, 'LGPD-2026-001')$$, '22023', 'invalid_phone', 'B2 telefone inválido');
select throws_ok($$select * from public.lgpd_erase_subject('62911110000', null, 'Titular Teste')$$, '22023', 'invalid_request_ref', 'B3 protocolo não aceita texto livre');
select throws_ok($$select * from public.lgpd_erase_subject('62911110000', null, '12345678909')$$, '22023', 'invalid_request_ref', 'B4 protocolo não aceita CPF');

-- ═══ C. localizar (sem PII na saída) ════════════════════════════════════
select is((select count(*)::int from public.lgpd_subject_lookup('+55 (62) 91111-0000', null) where lead_id is not null), 2,
  'C1 encontra os leads do titular nas duas empresas (com e sem 55)');
select is((select count(*)::int from public.lgpd_subject_lookup('62911110000', null) where lead_id is null), 1,
  'C2 lista o evento pendente ainda sem lead');
select is((select count(*)::int from public.lgpd_subject_lookup(null, 'TITULAR@example.test')), 1, 'C3 encontra pelo e-mail da resposta');

-- ═══ D. simulação não grava nada ════════════════════════════════════════
select is((select affected from public.lgpd_erase_subject('62911110000', null, 'LGPD-2026-001') where step = 'leads'), 2, 'D1 simulação conta 2 leads');
select is((select name from public.leads where id = (select lead_a from t_ids)), 'Titular Teste', 'D2 simulação não altera o lead');

-- ═══ E. execução ════════════════════════════════════════════════════════
create temp table t_run on commit drop as
  select * from public.lgpd_erase_subject('62911110000', 'titular@example.test', 'LGPD-2026-001', true);
select is((select affected from t_run where step = 'leads'), 2, 'E1 dois leads anonimizados');
select is((select count(*)::int from public.leads where id in ((select lead_a from t_ids), (select lead_b from t_ids))
            and name = 'Titular removido (LGPD)' and phone = '0' and archived_at is not null), 2, 'E2 nome e telefone removidos e arquivados');
select is((select count(*)::int from public.lead_form_submissions where lead_id = (select lead_a from t_ids)), 0, 'E3 respostas do titular apagadas');
select is((select count(*)::int from public.lead_timeline_entries where lead_id = (select lead_a from t_ids) and detail ilike '%Titular%'), 0, 'E4 texto livre da linha do tempo apagado');
select is((select label from public.lead_timeline_entries where lead_id = (select lead_a from t_ids)), 'Dados pessoais removidos (LGPD)', 'E5 um registro técnico na linha do tempo');
select is((select status || '/' || resolution || '/' || (payload = '{}'::jsonb)::text from public.kapa_leads_inbound_events
            where id = 'fe600000-0000-0000-0000-000000000002'), 'dismissed/lgpd_erased/true', 'E6 evento pendente descartado e sem dados');
select is((select count(*)::int from public.kapa_leads_inbound_events where source_lead_id in
            ('fe700000-0000-0000-0000-000000000001', 'fe700000-0000-0000-0000-000000000002')), 2, 'E7 marca técnica fica (impede reimportação)');
select is((select count(*)::int from public.leads where id = (select lead_other from t_ids) and name = 'Outro Cliente'), 1, 'E8 outro cliente intacto');
select is((select count(*)::int from public.lead_form_submissions where lead_id = (select lead_other from t_ids)), 1, 'E9 respostas do outro cliente intactas');
select is((select count(*)::int from public.audit_log where action = 'lgpd_subject_erased' and entity_id = 'LGPD-2026-001'), 2, 'E10 auditoria por empresa');
select ok((select bool_and(after_data::text not ilike '%Titular%' and after_data::text not like '%62911110000%')
             from public.audit_log where action = 'lgpd_subject_erased'), 'E11 auditoria sem dados pessoais');
select is((select count(*)::int from public.lgpd_subject_lookup('62911110000', null)), 0, 'E12 depois da eliminação nada mais é encontrado');

-- O mesmo lead do KAPA Leads, se vier de novo numa página (ex.: cursor voltado), não entra.
select is((select out_duplicates from public.kapa_leads_ingest_page(
  'fe500000-0000-0000-0000-000000000001', '2026-11-11T12:00:00Z', '00000000-0000-0000-0000-000000000000',
  jsonb_build_array(jsonb_build_object(
    'source_lead_id', 'fe700000-0000-0000-0000-000000000002', 'source_campaign_id', 'fe800000-0000-0000-0000-000000000001',
    'source_campaign_slug', 'fabrica', 'source_campaign_name', 'Fábrica', 'source_created_at', '2026-11-11T12:06:00Z',
    'store_id', 'fe900000-0000-0000-0000-0000000000a1',
    'payload', '{"contact":{"name":"Titular Teste","phone":"62911110000","email":null},"vehicle":null,"answers":[],"source_label":"x"}'::jsonb)),
  '2026-11-11T12:06:00Z', 'fe700000-0000-0000-0000-000000000002')), 1, 'E13 reimportação do lead eliminado é ignorada');
select is((select payload = '{}'::jsonb from public.kapa_leads_inbound_events where source_lead_id = 'fe700000-0000-0000-0000-000000000002'), true,
  'E14 o payload continua vazio');

-- ═══ F. item rejeitado (payload vazio) entra como falha visível e o cursor anda ═
select is((select out_invalid from public.kapa_leads_ingest_page(
  'fe500000-0000-0000-0000-000000000001', '2026-11-11T12:06:00Z', 'fe700000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object(
    'source_lead_id', 'fe700000-0000-0000-0000-000000000003', 'source_campaign_id', 'fe800000-0000-0000-0000-000000000001',
    'source_campaign_slug', 'campanha-nao-identificada', 'source_campaign_name', 'Campanha não identificada',
    'source_created_at', '2026-11-11T12:07:00Z', 'store_id', 'fe900000-0000-0000-0000-0000000000a1', 'payload', '{}'::jsonb)),
  '2026-11-11T12:07:00Z', 'fe700000-0000-0000-0000-000000000003')), 1, 'F1 item rejeitado conta como inválido');
select is((select status || '/' || last_error_code from public.kapa_leads_inbound_events where source_lead_id = 'fe700000-0000-0000-0000-000000000003'),
  'failed/invalid_payload', 'F2 fica na revisão');
select is((select cursor_lead_id from public.kapa_leads_store_links where id = 'fe500000-0000-0000-0000-000000000001'),
  'fe700000-0000-0000-0000-000000000003'::uuid, 'F3 cursor avançou (a loja não trava)');

-- ═══ G. volta do cursor (recuperação) ═══════════════════════════════════
select throws_ok($$select * from public.kapa_leads_link_rewind('fe500000-0000-0000-0000-000000000001', '2026-11-11T11:59:59Z')$$,
  '23514', 'before_activation', 'G1 nunca antes da ativação');
select throws_ok($$select * from public.kapa_leads_link_rewind('fe500000-0000-0000-0000-000000000001', '2026-11-11T12:30:00Z')$$,
  '23514', 'not_backwards', 'G2 só para trás');
select is((select out_cursor_created_at from public.kapa_leads_link_rewind('fe500000-0000-0000-0000-000000000001', '2026-11-11T12:00:00Z')),
  '2026-11-11T12:00:00Z'::timestamptz, 'G3 volta para a ativação');
select is((select count(*)::int from public.audit_log where action = 'kapa_leads_link_rewound'), 1, 'G4 auditado');
-- Página repetida depois da volta: tudo duplicado, nada novo.
select is((select out_duplicates from public.kapa_leads_ingest_page(
  'fe500000-0000-0000-0000-000000000001', '2026-11-11T12:00:00Z', '00000000-0000-0000-0000-000000000000',
  jsonb_build_array(jsonb_build_object(
    'source_lead_id', 'fe700000-0000-0000-0000-000000000003', 'source_campaign_id', 'fe800000-0000-0000-0000-000000000001',
    'source_campaign_slug', 'campanha-nao-identificada', 'source_campaign_name', 'Campanha não identificada',
    'source_created_at', '2026-11-11T12:07:00Z', 'store_id', 'fe900000-0000-0000-0000-0000000000a1', 'payload', '{}'::jsonb)),
  '2026-11-11T12:07:00Z', 'fe700000-0000-0000-0000-000000000003')), 1, 'G5 página repetida não duplica');

select * from finish();
rollback;
