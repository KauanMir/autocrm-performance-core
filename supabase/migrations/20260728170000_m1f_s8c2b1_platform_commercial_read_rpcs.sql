-- M1-F S8-C2-B1 — RPCs estreitas de leitura comercial para Super Admin
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §31/§32.
-- Migration puramente aditiva — cria 4 funções novas, não altera nenhuma
-- tabela, policy ou RPC existente (as 9 RPCs de mutation de leads,
-- reorder_pipeline_stages e as policies de pipeline_stages permanecem
-- exatamente como estão).
--
-- Nenhuma das 4 é RLS: são todas SECURITY DEFINER, validam
-- is_platform_super_admin() internamente (nunca confiam só no GRANT),
-- exigem empresa explícita (nunca inferida), e nunca escrevem em
-- audit_log (leitura não é ação auditável — decisão congelada em
-- §31.12: só mutation registra audit_log).

begin;

-- ── 1. list_commercial_companies() ──────────────────────────────────────
-- Lista TODAS as empresas comerciais (incluindo 'cancelada', que
-- useCompanies/companies_select_accessible excluem por design — motivo
-- pelo qual esta RPC não pode reaproveitar aquele caminho). Só id/name/
-- status — nada administrativo, nada de billing, nada de segredo.

create function public.list_commercial_companies()
returns table (
  id     uuid,
  name   text,
  status public.company_status
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_super_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select c.id, c.name, c.status
      from public.companies c
      order by
        case c.status
          when 'ativa'       then 1
          when 'implantacao' then 2
          when 'suspensa'    then 3
          when 'cancelada'   then 4
        end,
        c.name,
        c.id;
end;
$$;

-- ── 2. list_platform_leads_for_company(p_company_id, p_archived) ───────
-- Empresa SEMPRE explícita (nunca inferida, nunca "todas"). Leitura
-- histórica permitida em qualquer status (ativa/implantacao/suspensa/
-- cancelada) — a restrição de status é responsabilidade das RPCs de
-- MUTATION (S8-C2-C/D, ainda não implementadas), nunca desta leitura.
-- p_archived espelha exatamente o mesmo predicado já usado por
-- lib/leads/remoteRepository.ts (archived_at is null = ativo).

create function public.list_platform_leads_for_company(
  p_company_id uuid,
  p_archived   boolean default false
) returns setof public.leads
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_super_admin() then
    raise exception 'forbidden';
  end if;
  if p_company_id is null then
    raise exception 'company_required';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'company_not_found';
  end if;

  return query
    select *
      from public.leads l
      where l.company_id = p_company_id
        and (l.archived_at is not null) = p_archived
      order by l.created_at desc, l.id asc;
end;
$$;

-- ── 3. list_platform_lead_timeline(p_company_id, p_lead_id) ────────────
-- Ambos os parâmetros obrigatórios. Lead de OUTRA empresa usa o mesmo
-- erro de "não encontrado" que um lead genuinamente inexistente — nunca
-- revela que o lead existe em outra empresa (mesma disciplina já usada
-- por check_lead_phone_duplicate para não vazar contagem de duplicados).

create function public.list_platform_lead_timeline(
  p_company_id uuid,
  p_lead_id    uuid
) returns setof public.lead_timeline_entries
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_super_admin() then
    raise exception 'forbidden';
  end if;
  if p_company_id is null then
    raise exception 'company_required';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'company_not_found';
  end if;
  if p_lead_id is null then
    raise exception 'lead_required';
  end if;
  if not exists (
    select 1 from public.leads l
    where l.id = p_lead_id and l.company_id = p_company_id
  ) then
    raise exception 'lead_not_found';
  end if;

  return query
    select *
      from public.lead_timeline_entries te
      where te.lead_id = p_lead_id and te.company_id = p_company_id
      order by te.occurred_at desc, te.id asc;
end;
$$;

-- ── 4. list_pipeline_stages_for_company(p_company_id) ───────────────────
-- Somente leitura. NÃO altera stages_select/stages_insert/stages_update
-- (S8-C1-B, intocado) nem reorder_pipeline_stages — Super Admin continua
-- sem poder criar, editar ou reordenar etapas, mesmo depois desta RPC.

create function public.list_pipeline_stages_for_company(
  p_company_id uuid
) returns setof public.pipeline_stages
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_super_admin() then
    raise exception 'forbidden';
  end if;
  if p_company_id is null then
    raise exception 'company_required';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'company_not_found';
  end if;

  return query
    select *
      from public.pipeline_stages ps
      where ps.company_id = p_company_id
      order by ps.sort_order asc, ps.id asc;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────
-- Nenhum GRANT de SELECT novo em nenhuma tabela; nenhum EXECUTE para
-- anon/public; a validação de Super Admin acontece SEMPRE dentro da
-- função, nunca confiando só em quem tem EXECUTE.

revoke all on function public.list_commercial_companies() from public;
revoke all on function public.list_commercial_companies() from anon;
revoke all on function public.list_commercial_companies() from authenticated;
grant execute on function public.list_commercial_companies() to authenticated;

revoke all on function public.list_platform_leads_for_company(uuid, boolean) from public;
revoke all on function public.list_platform_leads_for_company(uuid, boolean) from anon;
revoke all on function public.list_platform_leads_for_company(uuid, boolean) from authenticated;
grant execute on function public.list_platform_leads_for_company(uuid, boolean) to authenticated;

revoke all on function public.list_platform_lead_timeline(uuid, uuid) from public;
revoke all on function public.list_platform_lead_timeline(uuid, uuid) from anon;
revoke all on function public.list_platform_lead_timeline(uuid, uuid) from authenticated;
grant execute on function public.list_platform_lead_timeline(uuid, uuid) to authenticated;

revoke all on function public.list_pipeline_stages_for_company(uuid) from public;
revoke all on function public.list_pipeline_stages_for_company(uuid) from anon;
revoke all on function public.list_pipeline_stages_for_company(uuid) from authenticated;
grant execute on function public.list_pipeline_stages_for_company(uuid) to authenticated;

commit;
