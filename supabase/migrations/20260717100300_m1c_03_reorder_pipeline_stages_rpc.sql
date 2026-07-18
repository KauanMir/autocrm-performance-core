-- M1-C / Módulo 1 — m1c_03: RPC reorder_pipeline_stages
-- Fonte: docs/M1-C-DESIGN.md (Revisão 4), §7.4, §6.2, §6.3.
-- Depende de m1c_01 (helpers endurecidos) e m1c_02 (tabela pipeline_stages,
-- incl. a unique DEFERRABLE de sort_order).
--
-- Escopo: única forma de alterar pipeline_stages.sort_order (a coluna está
-- fora do grant de UPDATE de authenticated — m1c_02). Transacional, com
-- lock explícito.
--
-- Mecânica de concorrência (precisa, sem promessas além do que o lock dá):
--   - chamadas DESTA MESMA RPC para a MESMA empresa adquirem os locks de
--     linha em ordem determinística (ORDER BY id), então entre si elas se
--     enfileiram: a segunda chamada aguarda o commit da primeira;
--   - depois do lock, a segunda revalida contra o estado já commitado e
--     aplica a própria ordem por cima — a última operação executada
--     prevalece (last-writer-wins, aceitável para reordenação de Kanban);
--   - transações EXTERNAS a esta RPC que adquiram locks nas mesmas linhas
--     em OUTRA ordem ainda podem causar deadlock — o ORDER BY id só
--     garante ordem consistente entre chamadas desta própria função;
--   - erros de deadlock (40P01) e de serialização (40001) devem ser
--     tratados pelo repository como falha RECUPERÁVEL (retry ou mensagem
--     de "tente novamente"), não como erro fatal;
--   - a unique (company_id, sort_order) DEFERRABLE INITIALLY DEFERRED
--     (m1c_02) só é verificada no commit, permitindo os estados
--     intermediários do laço dentro da transação da função.

begin;

create or replace function public.reorder_pipeline_stages(p_ordered_ids uuid[])
returns setof public.pipeline_stages
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_profile_company_id();
  v_id uuid;
  v_idx int := 0;
  v_matching int;
  v_total int;
begin
  -- Profile ativo obrigatório (helper retorna NULL para inativo — m1c_01)
  if v_company_id is null then
    raise exception 'no active profile for current user';
  end if;
  if not public.is_manager_or_admin() then
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

-- ── revoke/grant explícitos (mesma transação da criação, §6.3) ─────────
-- Assinatura completa: public.reorder_pipeline_stages(uuid[])

revoke all on function public.reorder_pipeline_stages(uuid[]) from public;
revoke all on function public.reorder_pipeline_stages(uuid[]) from anon;
revoke all on function public.reorder_pipeline_stages(uuid[]) from authenticated;

grant execute on function public.reorder_pipeline_stages(uuid[]) to authenticated;

commit;
