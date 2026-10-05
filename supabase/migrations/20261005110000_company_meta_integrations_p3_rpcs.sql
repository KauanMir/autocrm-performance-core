-- META-PERSISTENCE-P3 — RPCs estreitas de acesso a company_meta_integrations.
-- Somente service_role recebe EXECUTE. Estas funções NÃO decidem quem é
-- Super Admin nem qual company é a de teste: a autorização (feature flag,
-- Super Admin, company de teste) é da aplicação server-side, antes de chamar.
-- Owner = postgres (dono da tabela); SECURITY DEFINER com search_path vazio
-- e referências qualificadas. Falha em qualquer ponto = rollback completo.

create or replace function public.meta_connection_upsert(
  p_company_id uuid,
  p_page_id text,
  p_page_name text,
  p_access_token_ciphertext text,
  p_token_key_version smallint,
  p_granted_scopes text[],
  p_connected_at timestamptz,
  p_connected_by uuid,
  p_leadgen_subscribed_at timestamptz
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
  c_allowed_scopes constant text[] := array['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'];
begin
  if p_company_id is null
    or p_page_id is null or p_page_id !~ '^[0-9]{1,30}$'
    or p_access_token_ciphertext is null or char_length(p_access_token_ciphertext) not between 1 and 4096
    or p_token_key_version is null or p_token_key_version < 1
    or p_connected_at is null
    or p_granted_scopes is null or cardinality(p_granted_scopes) not between 1 and 3
    or not (p_granted_scopes <@ c_allowed_scopes)
  then
    raise using message = 'invalid_input';
  end if;

  begin
    insert into public.company_meta_integrations as i (
      company_id, page_id, page_name, access_token_ciphertext, token_key_version,
      granted_scopes, status, connected_at, connected_by, leadgen_subscribed_at,
      disconnected_at, last_error_code, last_error_at
    ) values (
      p_company_id, p_page_id, p_page_name, p_access_token_ciphertext, p_token_key_version,
      p_granted_scopes, 'connected', p_connected_at, p_connected_by, p_leadgen_subscribed_at,
      null, null, null
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
     'success', null, null, jsonb_build_object('page_id', v_row.page_id, 'status', v_row.status), 'rpc');

  return query select v_row.id, v_row.company_id, v_row.page_id, v_row.page_name, v_row.status,
                      v_row.connected_at, v_row.leadgen_subscribed_at;
end;
$$;

create or replace function public.meta_connection_status(p_company_id uuid)
returns table (
  id uuid,
  company_id uuid,
  page_id text,
  page_name text,
  status text,
  granted_scopes text[],
  connected_at timestamptz,
  leadgen_subscribed_at timestamptz,
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
    select i.id, i.company_id, i.page_id, i.page_name, i.status, i.granted_scopes,
           i.connected_at, i.leadgen_subscribed_at, i.disconnected_at,
           i.last_error_code, i.last_error_at, i.updated_at
    from public.company_meta_integrations i
    where i.company_id = p_company_id
    order by i.page_id;
end;
$$;

create or replace function public.meta_connection_lookup_by_page(p_page_id text)
returns table (
  integration_id uuid,
  company_id uuid,
  page_id text,
  status text,
  access_token_ciphertext text,
  token_key_version smallint
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
    select i.id, i.company_id, i.page_id, i.status, i.access_token_ciphertext, i.token_key_version
    from public.company_meta_integrations i
    where i.page_id = p_page_id
      and i.status = 'connected';
end;
$$;

revoke all on function public.meta_connection_upsert(uuid, text, text, text, smallint, text[], timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.meta_connection_status(uuid) from public, anon, authenticated;
revoke all on function public.meta_connection_lookup_by_page(text) from public, anon, authenticated;

grant execute on function public.meta_connection_upsert(uuid, text, text, text, smallint, text[], timestamptz, uuid, timestamptz)
  to service_role;
grant execute on function public.meta_connection_status(uuid) to service_role;
grant execute on function public.meta_connection_lookup_by_page(text) to service_role;
