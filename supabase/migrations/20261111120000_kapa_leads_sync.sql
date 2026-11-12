-- KAPA LEADS → KAPA CRM — sincronização dos leads dos simuladores (LOCAL; não aplicada em nenhum ambiente).
--
-- Arquitetura (pull): o CRM busca no KAPA Leads, por uma rota assinada e SOMENTE LEITURA, os leads
-- criados depois de um cursor (created_at, id). O KAPA Leads e as Landing Pages não mudam o caminho
-- de gravação: se o CRM estiver fora do ar, nada acontece lá; quando volta, continua do cursor.
--
-- 1. Vínculo loja do KAPA Leads → empresa do CRM, DESLIGADO por padrão, ligado só pelo Super Admin.
--    Ligar pela primeira vez grava o cursor = agora: não existe sincronização retroativa.
-- 2. Fila durável (ledger) idempotente por lead de origem (source_lead_id único): reenvio, página
--    repetida ou falha de rede nunca duplicam.
-- 3. Processamento só no banco (sem chamada externa): cria o lead em "Sem vendedor" ou associa ao
--    lead ativo com o mesmo telefone na mesma empresa — com o MESMO bloqueio por telefone do Meta Lead
--    Ads, então as duas origens nunca criam dois leads para o mesmo contato ao mesmo tempo.
-- 4. Origem preservada em lead_form_submissions (source = 'kapa_leads') e na linha do tempo.
-- 5. Falhas ficam visíveis (fila de revisão), com nova tentativa controlada; nada é descartado em silêncio.
--
-- Nenhum vínculo é criado aqui. Nenhuma linha é criada.
--
-- Disponibilidade: o ALTER em lead_form_submissions (gravada pelo Meta Lead Ads) pede trava
-- exclusiva. Com lock_timeout, se houver transação longa na tabela a migration desiste em 5 s e
-- volta inteira (nada aplicado), em vez de ficar na fila travando as gravações atrás dela.
set lock_timeout = '5s';

-- ═══ 1. vínculo loja → empresa ══════════════════════════════════════════

create table public.kapa_leads_store_links (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  kapa_store_id         uuid not null,
  store_label           text not null,
  -- Chave do formData que traz o veículo de interesse (null = "Não informado").
  vehicle_form_key      text,
  enabled               boolean not null default false,
  -- Cursor do pull: último (created_at, id) já gravado na fila.
  cursor_created_at     timestamptz,
  cursor_lead_id        uuid,
  activated_at          timestamptz,
  last_polled_at        timestamptz,
  last_success_at       timestamptz,
  last_error_code       text,
  consecutive_failures  integer not null default 0,
  -- Conferência por contagem (KAPA Leads × fila do CRM) na janela (reconciled_from, reconciled_to].
  reconciled_at            timestamptz,
  reconciled_from          timestamptz,
  reconciled_to            timestamptz,
  reconciled_source_count  integer,
  reconciled_crm_count     integer,
  updated_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Uma loja do KAPA Leads alimenta uma única empresa.
  constraint kapa_leads_store_links_store_uniq unique (kapa_store_id),
  constraint kapa_leads_store_links_id_company_uniq unique (id, company_id),
  constraint kapa_leads_store_links_label_ck check (char_length(btrim(store_label)) between 1 and 150),
  constraint kapa_leads_store_links_vehicle_key_ck check (
    vehicle_form_key is null or vehicle_form_key ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
  ),
  constraint kapa_leads_store_links_cursor_ck check ((cursor_created_at is null) = (cursor_lead_id is null)),
  -- Ligado exige cursor: nunca "desde o início".
  constraint kapa_leads_store_links_enabled_cursor_ck check (not enabled or cursor_created_at is not null),
  constraint kapa_leads_store_links_error_ck check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  constraint kapa_leads_store_links_failures_ck check (consecutive_failures >= 0),
  constraint kapa_leads_store_links_reconciled_ck check (
    (reconciled_at is null) = (reconciled_source_count is null)
    and (reconciled_at is null) = (reconciled_crm_count is null)
    and coalesce(reconciled_source_count, 0) >= 0 and coalesce(reconciled_crm_count, 0) >= 0
  )
);

create index kapa_leads_store_links_company_idx on public.kapa_leads_store_links (company_id);

create trigger kapa_leads_store_links_set_updated_at
  before update on public.kapa_leads_store_links
  for each row execute function set_updated_at();

alter table public.kapa_leads_store_links enable row level security;
revoke all on table public.kapa_leads_store_links from public, anon, authenticated, service_role;

-- ═══ 2. fila durável ════════════════════════════════════════════════════
-- payload (validado na entrada; PII mínima: nome, telefone, e-mail opcional):
--   { "contact": {"name","phone","email"}, "vehicle": text|null,
--     "answers": [{key, values[]}], "source_label": text }
-- Depois de processado ou descartado, o payload é apagado: os dados ficam no lead e em
-- lead_form_submissions, com a mesma visibilidade do lead.

create table public.kapa_leads_inbound_events (
  id                    uuid primary key default gen_random_uuid(),
  link_id               uuid not null,
  company_id            uuid not null references public.companies(id) on delete cascade,
  source_lead_id        uuid not null,
  source_campaign_id    uuid not null,
  source_campaign_slug  text not null,
  source_campaign_name  text not null,
  source_created_at     timestamptz not null,
  payload               jsonb not null default '{}'::jsonb,
  status                text not null default 'pending',
  attempts              integer not null default 0,
  next_attempt_at       timestamptz not null default now(),
  last_error_code       text,
  outcome               text,
  crm_lead_id           uuid,
  requeue_count         integer not null default 0,
  received_at           timestamptz not null default now(),
  processed_at          timestamptz,
  resolved_at           timestamptz,
  resolved_by           uuid references public.profiles(id) on delete set null,
  resolution            text,
  updated_at            timestamptz not null default now(),

  -- Idempotência: um lead do KAPA Leads entra uma única vez.
  constraint kapa_leads_inbound_events_source_uniq unique (source_lead_id),
  constraint kapa_leads_inbound_events_link_fk
    foreign key (link_id, company_id) references public.kapa_leads_store_links (id, company_id) on delete cascade,
  constraint kapa_leads_inbound_events_status_ck check (status in ('pending', 'processed', 'failed', 'dismissed')),
  constraint kapa_leads_inbound_events_outcome_ck check (
    (status = 'processed') = (outcome is not null)
    and (outcome is null or outcome in ('created', 'linked_existing'))
  ),
  constraint kapa_leads_inbound_events_lead_ck check ((status = 'processed') = (crm_lead_id is not null)),
  constraint kapa_leads_inbound_events_payload_ck check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  constraint kapa_leads_inbound_events_slug_ck check (source_campaign_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(source_campaign_slug) <= 64),
  constraint kapa_leads_inbound_events_name_ck check (char_length(btrim(source_campaign_name)) between 1 and 150),
  constraint kapa_leads_inbound_events_error_ck check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  constraint kapa_leads_inbound_events_attempts_ck check (attempts >= 0 and requeue_count >= 0),
  constraint kapa_leads_inbound_events_resolution_ck check (
    resolution is null or resolution in ('handled_manually', 'duplicate', 'test_event', 'not_recoverable')
  )
);

create index kapa_leads_inbound_events_pending_idx
  on public.kapa_leads_inbound_events (next_attempt_at, source_created_at)
  where status = 'pending';
create index kapa_leads_inbound_events_company_status_idx
  on public.kapa_leads_inbound_events (company_id, status, received_at desc);

create trigger kapa_leads_inbound_events_set_updated_at
  before update on public.kapa_leads_inbound_events
  for each row execute function set_updated_at();

alter table public.kapa_leads_inbound_events enable row level security;
revoke all on table public.kapa_leads_inbound_events from public, anon, authenticated, service_role;

-- ═══ 3. origem nas respostas de formulário ═══════════════════════════════

alter table public.lead_form_submissions
  add column kapa_leads_event_id uuid references public.kapa_leads_inbound_events(id) on delete set null,
  add column source_detail text;

alter table public.lead_form_submissions
  add constraint lead_form_submissions_kapa_event_uniq unique (kapa_leads_event_id),
  add constraint lead_form_submissions_source_detail_ck check (
    source_detail is null or char_length(btrim(source_detail)) between 1 and 200
  );

alter table public.lead_form_submissions drop constraint lead_form_submissions_source_ck;
alter table public.lead_form_submissions
  add constraint lead_form_submissions_source_ck check (source in ('meta_lead_ads', 'kapa_leads'));

-- Cada linha aponta para no máximo uma origem técnica.
alter table public.lead_form_submissions
  add constraint lead_form_submissions_one_origin_ck check (meta_event_id is null or kapa_leads_event_id is null);

-- ═══ 4. validação do payload ════════════════════════════════════════════

create or replace function public.kapa_leads_payload_valid(p_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_payload) = 'object'
    and jsonb_typeof(p_payload -> 'contact') = 'object'
    and jsonb_typeof(p_payload #> '{contact,name}') = 'string'
    and char_length(btrim(p_payload #>> '{contact,name}')) between 1 and 200
    and jsonb_typeof(p_payload #> '{contact,phone}') = 'string'
    and (p_payload #>> '{contact,phone}') ~ '^[1-9][0-9]{9,10}$'
    and (
      coalesce(jsonb_typeof(p_payload #> '{contact,email}'), 'null') = 'null'
      or (
        jsonb_typeof(p_payload #> '{contact,email}') = 'string'
        and char_length(p_payload #>> '{contact,email}') between 3 and 254
        and (p_payload #>> '{contact,email}') ~ '^[^@\s]+@[^@\s]+$'
      )
    )
    and (
      coalesce(jsonb_typeof(p_payload -> 'vehicle'), 'null') = 'null'
      or (jsonb_typeof(p_payload -> 'vehicle') = 'string' and char_length(btrim(p_payload ->> 'vehicle')) between 1 and 200)
    )
    and jsonb_typeof(p_payload -> 'source_label') = 'string'
    and char_length(btrim(p_payload ->> 'source_label')) between 1 and 200
    and public.lead_form_answers_valid(coalesce(p_payload -> 'answers', 'null'::jsonb)),
    false)
$$;

revoke all on function public.kapa_leads_payload_valid(jsonb) from public, anon, authenticated;

-- ═══ 5. worker (service_role) ════════════════════════════════════════════

-- Vínculos a consultar: ligados, de empresa ativa.
create or replace function public.kapa_leads_links_for_poll()
returns table (
  link_id uuid,
  company_id uuid,
  kapa_store_id uuid,
  vehicle_form_key text,
  cursor_created_at timestamptz,
  cursor_lead_id uuid,
  activated_at timestamptz,
  reconciled_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.company_id, l.kapa_store_id, l.vehicle_form_key, l.cursor_created_at, l.cursor_lead_id,
         l.activated_at, l.reconciled_at
    from public.kapa_leads_store_links l
    join public.companies c on c.id = l.company_id
   where l.enabled
     and c.status = 'ativa'
   order by l.last_polled_at nulls first, l.id
$$;

-- Grava uma página na fila e avança o cursor, atomicamente e com compare-and-set:
-- duas execuções simultâneas nunca avançam o cursor por cima uma da outra.
-- p_items: [{ source_lead_id, source_campaign_id, source_campaign_slug, source_campaign_name,
--             source_created_at, store_id, payload }]
-- Item com payload inválido entra como 'failed' (invalid_payload): visível, nunca descartado.
create or replace function public.kapa_leads_ingest_page(
  p_link_id uuid,
  p_expected_cursor_created_at timestamptz,
  p_expected_cursor_lead_id uuid,
  p_items jsonb,
  p_next_cursor_created_at timestamptz,
  p_next_cursor_lead_id uuid
)
returns table (out_outcome text, out_inserted integer, out_duplicates integer, out_invalid integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.kapa_leads_store_links;
  v_item jsonb;
  v_valid boolean;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_invalid integer := 0;
  v_rows integer;
begin
  if p_link_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100
    or (p_next_cursor_created_at is null) <> (p_next_cursor_lead_id is null)
    or (jsonb_array_length(p_items) > 0 and p_next_cursor_created_at is null)
  then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  select * into v_link from public.kapa_leads_store_links l where l.id = p_link_id for update;
  if not found then
    return query select 'link_not_found'::text, 0, 0, 0;
    return;
  end if;
  if not v_link.enabled
    or not exists (select 1 from public.companies c where c.id = v_link.company_id and c.status = 'ativa')
  then
    return query select 'link_disabled'::text, 0, 0, 0;
    return;
  end if;
  if v_link.cursor_created_at is distinct from p_expected_cursor_created_at
    or v_link.cursor_lead_id is distinct from p_expected_cursor_lead_id
  then
    return query select 'cursor_conflict'::text, 0, 0, 0;
    return;
  end if;
  -- O cursor só anda para frente.
  if p_next_cursor_created_at is not null
    and (p_next_cursor_created_at, p_next_cursor_lead_id) <= (v_link.cursor_created_at, v_link.cursor_lead_id)
  then
    raise invalid_parameter_value using message = 'cursor_not_forward';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or (v_item ->> 'store_id')::uuid is distinct from v_link.kapa_store_id
    then
      -- Loja diferente do vínculo: a página inteira é recusada (nunca gravar em outra empresa).
      raise invalid_parameter_value using message = 'store_mismatch';
    end if;
    -- Itens anteriores ao cursor de ativação nunca entram (defesa contra retroativo).
    if ((v_item ->> 'source_created_at')::timestamptz, (v_item ->> 'source_lead_id')::uuid)
       <= (v_link.cursor_created_at, v_link.cursor_lead_id)
    then
      raise invalid_parameter_value using message = 'item_before_cursor';
    end if;

    v_valid := public.kapa_leads_payload_valid(v_item -> 'payload');

    insert into public.kapa_leads_inbound_events (
      link_id, company_id, source_lead_id, source_campaign_id, source_campaign_slug, source_campaign_name,
      source_created_at, payload, status, last_error_code
    ) values (
      v_link.id, v_link.company_id,
      (v_item ->> 'source_lead_id')::uuid,
      (v_item ->> 'source_campaign_id')::uuid,
      v_item ->> 'source_campaign_slug',
      v_item ->> 'source_campaign_name',
      (v_item ->> 'source_created_at')::timestamptz,
      case when v_valid then v_item -> 'payload' else '{}'::jsonb end,
      case when v_valid then 'pending' else 'failed' end,
      case when v_valid then null else 'invalid_payload' end
    )
    on conflict on constraint kapa_leads_inbound_events_source_uniq do nothing;

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      v_duplicates := v_duplicates + 1;
    elsif v_valid then
      v_inserted := v_inserted + 1;
    else
      v_invalid := v_invalid + 1;
    end if;
  end loop;

  update public.kapa_leads_store_links l
     set cursor_created_at = coalesce(p_next_cursor_created_at, l.cursor_created_at),
         cursor_lead_id = coalesce(p_next_cursor_lead_id, l.cursor_lead_id),
         last_polled_at = now(),
         last_success_at = now(),
         last_error_code = null,
         consecutive_failures = 0
   where l.id = p_link_id;

  return query select 'ok'::text, v_inserted, v_duplicates, v_invalid;
end;
$$;

-- Falha de consulta ao KAPA Leads (rede, 5xx, assinatura): só metadados no vínculo.
create or replace function public.kapa_leads_link_record_failure(p_link_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_link_id is null or p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;
  update public.kapa_leads_store_links l
     set last_polled_at = now(),
         last_error_code = p_error_code,
         consecutive_failures = l.consecutive_failures + 1
   where l.id = p_link_id;
end;
$$;

-- Conferência: o worker informa quantos leads o KAPA Leads tem na janela (from, to]; o banco conta
-- quantos chegaram à fila do CRM na mesma janela (inclui falhas e descartados: foram recebidos).
-- source > crm = faltando no CRM (alerta). crm > source = apagado depois no KAPA Leads.
create or replace function public.kapa_leads_record_reconciliation(
  p_link_id uuid, p_from timestamptz, p_to timestamptz, p_source_count integer
)
returns table (out_source_count integer, out_crm_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crm integer;
begin
  if p_link_id is null or p_from is null or p_to is null or p_to < p_from
    or p_source_count is null or p_source_count < 0
  then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;
  select count(*)::integer into v_crm
    from public.kapa_leads_inbound_events e
   where e.link_id = p_link_id and e.source_created_at > p_from and e.source_created_at <= p_to;
  update public.kapa_leads_store_links l
     set reconciled_at = now(), reconciled_from = p_from, reconciled_to = p_to,
         reconciled_source_count = p_source_count, reconciled_crm_count = v_crm
   where l.id = p_link_id;
  if not found then
    raise no_data_found using message = 'link_not_found';
  end if;
  return query select p_source_count, v_crm;
end;
$$;

-- Processa UM evento já travado pelo chamador. Devolve o resultado; exceções sobem para o
-- chamador, que registra a falha.
create or replace function public._kapa_leads_process_event(p_event public.kapa_leads_inbound_events)
returns table (out_outcome text, out_crm_lead_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.kapa_leads_store_links;
  v_payload jsonb := p_event.payload;
  v_name text;
  v_phone text;
  v_vehicle text;
  v_count integer;
  v_stage_id uuid;
  v_lead_id uuid;
  v_lead public.leads;
  v_outcome text;
begin
  if not public.kapa_leads_payload_valid(v_payload) then
    return query select 'invalid_payload'::text, null::uuid;
    return;
  end if;

  select * into v_link from public.kapa_leads_store_links l
   where l.id = p_event.link_id and l.company_id = p_event.company_id;
  if not found or not v_link.enabled
    or not exists (select 1 from public.companies c where c.id = p_event.company_id and c.status = 'ativa')
  then
    return query select 'link_disabled'::text, null::uuid;
    return;
  end if;

  v_name := btrim(v_payload #>> '{contact,name}');
  v_phone := v_payload #>> '{contact,phone}';
  v_vehicle := nullif(btrim(v_payload ->> 'vehicle'), '');

  -- MESMA chave de bloqueio do Meta Lead Ads (meta_leadgen_event_complete_v2): as duas origens
  -- ficam em fila para o mesmo telefone da mesma empresa.
  perform pg_advisory_xact_lock(
    hashtextextended('meta_lead_phone:' || p_event.company_id::text || ':' || v_phone, 0)
  );

  select count(*) into v_count
    from public.leads l
   where l.company_id = p_event.company_id
     and l.phone_digits in (v_phone, '55' || v_phone)
     and l.archived_at is null;

  if v_count > 1 then
    return query select 'duplicate_phone_ambiguous'::text, null::uuid;
    return;
  end if;

  if v_count = 1 then
    select l.id into v_lead_id
      from public.leads l
     where l.company_id = p_event.company_id
       and l.phone_digits in (v_phone, '55' || v_phone)
       and l.archived_at is null;
    v_outcome := 'linked_existing';

    perform public.record_lead_timeline_event(
      p_event.company_id, v_lead_id, 'system', null,
      'message', '#7FB2E5', 'Nova simulação recebida: ' || left(p_event.source_campaign_name, 120), null);
  else
    select ps.id into v_stage_id
      from public.pipeline_stages ps
     where ps.company_id = p_event.company_id
       and ps.code = 'new';
    if not found then
      return query select 'initial_stage_missing'::text, null::uuid;
      return;
    end if;

    select * into v_lead
      from public.insert_lead_row(
        p_event.company_id, 'system', null, v_stage_id,
        v_name, v_phone, coalesce(v_vehicle, 'Não informado'), null, null, null,
        left(btrim(v_payload ->> 'source_label'), 200)
      );
    v_lead_id := v_lead.id;
    v_outcome := 'created';
  end if;

  insert into public.lead_form_submissions (
    company_id, lead_id, kapa_leads_event_id, source, source_detail, outcome, form_id, ad_id, submitted_at,
    contact_name, contact_phone, contact_email, vehicle_interest, answers
  ) values (
    p_event.company_id, v_lead_id, p_event.id, 'kapa_leads', left(btrim(v_payload ->> 'source_label'), 200),
    v_outcome, null, null, p_event.source_created_at,
    v_name, v_phone, nullif(btrim(v_payload #>> '{contact,email}'), ''), v_vehicle,
    coalesce(v_payload -> 'answers', '[]'::jsonb)
  );

  return query select v_outcome, v_lead_id;
end;
$$;

-- Processa a fila. Um executor por vez (trava consultiva); cada evento numa subtransação:
-- um evento com erro nunca desfaz os outros.
--   transitórios (initial_stage_missing, erro inesperado) → nova tentativa com espera crescente,
--     até 12 tentativas → failed (max_attempts);
--   link_disabled → continua pendente, sem contar tentativa (volta quando religar);
--   duplicate_phone_ambiguous / invalid_payload → failed (revisão manual).
create or replace function public.kapa_leads_process_pending(p_limit integer default 25)
returns table (out_status text, out_created integer, out_linked integer, out_retry integer, out_failed integer, out_held integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.kapa_leads_inbound_events;
  v_result record;
  v_created integer := 0;
  v_linked integer := 0;
  v_retry integer := 0;
  v_failed integer := 0;
  v_held integer := 0;
  v_code text;
  v_attempts integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('kapa_leads_process_pending', 0)) then
    return query select 'busy'::text, 0, 0, 0, 0, 0;
    return;
  end if;

  for v_event in
    select * from public.kapa_leads_inbound_events e
     where e.status = 'pending' and e.next_attempt_at <= now()
     order by e.next_attempt_at, e.source_created_at, e.id
     limit p_limit
     for update skip locked
  loop
    begin
      select * into v_result from public._kapa_leads_process_event(v_event);
      v_code := v_result.out_outcome;

      if v_code in ('created', 'linked_existing') then
        update public.kapa_leads_inbound_events e
           set status = 'processed', outcome = v_code, crm_lead_id = v_result.out_crm_lead_id,
               processed_at = now(), last_error_code = null, attempts = e.attempts + 1,
               payload = '{}'::jsonb
         where e.id = v_event.id;
        if v_code = 'created' then v_created := v_created + 1; else v_linked := v_linked + 1; end if;
      elsif v_code = 'link_disabled' then
        update public.kapa_leads_inbound_events e
           set last_error_code = v_code, next_attempt_at = now() + interval '15 minutes'
         where e.id = v_event.id;
        v_held := v_held + 1;
      elsif v_code in ('duplicate_phone_ambiguous', 'invalid_payload') then
        update public.kapa_leads_inbound_events e
           set status = 'failed', last_error_code = v_code, attempts = e.attempts + 1
         where e.id = v_event.id;
        v_failed := v_failed + 1;
      else
        v_attempts := v_event.attempts + 1;
        update public.kapa_leads_inbound_events e
           set status = case when v_attempts >= 12 then 'failed' else 'pending' end,
               last_error_code = case when v_attempts >= 12 then 'max_attempts' else left(v_code, 64) end,
               attempts = v_attempts,
               next_attempt_at = now() + least(interval '1 minute' * power(2, v_attempts), interval '6 hours')
         where e.id = v_event.id;
        if v_attempts >= 12 then v_failed := v_failed + 1; else v_retry := v_retry + 1; end if;
      end if;
    exception when others then
      -- A subtransação desfez o que o evento gravou; registra só o código (nunca a mensagem).
      v_attempts := v_event.attempts + 1;
      update public.kapa_leads_inbound_events e
         set status = case when v_attempts >= 12 then 'failed' else 'pending' end,
             last_error_code = case when v_attempts >= 12 then 'max_attempts' else 'unexpected_' || lower(sqlstate) end,
             attempts = v_attempts,
             next_attempt_at = now() + least(interval '1 minute' * power(2, v_attempts), interval '6 hours')
       where e.id = v_event.id;
      if v_attempts >= 12 then v_failed := v_failed + 1; else v_retry := v_retry + 1; end if;
    end;
  end loop;

  return query select 'ok'::text, v_created, v_linked, v_retry, v_failed, v_held;
end;
$$;

-- Retenção: falhas sem resolução há mais de 90 dias perdem o payload (PII) e viram descartadas.
create or replace function public.kapa_leads_purge_expired()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.kapa_leads_inbound_events e
     set status = 'dismissed', resolution = 'not_recoverable', resolved_at = now(), payload = '{}'::jsonb
   where e.status = 'failed' and e.received_at < now() - interval '90 days';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ═══ 6. Super Admin: vínculo e ativação ═════════════════════════════════

create or replace function public.kapa_leads_link_upsert(
  p_company_id uuid,
  p_kapa_store_id uuid,
  p_store_label text,
  p_vehicle_form_key text default null
)
returns table (link_id uuid, enabled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.kapa_leads_store_links;
  v_row public.kapa_leads_store_links;
  v_key text := nullif(btrim(p_vehicle_form_key), '');
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_company_id is null or p_kapa_store_id is null or p_store_label is null
    or char_length(btrim(p_store_label)) not between 1 and 150
    or (v_key is not null and v_key !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$')
  then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;
  perform 1 from public.companies c where c.id = p_company_id;
  if not found then
    raise no_data_found using message = 'company_not_found';
  end if;

  select * into v_existing from public.kapa_leads_store_links l where l.kapa_store_id = p_kapa_store_id for update;
  if found and v_existing.company_id <> p_company_id then
    -- A loja já alimenta outra empresa: nunca trocar em silêncio.
    raise unique_violation using message = 'store_linked_to_other_company';
  end if;

  if found then
    update public.kapa_leads_store_links l
       set store_label = btrim(p_store_label), vehicle_form_key = v_key, updated_by = auth.uid()
     where l.id = v_existing.id
    returning * into v_row;
  else
    insert into public.kapa_leads_store_links (company_id, kapa_store_id, store_label, vehicle_form_key, updated_by)
    values (p_company_id, p_kapa_store_id, btrim(p_store_label), v_key, auth.uid())
    returning * into v_row;
  end if;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'kapa_leads_link_upserted', 'kapa_leads_store_link', v_row.id::text, 'success', null,
     case when v_existing.id is null then null
          else jsonb_build_object('store_label', v_existing.store_label, 'vehicle_form_key', v_existing.vehicle_form_key) end,
     jsonb_build_object('kapa_store_id', v_row.kapa_store_id, 'store_label', v_row.store_label,
                        'vehicle_form_key', v_row.vehicle_form_key, 'enabled', v_row.enabled),
     'rpc');

  return query select v_row.id, v_row.enabled;
end;
$$;

-- Ligar a primeira vez grava o cursor = agora (sem retroativo). Religar continua do cursor:
-- leads criados enquanto estava desligado são buscados (não se perdem).
create or replace function public.kapa_leads_link_set_enabled(p_company_id uuid, p_link_id uuid, p_enabled boolean)
returns table (link_id uuid, enabled boolean, cursor_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.kapa_leads_store_links;
  v_row public.kapa_leads_store_links;
  v_status text;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if p_company_id is null or p_link_id is null or p_enabled is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  select * into v_before from public.kapa_leads_store_links l
   where l.id = p_link_id and l.company_id = p_company_id for update;
  if not found then
    raise no_data_found using message = 'link_not_found';
  end if;
  select c.status::text into v_status from public.companies c where c.id = p_company_id;
  if p_enabled and v_status <> 'ativa' then
    raise check_violation using message = 'company_not_active';
  end if;

  update public.kapa_leads_store_links l
     set enabled = p_enabled,
         cursor_created_at = case when p_enabled and l.cursor_created_at is null then now() else l.cursor_created_at end,
         -- UUID mínimo: o primeiro lead criado no mesmo microssegundo ainda fica depois do cursor.
         cursor_lead_id = case when p_enabled and l.cursor_lead_id is null
                               then '00000000-0000-0000-0000-000000000000'::uuid else l.cursor_lead_id end,
         activated_at = case when p_enabled and l.activated_at is null then now() else l.activated_at end,
         updated_by = auth.uid()
   where l.id = p_link_id
  returning * into v_row;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'kapa_leads_link_enabled_set', 'kapa_leads_store_link', p_link_id::text, 'success', null,
     jsonb_build_object('enabled', v_before.enabled, 'cursor_created_at', v_before.cursor_created_at),
     jsonb_build_object('enabled', v_row.enabled, 'cursor_created_at', v_row.cursor_created_at),
     'rpc');

  return query select v_row.id, v_row.enabled, v_row.cursor_created_at;
end;
$$;

-- Recuperação operacional (só operador do banco / service_role, nunca pela aplicação): volta o cursor
-- para buscar de novo leads a partir de p_from (nunca antes da ativação: continua sem retroativo).
-- Seguro: a fila é idempotente por source_lead_id, então leads já recebidos — inclusive os apagados por
-- LGPD, cujo registro técnico fica sem dados pessoais — não entram de novo.
create or replace function public.kapa_leads_link_rewind(p_link_id uuid, p_from timestamptz)
returns table (out_cursor_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.kapa_leads_store_links;
begin
  if p_link_id is null or p_from is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;
  select * into v_link from public.kapa_leads_store_links l where l.id = p_link_id for update;
  if not found then
    raise no_data_found using message = 'link_not_found';
  end if;
  if v_link.activated_at is null or p_from < v_link.activated_at then
    raise check_violation using message = 'before_activation';
  end if;
  if (p_from, '00000000-0000-0000-0000-000000000000'::uuid) >= (v_link.cursor_created_at, v_link.cursor_lead_id) then
    raise check_violation using message = 'not_backwards';
  end if;

  update public.kapa_leads_store_links l
     set cursor_created_at = p_from, cursor_lead_id = '00000000-0000-0000-0000-000000000000'::uuid
   where l.id = p_link_id;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (null, v_link.company_id, 'kapa_leads_link_rewound', 'kapa_leads_store_link', p_link_id::text, 'success', null,
     jsonb_build_object('cursor_created_at', v_link.cursor_created_at),
     jsonb_build_object('cursor_created_at', p_from), 'sql_operator');

  return query select p_from;
end;
$$;

-- ═══ 7. Manager / Super Admin: saúde, revisão e nova tentativa ═══════════
-- Só metadados técnicos: nunca nome, telefone ou e-mail.

create or replace function public.kapa_leads_sync_health(p_company_id uuid)
returns table (
  link_id uuid,
  kapa_store_id uuid,
  store_label text,
  vehicle_form_key text,
  enabled boolean,
  activated_at timestamptz,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  consecutive_failures integer,
  pending_count bigint,
  failed_count bigint,
  processed_7d bigint,
  oldest_pending_at timestamptz,
  last_processed_at timestamptz,
  reconciled_at timestamptz,
  reconciled_source_count integer,
  reconciled_crm_count integer
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
    select l.id, l.kapa_store_id, l.store_label, l.vehicle_form_key, l.enabled, l.activated_at,
           l.last_polled_at, l.last_success_at, l.last_error_code, l.consecutive_failures,
           (select count(*) from public.kapa_leads_inbound_events e where e.link_id = l.id and e.status = 'pending'),
           (select count(*) from public.kapa_leads_inbound_events e where e.link_id = l.id and e.status = 'failed'),
           (select count(*) from public.kapa_leads_inbound_events e
             where e.link_id = l.id and e.status = 'processed' and e.processed_at > now() - interval '7 days'),
           (select min(e.received_at) from public.kapa_leads_inbound_events e where e.link_id = l.id and e.status = 'pending'),
           (select max(e.processed_at) from public.kapa_leads_inbound_events e where e.link_id = l.id and e.status = 'processed'),
           l.reconciled_at, l.reconciled_source_count, l.reconciled_crm_count
      from public.kapa_leads_store_links l
     where l.company_id = p_company_id
     order by l.created_at;
end;
$$;

create or replace function public.kapa_leads_review_list(p_company_id uuid, p_limit integer default 50)
returns table (
  event_id uuid,
  status text,
  source_campaign_name text,
  source_created_at timestamptz,
  received_at timestamptz,
  attempts integer,
  last_error_code text,
  next_attempt_at timestamptz
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
  if p_limit is null or p_limit not between 1 and 200 then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  return query
    select e.id, e.status, e.source_campaign_name, e.source_created_at, e.received_at,
           e.attempts, e.last_error_code, e.next_attempt_at
      from public.kapa_leads_inbound_events e
     where e.company_id = p_company_id
       and (e.status = 'failed' or (e.status = 'pending' and e.attempts > 0) or (e.status = 'pending' and e.last_error_code is not null))
     order by e.received_at desc
     limit p_limit;
end;
$$;

create or replace function public.kapa_leads_event_requeue(p_company_id uuid, p_event_id uuid)
returns table (out_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.kapa_leads_inbound_events;
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

  select * into v_event from public.kapa_leads_inbound_events e
   where e.id = p_event_id and e.company_id = p_company_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_event.status <> 'failed' or v_event.last_error_code = 'invalid_payload' then
    return query select 'not_requeueable'::text;
    return;
  end if;
  if v_event.requeue_count >= 10 then
    return query select 'requeue_limit'::text;
    return;
  end if;

  update public.kapa_leads_inbound_events e
     set status = 'pending', attempts = 0, next_attempt_at = now(), requeue_count = e.requeue_count + 1
   where e.id = p_event_id;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'kapa_leads_event_requeued', 'kapa_leads_inbound_event', p_event_id::text,
     'success', v_event.last_error_code,
     jsonb_build_object('status', v_event.status, 'attempts', v_event.attempts),
     jsonb_build_object('status', 'pending', 'requeue_count', v_event.requeue_count + 1), 'rpc');

  return query select 'requeued'::text;
end;
$$;

create or replace function public.kapa_leads_event_dismiss(p_company_id uuid, p_event_id uuid, p_resolution text)
returns table (out_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.kapa_leads_inbound_events;
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

  select * into v_event from public.kapa_leads_inbound_events e
   where e.id = p_event_id and e.company_id = p_company_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_event.status <> 'failed' then
    return query select 'not_dismissable'::text;
    return;
  end if;

  update public.kapa_leads_inbound_events e
     set status = 'dismissed', resolution = p_resolution, resolved_at = now(), resolved_by = auth.uid(),
         payload = '{}'::jsonb
   where e.id = p_event_id;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'kapa_leads_event_dismissed', 'kapa_leads_inbound_event', p_event_id::text,
     'success', v_event.last_error_code,
     jsonb_build_object('status', v_event.status), jsonb_build_object('status', 'dismissed', 'resolution', p_resolution), 'rpc');

  return query select 'dismissed'::text;
end;
$$;

-- ═══ 8. respostas de formulário com a origem ════════════════════════════
-- v1 continua igual (código publicado). v2 acrescenta a origem e o detalhe (campanha).

create or replace function public.list_lead_form_submissions_v2(p_lead_id uuid, p_company_id uuid default null)
returns table (
  id uuid,
  source text,
  source_detail text,
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
    select s.id, s.source, s.source_detail, s.outcome, s.form_id, s.ad_id, s.submitted_at, s.created_at,
           s.contact_name, s.contact_phone, s.contact_email, s.vehicle_interest, s.answers
      from public.lead_form_submissions s
     where s.company_id = v_company_id
       and s.lead_id = p_lead_id
     order by s.created_at desc
     limit 20;
end;
$$;

-- ═══ 9. privilégios ═════════════════════════════════════════════════════

revoke all on function public.kapa_leads_links_for_poll() from public, anon, authenticated;
revoke all on function public.kapa_leads_ingest_page(uuid, timestamptz, uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.kapa_leads_link_record_failure(uuid, text) from public, anon, authenticated;
revoke all on function public._kapa_leads_process_event(public.kapa_leads_inbound_events) from public, anon, authenticated, service_role;
revoke all on function public.kapa_leads_process_pending(integer) from public, anon, authenticated;
revoke all on function public.kapa_leads_purge_expired() from public, anon, authenticated;
revoke all on function public.kapa_leads_record_reconciliation(uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.kapa_leads_link_rewind(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.kapa_leads_link_rewind(uuid, timestamptz) to service_role;
grant execute on function public.kapa_leads_links_for_poll() to service_role;
grant execute on function public.kapa_leads_ingest_page(uuid, timestamptz, uuid, jsonb, timestamptz, uuid) to service_role;
grant execute on function public.kapa_leads_link_record_failure(uuid, text) to service_role;
grant execute on function public.kapa_leads_process_pending(integer) to service_role;
grant execute on function public.kapa_leads_purge_expired() to service_role;
grant execute on function public.kapa_leads_record_reconciliation(uuid, timestamptz, timestamptz, integer) to service_role;

revoke all on function public.kapa_leads_link_upsert(uuid, uuid, text, text) from public, anon, service_role;
revoke all on function public.kapa_leads_link_set_enabled(uuid, uuid, boolean) from public, anon, service_role;
revoke all on function public.kapa_leads_sync_health(uuid) from public, anon, service_role;
revoke all on function public.kapa_leads_review_list(uuid, integer) from public, anon, service_role;
revoke all on function public.kapa_leads_event_requeue(uuid, uuid) from public, anon, service_role;
revoke all on function public.kapa_leads_event_dismiss(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.list_lead_form_submissions_v2(uuid, uuid) from public, anon, service_role;
grant execute on function public.kapa_leads_link_upsert(uuid, uuid, text, text) to authenticated;
grant execute on function public.kapa_leads_link_set_enabled(uuid, uuid, boolean) to authenticated;
grant execute on function public.kapa_leads_sync_health(uuid) to authenticated;
grant execute on function public.kapa_leads_review_list(uuid, integer) to authenticated;
grant execute on function public.kapa_leads_event_requeue(uuid, uuid) to authenticated;
grant execute on function public.kapa_leads_event_dismiss(uuid, uuid, text) to authenticated;
grant execute on function public.list_lead_form_submissions_v2(uuid, uuid) to authenticated;
