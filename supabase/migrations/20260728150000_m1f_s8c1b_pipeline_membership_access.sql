-- M1-F S8-C1-B — migração das policies de pipeline_stages e da RPC de
-- reordenação para o modelo de company_memberships
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §30 (decisões
-- humanas aprovadas sobre a auditoria S8-C1-A0/S8-C1-A). Migration
-- puramente de policies/função — nenhuma tabela, coluna, índice,
-- constraint ou dado alterado; nenhuma RPC de leads tocada; nenhum
-- helper legado removido.
--
-- Decisão central (aprovada, não revisitada nesta migration): Super
-- Admin NÃO opera Pipeline de empresas clientes nesta fase. Por isso as
-- policies abaixo e a RPC deliberadamente NÃO usam is_manager_or_platform()
-- nem can_access_company() isoladamente (ambos autorizam Super Admin,
-- por design, para os casos em que isso é correto — não é o caso aqui).
-- A autorização combina:
--   1. current_membership_company_id() = company_id — contexto real de
--      MEMBERSHIP (nunca null para Super Admin seria coincidência; na
--      prática Super Admin nunca tem membership, então este lado nunca
--      é satisfeito para ele, por construção);
--   2. current_membership_role() = 'manager' (INSERT/UPDATE/reorder) —
--      nunca platform_role, nunca role legado;
--   3. can_access_company(company_id) — situação operacional real da
--      empresa (existe, não suspensa/cancelada), a mesma checagem já
--      usada por todo o M1-F desde o S11, aplicada aqui só como filtro
--      operacional ADICIONAL, nunca como autorização isolada suficiente.
--
-- reorder_pipeline_stages: assinatura preservada integralmente
-- (p_ordered_ids uuid[], sem p_company_id — decisão aprovada). Toda a
-- lógica de locks/validação/atomicidade já existente é preservada sem
-- alteração; só a resolução de empresa e a checagem de autorização
-- trocam de current_profile_company_id()/is_manager_or_admin() (legado)
-- para current_membership_company_id()/current_membership_role().
-- Mensagens de erro internas ('forbidden: manager/admin only',
-- 'no active profile for current user') preservadas literalmente —
-- getReorderStagesErrorMessage (lib/hooks/useReorderStages.ts) continua
-- classificando corretamente sem nenhuma alteração de TypeScript.

begin;

-- ── policies de pipeline_stages ──────────────────────────────────────────

drop policy if exists stages_select on public.pipeline_stages;
drop policy if exists stages_insert on public.pipeline_stages;
drop policy if exists stages_update on public.pipeline_stages;

create policy stages_select on public.pipeline_stages
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and public.can_access_company(company_id)
  );

create policy stages_insert on public.pipeline_stages
  for insert to authenticated
  with check (
    company_id = public.current_membership_company_id()
    and public.current_membership_role() = 'manager'
    and public.can_access_company(company_id)
  );

create policy stages_update on public.pipeline_stages
  for update to authenticated
  using (
    company_id = public.current_membership_company_id()
    and public.current_membership_role() = 'manager'
    and public.can_access_company(company_id)
  )
  with check (
    company_id = public.current_membership_company_id()
    and public.current_membership_role() = 'manager'
    and public.can_access_company(company_id)
  );

-- ── reorder_pipeline_stages: mesma assinatura, nova resolução de empresa
--    e autorização ────────────────────────────────────────────────────────

create or replace function public.reorder_pipeline_stages(p_ordered_ids uuid[])
returns setof public.pipeline_stages
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_membership_company_id();
  v_id uuid;
  v_idx int := 0;
  v_matching int;
  v_total int;
begin
  -- Contexto empresarial real obrigatório (membership ativa) — Super
  -- Admin nunca tem membership, por design, então v_company_id é sempre
  -- null para ele; nenhuma empresa artificial/implícita/primeira-
  -- disponível é atribuída. Mensagem preservada literalmente (fragmento
  -- reconhecido por getReorderStagesErrorMessage).
  if v_company_id is null then
    raise exception 'no active profile for current user';
  end if;
  if public.current_membership_role() <> 'manager' then
    raise exception 'forbidden: manager/admin only';
  end if;
  if not public.can_access_company(v_company_id) then
    raise exception 'forbidden: manager/admin only';
  end if;

  -- Validação explícita da entrada, antes de adquirir qualquer lock
  if p_ordered_ids is null or cardinality(p_ordered_ids) = 0 then
    raise exception 'ordered stage list cannot be null or empty';
  end if;
  if array_ndims(p_ordered_ids) <> 1 then
    raise exception 'ordered stage list must be one-dimensional';
  end if;

  -- Lock explícito, em ordem determinística, de todas as linhas da empresa
  perform 1 from public.pipeline_stages
    where company_id = v_company_id
    order by id
    for update;

  -- Validações pós-lock: todo id pertence à empresa, sem duplicatas
  -- (count(distinct) < cardinality detecta ids repetidos no array),
  -- e a lista é uma permutação COMPLETA dos estágios da empresa.
  select count(distinct s.id) into v_matching
    from public.pipeline_stages s
    where s.id = any(p_ordered_ids) and s.company_id = v_company_id;
  select count(*) into v_total
    from public.pipeline_stages
    where company_id = v_company_id;

  if v_matching <> cardinality(p_ordered_ids) then
    raise exception 'one or more stages do not belong to the current company (or duplicated ids)';
  end if;
  if v_matching <> v_total then
    raise exception 'ordered list must include every stage of the company';
  end if;

  foreach v_id in array p_ordered_ids loop
    update public.pipeline_stages
      set sort_order = v_idx
      where id = v_id and company_id = v_company_id;
    v_idx := v_idx + 1;
  end loop;

  return query
    select * from public.pipeline_stages
    where company_id = v_company_id
    order by sort_order;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, reaplicados pois
--    CREATE OR REPLACE preserva grants existentes — reafirmados aqui por
--    clareza de auditoria, mesmo padrão já usado em toda migration deste
--    projeto que recria uma função SECURITY DEFINER) ────────────────────

revoke all on function public.reorder_pipeline_stages(uuid[]) from public;
revoke all on function public.reorder_pipeline_stages(uuid[]) from anon;
revoke all on function public.reorder_pipeline_stages(uuid[]) from authenticated;

grant execute on function public.reorder_pipeline_stages(uuid[]) to authenticated;

commit;
