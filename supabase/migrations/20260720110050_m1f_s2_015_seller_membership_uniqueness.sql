-- M1-F / Módulo 1 — m1f_s2_015: unicidade de sellers.membership_id
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §4.1
-- (Opção C: "cada membership tem seu próprio seller_id"), §6.3 (cadeia de
-- identidade leads.seller_id -> sellers -> company_memberships -> profiles,
-- cada elo não-destrutivo e estável), §7.4 (current_profile_seller_id
-- resolve um ÚNICO sellers.id por membership, sem LIMIT — assume 1:1
-- textualmente), §10.3 ("suspensa e reativada — só is_active muda": mesmo
-- seller, mesma membership, nenhuma linha nova) e §11 (offboard_seller
-- nunca cria um segundo seller para a mesma membership; sucessor, se
-- houver, é sempre um sellers.id de OUTRA membership já existente).
-- Depende de m1f_s2_01 (catch-up já deve ter rodado antes desta migration
-- — ver ordenação de timestamp: catch-up 110000 < esta 110050 < helpers
-- 110100).
--
-- Lacuna estrutural encontrada em auditoria adversarial: sellers.
-- membership_id (m1f_s1_01) nunca teve constraint UNIQUE — só a FK
-- composta sellers_membership_company_fk (garante mesma empresa) e o
-- trigger sellers_check_membership_consistency (garante role='seller' e
-- profile_id correspondente). Nenhum dos dois impede duas linhas de
-- sellers apontarem para a MESMA membership. O helper current_profile_
-- seller_id_for_company() (m1f_s2_02) já foi endurecido para falhar
-- fechado (retornar NULL) nesse cenário, mas isso é defesa de leitura —
-- não impede a escrita da inconsistência em si. Esta migration fecha a
-- lacuna na origem, no banco.
--
-- Falha alta (RAISE EXCEPTION) em vez de deduplicar: se já existir alguma
-- duplicidade em membership_id não nulo, não há como decidir com segurança
-- qual das duas linhas de sellers deveria "vencer" (ambas podem ter leads/
-- tarefas/vendas históricas referenciando seu id) — deduplicar
-- silenciosamente violaria a mesma garantia de não-destrutividade que a
-- cadeia de identidade do §6.3 exige. Se isso ocorrer, é uma decisão de
-- produto (qual seller.id é o correto, o que fazer com o histórico do
-- outro) fora do escopo desta migration.
--
-- UNIQUE comum (sem NULLS NOT DISTINCT): PostgreSQL trata cada NULL como
-- distinto de qualquer outro NULL por padrão em uma constraint UNIQUE —
-- múltiplas linhas de sellers com membership_id NULL continuam permitidas
-- durante a transição (mesmo motivo documentado em m1f_s1_01: seed.sql
-- ainda cria alguns sellers sem membership_id antes do catch-up cobri-los,
-- e o onboarding real de novos sellers é uma etapa futura, S4+).

begin;

-- ── validação: aborta se já existir duplicidade ──────────────────────────
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from (
      select membership_id
        from public.sellers
       where membership_id is not null
       group by membership_id
      having count(*) > 1
    ) d;
  if v_count > 0 then
    raise exception 'm1f_s2_015: % membership_id(s) referenciado(s) por mais de uma linha de sellers — nao e seguro adicionar UNIQUE sem decisao de produto sobre qual seller.id preservar', v_count;
  end if;
end $$;

-- ── unicidade ─────────────────────────────────────────────────────────────
alter table public.sellers
  add constraint sellers_membership_id_uidx unique (membership_id);

commit;
