-- META-MVP1 — confiabilidade do Lead Ads.
--
-- 1. Saúde do token da conexão (origem, validade, expiração de acesso a dados)
--    e estado de erro marcado pelo processor (reconexão necessária).
-- 2. Ledger: reprocessamento manual auditado e resolução de revisão.
-- 3. Respostas do formulário preservadas por lead (lead_form_submissions),
--    sem PII no ledger e sem sobrescrever o lead existente.
-- 4. Mapeamento de campos por formulário (meta_lead_form_mappings).
-- 5. Fila de revisão e saúde da conexão para Manager/Super Admin da company.
--
-- Nenhuma mudança de comportamento para company que não tenha conexão Meta.
-- As funções antigas (meta_connection_upsert, meta_leadgen_event_complete)
-- continuam existindo para o código já publicado; o código novo usa as _v2.

-- ═══ 1. saúde do token ══════════════════════════════════════════════════

alter table public.company_meta_integrations
  add column token_origin                 text,
  add column token_expires_at             timestamptz,
  add column token_data_access_expires_at timestamptz,
  add column token_checked_at             timestamptz;

alter table public.company_meta_integrations
  add constraint company_meta_integrations_token_origin_ck
    check (token_origin is null or token_origin in ('exchanged_long_lived', 'original_token'));

-- Upsert com metadados do token verificados server-side (debug_token).
-- Token de Página que expira em menos de 7 dias nunca é salvo: seria uma
-- conexão que morre em silêncio poucas horas depois.
create or replace function public.meta_connection_upsert_v2(
  p_company_id uuid,
  p_page_id text,
  p_page_name text,
  p_access_token_ciphertext text,
  p_token_key_version smallint,
  p_granted_scopes text[],
  p_connected_at timestamptz,
  p_connected_by uuid,
  p_leadgen_subscribed_at timestamptz,
  p_token_origin text,
  p_token_checked_at timestamptz,
  -- Opcionais (null = a Meta não informou): default para o PostgREST aceitar a omissão.
  p_token_expires_at timestamptz default null,
  p_token_data_access_expires_at timestamptz default null
)
returns table (
  id uuid,
  company_id uuid,
  page_id text,
  page_name text,
  status text,
  connected_at timestamptz,
  leadgen_subscribed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_meta_integrations;
  v_constraint text;
  c_required_scopes constant text[] := array[
    'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'
  ];
begin
  if p_company_id is null
    or p_page_id is null or p_page_id !~ '^[0-9]{1,30}$'
    or p_access_token_ciphertext is null or char_length(p_access_token_ciphertext) not between 1 and 4096
    or p_token_key_version is null or p_token_key_version < 1
    or p_connected_at is null
    or p_granted_scopes is null
    or cardinality(p_granted_scopes) <> cardinality(c_required_scopes)
    or not (p_granted_scopes <@ c_required_scopes)
    or not (p_granted_scopes @> c_required_scopes)
    or p_token_origin is null or p_token_origin not in ('exchanged_long_lived', 'original_token')
    or p_token_checked_at is null
  then
    raise using message = 'invalid_input';
  end if;

  if p_token_expires_at is not null and p_token_expires_at < now() + interval '7 days' then
    raise using message = 'token_short_lived';
  end if;
  if p_token_data_access_expires_at is not null and p_token_data_access_expires_at <= now() then
    raise using message = 'token_data_access_expired';
  end if;

  begin
    insert into public.company_meta_integrations as i (
      company_id, page_id, page_name, access_token_ciphertext, token_key_version,
      granted_scopes, status, connected_at, connected_by, leadgen_subscribed_at,
      disconnected_at, last_error_code, last_error_at,
      token_origin, token_expires_at, token_data_access_expires_at, token_checked_at
    ) values (
      p_company_id, p_page_id, p_page_name, p_access_token_ciphertext, p_token_key_version,
      p_granted_scopes, 'connected', p_connected_at, p_connected_by, p_leadgen_subscribed_at,
      null, null, null,
      p_token_origin, p_token_expires_at, p_token_data_access_expires_at, p_token_checked_at
    )
    on conflict on constraint company_meta_integrations_company_page_uniq do update set
      page_name = excluded.page_name,
      access_token_ciphertext = excluded.access_token_ciphertext,
      token_key_version = excluded.token_key_version,
      granted_scopes = excluded.granted_scopes,
      status = 'connected',
      connected_at = excluded.connected_at,
      connected_by = excluded.connected_by,
      leadgen_subscribed_at = excluded.leadgen_subscribed_at,
      disconnected_at = null,
      last_error_code = null,
      last_error_at = null,
      token_origin = excluded.token_origin,
      token_expires_at = excluded.token_expires_at,
      token_data_access_expires_at = excluded.token_data_access_expires_at,
      token_checked_at = excluded.token_checked_at,
      updated_at = now()
    returning i.* into v_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'company_meta_integrations_page_connected_uniq' then
        raise using message = 'page_already_connected';
      end if;
      raise;
  end;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (p_connected_by, p_company_id, 'meta_connection_upserted', 'company_meta_integration', v_row.id::text,
     'success', null, null,
     jsonb_build_object('page_id', v_row.page_id, 'status', v_row.status, 'token_origin', v_row.token_origin,
                        'token_expires', v_row.token_expires_at is not null),
     'rpc');

  return query select v_row.id, v_row.company_id, v_row.page_id, v_row.page_name, v_row.status,
                      v_row.connected_at, v_row.leadgen_subscribed_at;
end;
$$;

-- O processor marca a conexão como erro quando a Meta recusa o token ou a
-- permissão. Só sai de connected; reconectar (upsert) volta a connected.
create or replace function public.meta_connection_mark_error(p_integration_id uuid, p_error_code text)
returns table (out_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_meta_integrations;
begin
  if p_integration_id is null
    or p_error_code is null
    or p_error_code not in ('token_invalid', 'token_expired', 'permission_missing')
  then
    raise using message = 'invalid_input';
  end if;

  update public.company_meta_integrations i
     set status = 'error',
         last_error_code = p_error_code,
         last_error_at = now()
   where i.id = p_integration_id
     and i.status = 'connected'
  returning i.* into v_row;

  if not found then
    return query select 'unchanged'::text;
    return;
  end if;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (null, v_row.company_id, 'meta_connection_marked_error', 'company_meta_integration', v_row.id::text,
     'success', p_error_code, jsonb_build_object('status', 'connected'), jsonb_build_object('status', 'error'), 'rpc');

  return query select 'marked'::text;
end;
$$;

-- Ingestão: conexão connected OU error da Page. Uma conexão em erro ainda
-- recebe o evento no ledger (o lead fica aguardando reconexão, visível na
-- fila), em vez de ser descartado com 200.
create or replace function public.meta_connection_owner_for_ingestion(p_page_id text)
returns table (
  integration_id uuid,
  company_id uuid,
  page_id text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_page_id is null or p_page_id !~ '^[0-9]{1,30}$' then
    raise using message = 'invalid_input';
  end if;

  return query
    select i.id, i.company_id, i.page_id, i.status
      from public.company_meta_integrations i
     where i.page_id = p_page_id
       and i.status in ('connected', 'error')
     order by (i.status = 'connected') desc, i.updated_at desc;
end;
$$;

-- Registro no ledger também para conexão em erro (mesma assinatura da P1:
-- create or replace preserva o grant de service_role).
create or replace function public.meta_leadgen_event_register(
  p_integration_id uuid,
  p_company_id uuid,
  p_page_id text,
  p_leadgen_id text,
  p_form_id text default null,
  p_received_at timestamptz default now()
)
returns table (
  out_event_id uuid,
  out_status text,
  out_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_created boolean := false;
begin
  if p_integration_id is null or p_company_id is null or p_received_at is null
    or p_page_id is null or p_page_id !~ '^[0-9]{1,30}$'
    or p_leadgen_id is null or p_leadgen_id !~ '^[0-9]{1,64}$'
    or (p_form_id is not null and p_form_id !~ '^[0-9]{1,64}$')
  then
    raise using message = 'invalid_input';
  end if;

  perform 1
    from public.company_meta_integrations i
    where i.id = p_integration_id
      and i.company_id = p_company_id
      and i.page_id = p_page_id
      and i.status in ('connected', 'error');
  if not found then
    raise using message = 'integration_not_connected';
  end if;

  insert into public.meta_leadgen_events
    (integration_id, company_id, page_id, leadgen_id, form_id, status, received_at)
  values
    (p_integration_id, p_company_id, p_page_id, p_leadgen_id, p_form_id, 'received', p_received_at)
  on conflict on constraint meta_leadgen_events_page_leadgen_uniq do nothing
  returning id, status into v_id, v_status;

  if v_id is null then
    select e.id, e.status into v_id, v_status
      from public.meta_leadgen_events e
      where e.page_id = p_page_id and e.leadgen_id = p_leadgen_id;
  else
    v_created := true;
  end if;

  return query select v_id, v_status, v_created;
end;
$$;

-- Lookup do processor com a validade do token. Retorno muda: drop + create.
drop function public.meta_connection_lookup_for_processing(uuid);

create function public.meta_connection_lookup_for_processing(p_integration_id uuid)
returns table (
  out_integration_id uuid,
  out_company_id uuid,
  out_page_id text,
  out_status text,
  out_access_token_ciphertext text,
  out_token_key_version smallint,
  out_token_expires_at timestamptz,
  out_token_data_access_expires_at timestamptz
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
           i.token_key_version,
           i.token_expires_at,
           i.token_data_access_expires_at
      from public.company_meta_integrations i
     where i.id = p_integration_id;
end;
$$;

-- Código novo de erro operacional: token vencido segundo os metadados salvos.
create or replace function public.meta_leadgen_error_kind(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_code in ('graph_timeout', 'graph_error', 'graph_malformed', 'lead_not_found', 'crm_create_failed')
      then 'retryable'
    when p_code in ('token_decrypt_failed', 'token_invalid', 'token_expired', 'graph_permission_missing',
                    'initial_stage_missing')
      then 'operational'
    when p_code in ('integration_not_found', 'invalid_field_data', 'missing_name', 'missing_phone',
                    'duplicate_phone_ambiguous', 'max_attempts', 'event_expired')
      then 'terminal'
    else null
  end
$$;

revoke all on function public.meta_leadgen_error_kind(text) from public, anon, authenticated, service_role;

-- ═══ 2. ledger: reprocessamento e resolução ═════════════════════════════

alter table public.meta_leadgen_events
  add column requeue_count      integer not null default 0,
  add column last_requeued_at   timestamptz,
  add column last_requeued_by   uuid references public.profiles(id) on delete set null,
  add column review_resolved_at timestamptz,
  add column review_resolved_by uuid references public.profiles(id) on delete set null,
  add column review_resolution  text;

alter table public.meta_leadgen_events
  add constraint meta_leadgen_events_requeue_count_ck check (requeue_count between 0 and 10),
  add constraint meta_leadgen_events_review_resolution_ck check (
    review_resolution is null
    or review_resolution in ('handled_manually', 'duplicate', 'test_event', 'not_recoverable')
  ),
  add constraint meta_leadgen_events_review_pair_ck check (
    (review_resolved_at is null) = (review_resolution is null)
  ),
  add constraint meta_leadgen_events_review_failed_ck check (
    review_resolved_at is null or status = 'failed'
  );

-- Claim: a janela de 7 dias recomeça num reprocessamento manual. Mesma
-- assinatura: create or replace preserva o grant de service_role.
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
   where coalesce(e.last_requeued_at, e.received_at) < now() - interval '7 days'
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

-- ═══ 3. respostas do formulário ════════════════════════════════════════

-- Formato fechado: [{ "key": text(1..100), "values": [text(1..1000)] (1..10) }]
-- com no máximo 50 itens e nenhuma outra chave.
create or replace function public.lead_form_answers_valid(p_answers jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_answers) = 'array', false)
     and jsonb_array_length(p_answers) <= 50
     and not exists (
       select 1
         from jsonb_array_elements(p_answers) as item(e)
        where jsonb_typeof(e) is distinct from 'object'
           or (select count(*) from jsonb_object_keys(e)) <> 2
           or jsonb_typeof(e -> 'key') is distinct from 'string'
           or coalesce(char_length(e ->> 'key') not between 1 and 100, true)
           or jsonb_typeof(e -> 'values') is distinct from 'array'
           or coalesce(jsonb_array_length(e -> 'values') not between 1 and 10, true)
           or exists (
             select 1
               from jsonb_array_elements(e -> 'values') as val(v)
              where jsonb_typeof(v) is distinct from 'string'
                 or coalesce(char_length(v #>> '{}') not between 1 and 1000, true)
           )
     )
$$;

revoke all on function public.lead_form_answers_valid(jsonb) from public, anon, authenticated;

create table public.lead_form_submissions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  lead_id          uuid not null,
  meta_event_id    uuid references public.meta_leadgen_events(id) on delete set null,
  source           text not null,
  outcome          text not null,
  form_id          text,
  ad_id            text,
  submitted_at     timestamptz,
  contact_name     text not null,
  contact_phone    text not null,
  contact_email    text,
  vehicle_interest text,
  answers          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),

  constraint lead_form_submissions_event_uniq unique (meta_event_id),
  constraint lead_form_submissions_lead_fk
    foreign key (company_id, lead_id) references public.leads (company_id, id) on delete cascade,
  constraint lead_form_submissions_source_ck check (source = 'meta_lead_ads'),
  constraint lead_form_submissions_outcome_ck check (outcome in ('created', 'linked_existing')),
  constraint lead_form_submissions_form_id_ck check (form_id is null or form_id ~ '^[0-9]{1,64}$'),
  constraint lead_form_submissions_ad_id_ck check (ad_id is null or ad_id ~ '^[0-9]{1,64}$'),
  constraint lead_form_submissions_name_ck check (char_length(btrim(contact_name)) between 1 and 200),
  constraint lead_form_submissions_phone_ck check (contact_phone ~ '^[1-9][0-9]{9,10}$'),
  constraint lead_form_submissions_email_ck check (
    contact_email is null or (char_length(contact_email) between 3 and 254 and contact_email ~ '^[^@\s]+@[^@\s]+$')
  ),
  constraint lead_form_submissions_vehicle_ck check (
    vehicle_interest is null or char_length(btrim(vehicle_interest)) between 1 and 200
  ),
  constraint lead_form_submissions_answers_ck check (public.lead_form_answers_valid(answers))
);

create index lead_form_submissions_lead_idx on public.lead_form_submissions (company_id, lead_id, created_at desc);

alter table public.lead_form_submissions enable row level security;

-- Sem grant direto: leitura só pela RPC abaixo, que espelha a visibilidade do lead.
revoke all on table public.lead_form_submissions from public, anon, authenticated, service_role;

-- ═══ 4. mapeamento de campos por formulário ════════════════════════════

create table public.meta_lead_form_mappings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  form_id     text not null,
  target      text not null,
  field_key   text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint meta_lead_form_mappings_uniq unique (company_id, form_id, target),
  constraint meta_lead_form_mappings_form_id_ck check (form_id ~ '^[0-9]{1,64}$'),
  constraint meta_lead_form_mappings_target_ck check (target in ('name', 'phone', 'email', 'vehicle')),
  constraint meta_lead_form_mappings_field_key_ck check (
    char_length(field_key) between 1 and 100 and field_key !~ '[[:cntrl:]]' and field_key = btrim(field_key)
  )
);

create trigger meta_lead_form_mappings_set_updated_at
  before update on public.meta_lead_form_mappings
  for each row execute function set_updated_at();

alter table public.meta_lead_form_mappings enable row level security;

revoke all on table public.meta_lead_form_mappings from public, anon, authenticated, service_role;

create or replace function public.meta_form_mapping_for_processing(p_company_id uuid, p_form_id text)
returns table (out_target text, out_field_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company_id is null then
    raise using message = 'invalid_input';
  end if;
  if p_form_id is null then
    return;
  end if;
  if p_form_id !~ '^[0-9]{1,64}$' then
    raise using message = 'invalid_input';
  end if;

  return query
    select m.target, m.field_key
      from public.meta_lead_form_mappings m
     where m.company_id = p_company_id
       and m.form_id = p_form_id
     order by m.target;
end;
$$;

create or replace function public.meta_form_mapping_list(p_company_id uuid)
returns table (form_id text, target text, field_key text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  return query
    select m.form_id, m.target, m.field_key, m.updated_at
      from public.meta_lead_form_mappings m
     where m.company_id = p_company_id
     order by m.form_id, m.target;
end;
$$;

create or replace function public.meta_form_mapping_set(
  p_company_id uuid,
  p_form_id text,
  p_target text,
  p_field_key text
)
returns table (form_id text, target text, field_key text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.meta_lead_form_mappings;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_form_id is null or p_form_id !~ '^[0-9]{1,64}$'
    or p_target is null or p_target not in ('name', 'phone', 'email', 'vehicle')
    or p_field_key is null or char_length(btrim(p_field_key)) not between 1 and 100
    or p_field_key ~ '[[:cntrl:]]'
  then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  insert into public.meta_lead_form_mappings as m (company_id, form_id, target, field_key, created_by)
  values (p_company_id, p_form_id, p_target, btrim(p_field_key), auth.uid())
  on conflict on constraint meta_lead_form_mappings_uniq do update set
    field_key = excluded.field_key,
    created_by = excluded.created_by
  returning m.* into v_row;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'meta_form_mapping_set', 'meta_lead_form_mapping', v_row.id::text,
     'success', null, null,
     jsonb_build_object('form_id', v_row.form_id, 'target', v_row.target, 'field_key', v_row.field_key), 'rpc');

  return query select v_row.form_id, v_row.target, v_row.field_key, v_row.updated_at;
end;
$$;

create or replace function public.meta_form_mapping_delete(p_company_id uuid, p_form_id text, p_target text)
returns table (out_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_form_id is null or p_target is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  delete from public.meta_lead_form_mappings m
   where m.company_id = p_company_id and m.form_id = p_form_id and m.target = p_target
  returning m.id into v_id;

  if v_id is null then
    return query select 'not_found'::text;
    return;
  end if;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'meta_form_mapping_deleted', 'meta_lead_form_mapping', v_id::text,
     'success', null, jsonb_build_object('form_id', p_form_id, 'target', p_target), null, 'rpc');

  return query select 'deleted'::text;
end;
$$;

-- ═══ complete v2: lead + respostas + evento na MESMA transação ═════════
-- Lead novo: criado na etapa new, sem vendedor (atribuição é MVP-2).
-- Lead existente (mesmo telefone): NUNCA alterado; ganha a submissão e uma
-- entrada no histórico. Qualquer falha desfaz tudo e o evento não vira
-- processed.

create or replace function public.meta_leadgen_event_complete_v2(
  p_event_id uuid,
  p_lease_token uuid,
  p_name text,
  p_phone text,
  p_answers jsonb,
  -- Opcionais (null = ausente no formulário): default para o PostgREST aceitar a omissão.
  p_email text default null,
  p_vehicle text default null,
  p_form_id text default null,
  p_ad_id text default null,
  p_submitted_at timestamptz default null
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
  v_vehicle text := nullif(btrim(p_vehicle), '');
  v_outcome text;
begin
  if p_event_id is null or p_lease_token is null
    or p_name is null or char_length(btrim(p_name)) not between 1 and 200
    or p_phone is null or p_phone !~ '^[1-9][0-9]{9,10}$'
    or (v_vehicle is not null and char_length(v_vehicle) > 200)
    or p_answers is null or not public.lead_form_answers_valid(p_answers)
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
    v_outcome := 'linked_existing';

    perform public.record_lead_timeline_event(
      v_event.company_id, v_lead_id, 'system', null,
      'message', '#7FB2E5', 'Novo formulário Meta recebido', null);
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
        btrim(p_name), p_phone, coalesce(v_vehicle, 'Não informado'), null, null, null, 'Meta Lead Ads'
      );
    v_lead_id := v_lead.id;
    v_outcome := 'created';
  end if;

  insert into public.lead_form_submissions (
    company_id, lead_id, meta_event_id, source, outcome, form_id, ad_id, submitted_at,
    contact_name, contact_phone, contact_email, vehicle_interest, answers
  ) values (
    v_event.company_id, v_lead_id, v_event.id, 'meta_lead_ads', v_outcome,
    coalesce(p_form_id, v_event.form_id), p_ad_id, p_submitted_at,
    btrim(p_name), p_phone, nullif(btrim(p_email), ''), v_vehicle, p_answers
  );

  update public.meta_leadgen_events e
     set status = 'processed',
         crm_lead_id = v_lead_id,
         processed_at = now(),
         lease_token = null,
         locked_until = null,
         last_error_code = null
   where e.id = p_event_id;

  return query select v_outcome, v_lead_id;
end;
$$;

-- Leitura das respostas: mesma visibilidade do lead (Manager da company,
-- Seller dono do lead não arquivado, Super Admin com acesso à company).
create or replace function public.list_lead_form_submissions(p_lead_id uuid, p_company_id uuid default null)
returns table (
  id uuid,
  outcome text,
  form_id text,
  ad_id text,
  submitted_at timestamptz,
  received_at timestamptz,
  contact_name text,
  contact_phone text,
  contact_email text,
  vehicle_interest text,
  answers jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_lead public.leads;
begin
  if p_lead_id is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  v_company_id := public._resolve_commercial_read_company(p_company_id);

  select * into v_lead from public.leads l where l.id = p_lead_id and l.company_id = v_company_id;
  if not found then
    raise no_data_found using message = 'lead_not_found';
  end if;

  if not public.is_platform_super_admin() then
    if not exists (select 1 from public.companies c where c.id = v_company_id and c.status = 'ativa') then
      raise insufficient_privilege using message = 'forbidden';
    end if;
    if public.current_membership_role() = 'seller' then
      if v_lead.archived_at is not null
        or v_lead.seller_id is distinct from public.current_profile_seller_id_for_company(v_company_id)
      then
        raise no_data_found using message = 'lead_not_found';
      end if;
    elsif public.current_membership_role() is distinct from 'manager' then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  return query
    select s.id, s.outcome, s.form_id, s.ad_id, s.submitted_at, s.created_at,
           s.contact_name, s.contact_phone, s.contact_email, s.vehicle_interest, s.answers
      from public.lead_form_submissions s
     where s.company_id = v_company_id
       and s.lead_id = p_lead_id
     order by s.created_at desc
     limit 20;
end;
$$;

-- ═══ 5. fila de revisão e saúde da conexão ═════════════════════════════
-- Somente metadados técnicos: o ledger não tem PII. Autorização: Manager da
-- company ou Super Admin com acesso (is_manager_or_platform).

create or replace function public.meta_connection_health(p_company_id uuid)
returns table (
  integration_id uuid,
  page_id text,
  page_name text,
  status text,
  last_error_code text,
  last_error_at timestamptz,
  connected_at timestamptz,
  leadgen_subscribed_at timestamptz,
  token_origin text,
  token_expires_at timestamptz,
  token_data_access_expires_at timestamptz,
  token_checked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  return query
    select i.id, i.page_id, i.page_name, i.status, i.last_error_code, i.last_error_at,
           i.connected_at, i.leadgen_subscribed_at, i.token_origin, i.token_expires_at,
           i.token_data_access_expires_at, i.token_checked_at
      from public.company_meta_integrations i
     where i.company_id = p_company_id
     order by i.page_id;
end;
$$;

create or replace function public.meta_leadgen_review_list(p_company_id uuid, p_limit integer default 50)
returns table (
  event_id uuid,
  review_state text,
  status text,
  last_error_code text,
  error_kind text,
  attempts integer,
  requeue_count integer,
  received_at timestamptz,
  next_attempt_at timestamptz,
  updated_at timestamptz,
  form_id text,
  leadgen_id text,
  can_requeue boolean,
  can_dismiss boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  return query
    with rows as (
      select e.*,
             case
               when e.status = 'failed' and e.review_resolved_at is null then 'failed'
               -- 'stuck' antes de 'retrying': retry vencido há mais de 15 min sem
               -- ninguém processar (ex.: sem cron) é sinal de parada, não de espera.
               when e.status = 'processing' and e.locked_until < now() then 'stuck'
               when e.status = 'received' and e.next_attempt_at < now() - interval '15 minutes' then 'stuck'
               when e.status = 'received' and e.last_error_code is not null then 'retrying'
               else null
             end as state
        from public.meta_leadgen_events e
       where e.company_id = p_company_id
    )
    select r.id, r.state, r.status, r.last_error_code, public.meta_leadgen_error_kind(r.last_error_code),
           r.attempts, r.requeue_count, r.received_at, r.next_attempt_at, r.updated_at,
           r.form_id, r.leadgen_id,
           (r.state in ('failed', 'retrying', 'stuck') and r.status <> 'processing'
             and r.requeue_count < 10 and r.received_at > now() - interval '90 days'),
           (r.state = 'failed')
      from rows r
     where r.state is not null
     order by case r.state when 'failed' then 0 when 'stuck' then 1 else 2 end, r.received_at desc
     limit p_limit;
end;
$$;

create or replace function public.meta_leadgen_review_summary(p_company_id uuid)
returns table (
  failed_open integer,
  retrying integer,
  stuck integer,
  pending integer,
  processed_last_7d integer,
  dismissed_last_30d integer,
  last_received_at timestamptz,
  last_processed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  return query
    select
      count(*) filter (where e.status = 'failed' and e.review_resolved_at is null)::integer,
      count(*) filter (where e.status = 'received' and e.last_error_code is not null
                          and e.next_attempt_at >= now() - interval '15 minutes')::integer,
      count(*) filter (where (e.status = 'processing' and e.locked_until < now())
                          or (e.status = 'received' and e.next_attempt_at < now() - interval '15 minutes'))::integer,
      count(*) filter (where e.status in ('received', 'processing'))::integer,
      count(*) filter (where e.status = 'processed' and e.processed_at > now() - interval '7 days')::integer,
      count(*) filter (where e.review_resolved_at > now() - interval '30 days')::integer,
      max(e.received_at),
      max(e.processed_at)
      from public.meta_leadgen_events e
     where e.company_id = p_company_id;
end;
$$;

-- Reprocessamento manual: volta o evento para received com tentativas
-- zeradas e nova janela de 7 dias. Leads Meta ficam disponíveis por 90 dias
-- na Graph; além disso o reprocessamento é recusado.
create or replace function public.meta_leadgen_event_requeue(p_company_id uuid, p_event_id uuid)
returns table (out_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.meta_leadgen_events;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_event_id is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  select * into v_event
    from public.meta_leadgen_events e
   where e.id = p_event_id and e.company_id = p_company_id
     for update;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  if not (
    (v_event.status = 'failed' and v_event.review_resolved_at is null)
    or (v_event.status = 'received')
  ) then
    return query select 'not_requeueable'::text;
    return;
  end if;
  if v_event.requeue_count >= 10 then
    return query select 'requeue_limit'::text;
    return;
  end if;
  if v_event.received_at <= now() - interval '90 days' then
    return query select 'too_old'::text;
    return;
  end if;

  update public.meta_leadgen_events e
     set status = 'received',
         attempts = 0,
         next_attempt_at = now(),
         lease_token = null,
         locked_until = null,
         requeue_count = e.requeue_count + 1,
         last_requeued_at = now(),
         last_requeued_by = auth.uid()
   where e.id = p_event_id;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'meta_leadgen_event_requeued', 'meta_leadgen_event', p_event_id::text,
     'success', v_event.last_error_code,
     jsonb_build_object('status', v_event.status, 'attempts', v_event.attempts),
     jsonb_build_object('status', 'received', 'requeue_count', v_event.requeue_count + 1), 'rpc');

  return query select 'requeued'::text;
end;
$$;

create or replace function public.meta_leadgen_event_dismiss(p_company_id uuid, p_event_id uuid, p_resolution text)
returns table (out_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.meta_leadgen_events;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_company_id is null or not public.is_manager_or_platform(p_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_event_id is null or p_resolution is null
    or p_resolution not in ('handled_manually', 'duplicate', 'test_event', 'not_recoverable')
  then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  select * into v_event
    from public.meta_leadgen_events e
   where e.id = p_event_id and e.company_id = p_company_id
     for update;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_event.status <> 'failed' or v_event.review_resolved_at is not null then
    return query select 'not_dismissable'::text;
    return;
  end if;

  update public.meta_leadgen_events e
     set review_resolved_at = now(),
         review_resolved_by = auth.uid(),
         review_resolution = p_resolution
   where e.id = p_event_id;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'meta_leadgen_event_dismissed', 'meta_leadgen_event', p_event_id::text,
     'success', p_resolution, jsonb_build_object('last_error_code', v_event.last_error_code), null, 'rpc');

  return query select 'dismissed'::text;
end;
$$;

-- ═══ privilégios ═══════════════════════════════════════════════════════

-- service_role (processor/callback, server-only)
revoke all on function public.meta_connection_upsert_v2(uuid, text, text, text, smallint, text[], timestamptz, uuid, timestamptz, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.meta_connection_mark_error(uuid, text) from public, anon, authenticated;
revoke all on function public.meta_connection_owner_for_ingestion(text) from public, anon, authenticated;
revoke all on function public.meta_connection_lookup_for_processing(uuid) from public, anon, authenticated;
revoke all on function public.meta_form_mapping_for_processing(uuid, text) from public, anon, authenticated;
revoke all on function public.meta_leadgen_event_complete_v2(uuid, uuid, text, text, jsonb, text, text, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.meta_connection_upsert_v2(uuid, text, text, text, smallint, text[], timestamptz, uuid, timestamptz, text, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.meta_connection_mark_error(uuid, text) to service_role;
grant execute on function public.meta_connection_owner_for_ingestion(text) to service_role;
grant execute on function public.meta_connection_lookup_for_processing(uuid) to service_role;
grant execute on function public.meta_form_mapping_for_processing(uuid, text) to service_role;
grant execute on function public.meta_leadgen_event_complete_v2(uuid, uuid, text, text, jsonb, text, text, text, text, timestamptz) to service_role;

-- authenticated (autorização dentro da função)
revoke all on function public.list_lead_form_submissions(uuid, uuid) from public, anon, service_role;
revoke all on function public.meta_connection_health(uuid) from public, anon, service_role;
revoke all on function public.meta_leadgen_review_list(uuid, integer) from public, anon, service_role;
revoke all on function public.meta_leadgen_review_summary(uuid) from public, anon, service_role;
revoke all on function public.meta_leadgen_event_requeue(uuid, uuid) from public, anon, service_role;
revoke all on function public.meta_leadgen_event_dismiss(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.meta_form_mapping_list(uuid) from public, anon, service_role;
revoke all on function public.meta_form_mapping_set(uuid, text, text, text) from public, anon, service_role;
revoke all on function public.meta_form_mapping_delete(uuid, text, text) from public, anon, service_role;

grant execute on function public.list_lead_form_submissions(uuid, uuid) to authenticated;
grant execute on function public.meta_connection_health(uuid) to authenticated;
grant execute on function public.meta_leadgen_review_list(uuid, integer) to authenticated;
grant execute on function public.meta_leadgen_review_summary(uuid) to authenticated;
grant execute on function public.meta_leadgen_event_requeue(uuid, uuid) to authenticated;
grant execute on function public.meta_leadgen_event_dismiss(uuid, uuid, text) to authenticated;
grant execute on function public.meta_form_mapping_list(uuid) to authenticated;
grant execute on function public.meta_form_mapping_set(uuid, text, text, text) to authenticated;
grant execute on function public.meta_form_mapping_delete(uuid, text, text) to authenticated;
