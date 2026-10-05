-- META-INGESTION-P1 — ledger idempotente de eventos leadgen. Expõe somente a
-- RPC de registro. Nenhuma busca na Graph, nenhum lead CRM, nenhum
-- field_data/PII armazenado. Acesso somente por RPC service_role.

create table public.meta_leadgen_events (
  id               uuid primary key default gen_random_uuid(),
  integration_id   uuid not null references public.company_meta_integrations(id) on delete restrict,
  company_id       uuid not null references public.companies(id) on delete cascade,
  page_id          text not null,
  leadgen_id       text not null,
  form_id          text,
  status           text not null,
  crm_lead_id      uuid,
  attempts         integer not null default 0,
  locked_until     timestamptz,
  last_error_code  text,
  received_at      timestamptz not null,
  processed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint meta_leadgen_events_page_leadgen_uniq unique (page_id, leadgen_id),
  constraint meta_leadgen_events_page_id_ck check (page_id ~ '^[0-9]{1,30}$'),
  constraint meta_leadgen_events_leadgen_id_ck check (leadgen_id ~ '^[0-9]{1,64}$'),
  constraint meta_leadgen_events_form_id_ck check (form_id is null or form_id ~ '^[0-9]{1,64}$'),
  constraint meta_leadgen_events_status_ck check (status in ('received', 'processing', 'processed', 'failed')),
  constraint meta_leadgen_events_attempts_ck check (attempts >= 0),
  constraint meta_leadgen_events_last_error_code_ck check (
    last_error_code is null
    or (char_length(last_error_code) between 1 and 64 and last_error_code ~ '^[a-z][a-z0-9_]*$')
  ),
  constraint meta_leadgen_events_processed_ck check (
    status <> 'processed' or (crm_lead_id is not null and processed_at is not null)
  ),
  constraint meta_leadgen_events_crm_lead_fk
    foreign key (company_id, crm_lead_id)
    references public.leads (company_id, id)
    on delete set null (crm_lead_id)
);

create index meta_leadgen_events_sweep_idx
  on public.meta_leadgen_events (status, locked_until);

create index meta_leadgen_events_integration_idx
  on public.meta_leadgen_events (integration_id);

create trigger meta_leadgen_events_set_updated_at
  before update on public.meta_leadgen_events
  for each row execute function set_updated_at();

alter table public.meta_leadgen_events enable row level security;

revoke all on table public.meta_leadgen_events
  from public, anon, authenticated, service_role;

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
      and i.status = 'connected';
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

revoke all on function public.meta_leadgen_event_register(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.meta_leadgen_event_register(uuid, uuid, text, text, text, timestamptz)
  to service_role;
