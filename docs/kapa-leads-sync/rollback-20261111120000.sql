-- ROLLBACK de 20261111120000_kapa_leads_sync.sql (KAPA Leads → CRM). NÃO é migration.
-- Só usar com autorização, depois de pausar todos os vínculos e desligar KAPA_LEADS_SYNC_ENABLED.
-- Normalmente NÃO é necessário: o código anterior (3f60f1a) funciona com a migration aplicada
-- (objetos novos ficam sem uso). Rodar dentro de uma transação e conferir antes do COMMIT.
--
-- Efeito: apaga a fila e os vínculos da sincronização. Os LEADS criados pela sincronização
-- continuam no CRM; as respostas de formulário com source = 'kapa_leads' são apagadas, porque a
-- restrição antiga só aceita 'meta_lead_ads'. Exporte-as antes, se precisar guardá-las.
begin;

drop function if exists public.list_lead_form_submissions_v2(uuid, uuid);
drop function if exists public.kapa_leads_event_dismiss(uuid, uuid, text);
drop function if exists public.kapa_leads_event_requeue(uuid, uuid);
drop function if exists public.kapa_leads_review_list(uuid, integer);
drop function if exists public.kapa_leads_sync_health(uuid);
drop function if exists public.kapa_leads_link_set_enabled(uuid, uuid, boolean);
drop function if exists public.kapa_leads_link_upsert(uuid, uuid, text, text);
drop function if exists public.kapa_leads_link_rewind(uuid, timestamptz);
drop function if exists public.kapa_leads_record_reconciliation(uuid, timestamptz, timestamptz, integer);
drop function if exists public.kapa_leads_purge_expired();
drop function if exists public.kapa_leads_process_pending(integer);
drop function if exists public._kapa_leads_process_event(public.kapa_leads_inbound_events);
drop function if exists public.kapa_leads_link_record_failure(uuid, text);
drop function if exists public.kapa_leads_ingest_page(uuid, timestamptz, uuid, jsonb, timestamptz, uuid);
drop function if exists public.kapa_leads_links_for_poll();
drop function if exists public.kapa_leads_payload_valid(jsonb);

delete from public.lead_form_submissions where source = 'kapa_leads';
alter table public.lead_form_submissions drop constraint if exists lead_form_submissions_one_origin_ck;
alter table public.lead_form_submissions drop constraint if exists lead_form_submissions_source_ck;
alter table public.lead_form_submissions
  add constraint lead_form_submissions_source_ck check (source = 'meta_lead_ads');
alter table public.lead_form_submissions drop constraint if exists lead_form_submissions_source_detail_ck;
alter table public.lead_form_submissions drop constraint if exists lead_form_submissions_kapa_event_uniq;
alter table public.lead_form_submissions drop column if exists source_detail;
alter table public.lead_form_submissions drop column if exists kapa_leads_event_id;

drop table if exists public.kapa_leads_inbound_events;
drop table if exists public.kapa_leads_store_links;

delete from supabase_migrations.schema_migrations where version = '20261111120000';

-- Conferir: nenhuma função/tabela kapa_leads_* restante.
select count(*) as restantes from pg_proc where proname like '%kapa_leads%';
-- commit;  -- só depois de conferir
