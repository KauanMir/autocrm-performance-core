-- META-INGESTION-P2.2 — fundação de processamento dos eventos leadgen.
-- Claim com lease, fail com política de retry, complete atômico (lead + evento)
-- e lookup estreito da conexão para o processor. Nenhum PII em meta_leadgen_events.
-- Mirror obrigatório de META_LEAD_ERROR_CODES (lib/server/meta-webhook/error-codes.ts)
-- e de META_LEAD_SOURCE (lib/server/meta-webhook/normalize-lead-fields.ts).
-- Match de telefone: leads ativos com phone_digits = nacional OU '55' || nacional.
-- Só essas duas representações; nenhum outro DDI. Lock: somente o nacional.

alter table public.meta_leadgen_events
  add column next_attempt_at timestamptz not null default now(),
  add column lease_token uuid;

alter table public.meta_leadgen_events
  add constraint meta_leadgen_events_state_ck check (
    (status = 'received' and lease_token is null and locked_until is null and processed_at is null)
    or (status = 'processing' and lease_token is not null and locked_until is not null and processed_at is null)
    or (status = 'processed' and lease_token is null and locked_until is null
        and crm_lead_id is not null and processed_at is not null and last_error_code is null)
    or (status = 'failed' and lease_token is null and locked_until is null
        and processed_at is null and last_error_code is not null)
  );

create index meta_leadgen_events_claim_idx
  on public.meta_leadgen_events (next_attempt_at)
  where status = 'received';

-- ── política de erro (closed set) ───────────────────────────────────────

create or replace function public.meta_leadgen_error_kind(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_code in ('graph_timeout', 'graph_error', 'graph_malformed', 'lead_not_found', 'crm_create_failed')
      then 'retryable'
    when p_code in ('token_decrypt_failed', 'token_invalid', 'graph_permission_missing', 'initial_stage_missing')
      then 'operational'
    when p_code in ('integration_not_found', 'invalid_field_data', 'missing_name', 'missing_phone',
                    'duplicate_phone_ambiguous', 'max_attempts', 'event_expired')
      then 'terminal'
    else null
  end
$$;

revoke all on function public.meta_leadgen_error_kind(text) from public, anon, authenticated, service_role;

-- ── claim em lote com lease ─────────────────────────────────────────────

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

-- ── fail com retry, operacional ou terminal ─────────────────────────────

create or replace function public.meta_leadgen_event_fail(
  p_event_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns table (
  out_outcome text,
  out_status text,
  out_attempts integer,
  out_next_attempt_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.meta_leadgen_events;
  v_kind text;
  v_backoff interval;
begin
  v_kind := public.meta_leadgen_error_kind(p_error_code);
  if p_event_id is null or p_lease_token is null or v_kind is null then
    raise using message = 'invalid_input';
  end if;

  select * into v_event
    from public.meta_leadgen_events e
   where e.id = p_event_id
     for update;

  if not found
    or v_event.status <> 'processing'
    or v_event.lease_token is distinct from p_lease_token
    or v_event.locked_until <= now()
  then
    return query select 'lease_lost'::text, null::text, null::integer, null::timestamptz;
    return;
  end if;

  if v_kind = 'terminal' then
    update public.meta_leadgen_events e
       set status = 'failed', last_error_code = p_error_code, lease_token = null, locked_until = null
     where e.id = p_event_id;
    return query select 'failed_terminal'::text, 'failed'::text, v_event.attempts, v_event.next_attempt_at;
    return;
  end if;

  if v_kind = 'operational' then
    update public.meta_leadgen_events e
       set status = 'received',
           attempts = greatest(e.attempts - 1, 0),
           next_attempt_at = now() + interval '1 hour',
           last_error_code = p_error_code,
           lease_token = null,
           locked_until = null
     where e.id = p_event_id;
    return query select 'retry_scheduled'::text, 'received'::text,
                        greatest(v_event.attempts - 1, 0), now() + interval '1 hour';
    return;
  end if;

  if v_event.attempts >= 5 then
    update public.meta_leadgen_events e
       set status = 'failed', last_error_code = 'max_attempts', lease_token = null, locked_until = null
     where e.id = p_event_id;
    return query select 'failed_max_attempts'::text, 'failed'::text, v_event.attempts, v_event.next_attempt_at;
    return;
  end if;

  v_backoff := case v_event.attempts
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '15 minutes'
    else interval '60 minutes'
  end;

  update public.meta_leadgen_events e
     set status = 'received',
         next_attempt_at = now() + v_backoff,
         last_error_code = p_error_code,
         lease_token = null,
         locked_until = null
   where e.id = p_event_id;
  return query select 'retry_scheduled'::text, 'received'::text, v_event.attempts, now() + v_backoff;
end;
$$;

-- ── lookup estreito da conexão para o processor (service_role) ──────────
-- Ciphertext só é devolvido para integração connected. Não reaproveita
-- meta_connection_lookup_by_page porque ela busca por page e filtra status:
-- o processor precisa distinguir disconnected de error pelo integration_id.

create or replace function public.meta_connection_lookup_for_processing(p_integration_id uuid)
returns table (
  out_integration_id uuid,
  out_company_id uuid,
  out_page_id text,
  out_status text,
  out_access_token_ciphertext text,
  out_token_key_version smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_integration_id is null then
    raise using message = 'invalid_input';
  end if;

  return query
    select i.id, i.company_id, i.page_id, i.status,
           case when i.status = 'connected' then i.access_token_ciphertext else null end,
           i.token_key_version
      from public.company_meta_integrations i
     where i.id = p_integration_id;
end;
$$;

-- ── complete: lead + evento na MESMA transação ─────────────────────────

create or replace function public.meta_leadgen_event_complete(
  p_event_id uuid,
  p_lease_token uuid,
  p_name text,
  p_phone text,
  p_car text
)
returns table (
  out_outcome text,
  out_crm_lead_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.meta_leadgen_events;
  v_count integer;
  v_stage_id uuid;
  v_lead_id uuid;
  v_lead public.leads;
begin
  if p_event_id is null or p_lease_token is null
    or p_name is null or btrim(p_name) = ''
    or p_car is null or btrim(p_car) = ''
    or p_phone is null or p_phone !~ '^[1-9][0-9]{9,10}$'
  then
    raise using message = 'invalid_input';
  end if;

  select * into v_event
    from public.meta_leadgen_events e
   where e.id = p_event_id
     for update;

  if not found
    or v_event.status <> 'processing'
    or v_event.lease_token is distinct from p_lease_token
    or v_event.locked_until <= now()
  then
    return query select 'lease_lost'::text, null::uuid;
    return;
  end if;

  perform 1
    from public.company_meta_integrations i
   where i.id = v_event.integration_id
     and i.company_id = v_event.company_id
     and i.page_id = v_event.page_id
     and i.status = 'connected';
  if not found then
    return query select 'integration_not_found'::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('meta_lead_phone:' || v_event.company_id::text || ':' || p_phone, 0)
  );

  select count(*) into v_count
    from public.leads l
   where l.company_id = v_event.company_id
     and l.phone_digits in (p_phone, '55' || p_phone)
     and l.archived_at is null;

  if v_count > 1 then
    return query select 'duplicate_phone_ambiguous'::text, null::uuid;
    return;
  end if;

  if v_count = 1 then
    select l.id into v_lead_id
      from public.leads l
     where l.company_id = v_event.company_id
       and l.phone_digits in (p_phone, '55' || p_phone)
       and l.archived_at is null;
  else
    select ps.id into v_stage_id
      from public.pipeline_stages ps
     where ps.company_id = v_event.company_id
       and ps.code = 'new';
    if not found then
      return query select 'initial_stage_missing'::text, null::uuid;
      return;
    end if;

    select * into v_lead
      from public.insert_lead_row(
        v_event.company_id, 'system', null, v_stage_id,
        p_name, p_phone, p_car, null, null, null, 'Meta Lead Ads'
      );
    v_lead_id := v_lead.id;
  end if;

  update public.meta_leadgen_events e
     set status = 'processed',
         crm_lead_id = v_lead_id,
         processed_at = now(),
         lease_token = null,
         locked_until = null,
         last_error_code = null
   where e.id = p_event_id;

  return query select
    case when v_count = 1 then 'linked_existing' else 'created' end::text,
    v_lead_id;
end;
$$;

-- ── privilégios: somente service_role ──────────────────────────────────

revoke all on function public.meta_leadgen_event_claim_batch(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.meta_leadgen_event_fail(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.meta_leadgen_event_complete(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.meta_connection_lookup_for_processing(uuid) from public, anon, authenticated;

grant execute on function public.meta_leadgen_event_claim_batch(uuid, integer, integer) to service_role;
grant execute on function public.meta_leadgen_event_fail(uuid, uuid, text) to service_role;
grant execute on function public.meta_leadgen_event_complete(uuid, uuid, text, text, text) to service_role;
grant execute on function public.meta_connection_lookup_for_processing(uuid) to service_role;
