-- WHATSAPP-W2B-4 — contatos, conversas e mensagens WhatsApp por empresa.
-- Acesso somente por RPCs (segunda migration desta fase). Mesmo padrão da W2A:
-- RLS habilitado, ZERO policies e nenhum privilégio direto, nem para service_role.
-- A leitura pelo CRM entra na W2B-8, com autorização por papel.
--
-- Dados pessoais: telefone, nome, BSUID, texto e wamid só existem em envelope
-- AES-256-GCM cifrado pela aplicação. A busca de contato usa HMAC com segredo,
-- calculado na aplicação e vinculado à empresa. Nada é decifrado no banco.
--
-- Isolamento: FKs compostas com company_id tornam estruturalmente impossível uma
-- mensagem apontar para conversa, contato, conexão ou evento de outra empresa.
--
-- RETENÇÃO E EXCLUSÃO: decisão pendente. A trava
-- whatsapp_connections_capture_test_only_ck impede habilitar a captura fora da
-- TEST COMPANY. Removê-la exige migration própria, depois da decisão.
--
-- LOCKS: nenhuma FK aponta para leads, para não travar escritas das
-- concessionárias. O vínculo com lead entra na W2B-9, em migration própria. A FK
-- para companies toma SHARE ROW EXCLUSIVE por instantes: lock_timeout faz a
-- migration falhar sem efeito em vez de enfileirar as escritas atrás dela.
set lock_timeout = '5s';

alter table public.whatsapp_connections
  add column capture_enabled boolean not null default false,
  add constraint whatsapp_connections_company_id_id_uniq unique (company_id, id),
  add constraint whatsapp_connections_capture_test_only_ck check (
    not capture_enabled or company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'::uuid
  );

alter table public.whatsapp_webhook_events
  add column request_id uuid,
  add constraint whatsapp_webhook_events_company_id_id_uniq unique (company_id, id);

create table public.whatsapp_contacts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  bsuid_hmac        text,
  phone_hmac        text,
  hmac_key_version  smallint not null,
  pii_ciphertext    text not null,
  pii_ref           uuid not null,
  pii_key_version   smallint not null,
  pii_has_phone     boolean not null,
  pii_source_at     timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint whatsapp_contacts_company_id_id_uniq unique (company_id, id),
  constraint whatsapp_contacts_identity_ck check (bsuid_hmac is not null or phone_hmac is not null),
  constraint whatsapp_contacts_bsuid_hmac_ck check (bsuid_hmac is null or bsuid_hmac ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_contacts_phone_hmac_ck check (phone_hmac is null or phone_hmac ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_contacts_pii_len_ck check (char_length(pii_ciphertext) between 1 and 8192),
  constraint whatsapp_contacts_key_versions_ck check (hmac_key_version >= 1 and pii_key_version >= 1)
);

create unique index whatsapp_contacts_company_bsuid_uniq
  on public.whatsapp_contacts (company_id, bsuid_hmac)
  where bsuid_hmac is not null;

create unique index whatsapp_contacts_company_phone_uniq
  on public.whatsapp_contacts (company_id, phone_hmac)
  where phone_hmac is not null;

create trigger whatsapp_contacts_set_updated_at
  before update on public.whatsapp_contacts
  for each row execute function set_updated_at();

create table public.whatsapp_conversations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  connection_id     uuid not null,
  contact_id        uuid not null,
  first_message_at  timestamptz not null,
  last_message_at   timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint whatsapp_conversations_company_id_id_uniq unique (company_id, id),
  constraint whatsapp_conversations_identity_uniq unique (company_id, id, connection_id, contact_id),
  constraint whatsapp_conversations_contact_uniq unique (company_id, connection_id, contact_id),
  constraint whatsapp_conversations_connection_fk
    foreign key (company_id, connection_id)
    references public.whatsapp_connections (company_id, id) on delete cascade,
  constraint whatsapp_conversations_contact_fk
    foreign key (company_id, contact_id)
    references public.whatsapp_contacts (company_id, id) on delete cascade,
  constraint whatsapp_conversations_dates_ck check (first_message_at <= last_message_at)
);

create index whatsapp_conversations_company_recent_idx
  on public.whatsapp_conversations (company_id, last_message_at desc);

create index whatsapp_conversations_contact_idx
  on public.whatsapp_conversations (company_id, contact_id);

create trigger whatsapp_conversations_set_updated_at
  before update on public.whatsapp_conversations
  for each row execute function set_updated_at();

create table public.whatsapp_messages (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  connection_id        uuid not null,
  conversation_id      uuid not null,
  contact_id           uuid not null,
  event_id             uuid not null,
  direction            text not null,
  message_type         text not null,
  message_id_hash      text not null,
  content_ciphertext   text not null,
  content_key_version  smallint not null,
  occurred_at          timestamptz not null,
  received_at          timestamptz not null,
  created_at           timestamptz not null default now(),

  -- Por conexão, como a event_key: o mesmo wamid em dois números da empresa são
  -- duas mensagens, cada uma na sua conversa.
  constraint whatsapp_messages_message_uniq unique (company_id, connection_id, message_id_hash),
  constraint whatsapp_messages_event_uniq unique (event_id),
  constraint whatsapp_messages_conversation_fk
    foreign key (company_id, conversation_id, connection_id, contact_id)
    references public.whatsapp_conversations (company_id, id, connection_id, contact_id) on delete cascade,
  constraint whatsapp_messages_event_fk
    foreign key (company_id, event_id)
    references public.whatsapp_webhook_events (company_id, id) on delete cascade,
  constraint whatsapp_messages_direction_ck check (direction = 'inbound'),
  constraint whatsapp_messages_message_type_ck check (
    message_type in (
      'text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive',
      'button', 'reaction', 'order', 'system', 'request_welcome', 'unsupported', 'other'
    )
  ),
  constraint whatsapp_messages_message_id_hash_ck check (message_id_hash ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_messages_content_len_ck check (char_length(content_ciphertext) between 1 and 131072),
  constraint whatsapp_messages_key_version_ck check (content_key_version >= 1)
);

create index whatsapp_messages_conversation_time_idx
  on public.whatsapp_messages (conversation_id, occurred_at desc);

create index whatsapp_messages_conversation_fk_idx
  on public.whatsapp_messages (company_id, conversation_id, connection_id, contact_id);

create index whatsapp_messages_event_fk_idx
  on public.whatsapp_messages (company_id, event_id);

alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

revoke all on table public.whatsapp_contacts from public, anon, authenticated, service_role;
revoke all on table public.whatsapp_conversations from public, anon, authenticated, service_role;
revoke all on table public.whatsapp_messages from public, anon, authenticated, service_role;

reset lock_timeout;
