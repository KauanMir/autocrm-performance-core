-- M1-F S8-C2-B1 — migração das policies SELECT de leads/lead_timeline_entries
-- para o modelo de company_memberships
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §31/§32 (decisões
-- humanas aprovadas sobre a reauditoria S8-C2-A1/correção de produto).
-- Migration puramente de policies — nenhuma tabela, coluna, índice,
-- constraint, RPC de mutation ou dado alterado.
--
-- Decisão central (aprovada, não revisitada nesta migration): Manager/
-- Seller continuam lendo Leads/timeline diretamente pelas tabelas,
-- protegidos por RLS derivada da membership — nenhuma RLS global de
-- Super Admin é criada aqui (§31.8/§31 do design). Autorização combina:
--   1. current_membership_company_id() = company_id — contexto real de
--      MEMBERSHIP (nunca satisfeito para Super Admin, que nunca tem
--      membership, por design);
--   2. status da empresa EXATAMENTE 'ativa' — checagem inline, NUNCA
--      via can_access_company()/is_manager_or_platform() isoladamente
--      (ambos aceitam 'implantacao' também, que a nova matriz de Leads
--      nega especificamente para Manager/Seller, diferente do contrato
--      já aprovado para Pipeline no S8-C1-B, que não é alterado por
--      esta migration);
--   3. current_membership_role() — 'manager' vê tudo da empresa
--      (incluindo arquivados, comportamento já existente preservado);
--      'seller' só o próprio lead (via
--      current_profile_seller_id_for_company(company_id), nunca
--      profiles.seller_id), e nunca arquivado.
--
-- Super Admin lerá Leads/timeline exclusivamente por RPCs estreitas
-- (migration seguinte, 20260728170000) — não por SELECT direto.

begin;

-- ── leads_select ──────────────────────────────────────────────────────

drop policy if exists leads_select on public.leads;

create policy leads_select on public.leads
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and exists (
      select 1 from public.companies c
      where c.id = leads.company_id and c.status = 'ativa'
    )
    and (
      public.current_membership_role() = 'manager'
      or (
        public.current_membership_role() = 'seller'
        and archived_at is null
        and seller_id = public.current_profile_seller_id_for_company(leads.company_id)
      )
    )
  );

-- ── lead_timeline_select ─────────────────────────────────────────────
-- Mesma estrutura já usada antes desta migration (EXISTS contra leads,
-- nunca uma policy independente da visibilidade do lead) — só troca os
-- helpers legados pelos novos, preservando a garantia "timeline nunca
-- amplia acesso além do que o lead já autoriza".

drop policy if exists lead_timeline_select on public.lead_timeline_entries;

create policy lead_timeline_select on public.lead_timeline_entries
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and exists (
      select 1 from public.companies c
      where c.id = lead_timeline_entries.company_id and c.status = 'ativa'
    )
    and exists (
      select 1 from public.leads l
      where l.id = lead_timeline_entries.lead_id
        and l.company_id = lead_timeline_entries.company_id
        and (
          public.current_membership_role() = 'manager'
          or (
            public.current_membership_role() = 'seller'
            and l.archived_at is null
            and l.seller_id = public.current_profile_seller_id_for_company(lead_timeline_entries.company_id)
          )
        )
    )
  );

commit;
