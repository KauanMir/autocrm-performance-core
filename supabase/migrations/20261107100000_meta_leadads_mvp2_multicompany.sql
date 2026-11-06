-- META-MVP2 — Lead Ads multiempresa (LOCAL; não aplicada em nenhum ambiente).
--
-- 1. Autorização por empresa, DESLIGADA por padrão, ligada só pelo Super Admin.
--    Substitui a company/Página de teste fixas no código.
-- 2. Ingestão e processor passam a exigir a autorização da empresa dona da Page.
-- 3. Seleção de Página após o OAuth: tokens de Página das Páginas elegíveis
--    ficam CIFRADOS numa seleção de uso único com TTL curto; o usuário escolhe
--    uma e só ela vira conexão.
-- 4. Posse da Página: conexão em erro de outra empresa também bloqueia. Sem
--    isso, outra empresa tomaria a Página enquanto a dona reconecta, e os
--    leads seguintes iriam para ela.
-- 5. Eventos sem dono: webhook assinado cuja Página não tem conexão utilizável
--    (ou cuja empresa está desligada) fica retido SEM empresa, em vez de ser
--    descartado com 200. Só o Super Admin libera, para uma empresa conectada.
--
-- Nenhuma empresa é habilitada aqui. Nenhuma linha é criada.

-- ═══ 1. autorização por empresa ═════════════════════════════════════════

create table public.company_meta_lead_ads_access (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  enabled     boolean not null default false,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger company_meta_lead_ads_access_set_updated_at
  before update on public.company_meta_lead_ads_access
  for each row execute function set_updated_at();

alter table public.company_meta_lead_ads_access enable row level security;
revoke all on table public.company_meta_lead_ads_access from public, anon, authenticated, service_role;

-- Leitura interna (sem autorização de usuário): ausência de linha = desligado.
-- Só empresa `ativa` recebe leads: a policy de leitura de leads exige esse status,
-- e lead criado em empresa em implantação ou suspensa ficaria invisível para todos.
create or replace function public.meta_lead_ads_enabled_for(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select a.enabled
      from public.company_meta_lead_ads_access a
      join public.companies c on c.id = a.company_id
     where a.company_id = p_company_id
       and c.status = 'ativa'
  ), false)
$$;

-- Super Admin liga/desliga. Manager nunca amplia a própria permissão.
create or replace function public.meta_lead_ads_set_company_access(p_company_id uuid, p_enabled boolean)
returns table (company_id uuid, enabled boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before boolean;
  v_status text;
  v_row public.company_meta_lead_ads_access;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_company_id is null or p_enabled is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;
  select c.status::text into v_status from public.companies c where c.id = p_company_id;
  if not found then
    raise no_data_found using message = 'company_not_found';
  end if;
  -- Desligar é sempre permitido; ligar só em empresa ativa.
  if p_enabled and v_status <> 'ativa' then
    raise check_violation using message = 'company_not_active';
  end if;

  v_before := public.meta_lead_ads_enabled_for(p_company_id);

  insert into public.company_meta_lead_ads_access as a (company_id, enabled, updated_by)
  values (p_company_id, p_enabled, auth.uid())
  on conflict on constraint company_meta_lead_ads_access_pkey do update set enabled = excluded.enabled, updated_by = excluded.updated_by
  returning a.* into v_row;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'meta_lead_ads_access_set', 'company', p_company_id::text, 'success', null,
     jsonb_build_object('enabled', v_before), jsonb_build_object('enabled', v_row.enabled), 'rpc');

  return query select v_row.company_id, v_row.enabled, v_row.updated_at;
end;
$$;

-- Manager da empresa ou Super Admin com acesso podem LER o estado.
create or replace function public.meta_lead_ads_company_access(p_company_id uuid)
returns table (enabled boolean)
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
  return query select public.meta_lead_ads_enabled_for(p_company_id);
end;
$$;

-- ═══ 2. ingestão e processor com a autorização ══════════════════════════

drop function public.meta_connection_owner_for_ingestion(text);

create function public.meta_connection_owner_for_ingestion(p_page_id text)
returns table (
  integration_id uuid,
  company_id uuid,
  page_id text,
  status text,
  lead_ads_enabled boolean
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
    select i.id, i.company_id, i.page_id, i.status, public.meta_lead_ads_enabled_for(i.company_id)
      from public.company_meta_integrations i
     where i.page_id = p_page_id
       and i.status in ('connected', 'error')
     order by (i.status = 'connected') desc, i.updated_at desc;
end;
$$;

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
  out_token_data_access_expires_at timestamptz,
  out_lead_ads_enabled boolean
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
           i.token_data_access_expires_at,
           public.meta_lead_ads_enabled_for(i.company_id)
      from public.company_meta_integrations i
     where i.id = p_integration_id;
end;
$$;

-- Empresa desligada depois do registro: evento espera (visível) em vez de criar lead.
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
                    'initial_stage_missing', 'company_access_disabled')
      then 'operational'
    when p_code in ('integration_not_found', 'invalid_field_data', 'missing_name', 'missing_phone',
                    'duplicate_phone_ambiguous', 'max_attempts', 'event_expired')
      then 'terminal'
    else null
  end
$$;

revoke all on function public.meta_leadgen_error_kind(text) from public, anon, authenticated, service_role;

-- O complete também confere a autorização (defesa em profundidade: a
-- empresa pode ter sido desligada entre o lookup e a gravação).
create or replace function public.meta_leadgen_event_complete_v2(
  p_event_id uuid,
  p_lease_token uuid,
  p_name text,
  p_phone text,
  p_answers jsonb,
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

  if not public.meta_lead_ads_enabled_for(v_event.company_id) then
    return query select 'company_access_disabled'::text, null::uuid;
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

-- ═══ 3. seleção de Página após o OAuth ══════════════════════════════════
-- pages: [{ "page_id": text, "page_name": text, "ciphertext": text }] (1..25).
-- O ciphertext é AES-256-GCM com AAD company+page (mesmo envelope da conexão).

create table public.meta_oauth_page_selections (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  pages       jsonb not null,
  token_origin text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint meta_oauth_page_selections_pages_ck check (
    jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) between 1 and 25
  ),
  constraint meta_oauth_page_selections_origin_ck check (token_origin in ('exchanged_long_lived', 'original_token')),
  constraint meta_oauth_page_selections_ttl_ck check (expires_at <= created_at + interval '10 minutes')
);

create index meta_oauth_page_selections_expires_idx on public.meta_oauth_page_selections (expires_at);

alter table public.meta_oauth_page_selections enable row level security;
revoke all on table public.meta_oauth_page_selections from public, anon, authenticated, service_role;

create or replace function public.meta_page_selection_create(
  p_company_id uuid,
  p_profile_id uuid,
  p_pages jsonb,
  p_token_origin text,
  p_ttl_seconds integer default 600
)
returns table (out_selection_id uuid, out_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.meta_oauth_page_selections;
begin
  if p_company_id is null or p_profile_id is null or p_pages is null
    or jsonb_typeof(p_pages) is distinct from 'array'
    or jsonb_array_length(p_pages) not between 1 and 25
    or p_ttl_seconds is null or p_ttl_seconds not between 60 and 600
    or p_token_origin is null or p_token_origin not in ('exchanged_long_lived', 'original_token')
    or exists (
      select 1 from jsonb_array_elements(p_pages) p(e)
       where jsonb_typeof(e) is distinct from 'object'
          or coalesce((e ->> 'page_id') !~ '^[0-9]{1,30}$', true)
          or coalesce(char_length(e ->> 'page_name') not between 1 and 200, true)
          or coalesce(char_length(e ->> 'ciphertext') not between 1 and 4096, true)
    )
    or (select count(distinct e ->> 'page_id') from jsonb_array_elements(p_pages) p(e)) <> jsonb_array_length(p_pages)
  then
    raise using message = 'invalid_input';
  end if;

  -- Um novo OAuth invalida a seleção anterior do mesmo usuário nesta empresa.
  -- Seleções vencidas de qualquer empresa saem junto: não guardam ciphertext.
  delete from public.meta_oauth_page_selections s
   where (s.company_id = p_company_id and s.profile_id = p_profile_id)
      or s.expires_at <= now();

  insert into public.meta_oauth_page_selections (company_id, profile_id, pages, token_origin, expires_at)
  values (p_company_id, p_profile_id, p_pages, p_token_origin, now() + make_interval(secs => p_ttl_seconds))
  returning * into v_row;

  return query select v_row.id, v_row.expires_at;
end;
$$;

-- Lista só id e nome (nunca ciphertext) de uma seleção vigente do mesmo usuário/empresa.
create or replace function public.meta_page_selection_list(p_selection_id uuid, p_company_id uuid, p_profile_id uuid)
returns table (out_page_id text, out_page_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_selection_id is null or p_company_id is null or p_profile_id is null then
    raise using message = 'invalid_input';
  end if;
  return query
    select e ->> 'page_id', e ->> 'page_name'
      from public.meta_oauth_page_selections s, jsonb_array_elements(s.pages) p(e)
     where s.id = p_selection_id
       and s.company_id = p_company_id
       and s.profile_id = p_profile_id
       and s.consumed_at is null
       and s.expires_at > now()
     order by e ->> 'page_name', e ->> 'page_id';
end;
$$;

-- Uso único: devolve o ciphertext SÓ da Página escolhida e consome a seleção.
create or replace function public.meta_page_selection_consume(
  p_selection_id uuid,
  p_company_id uuid,
  p_profile_id uuid,
  p_page_id text
)
returns table (out_outcome text, out_page_name text, out_ciphertext text, out_token_origin text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.meta_oauth_page_selections;
  v_page jsonb;
begin
  if p_selection_id is null or p_company_id is null or p_profile_id is null
    or p_page_id is null or p_page_id !~ '^[0-9]{1,30}$'
  then
    raise using message = 'invalid_input';
  end if;

  select * into v_row
    from public.meta_oauth_page_selections s
   where s.id = p_selection_id
     for update;

  if not found or v_row.company_id <> p_company_id or v_row.profile_id <> p_profile_id then
    return query select 'not_found'::text, null::text, null::text, null::text;
    return;
  end if;
  if v_row.consumed_at is not null then
    return query select 'already_consumed'::text, null::text, null::text, null::text;
    return;
  end if;
  if v_row.expires_at <= now() then
    delete from public.meta_oauth_page_selections s where s.id = p_selection_id;
    return query select 'expired'::text, null::text, null::text, null::text;
    return;
  end if;

  select e into v_page from jsonb_array_elements(v_row.pages) p(e) where e ->> 'page_id' = p_page_id;
  if v_page is null then
    return query select 'page_not_offered'::text, null::text, null::text, null::text;
    return;
  end if;

  -- Consome e apaga os ciphertexts das outras Páginas: nada além da escolhida fica guardado.
  update public.meta_oauth_page_selections s
     set consumed_at = now(),
         pages = jsonb_build_array(jsonb_build_object('page_id', p_page_id, 'page_name', v_page ->> 'page_name', 'ciphertext', 'consumed'))
   where s.id = p_selection_id;

  return query select 'consumed'::text, v_page ->> 'page_name', v_page ->> 'ciphertext', v_row.token_origin;
end;
$$;

-- ═══ 4. posse da Página ════════════════════════════════════════════════
-- Mesma assinatura do MVP-1 (create or replace preserva o grant). O índice
-- único só cobre `connected`; a conexão em erro de outra empresa precisa ser
-- recusada aqui. O lock serializa conexões simultâneas da mesma Página.

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

  perform pg_advisory_xact_lock(hashtextextended('meta_page_owner:' || p_page_id, 0));

  if exists (
    select 1 from public.company_meta_integrations i
     where i.page_id = p_page_id
       and i.company_id <> p_company_id
       and i.status in ('connected', 'error')
  ) then
    raise using message = 'page_already_connected';
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

-- ═══ 5. eventos sem dono ═══════════════════════════════════════════════
-- Só metadados técnicos da entrega: nunca PII. Sem company_id de propósito:
-- reter o evento NÃO decide de quem ele é.

create table public.meta_leadgen_unrouted_events (
  id                uuid primary key default gen_random_uuid(),
  page_id           text not null,
  leadgen_id        text not null,
  form_id           text,
  reason            text not null,
  delivery_count    integer not null default 1,
  first_received_at timestamptz not null,
  last_received_at  timestamptz not null,
  resolved_at       timestamptz,
  resolution        text,
  resolved_event_id uuid references public.meta_leadgen_events(id) on delete set null,
  resolved_by       uuid references public.profiles(id) on delete set null,

  constraint meta_leadgen_unrouted_page_leadgen_uniq unique (page_id, leadgen_id),
  constraint meta_leadgen_unrouted_page_id_ck check (page_id ~ '^[0-9]{1,30}$'),
  constraint meta_leadgen_unrouted_leadgen_id_ck check (leadgen_id ~ '^[0-9]{1,64}$'),
  constraint meta_leadgen_unrouted_form_id_ck check (form_id is null or form_id ~ '^[0-9]{1,64}$'),
  constraint meta_leadgen_unrouted_reason_ck check (reason in ('no_connection', 'company_disabled', 'ambiguous_owner')),
  constraint meta_leadgen_unrouted_resolution_ck check (resolution is null or resolution in ('adopted', 'already_registered')),
  constraint meta_leadgen_unrouted_resolution_pair_ck check ((resolved_at is null) = (resolution is null))
);

create index meta_leadgen_unrouted_pending_idx on public.meta_leadgen_unrouted_events (page_id) where resolved_at is null;
create index meta_leadgen_unrouted_first_received_idx on public.meta_leadgen_unrouted_events (first_received_at);

alter table public.meta_leadgen_unrouted_events enable row level security;
revoke all on table public.meta_leadgen_unrouted_events from public, anon, authenticated, service_role;

-- Chamado pelo webhook (já autenticado por HMAC). Idempotente por (page, leadgen).
-- Evento que já está no ledger não é retido: a reentrega não muda nada.
create or replace function public.meta_leadgen_unrouted_record(
  p_page_id text,
  p_leadgen_id text,
  p_reason text,
  p_received_at timestamptz,
  p_form_id text default null
)
returns table (out_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created boolean;
begin
  if p_page_id is null or p_page_id !~ '^[0-9]{1,30}$'
    or p_leadgen_id is null or p_leadgen_id !~ '^[0-9]{1,64}$'
    or (p_form_id is not null and p_form_id !~ '^[0-9]{1,64}$')
    or p_reason is null or p_reason not in ('no_connection', 'company_disabled', 'ambiguous_owner')
    or p_received_at is null
  then
    raise using message = 'invalid_input';
  end if;

  if exists (select 1 from public.meta_leadgen_events e where e.page_id = p_page_id and e.leadgen_id = p_leadgen_id) then
    return query select 'already_registered'::text;
    return;
  end if;

  insert into public.meta_leadgen_unrouted_events as u
    (page_id, leadgen_id, form_id, reason, first_received_at, last_received_at)
  values
    (p_page_id, p_leadgen_id, p_form_id, p_reason, p_received_at, p_received_at)
  on conflict on constraint meta_leadgen_unrouted_page_leadgen_uniq do update
    set delivery_count = u.delivery_count + 1,
        last_received_at = excluded.last_received_at,
        reason = excluded.reason
    where u.resolved_at is null
  returning (xmax = 0) into v_created;

  return query select case when v_created then 'recorded' else 'repeated' end;
end;
$$;

-- Só Super Admin: mostra Páginas de qualquer empresa e de nenhuma. `can_adopt`
-- diz se a empresa aberta pode receber esses eventos agora.
create or replace function public.meta_leadgen_unrouted_list(p_company_id uuid)
returns table (
  page_id text,
  reason text,
  pending integer,
  first_received_at timestamptz,
  last_received_at timestamptz,
  can_adopt boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_company_id is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  return query
    select u.page_id, u.reason, count(*)::integer, min(u.first_received_at), max(u.last_received_at),
           public.meta_lead_ads_enabled_for(p_company_id)
           and exists (select 1 from public.company_meta_integrations i
                        where i.company_id = p_company_id and i.page_id = u.page_id and i.status = 'connected')
           and not exists (select 1 from public.company_meta_integrations i
                            where i.company_id <> p_company_id and i.page_id = u.page_id and i.status in ('connected', 'error'))
      from public.meta_leadgen_unrouted_events u
     where u.resolved_at is null
     group by u.page_id, u.reason
     order by 6 desc, max(u.last_received_at) desc
     limit 50;
end;
$$;

-- Decisão humana e auditada. Exige a Página conectada nesta empresa, a empresa
-- habilitada e nenhuma outra dona. Os eventos entram no fluxo normal com a
-- janela de 7 dias reiniciada (como no reprocessamento manual); o que passou
-- dos 90 dias de retenção da Meta fica de fora.
create or replace function public.meta_leadgen_unrouted_adopt(p_company_id uuid, p_page_id text)
returns table (out_outcome text, out_adopted integer, out_already_registered integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration_id uuid;
  v_adopted integer;
  v_already integer;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_company_id is null or p_page_id is null or p_page_id !~ '^[0-9]{1,30}$' then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('meta_page_owner:' || p_page_id, 0));

  select i.id into v_integration_id
    from public.company_meta_integrations i
   where i.company_id = p_company_id and i.page_id = p_page_id and i.status = 'connected';
  if not found then
    return query select 'not_connected'::text, 0, 0;
    return;
  end if;
  if not public.meta_lead_ads_enabled_for(p_company_id) then
    return query select 'company_disabled'::text, 0, 0;
    return;
  end if;
  if exists (
    select 1 from public.company_meta_integrations i
     where i.page_id = p_page_id and i.company_id <> p_company_id and i.status in ('connected', 'error')
  ) then
    return query select 'owner_conflict'::text, 0, 0;
    return;
  end if;

  with pending as (
    select u.id, u.leadgen_id, u.form_id, u.first_received_at
      from public.meta_leadgen_unrouted_events u
     where u.page_id = p_page_id
       and u.resolved_at is null
       and u.first_received_at > now() - interval '90 days'
       for update
  ), inserted as (
    insert into public.meta_leadgen_events
      (integration_id, company_id, page_id, leadgen_id, form_id, status, received_at, last_requeued_at, last_requeued_by)
    select v_integration_id, p_company_id, p_page_id, p.leadgen_id, p.form_id, 'received', p.first_received_at, now(), auth.uid()
      from pending p
    on conflict on constraint meta_leadgen_events_page_leadgen_uniq do nothing
    returning id, leadgen_id
  ), resolved as (
    update public.meta_leadgen_unrouted_events u
       set resolved_at = now(),
           resolution = case when i.id is null then 'already_registered' else 'adopted' end,
           resolved_event_id = i.id,
           resolved_by = auth.uid()
      from pending p
      left join inserted i on i.leadgen_id = p.leadgen_id
     where u.id = p.id
    returning u.resolution
  )
  select count(*) filter (where r.resolution = 'adopted')::integer,
         count(*) filter (where r.resolution = 'already_registered')::integer
    into v_adopted, v_already
    from resolved r;

  if v_adopted + v_already = 0 then
    return query select 'nothing_pending'::text, 0, 0;
    return;
  end if;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'meta_leadgen_unrouted_adopted', 'company_meta_integration', v_integration_id::text,
     'success', null, null,
     jsonb_build_object('page_id', p_page_id, 'adopted', v_adopted, 'already_registered', v_already), 'rpc');

  return query select 'adopted'::text, v_adopted, v_already;
end;
$$;

-- Expurgo chamado pelo sweep. A seleção vencida carrega ciphertext de token de
-- Página, que pode não expirar; o evento retido perde a utilidade depois dos 90
-- dias em que a Meta mantém o lead.
create or replace function public.meta_leadads_purge_expired()
returns table (out_selections integer, out_unrouted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_selections integer;
  v_unrouted integer;
begin
  delete from public.meta_oauth_page_selections s
   where s.expires_at <= now() or s.consumed_at is not null;
  get diagnostics v_selections = row_count;

  delete from public.meta_leadgen_unrouted_events u
   where u.first_received_at < now() - interval '90 days';
  get diagnostics v_unrouted = row_count;

  return query select v_selections, v_unrouted;
end;
$$;

-- ═══ privilégios ═══════════════════════════════════════════════════════

revoke all on function public.meta_leadgen_unrouted_record(text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.meta_leadads_purge_expired() from public, anon, authenticated;
revoke all on function public.meta_leadgen_unrouted_list(uuid) from public, anon, service_role;
revoke all on function public.meta_leadgen_unrouted_adopt(uuid, text) from public, anon, service_role;
grant execute on function public.meta_leadgen_unrouted_record(text, text, text, timestamptz, text) to service_role;
grant execute on function public.meta_leadads_purge_expired() to service_role;
grant execute on function public.meta_leadgen_unrouted_list(uuid) to authenticated;
grant execute on function public.meta_leadgen_unrouted_adopt(uuid, text) to authenticated;

revoke all on function public.meta_lead_ads_enabled_for(uuid) from public, anon, authenticated;
grant execute on function public.meta_lead_ads_enabled_for(uuid) to service_role;
revoke all on function public.meta_connection_owner_for_ingestion(text) from public, anon, authenticated;
revoke all on function public.meta_connection_lookup_for_processing(uuid) from public, anon, authenticated;
revoke all on function public.meta_page_selection_create(uuid, uuid, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.meta_page_selection_list(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.meta_page_selection_consume(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.meta_lead_ads_set_company_access(uuid, boolean) from public, anon, service_role;
revoke all on function public.meta_lead_ads_company_access(uuid) from public, anon, service_role;

grant execute on function public.meta_connection_owner_for_ingestion(text) to service_role;
grant execute on function public.meta_connection_lookup_for_processing(uuid) to service_role;
grant execute on function public.meta_page_selection_create(uuid, uuid, jsonb, text, integer) to service_role;
grant execute on function public.meta_page_selection_list(uuid, uuid, uuid) to service_role;
grant execute on function public.meta_page_selection_consume(uuid, uuid, uuid, text) to service_role;
grant execute on function public.meta_lead_ads_set_company_access(uuid, boolean) to authenticated;
grant execute on function public.meta_lead_ads_company_access(uuid) to authenticated;
