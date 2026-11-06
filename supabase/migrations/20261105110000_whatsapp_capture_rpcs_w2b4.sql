-- WHATSAPP-W2B-4 — RPCs da captura transacional. Todas SECURITY DEFINER com
-- search_path vazio e EXECUTE somente para service_role. Nenhuma devolve
-- ciphertext, HMAC, WABA em diagnóstico ou dado pessoal.
--
-- A captura grava evento, contato, conversa e mensagem na MESMA transação. A
-- empresa é sempre derivada da conexão: p_expected_company_id só confirma a
-- empresa usada pela aplicação no AAD e no HMAC, e divergência não grava nada.
-- Reentrega é idempotente pela event_key e por (company_id, connection_id,
-- message_id_hash).
set lock_timeout = '5s';

-- ── contexto da captura (webhook: phone_number_id → conexão) ──────────────
create function public.whatsapp_connection_capture_context(p_phone_number_id text)
returns table (
  out_connection_id uuid,
  out_company_id uuid,
  out_waba_id text,
  out_capture_allowed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,30}$' then
    raise using message = 'invalid_input';
  end if;

  return query
    select c.id, c.company_id, c.waba_id,
           c.capture_enabled and co.status::text in ('ativa', 'implantacao')
    from public.whatsapp_connections c
    join public.companies co on co.id = c.company_id
    where c.phone_number_id = p_phone_number_id
      and c.status = 'connected';
end;
$$;

-- ── portão comum: devolve null quando a captura pode prosseguir ───────────
create function public.whatsapp_capture_gate(
  p_connection_id uuid,
  p_expected_company_id uuid,
  p_phone_number_id text,
  p_waba_id text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection public.whatsapp_connections;
  v_company_status text;
begin
  select * into v_connection
    from public.whatsapp_connections c
    where c.id = p_connection_id;

  if not found
    or v_connection.status <> 'connected'
    or v_connection.phone_number_id is distinct from p_phone_number_id
    or v_connection.company_id is distinct from p_expected_company_id
  then
    return 'connection_not_connected';
  end if;

  if v_connection.waba_id is distinct from p_waba_id then
    return 'waba_mismatch';
  end if;

  select co.status::text into v_company_status
    from public.companies co
    where co.id = v_connection.company_id;

  if not v_connection.capture_enabled or v_company_status not in ('ativa', 'implantacao') then
    return 'capture_disabled';
  end if;

  return null;
end;
$$;

-- ── captura transacional de uma mensagem recebida ─────────────────────────
create function public.whatsapp_inbound_message_capture(
  p_connection_id uuid,
  p_expected_company_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_message_id_hash text,
  p_message_type text,
  p_occurred_at timestamptz,
  p_received_at timestamptz,
  p_request_id uuid,
  p_bsuid_hmac text,
  p_phone_hmac text,
  p_hmac_key_version smallint,
  p_pii_ciphertext text,
  p_pii_ref uuid,
  p_pii_key_version smallint,
  p_pii_has_phone boolean,
  p_content_ciphertext text,
  p_content_key_version smallint
)
returns table (
  out_outcome text,
  out_event_id uuid,
  out_message_id uuid,
  out_conversation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate text;
  v_company_id uuid := p_expected_company_id;
  v_valid_occurred_at timestamptz;
  v_occurred_at timestamptz;
  v_event_key text;
  v_event_id uuid;
  v_event_company_id uuid;
  v_message_id uuid;
  v_conversation_id uuid;
  v_contact_by_bsuid uuid;
  v_contact_by_phone uuid;
  v_contact_id uuid;
  v_replace_pii boolean;
begin
  if p_connection_id is null or p_expected_company_id is null or p_received_at is null
    or p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,30}$'
    or p_waba_id is null or p_waba_id !~ '^[0-9]{1,30}$'
    or p_message_id_hash is null or p_message_id_hash !~ '^[0-9a-f]{64}$'
    or p_message_type is null
    or p_message_type not in (
      'text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive',
      'button', 'reaction', 'order', 'system', 'request_welcome', 'unsupported', 'other'
    )
    or (p_bsuid_hmac is null and p_phone_hmac is null)
    or (p_bsuid_hmac is not null and p_bsuid_hmac !~ '^[0-9a-f]{64}$')
    or (p_phone_hmac is not null and p_phone_hmac !~ '^[0-9a-f]{64}$')
    or p_hmac_key_version is null or p_hmac_key_version < 1
    or p_pii_ciphertext is null or char_length(p_pii_ciphertext) not between 1 and 8192
    or p_pii_ref is null
    or p_pii_key_version is null or p_pii_key_version < 1
    or p_pii_has_phone is null
    or p_content_ciphertext is null or char_length(p_content_ciphertext) not between 1 and 131072
    or p_content_key_version is null or p_content_key_version < 1
  then
    raise using message = 'invalid_input';
  end if;

  v_gate := public.whatsapp_capture_gate(p_connection_id, p_expected_company_id, p_phone_number_id, p_waba_id);
  if v_gate is not null then
    return query select v_gate, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  -- Horário fora da faixa não entra na ordem da conversa. Mesma regra do parser.
  v_valid_occurred_at := case
    when p_occurred_at < timestamptz '2009-01-01 00:00:00+00'
      or p_occurred_at > p_received_at + interval '1 day'
    then null
    else p_occurred_at
  end;
  v_occurred_at := coalesce(v_valid_occurred_at, p_received_at);
  v_event_key := encode(
    sha256(convert_to(
      'wa-webhook-event:v1:message:' || p_phone_number_id || ':' || p_message_id_hash || ':-',
      'UTF8')),
    'hex');

  insert into public.whatsapp_webhook_events (
    company_id, connection_id, phone_number_id, event_kind, event_key, message_id_hash,
    message_type, processing_status, occurred_at, received_at, request_id
  ) values (
    v_company_id, p_connection_id, p_phone_number_id, 'message', v_event_key, p_message_id_hash,
    p_message_type, 'received', v_valid_occurred_at, p_received_at, p_request_id
  )
  on conflict on constraint whatsapp_webhook_events_event_key_uniq do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id, e.company_id into v_event_id, v_event_company_id
      from public.whatsapp_webhook_events e
      where e.event_key = v_event_key
      for update;

    if v_event_company_id is distinct from v_company_id then
      return query select 'event_company_mismatch'::text, null::uuid, null::uuid, null::uuid;
      return;
    end if;

    select m.id, m.conversation_id into v_message_id, v_conversation_id
      from public.whatsapp_messages m
      where m.company_id = v_company_id
        and m.connection_id = p_connection_id
        and m.message_id_hash = p_message_id_hash;

    if found then
      return query select 'duplicate'::text, v_event_id, v_message_id, v_conversation_id;
      return;
    end if;
    -- Evento sem mensagem (linha da W2A ou falha anterior): a reentrega completa.
  end if;

  -- Serializa a resolução do mesmo contato. Ordem fixa evita deadlock.
  perform pg_advisory_xact_lock(hashtextextended('whatsapp_contact:' || v_company_id::text || ':' || k, 0))
    from (
      select unnest(array_remove(array[p_bsuid_hmac, p_phone_hmac], null)) as k
      order by 1
    ) keys;

  if p_bsuid_hmac is not null then
    select c.id into v_contact_by_bsuid
      from public.whatsapp_contacts c
      where c.company_id = v_company_id and c.bsuid_hmac = p_bsuid_hmac;
  end if;

  if p_phone_hmac is not null then
    select c.id into v_contact_by_phone
      from public.whatsapp_contacts c
      where c.company_id = v_company_id and c.phone_hmac = p_phone_hmac;
  end if;

  v_contact_id := coalesce(v_contact_by_bsuid, v_contact_by_phone);

  if v_contact_id is null then
    insert into public.whatsapp_contacts (
      company_id, bsuid_hmac, phone_hmac, hmac_key_version, pii_ciphertext, pii_ref,
      pii_key_version, pii_has_phone, pii_source_at
    ) values (
      v_company_id, p_bsuid_hmac, p_phone_hmac, p_hmac_key_version, p_pii_ciphertext, p_pii_ref,
      p_pii_key_version, p_pii_has_phone, v_occurred_at
    )
    returning id into v_contact_id;
  else
    -- Eventos chegam fora de ordem: só substitui o envelope se ele for mais novo
    -- ou trouxer um telefone que ainda não existia. Nunca perde o telefone.
    select (p_pii_has_phone and not c.pii_has_phone)
        or (v_occurred_at >= c.pii_source_at and (p_pii_has_phone or not c.pii_has_phone))
      into v_replace_pii
      from public.whatsapp_contacts c
      where c.id = v_contact_id;

    update public.whatsapp_contacts c
       set bsuid_hmac = case when c.bsuid_hmac is null and v_contact_by_bsuid is null then p_bsuid_hmac else c.bsuid_hmac end,
           phone_hmac = case when c.phone_hmac is null and v_contact_by_phone is null then p_phone_hmac else c.phone_hmac end,
           pii_ciphertext = case when v_replace_pii then p_pii_ciphertext else c.pii_ciphertext end,
           pii_ref = case when v_replace_pii then p_pii_ref else c.pii_ref end,
           pii_key_version = case when v_replace_pii then p_pii_key_version else c.pii_key_version end,
           pii_has_phone = case when v_replace_pii then p_pii_has_phone else c.pii_has_phone end,
           pii_source_at = case when v_replace_pii then greatest(c.pii_source_at, v_occurred_at) else c.pii_source_at end
     where c.id = v_contact_id;
  end if;

  insert into public.whatsapp_conversations as conv (
    company_id, connection_id, contact_id, first_message_at, last_message_at
  ) values (
    v_company_id, p_connection_id, v_contact_id, v_occurred_at, v_occurred_at
  )
  on conflict on constraint whatsapp_conversations_contact_uniq do update
    set first_message_at = least(conv.first_message_at, excluded.first_message_at),
        last_message_at = greatest(conv.last_message_at, excluded.last_message_at)
  returning conv.id into v_conversation_id;

  insert into public.whatsapp_messages (
    company_id, connection_id, conversation_id, contact_id, event_id, direction, message_type,
    message_id_hash, content_ciphertext, content_key_version, occurred_at, received_at
  ) values (
    v_company_id, p_connection_id, v_conversation_id, v_contact_id, v_event_id, 'inbound', p_message_type,
    p_message_id_hash, p_content_ciphertext, p_content_key_version, v_occurred_at, p_received_at
  )
  on conflict on constraint whatsapp_messages_message_uniq do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select m.id into v_message_id
      from public.whatsapp_messages m
      where m.company_id = v_company_id
        and m.connection_id = p_connection_id
        and m.message_id_hash = p_message_id_hash;
    return query select 'duplicate'::text, v_event_id, v_message_id, v_conversation_id;
    return;
  end if;

  update public.whatsapp_webhook_events e
     set processing_status = 'processed',
         processed_at = now(),
         last_error_code = null,
         request_id = coalesce(e.request_id, p_request_id)
   where e.id = v_event_id;

  return query select 'captured'::text, v_event_id, v_message_id, v_conversation_id;
end;
$$;

-- ── mensagem que não pode ser capturada: fica rastreada, sem dado pessoal ──
-- WABA divergente nunca grava conversa. O chamador envia a WABA da própria
-- conexão, e o motivo fica no código de erro, de conjunto fechado.
create function public.whatsapp_inbound_event_mark_failed(
  p_connection_id uuid,
  p_expected_company_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_message_id_hash text,
  p_message_type text,
  p_error_code text,
  p_occurred_at timestamptz,
  p_received_at timestamptz,
  p_request_id uuid
)
returns table (
  out_outcome text,
  out_event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate text;
  v_event_key text;
  v_event_id uuid;
begin
  if p_connection_id is null or p_expected_company_id is null or p_received_at is null
    or p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{1,30}$'
    or p_waba_id is null or p_waba_id !~ '^[0-9]{1,30}$'
    or p_message_id_hash is null or p_message_id_hash !~ '^[0-9a-f]{64}$'
    or p_message_type is null
    or p_error_code is null or p_error_code not in ('contact_unresolved', 'group_message', 'waba_mismatch')
  then
    raise using message = 'invalid_input';
  end if;

  v_gate := public.whatsapp_capture_gate(p_connection_id, p_expected_company_id, p_phone_number_id, p_waba_id);
  if v_gate is not null then
    return query select v_gate, null::uuid;
    return;
  end if;

  v_event_key := encode(
    sha256(convert_to(
      'wa-webhook-event:v1:message:' || p_phone_number_id || ':' || p_message_id_hash || ':-',
      'UTF8')),
    'hex');

  insert into public.whatsapp_webhook_events (
    company_id, connection_id, phone_number_id, event_kind, event_key, message_id_hash,
    message_type, processing_status, last_error_code, occurred_at, received_at, request_id
  ) values (
    p_expected_company_id, p_connection_id, p_phone_number_id, 'message', v_event_key, p_message_id_hash,
    p_message_type, 'failed', p_error_code, p_occurred_at, p_received_at, p_request_id
  )
  on conflict on constraint whatsapp_webhook_events_event_key_uniq do nothing
  returning id into v_event_id;

  return query select case when v_event_id is null then 'already_recorded' else 'recorded' end, v_event_id;
end;
$$;

-- ── habilita ou desabilita a captura de uma conexão ───────────────────────
-- A trava de banco recusa qualquer empresa além da TEST COMPANY.
create function public.whatsapp_connection_set_capture(
  p_connection_id uuid,
  p_capture_enabled boolean,
  p_actor_profile_id uuid
)
returns table (
  out_connection_id uuid,
  out_capture_enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.whatsapp_connections;
  v_previous boolean;
begin
  if p_connection_id is null or p_capture_enabled is null then
    raise using message = 'invalid_input';
  end if;

  select c.capture_enabled into v_previous
    from public.whatsapp_connections c
    where c.id = p_connection_id
    for update;

  begin
    update public.whatsapp_connections c
       set capture_enabled = p_capture_enabled
     where c.id = p_connection_id
       and (not p_capture_enabled or c.status = 'connected')
    returning c.* into v_connection;
  exception
    when check_violation then
      raise using message = 'capture_not_allowed';
  end;

  if not found then
    raise using message = 'connection_not_connected';
  end if;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (p_actor_profile_id, v_connection.company_id, 'whatsapp_capture_changed', 'whatsapp_connection', v_connection.id::text,
     'success', null, jsonb_build_object('capture_enabled', v_previous),
     jsonb_build_object('capture_enabled', v_connection.capture_enabled), 'rpc');

  return query select v_connection.id, v_connection.capture_enabled;
end;
$$;

-- ── resumo sanitizado para o diagnóstico: só contagens e datas ────────────
create function public.whatsapp_diagnostics_summary(p_company_id uuid)
returns table (
  out_events_total bigint,
  out_events_received bigint,
  out_events_processed bigint,
  out_events_failed bigint,
  out_events_waba_mismatch bigint,
  out_events_contact_unresolved bigint,
  out_events_group_message bigint,
  out_last_event_at timestamptz,
  out_messages_total bigint,
  out_contacts_total bigint,
  out_conversations_total bigint,
  out_capture_enabled_connections bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_company_id is null then
    raise using message = 'invalid_input';
  end if;

  return query
    select
      (select count(*) from public.whatsapp_webhook_events e where e.company_id = p_company_id),
      (select count(*) from public.whatsapp_webhook_events e
        where e.company_id = p_company_id and e.processing_status = 'received'),
      (select count(*) from public.whatsapp_webhook_events e
        where e.company_id = p_company_id and e.processing_status = 'processed'),
      (select count(*) from public.whatsapp_webhook_events e
        where e.company_id = p_company_id and e.processing_status = 'failed'),
      (select count(*) from public.whatsapp_webhook_events e
        where e.company_id = p_company_id and e.last_error_code = 'waba_mismatch'),
      (select count(*) from public.whatsapp_webhook_events e
        where e.company_id = p_company_id and e.last_error_code = 'contact_unresolved'),
      (select count(*) from public.whatsapp_webhook_events e
        where e.company_id = p_company_id and e.last_error_code = 'group_message'),
      (select max(e.received_at) from public.whatsapp_webhook_events e where e.company_id = p_company_id),
      (select count(*) from public.whatsapp_messages m where m.company_id = p_company_id),
      (select count(*) from public.whatsapp_contacts c where c.company_id = p_company_id),
      (select count(*) from public.whatsapp_conversations c where c.company_id = p_company_id),
      (select count(*) from public.whatsapp_connections c where c.company_id = p_company_id and c.capture_enabled);
end;
$$;

-- ── privilégios ───────────────────────────────────────────────────────────
revoke all on function public.whatsapp_capture_gate(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.whatsapp_connection_capture_context(text) from public, anon, authenticated;
revoke all on function public.whatsapp_inbound_message_capture(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text, text, smallint, text, uuid, smallint,
  boolean, text, smallint
) from public, anon, authenticated;
revoke all on function public.whatsapp_inbound_event_mark_failed(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.whatsapp_connection_set_capture(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_diagnostics_summary(uuid) from public, anon, authenticated;

grant execute on function public.whatsapp_connection_capture_context(text) to service_role;
grant execute on function public.whatsapp_inbound_message_capture(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text, text, smallint, text, uuid, smallint,
  boolean, text, smallint
) to service_role;
grant execute on function public.whatsapp_inbound_event_mark_failed(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid
) to service_role;
grant execute on function public.whatsapp_connection_set_capture(uuid, boolean, uuid) to service_role;
grant execute on function public.whatsapp_diagnostics_summary(uuid) to service_role;

reset lock_timeout;
