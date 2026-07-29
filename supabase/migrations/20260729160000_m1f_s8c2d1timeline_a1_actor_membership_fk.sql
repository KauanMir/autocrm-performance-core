-- M1-F S8-C2-D1-TIMELINE-AUTH-A1 — reaponta lead_timeline_actor_fk para
-- company_memberships (autoria empresarial da timeline por membership
-- histórica)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §39 (decisão
-- humana aprovada). Depende de todas as migrations anteriores — nenhuma é
-- alterada. Mesmo molde de 20260729120000_m1f_s8c2c1auth_a1_lead_
-- authorship_membership_fk.sql (que corrigiu leads_created_by_fk/
-- leads_updated_by_fk pelo mesmo motivo estrutural).
--
-- Risco corrigido, reproduzido ao vivo antes desta migration: lead_
-- timeline_actor_fk exigia profiles.company_id = lead_timeline_entries.
-- company_id para o ator — profiles.company_id nunca é atualizado por
-- transfer_membership (nem por nenhuma outra RPC além de accept_invite,
-- na criação inicial do profile), então um Manager/Seller transferido
-- para uma nova empresa tinha add_lead_timeline_entry corretamente
-- autorizado pela membership real (via resolve_lead_mutation_context,
-- S8-C2-C1), mas rejeitado pela FK antiga (23503).
--
-- Escopo estrito: SOMENTE esta FK. Nenhuma coluna adicionada/removida,
-- nenhuma RPC alterada (add_lead_timeline_entry já grava exatamente o
-- profile real do ator para Manager/Seller e NULL para Super Admin desde
-- o S8-C2-D1 — só o ALVO da integridade referencial muda), nenhuma
-- policy tocada, nenhuma sincronização de profiles.company_id, nenhuma
-- membership artificial, nenhum backfill de dados (a validação abaixo só
-- FALHA fechado se encontrar incompatibilidade — nunca corrige
-- automaticamente).

begin;

-- ── 1. validação de dados preexistentes (falha fechada, sem PII) ────────
-- Toda lead_timeline_entries.actor_profile_id não nula precisa ter uma
-- linha correspondente em company_memberships(company_id, profile_id) —
-- a UNIQUE já existente desde o S1 garante que, se existir, é única.
do $$
declare
  v_bad_actor int;
begin
  select count(*)::int into v_bad_actor
    from public.lead_timeline_entries t
    where t.actor_profile_id is not null
      and not exists (
        select 1 from public.company_memberships cm
        where cm.company_id = t.company_id
          and cm.profile_id = t.actor_profile_id
      );

  if v_bad_actor > 0 then
    raise exception
      'timeline_actor_membership_backfill_required: % entrada(s) de timeline com actor_profile_id sem membership correspondente',
      v_bad_actor;
  end if;
end $$;

-- ── 2. remove a FK antiga (alvo: profiles(company_id, id), ON DELETE SET
--    NULL) ──────────────────────────────────────────────────────────────

alter table public.lead_timeline_entries drop constraint lead_timeline_actor_fk;

-- ── 3. recria com o MESMO nome, novo alvo: company_memberships
--    (company_id, profile_id) — UNIQUE já existente desde o S1
--    (m1f_s1_01), não recriada aqui. ON DELETE RESTRICT (nunca SET NULL/
--    CASCADE): mesma política já usada por leads_created_by_fk/leads_
--    updated_by_fk (S8-C2-C1-AUTH-A1) e leads_company_seller_fk/leads_
--    company_stage_fk/sellers_membership_company_fk neste schema —
--    bloqueia hard delete de uma membership referenciada por qualquer
--    entrada de timeline. ON UPDATE permanece NO ACTION (idêntico ao
--    anterior e às demais FKs compostas do domínio) — company_id/
--    profile_id de uma membership são imutáveis após a criação (trigger
--    de consistência do S1), a cláusula nunca é exercitada na prática.
--    MATCH SIMPLE (default, preservado): company_id ou o actor_profile_id
--    nulos (Super Admin) nunca acionam a checagem — nenhuma mudança de
--    comportamento para Super Admin. actor_profile_id continua nullable
--    (coluna não tocada) e sem deferrability (idêntico ao anterior).
alter table public.lead_timeline_entries
  add constraint lead_timeline_actor_fk
  foreign key (company_id, actor_profile_id)
  references public.company_memberships (company_id, profile_id)
  on delete restrict;

commit;
