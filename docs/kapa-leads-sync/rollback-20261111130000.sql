-- Rollback de 20261111130000_lgpd_subject_erasure.sql (SÓ com autorização; normalmente desnecessário).
-- Remove as funções de eliminação; a anonimização já feita NÃO é desfeita (é irreversível por desenho).
-- Pré-condição: nenhuma linha com resolution = 'lgpd_erased' (senão a restrição antiga falha; nesse
-- caso mantenha a restrição nova — ela é um superconjunto da antiga e não afeta o código publicado).
begin;
drop function if exists public.lgpd_erase_subject(text, text, text, boolean);
drop function if exists public.lgpd_subject_lookup(text, text);
drop function if exists public._lgpd_subject_queue_events(text, text);
drop function if exists public._lgpd_subject_leads(text, text);
drop function if exists public._lgpd_normalize_phone(text);
alter table public.kapa_leads_inbound_events drop constraint kapa_leads_inbound_events_resolution_ck;
alter table public.kapa_leads_inbound_events
  add constraint kapa_leads_inbound_events_resolution_ck check (
    resolution is null or resolution in ('handled_manually', 'duplicate', 'test_event', 'not_recoverable')
  );
delete from supabase_migrations.schema_migrations where version = '20261111130000';
commit;
