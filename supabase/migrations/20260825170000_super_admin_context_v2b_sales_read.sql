-- SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC — leitura operacional
-- company-wide para Super Admin contextual em Sales (Vendas/Resultados/
-- Funil comercial da Home). PRECHECK já concluído (mesma sessão de
-- SUPER-ADMIN-COMPANY-CONTEXT-V2-READ-A1).
--
-- READ ONLY: nenhuma mutation nova, nenhuma RLS alterada em sales (Manager/
-- Seller continuam usando SELECT direto + sales_select, exatamente como
-- hoje — mesmo princípio já aplicado em tasks/visits/deals no V2A). Esta
-- RPC é o bridge EXCLUSIVO do Super Admin contextual (/company/[id]).
--
-- Reutiliza _resolve_commercial_read_company (criado e validado no V2A,
-- migration 20260825160000) — nenhum resolver novo, nenhuma duplicação de
-- lógica de autorização.
--
-- ═══════════════════════════════════════════════════════════════════════
-- list_platform_sales_for_company — mesma ordenação de fetchVisibleSaleRows
-- (lib/sales/remoteRepository.ts): sold_at desc, id asc. Nenhum filtro por
-- status (Sale nasce final e imutável, sem sale_status — migration #54).
-- ═══════════════════════════════════════════════════════════════════════
begin;

create function public.list_platform_sales_for_company(p_company_id uuid)
returns setof public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  v_company_id := public._resolve_commercial_read_company(p_company_id);
  return query
    select *
      from public.sales s
     where s.company_id = v_company_id
     order by s.sold_at desc, s.id asc;
end;
$$;

revoke all on function public.list_platform_sales_for_company(uuid) from public;
revoke all on function public.list_platform_sales_for_company(uuid) from anon;
revoke all on function public.list_platform_sales_for_company(uuid) from authenticated;
grant execute on function public.list_platform_sales_for_company(uuid) to authenticated;

commit;
