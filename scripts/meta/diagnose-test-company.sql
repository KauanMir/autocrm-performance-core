-- Diagnostico somente leitura da TEST COMPANY. Nao retorna tokens, ciphertext,
-- nomes, telefones ou payloads. Nao aplica migrations nem reprocessa eventos.
begin read only;
set local statement_timeout = '10s';

-- Uma unica linha JSON: o SQL Editor pode mostrar apenas o ultimo result set.
with connection_health as (
select status,
       granted_scopes,
       access_token_ciphertext is not null as token_present,
       token_key_version,
       connected_at,
       leadgen_subscribed_at,
       last_error_code,
       last_error_at,
       disconnected_at
from public.company_meta_integrations
where company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'
  and page_id = '1381033925087695'
), event_summary as (

select status, last_error_code, count(*) as event_count,
       max(attempts) as max_attempts,
       max(received_at) as latest_received_at,
       max(processed_at) as latest_processed_at
from public.meta_leadgen_events
where company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'
  and page_id = '1381033925087695'
group by status, last_error_code
order by status, last_error_code
), lead_summary as (

select count(*) as meta_leads,
       count(*) filter (where archived_at is null) as active_meta_leads
from public.leads
where company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'
  and source = 'Meta Lead Ads'
), consistency as (

-- Um evento processed deve apontar para um lead da mesma empresa.
select count(*) as processed_without_matching_lead
from public.meta_leadgen_events e
left join public.leads l on l.id = e.crm_lead_id and l.company_id = e.company_id
where e.company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'
  and e.page_id = '1381033925087695'
  and e.status = 'processed'
  and l.id is null
)
select current_timestamp as checked_at,
       current_user as database_role,
       coalesce((select jsonb_agg(to_jsonb(c)) from connection_health c), '[]'::jsonb) as connections,
       coalesce((select jsonb_agg(to_jsonb(e) order by e.status, e.last_error_code) from event_summary e), '[]'::jsonb) as events,
       (select to_jsonb(l) from lead_summary l) as leads,
       (select processed_without_matching_lead from consistency) as processed_without_matching_lead;

rollback;
