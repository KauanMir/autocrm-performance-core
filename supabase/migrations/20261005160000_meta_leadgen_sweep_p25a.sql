-- META-INGESTION-P2.5A — expiração de 7 dias dentro do claim em lote.
-- Eventos não processados há mais de 7 dias viram failed/event_expired ANTES do
-- claim normal, sem Graph e sem decrypt. Mesma assinatura e colunas da P2.2:
-- create or replace preserva os grants de service_role.

create or replace function public.meta_leadgen_event_claim_batch(
  p_event_id uuid default null,
  p_limit integer default 20,
  p_lease_seconds integer default 90
)
returns table (
  out_event_id uuid,
  out_integration_id uuid,
  out_company_id uuid,
  out_page_id text,
  out_leadgen_id text,
  out_form_id text,
  out_attempts integer,
  out_lease_token uuid,
  out_locked_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 20
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 300
  then
    raise using message = 'invalid_input';
  end if;

  update public.meta_leadgen_events e
     set status = 'failed',
         last_error_code = 'event_expired',
         lease_token = null,
         locked_until = null
   where e.received_at < now() - interval '7 days'
     and (
       e.status = 'received'
       or (e.status = 'processing' and e.locked_until < now())
     )
     and (p_event_id is null or e.id = p_event_id);

  update public.meta_leadgen_events e
     set status = 'failed',
         last_error_code = 'max_attempts',
         lease_token = null,
         locked_until = null
   where e.status = 'processing'
     and e.locked_until < now()
     and e.attempts >= 5
     and (p_event_id is null or e.id = p_event_id);

  return query
  with candidates as (
    select e.id
      from public.meta_leadgen_events e
     where (p_event_id is null or e.id = p_event_id)
       and e.attempts < 5
       and (
         (e.status = 'received' and e.next_attempt_at <= now())
         or (e.status = 'processing' and e.locked_until < now())
       )
     order by e.next_attempt_at, e.id
     limit p_limit
     for update skip locked
  )
  update public.meta_leadgen_events e
     set status = 'processing',
         attempts = e.attempts + 1,
         lease_token = gen_random_uuid(),
         locked_until = now() + make_interval(secs => p_lease_seconds)
    from candidates c
   where e.id = c.id
  returning e.id, e.integration_id, e.company_id, e.page_id, e.leadgen_id, e.form_id,
            e.attempts, e.lease_token, e.locked_until;
end;
$$;
