-- META-P4A — consulta de ownership metadata-only por page_id, usada antes da
-- subscription para não tocar em uma Page já conectada a outra company.
-- Não retorna ciphertext, key version, scopes, nome, auditoria nem segredo.
-- Somente service_role recebe EXECUTE. Tabela continua sem grant direto.

create or replace function public.meta_connection_owner_by_page(p_page_id text)
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
      and i.status = 'connected';
end;
$$;

revoke all on function public.meta_connection_owner_by_page(text) from public, anon, authenticated;
grant execute on function public.meta_connection_owner_by_page(text) to service_role;
