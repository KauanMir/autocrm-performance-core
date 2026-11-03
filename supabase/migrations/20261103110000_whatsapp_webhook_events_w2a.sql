-- WHATSAPP-W2A — ledger idempotente de eventos do webhook WhatsApp Cloud API.
-- Só metadados técnicos: NENHUM texto de mensagem, telefone/nome do contato,
-- mídia ou payload bruto. O wamid NÃO é armazenado cru (ele codifica o
-- telefone do contato em base64): a aplicação envia só o SHA-256 dele
-- (message_id_hash). Nenhuma conversa/mensagem CRM é criada aqui. Acesso
-- somente pela RPC de registro, EXECUTE só service_role.
--
-- IDEMPOTÊNCIA (a Meta reentrega webhooks): event_key é derivado NA RPC, de
-- forma determinística, e é UNIQUE:
--   message → sha256('wa-webhook-event:v1:message:<phone_number_id>:<message_id_hash>:-')
--   status  → sha256('wa-webhook-event:v1:status:<phone_number_id>:<message_id_hash>:<status_key_hash>')
-- status_key_hash = SHA-256 do valor BRUTO do status, calculado pela
-- aplicação em memória. O valor bruto nunca chega ao banco, nunca é
-- armazenado nem logado; status_value continua só a classificação da
-- allowlist (ou 'other'). Assim dois statuses desconhecidos distintos do
-- mesmo wamid (ambos 'other') geram event_keys diferentes.
-- Mensagem e status nunca colidem (kind no material da chave); cada
-- transição de status (sent/delivered/read/failed...) é um evento distinto,
-- e a reentrega da mesma transição é deduplicada.

create table public.whatsapp_webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  connection_id      uuid not null references public.whatsapp_connections(id) on delete cascade,
  phone_number_id    text not null,
  event_kind         text not null,
  event_key          text not null,
  message_id_hash    text not null,
  message_type       text,
  status_value       text,
  processing_status  text not null default 'received',
  attempts           integer not null default 0,
  last_error_code    text,
  occurred_at        timestamptz,
  received_at        timestamptz not null,
  processed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint whatsapp_webhook_events_event_key_uniq unique (event_key),
  constraint whatsapp_webhook_events_phone_number_id_ck check (phone_number_id ~ '^[0-9]{1,30}$'),
  constraint whatsapp_webhook_events_event_kind_ck check (event_kind in ('message', 'status')),
  constraint whatsapp_webhook_events_event_key_ck check (event_key ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_webhook_events_message_id_hash_ck check (message_id_hash ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_webhook_events_message_type_ck check (
    message_type is null or message_type in (
      'text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive',
      'button', 'reaction', 'order', 'system', 'request_welcome', 'unsupported', 'other'
    )
  ),
  constraint whatsapp_webhook_events_status_value_ck check (
    status_value is null or status_value in ('sent', 'delivered', 'read', 'failed', 'deleted', 'warning', 'other')
  ),
  constraint whatsapp_webhook_events_kind_shape_ck check (
    (event_kind = 'message' and message_type is not null and status_value is null)
    or (event_kind = 'status' and status_value is not null and message_type is null)
  ),
  constraint whatsapp_webhook_events_processing_status_ck check (
    processing_status in ('received', 'processing', 'processed', 'failed', 'ignored')
  ),
  constraint whatsapp_webhook_events_attempts_ck check (attempts >= 0),
  constraint whatsapp_webhook_events_last_error_code_ck check (
    last_error_code is null
    or (char_length(last_error_code) between 1 and 64 and last_error_code ~ '^[a-z][a-z0-9_]*$')
  ),
  constraint whatsapp_webhook_events_processed_ck check (
    processing_status <> 'processed' or processed_at is not null
  )
);

create index whatsapp_webhook_events_connection_idx
  on public.whatsapp_webhook_events (connection_id);

create index whatsapp_webhook_events_processing_idx
  on public.whatsapp_webhook_events (processing_status, received_at);

create trigger whatsapp_webhook_events_set_updated_at
  before update on public.whatsapp_webhook_events
  for each row execute function set_updated_at();

alter table public.whatsapp_webhook_events enable row level security;

revoke all on table public.whatsapp_webhook_events
  from public, anon, authenticated, service_role;

create or replace function public.whatsapp_webhook_event_register(
  p_connection_id uuid,
  p_company_id uuid,
  p_phone_number_id text,
  p_event_kind text,
  p_message_id_hash text,
  p_message_type text default null,
  p_status_value text default null,
  p_status_key_hash text default null,
  p_occurred_at timestamptz default null,
  p_received_at timestamptz default now()
)
returns table (
  out_event_id uuid,
  out_processing_status text,
  out_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
  v_status text;
  v_created boolean := false;
begin
  if p_connection_id is null or p_company_id is null or p_received_at is null
    or p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,30}$'
    or p_message_id_hash is null or p_message_id_hash !~ '^[0-9a-f]{64}$'
    or p_event_kind is null
    or not (
      (p_event_kind = 'message' and p_message_type is not null
        and p_status_value is null and p_status_key_hash is null)
      or (p_event_kind = 'status' and p_message_type is null
        and p_status_value is not null and p_status_key_hash is not null and p_status_key_hash ~ '^[0-9a-f]{64}$')
    )
  then
    raise using message = 'invalid_input';
  end if;

  perform 1
    from public.whatsapp_connections c
    where c.id = p_connection_id
      and c.company_id = p_company_id
      and c.phone_number_id = p_phone_number_id
      and c.status = 'connected';
  if not found then
    raise using message = 'connection_not_connected';
  end if;

  v_key := encode(
    sha256(convert_to(
      'wa-webhook-event:v1:' || p_event_kind || ':' || p_phone_number_id || ':' || p_message_id_hash || ':'
        || coalesce(p_status_key_hash, '-'),
      'UTF8')),
    'hex');

  insert into public.whatsapp_webhook_events (
    company_id, connection_id, phone_number_id, event_kind, event_key, message_id_hash,
    message_type, status_value, processing_status, occurred_at, received_at
  ) values (
    p_company_id, p_connection_id, p_phone_number_id, p_event_kind, v_key, p_message_id_hash,
    p_message_type, p_status_value, 'received', p_occurred_at, p_received_at
  )
  on conflict on constraint whatsapp_webhook_events_event_key_uniq do nothing
  returning id, processing_status into v_id, v_status;

  if v_id is null then
    select e.id, e.processing_status into v_id, v_status
      from public.whatsapp_webhook_events e
      where e.event_key = v_key;
  else
    v_created := true;
  end if;

  return query select v_id, v_status, v_created;
end;
$$;

revoke all on function public.whatsapp_webhook_event_register(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.whatsapp_webhook_event_register(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz)
  to service_role;
