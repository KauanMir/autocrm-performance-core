-- WHATSAPP-W2B-8 — leitura da caixa de entrada WhatsApp. Só RPCs novas: nenhuma
-- tabela, coluna, grant ou policy muda, então as tabelas seguem sem acesso direto.
--
-- As RPCs devolvem ciphertext para o SERVIDOR decifrar, por isso EXECUTE é só de
-- service_role. Um grant para authenticated entregaria ciphertext ao navegador.
-- Nunca devolvem HMAC nem nada do webhook.
--
-- Enquanto a matriz de permissões da inbox não for aprovada, a leitura é restrita ao
-- Super Admin ativo operando a TEST COMPANY. A regra mora aqui também, e não só na
-- rota: um erro na aplicação não pode abrir leitura de outra empresa. Ampliar exige
-- migration própria, depois da decisão.
--
-- Vínculo com lead fica para a W2B-9. Estas RPCs não tocam leads.
set lock_timeout = '5s';

-- ── portão interno da leitura ─────────────────────────────────────────────
create function public.whatsapp_inbox_read_allowed(p_actor_profile_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'::uuid
    and exists (
      select 1
      from public.profiles p
      where p.id = p_actor_profile_id
        and p.is_active
        and p.platform_role = 'super_admin'
    );
$$;

-- ── conversas, da mais recente para a mais antiga ─────────────────────────
create function public.whatsapp_inbox_list_conversations(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_limit integer default 30,
  p_before_last_message_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  out_conversation_id uuid,
  out_last_message_at timestamptz,
  out_message_count bigint,
  out_pii_ciphertext text,
  out_pii_ref uuid,
  out_pii_key_version smallint,
  out_last_connection_id uuid,
  out_last_message_type text,
  out_last_message_id_hash text,
  out_last_content_ciphertext text,
  out_last_content_key_version smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_profile_id is null or p_company_id is null
    or p_limit is null or p_limit not between 1 and 100
    or (p_before_last_message_at is null) <> (p_before_id is null)
  then
    raise using message = 'invalid_input';
  end if;

  if not public.whatsapp_inbox_read_allowed(p_actor_profile_id, p_company_id) then
    raise using message = 'forbidden';
  end if;

  return query
    select
      conv.id,
      conv.last_message_at,
      stats.total,
      contact.pii_ciphertext,
      contact.pii_ref,
      contact.pii_key_version,
      last_message.connection_id,
      last_message.message_type,
      last_message.message_id_hash,
      last_message.content_ciphertext,
      last_message.content_key_version
    from public.whatsapp_conversations conv
    join public.whatsapp_contacts contact
      on contact.company_id = conv.company_id
     and contact.id = conv.contact_id
    join lateral (
      select m.connection_id, m.message_type, m.message_id_hash, m.content_ciphertext, m.content_key_version
      from public.whatsapp_messages m
      where m.conversation_id = conv.id
        and m.company_id = conv.company_id
      order by m.occurred_at desc, m.received_at desc, m.id desc
      limit 1
    ) last_message on true
    join lateral (
      select count(*) as total
      from public.whatsapp_messages m
      where m.conversation_id = conv.id
        and m.company_id = conv.company_id
    ) stats on true
    where conv.company_id = p_company_id
      and (
        p_before_last_message_at is null
        or (conv.last_message_at, conv.id) < (p_before_last_message_at, p_before_id)
      )
    order by conv.last_message_at desc, conv.id desc
    limit p_limit;
end;
$$;

-- ── mensagens de uma conversa, da mais recente para a mais antiga ─────────
-- O WhatsApp informa o horário em segundos: received_at desempata mensagens do
-- mesmo segundo, para que a conversa apareça na ordem de chegada.
create function public.whatsapp_inbox_list_messages(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_conversation_id uuid,
  p_limit integer default 50,
  p_before_occurred_at timestamptz default null,
  p_before_received_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  out_message_id uuid,
  out_connection_id uuid,
  out_message_type text,
  out_message_id_hash text,
  out_content_ciphertext text,
  out_content_key_version smallint,
  out_occurred_at timestamptz,
  out_received_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_profile_id is null or p_company_id is null or p_conversation_id is null
    or p_limit is null or p_limit not between 1 and 100
    or (p_before_occurred_at is null) <> (p_before_id is null)
    or (p_before_received_at is null) <> (p_before_id is null)
  then
    raise using message = 'invalid_input';
  end if;

  if not public.whatsapp_inbox_read_allowed(p_actor_profile_id, p_company_id) then
    raise using message = 'forbidden';
  end if;

  -- Conversa de outra empresa e conversa inexistente têm a mesma resposta.
  if not exists (
    select 1
    from public.whatsapp_conversations conv
    where conv.company_id = p_company_id
      and conv.id = p_conversation_id
  ) then
    raise using message = 'conversation_not_found';
  end if;

  return query
    select
      m.id,
      m.connection_id,
      m.message_type,
      m.message_id_hash,
      m.content_ciphertext,
      m.content_key_version,
      m.occurred_at,
      m.received_at
    from public.whatsapp_messages m
    where m.company_id = p_company_id
      and m.conversation_id = p_conversation_id
      and (
        p_before_id is null
        or (m.occurred_at, m.received_at, m.id) < (p_before_occurred_at, p_before_received_at, p_before_id)
      )
    order by m.occurred_at desc, m.received_at desc, m.id desc
    limit p_limit;
end;
$$;

-- ── privilégios ───────────────────────────────────────────────────────────
revoke all on function public.whatsapp_inbox_read_allowed(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.whatsapp_inbox_list_conversations(uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.whatsapp_inbox_list_messages(uuid, uuid, uuid, integer, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;

grant execute on function public.whatsapp_inbox_list_conversations(uuid, uuid, integer, timestamptz, uuid)
  to service_role;
grant execute on function public.whatsapp_inbox_list_messages(uuid, uuid, uuid, integer, timestamptz, timestamptz, uuid)
  to service_role;

reset lock_timeout;
