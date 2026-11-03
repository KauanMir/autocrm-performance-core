-- WHATSAPP-W2A — conexão WhatsApp Cloud API por company + RPCs estreitas.
-- Mesmo padrão de company_meta_integrations (P2/P3/P4A): tabela com RLS,
-- ZERO policies, nenhum privilégio direto (nem service_role); acesso só por
-- RPCs SECURITY DEFINER com search_path vazio e EXECUTE somente service_role.
-- Token só cifrado (AES-256-GCM, envelope versionado, AAD por company +
-- phone_number_id, chave WHATSAPP_TOKEN_ENCRYPTION_KEY_V<n>) — nunca plaintext.
-- Estas funções NÃO decidem autorização: quem pode conectar é decisão da
-- aplicação server-side, antes de chamar. Nenhuma linha criada aqui.

create table public.whatsapp_connections (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  waba_id                  text not null,
  phone_number_id          text not null,
  display_phone_number     text,
  access_token_ciphertext  text,
  token_key_version        smallint not null default 1,
  status                   text not null,
  connected_at             timestamptz,
  connected_by             uuid references public.profiles(id) on delete set null,
  disconnected_at          timestamptz,
  last_error_code          text,
  last_error_at            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint whatsapp_connections_company_phone_uniq
    unique (company_id, phone_number_id),
  constraint whatsapp_connections_waba_id_ck
    check (waba_id ~ '^[0-9]{1,30}$'),
  constraint whatsapp_connections_phone_number_id_ck
    check (phone_number_id ~ '^[0-9]{1,30}$'),
  -- Número do PRÓPRIO negócio (não do contato), formato de exibição da Meta.
  constraint whatsapp_connections_display_phone_ck
    check (display_phone_number is null or display_phone_number ~ '^[0-9 +()-]{1,32}$'),
  constraint whatsapp_connections_key_version_ck
    check (token_key_version >= 1),
  constraint whatsapp_connections_status_ck
    check (status in ('connected', 'disconnected', 'error')),
  constraint whatsapp_connections_ciphertext_len_ck
    check (access_token_ciphertext is null or char_length(access_token_ciphertext) <= 4096),
  constraint whatsapp_connections_connected_ciphertext_ck
    check (status <> 'connected' or access_token_ciphertext is not null),
  constraint whatsapp_connections_connected_at_ck
    check (status <> 'connected' or connected_at is not null),
  constraint whatsapp_connections_last_error_code_ck
    check (
      last_error_code is null
      or (char_length(last_error_code) between 1 and 64 and last_error_code ~ '^[a-z][a-z0-9_]*$')
    )
);

-- Um phone_number_id conectado pertence a no máximo UMA company (nenhuma
-- company se apropria de número já conectado a outra). Também é o índice do
-- lookup do webhook, que só resolve conexões ativas.
create unique index whatsapp_connections_phone_connected_uniq
  on public.whatsapp_connections (phone_number_id)
  where status = 'connected';

create trigger whatsapp_connections_set_updated_at
  before update on public.whatsapp_connections
  for each row execute function set_updated_at();

alter table public.whatsapp_connections enable row level security;

revoke all on table public.whatsapp_connections
  from public, anon, authenticated, service_role;

-- ── upsert: conecta/reconecta (idempotente por company + phone_number_id) ──
create or replace function public.whatsapp_connection_upsert(
  p_company_id uuid,
  p_waba_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_access_token_ciphertext text,
  p_token_key_version smallint,
  p_connected_at timestamptz,
  p_connected_by uuid
)
returns table (
  id uuid,
  company_id uuid,
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  status text,
  connected_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_connections;
  v_constraint text;
begin
  if p_company_id is null
    or p_waba_id is null or p_waba_id !~ '^[0-9]{1,30}$'
    or p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,30}$'
    or (p_display_phone_number is not null and p_display_phone_number !~ '^[0-9 +()-]{1,32}$')
    or p_access_token_ciphertext is null or char_length(p_access_token_ciphertext) not between 1 and 4096
    or p_token_key_version is null or p_token_key_version < 1
    or p_connected_at is null
  then
    raise using message = 'invalid_input';
  end if;

  begin
    insert into public.whatsapp_connections as c (
      company_id, waba_id, phone_number_id, display_phone_number, access_token_ciphertext,
      token_key_version, status, connected_at, connected_by, disconnected_at, last_error_code, last_error_at
    ) values (
      p_company_id, p_waba_id, p_phone_number_id, p_display_phone_number, p_access_token_ciphertext,
      p_token_key_version, 'connected', p_connected_at, p_connected_by, null, null, null
    )
    on conflict on constraint whatsapp_connections_company_phone_uniq do update set
      waba_id = excluded.waba_id,
      display_phone_number = excluded.display_phone_number,
      access_token_ciphertext = excluded.access_token_ciphertext,
      token_key_version = excluded.token_key_version,
      status = 'connected',
      connected_at = excluded.connected_at,
      connected_by = excluded.connected_by,
      disconnected_at = null,
      last_error_code = null,
      last_error_at = null,
      updated_at = now()
    returning c.* into v_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'whatsapp_connections_phone_connected_uniq' then
        raise using message = 'phone_number_already_connected';
      end if;
      raise;
  end;

  -- Auditoria sem identificadores externos (WABA/phone_number_id) nem token.
  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (p_connected_by, p_company_id, 'whatsapp_connection_upserted', 'whatsapp_connection', v_row.id::text,
     'success', null, null, jsonb_build_object('status', v_row.status), 'rpc');

  return query select v_row.id, v_row.company_id, v_row.waba_id, v_row.phone_number_id,
                      v_row.display_phone_number, v_row.status, v_row.connected_at;
end;
$$;

-- ── status por company: metadados, NUNCA ciphertext / key version ─────────
create or replace function public.whatsapp_connection_status(p_company_id uuid)
returns table (
  id uuid,
  company_id uuid,
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  status text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company_id is null then
    raise using message = 'invalid_input';
  end if;

  return query
    select c.id, c.company_id, c.waba_id, c.phone_number_id, c.display_phone_number, c.status,
           c.connected_at, c.disconnected_at, c.last_error_code, c.last_error_at, c.updated_at
    from public.whatsapp_connections c
    where c.company_id = p_company_id
    order by c.phone_number_id;
end;
$$;

-- ── ownership metadata-only (webhook: phone_number_id → company) ─────────
create or replace function public.whatsapp_connection_owner_by_phone_number(p_phone_number_id text)
returns table (
  connection_id uuid,
  company_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,30}$' then
    raise using message = 'invalid_input';
  end if;

  return query
    select c.id, c.company_id, c.status
    from public.whatsapp_connections c
    where c.phone_number_id = p_phone_number_id
      and c.status = 'connected';
end;
$$;

-- ── lookup para processamento: ÚNICA função que devolve ciphertext ───────
create or replace function public.whatsapp_connection_lookup_for_processing(p_phone_number_id text)
returns table (
  connection_id uuid,
  company_id uuid,
  waba_id text,
  phone_number_id text,
  status text,
  access_token_ciphertext text,
  token_key_version smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,30}$' then
    raise using message = 'invalid_input';
  end if;

  return query
    select c.id, c.company_id, c.waba_id, c.phone_number_id, c.status,
           c.access_token_ciphertext, c.token_key_version
    from public.whatsapp_connections c
    where c.phone_number_id = p_phone_number_id
      and c.status = 'connected';
end;
$$;

revoke all on function public.whatsapp_connection_upsert(uuid, text, text, text, text, smallint, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.whatsapp_connection_status(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_connection_owner_by_phone_number(text) from public, anon, authenticated;
revoke all on function public.whatsapp_connection_lookup_for_processing(text) from public, anon, authenticated;

grant execute on function public.whatsapp_connection_upsert(uuid, text, text, text, text, smallint, timestamptz, uuid)
  to service_role;
grant execute on function public.whatsapp_connection_status(uuid) to service_role;
grant execute on function public.whatsapp_connection_owner_by_phone_number(text) to service_role;
grant execute on function public.whatsapp_connection_lookup_for_processing(text) to service_role;
