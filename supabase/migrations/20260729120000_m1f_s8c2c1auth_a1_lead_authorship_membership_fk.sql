-- M1-F S8-C2-C1-AUTH-A1 — reaponta leads_created_by_fk/leads_updated_by_fk
-- para company_memberships (autoria empresarial por membership histórica)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §35 (decisões
-- humanas aprovadas na auditoria S8-C2-C1-AUTH-A0). Depende de todas as
-- migrations anteriores — nenhuma é alterada.
--
-- Risco corrigido: leads_created_by_fk/leads_updated_by_fk exigiam
-- profiles.company_id = leads.company_id para o autor — profiles.company_id
-- nunca é atualizado por transfer_membership (nem por nenhuma outra RPC
-- além de accept_invite, na criação inicial), então um Manager/Seller
-- transferido para uma nova empresa tinha create_lead/update_lead
-- corretamente autorizados pela membership real, mas rejeitados pela FK
-- antiga — reproduzido ao vivo antes desta migration.
--
-- Escopo estrito: SOMENTE as duas FKs. Nenhuma coluna adicionada/removida,
-- nenhuma RPC alterada, nenhuma policy tocada, nenhuma sincronização de
-- profiles.company_id, nenhuma membership artificial, nenhum backfill de
-- dados (a validação abaixo só FALHA fechado se encontrar incompatibilidade
-- — nunca corrige automaticamente).

begin;

-- ── 1. validação de dados preexistentes (falha fechado, sem PII) ────────
-- Todo created_by_profile_id/updated_by_profile_id não nulo precisa ter
-- uma linha correspondente em company_memberships(company_id, profile_id)
-- — a UNIQUE já existente desde o S1 garante que, se existir, é única.
do $$
declare
  v_bad_created int;
  v_bad_updated int;
begin
  select count(*)::int into v_bad_created
    from public.leads l
    where l.created_by_profile_id is not null
      and not exists (
        select 1 from public.company_memberships cm
        where cm.company_id = l.company_id
          and cm.profile_id = l.created_by_profile_id
      );

  select count(*)::int into v_bad_updated
    from public.leads l
    where l.updated_by_profile_id is not null
      and not exists (
        select 1 from public.company_memberships cm
        where cm.company_id = l.company_id
          and cm.profile_id = l.updated_by_profile_id
      );

  if v_bad_created > 0 or v_bad_updated > 0 then
    raise exception
      'authorship_membership_backfill_required: % lead(s) com created_by_profile_id sem membership correspondente, % lead(s) com updated_by_profile_id sem membership correspondente',
      v_bad_created, v_bad_updated;
  end if;
end $$;

-- ── 2. remove as FKs antigas (alvo: profiles(company_id, id)) ───────────

alter table public.leads drop constraint leads_created_by_fk;
alter table public.leads drop constraint leads_updated_by_fk;

-- ── 3. recria com os MESMOS nomes, novo alvo: company_memberships
--    (company_id, profile_id) — UNIQUE já existente desde o S1
--    (m1f_s1_01), não recriada aqui. ON DELETE RESTRICT (nunca SET NULL/
--    CASCADE): mesma política já usada por leads_company_seller_fk/
--    leads_company_stage_fk/sellers_membership_company_fk neste schema —
--    bloqueia hard delete de uma membership referenciada por qualquer
--    Lead. ON UPDATE permanece implícito (NO ACTION), idêntico às demais
--    FKs compostas de leads — company_id/profile_id de uma membership são
--    imutáveis após a criação (trigger de consistência do S1), a cláusula
--    nunca é exercitada na prática. MATCH SIMPLE (default, preservado):
--    company_id ou o profile_id nulos (Super Admin) nunca acionam a
--    checagem — nenhuma mudança de comportamento para Super Admin.
alter table public.leads
  add constraint leads_created_by_fk
  foreign key (company_id, created_by_profile_id)
  references public.company_memberships (company_id, profile_id)
  on delete restrict;

alter table public.leads
  add constraint leads_updated_by_fk
  foreign key (company_id, updated_by_profile_id)
  references public.company_memberships (company_id, profile_id)
  on delete restrict;

commit;
