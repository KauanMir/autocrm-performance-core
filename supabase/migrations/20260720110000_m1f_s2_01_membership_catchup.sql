-- M1-F / Módulo 1 — m1f_s2_01: catch-up backfill de company_memberships e
-- sellers.membership_id
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §5.4,
-- §6.2, §6.3, §16 (S2). Depende de m1f_s1_01/m1f_s1_02.
--
-- Esta é a PRIMEIRA operação relevante do S2, de propósito: cobre qualquer
-- profile/seller criado depois da migration de backfill do S1
-- (m1f_s1_02) — seja pelo seed local (que roda depois de TODAS as
-- migrations) seja por qualquer criação legada no remoto durante a janela
-- S1→S2 (documentada em m1f_s1_02). Roda ANTES de qualquer helper desta
-- etapa depender de company_memberships — os 7 helpers de m1f_s2_02 só
-- existem depois deste catch-up já ter rodado, na mesma transação de
-- deploy. (Nota: uma RLS de leitura para company_memberships foi avaliada
-- para esta etapa e deliberadamente adiada — sem consumidor real ainda —
-- ver decisão registrada no relatório do S2; não há migration m1f_s2_03.)
--
-- Lógica IDÊNTICA à de m1f_s1_02 (mesmo mapeamento de role, mesma
-- idempotência via ON CONFLICT DO NOTHING, mesma escolha de is_active/
-- joined_at) — não é uma implementação paralela nem simplificada. Reexecutar
-- contra dados já cobertos é seguro e não duplica nada.

begin;

-- ── diagnóstico: profile sem company_id não recebe membership ───────────
do $$
declare
  v_orphan record;
begin
  for v_orphan in
    select id, email from public.profiles where company_id is null
  loop
    raise notice 'm1f_s2_01: profile % (%) sem company_id — nenhuma membership criada para ele', v_orphan.id, v_orphan.email;
  end loop;
end $$;

-- ── company_memberships a partir de profiles (catch-up) ──────────────────
-- Role desconhecida causa falha explícita: CASE do PL/pgSQL sem ELSE
-- levanta case_not_found automaticamente (mesmo raciocínio de m1f_s1_02).
do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null
  loop
    case v_profile.role
      when 'admin' then
        v_role := 'manager';
      when 'manager' then
        v_role := 'manager';
      when 'seller' then
        v_role := 'seller';
    end case;

    insert into public.company_memberships
      (company_id, profile_id, role, is_active, invited_at, joined_at)
    values
      (v_profile.company_id, v_profile.id, v_role, v_profile.is_active, null, v_profile.created_at)
    on conflict (company_id, profile_id) do nothing;
  end loop;
end $$;

-- ── sellers.membership_id a partir das memberships (catch-up) ───────────
update public.sellers s
set membership_id = cm.id
from public.company_memberships cm
where s.profile_id is not null
  and s.company_id is not null
  and cm.company_id = s.company_id
  and cm.profile_id = s.profile_id
  and cm.role = 'seller'
  and s.membership_id is null;

-- ═══════════════════════════════════════════════════════════════════════
-- VALIDAÇÕES PÓS-CATCH-UP — abortam a migration (RAISE EXCEPTION, não
-- NOTICE) se qualquer inconsistência crítica de autorização for
-- encontrada. Várias delas já são estruturalmente impossíveis pelas
-- constraints/triggers de m1f_s1_01 (unique, FK composta, triggers de
-- consistência) — revalidadas aqui mesmo assim, como defesa em
-- profundidade explícita, conforme exigido nesta etapa: não basta confiar
-- silenciosamente nas constraints já existentes.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  v_count int;
begin
  -- 1. profile com company_id válido, sem membership correspondente
  select count(*) into v_count
    from public.profiles p
    where p.company_id is not null
      and not exists (
        select 1 from public.company_memberships cm
        where cm.company_id = p.company_id and cm.profile_id = p.id
      );
  if v_count > 0 then
    raise exception 'm1f_s2_01: % profile(s) com company_id valido ainda sem membership apos o catch-up', v_count;
  end if;

  -- 2. seller elegível (profile_id e company_id preenchidos) sem membership_id
  select count(*) into v_count
    from public.sellers s
    where s.profile_id is not null
      and s.company_id is not null
      and s.membership_id is null;
  if v_count > 0 then
    raise exception 'm1f_s2_01: % seller(s) elegivel(is) ainda sem membership_id apos o catch-up', v_count;
  end if;

  -- 3. seller vinculado a membership de outro profile (defesa em
  --    profundidade — já impossível pelo trigger sellers_check_membership_
  --    consistency de m1f_s1_01)
  select count(*) into v_count
    from public.sellers s
    join public.company_memberships cm on cm.id = s.membership_id
    where s.profile_id is distinct from cm.profile_id;
  if v_count > 0 then
    raise exception 'm1f_s2_01: % seller(s) vinculados a membership de outro profile', v_count;
  end if;

  -- 4. seller vinculado a membership de outra empresa (defesa em
  --    profundidade — já impossível pela FK composta sellers_membership_
  --    company_fk de m1f_s1_01)
  select count(*) into v_count
    from public.sellers s
    join public.company_memberships cm on cm.id = s.membership_id
    where s.company_id is distinct from cm.company_id;
  if v_count > 0 then
    raise exception 'm1f_s2_01: % seller(s) vinculados a membership de outra empresa', v_count;
  end if;

  -- 5. seller vinculado a membership MANAGER (defesa em profundidade — já
  --    impossível pelo trigger de m1f_s1_01)
  select count(*) into v_count
    from public.sellers s
    join public.company_memberships cm on cm.id = s.membership_id
    where cm.role <> 'seller';
  if v_count > 0 then
    raise exception 'm1f_s2_01: % seller(s) vinculados a membership MANAGER', v_count;
  end if;

  -- 6. membership duplicada por (company_id, profile_id) (defesa em
  --    profundidade — já impossível por unique(company_id, profile_id))
  select count(*) into v_count
    from (
      select 1 from public.company_memberships
      group by company_id, profile_id having count(*) > 1
    ) d;
  if v_count > 0 then
    raise exception 'm1f_s2_01: memberships duplicadas detectadas para o mesmo par (company_id, profile_id)';
  end if;

  -- 7. mais de uma membership ATIVA para o mesmo profile (defesa em
  --    profundidade — já impossível pelo índice único parcial de
  --    m1f_s1_01)
  select count(*) into v_count
    from (
      select 1 from public.company_memberships
      where is_active
      group by profile_id having count(*) > 1
    ) d;
  if v_count > 0 then
    raise exception 'm1f_s2_01: profile(s) com mais de uma membership ATIVA detectado(s)';
  end if;

  -- 8. nenhum platform_role deve ter sido criado por esta migration —
  --    nenhuma promoção automática a SUPER_ADMIN em nenhum passo do S1/S2
  select count(*) into v_count
    from public.profiles where platform_role is not null;
  if v_count > 0 then
    raise exception 'm1f_s2_01: % profile(s) com platform_role preenchido — nenhuma promocao deveria ter ocorrido', v_count;
  end if;
end $$;

commit;
