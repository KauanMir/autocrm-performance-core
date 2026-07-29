-- M1-F S8-C2-C2-SELLERS-B1 — leitura estreita de Sellers operacionais para
-- o Seller picker comercial do Super Admin
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §36 (decisão
-- humana aprovada). Migration puramente aditiva — nenhuma tabela, coluna,
-- policy, grant de tabela ou RPC de mutation é alterada.
--
-- Bloqueio que esta RPC resolve: create_lead/assign_lead_seller exigem
-- p_seller_id = public.sellers.id (text, identidade independente de
-- profiles.id) — nenhuma fonte publicada (list_company_users/
-- list_inactive_company_users devolvem profile_id/membership_id, nunca
-- sellers.id) fornecia esse valor para o Super Admin; public.sellers não
-- tem RLS nem GRANT de SELECT para authenticated/anon (confirmado por
-- auditoria ao vivo antes desta migration).

begin;

-- ── list_platform_sellers_for_company(p_company_id) ─────────────────────
-- Somente leitura. Mesma matriz de status do S8-C2-C1 (preparação para
-- mutation, nunca leitura histórica solta): ativa/implantacao permitidas,
-- suspensa/cancelada negadas com company_read_only. Qualquer ator que não
-- seja Super Admin -> forbidden (Manager/Seller resolvem o próprio Seller
-- via current_profile_seller_id_for_company(), nunca precisam desta RPC).
create function public.list_platform_sellers_for_company(
  p_company_id uuid
) returns table (
  seller_id text,
  name      text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.company_status;
begin
  if not public.is_platform_super_admin() then
    raise exception 'forbidden';
  end if;
  if p_company_id is null then
    raise exception 'company_required';
  end if;

  select c.status into v_status
    from public.companies c
    where c.id = p_company_id;
  if v_status is null then
    raise exception 'company_not_found';
  end if;
  if v_status not in ('ativa', 'implantacao') then
    raise exception 'company_read_only';
  end if;

  -- Filtro de "Seller operacional": todas as condições abaixo precisam
  -- valer simultaneamente. sellers.is_active já é mantido em sincronia em
  -- todo ponto do ciclo de vida (suspend/reactivate/offboard/transfer/
  -- promoção-rebaixamento), mas a cadeia completa é checada de propósito
  -- (mesmo padrão defensivo de current_profile_seller_id_for_company,
  -- S2) — nunca confiança cega numa única coluna. profiles.role/
  -- profiles.seller_id legados nunca são lidos.
  return query
    select s.id, s.name
      from public.sellers s
      join public.company_memberships cm on cm.id = s.membership_id
      join public.profiles p on p.id = cm.profile_id
      where s.company_id = p_company_id
        and s.is_active
        and cm.company_id = p_company_id
        and cm.role = 'seller'
        and cm.is_active
        and cm.lifecycle_status = 'active'
        and p.is_active
      order by s.name, s.id;
end;
$$;

-- ── revoke/grant explícitos (mesma transação) ───────────────────────────
-- Nenhum SELECT novo em sellers/profiles/company_memberships — a RPC
-- continua sendo o único caminho, exatamente como as quatro RPCs do
-- S8-C2-B1.
revoke all on function public.list_platform_sellers_for_company(uuid) from public;
revoke all on function public.list_platform_sellers_for_company(uuid) from anon;
revoke all on function public.list_platform_sellers_for_company(uuid) from authenticated;
grant execute on function public.list_platform_sellers_for_company(uuid) to authenticated;

commit;
