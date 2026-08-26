-- SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — leitura operacional
-- company-wide para Super Admin contextual em Tasks/Visits/Deals.
-- PRECHECK: SUPER-ADMIN-COMPANY-CONTEXT-V2-READ-A1 (COMPLETE).
--
-- READ ONLY: nenhuma mutation nova, nenhuma RLS alterada em
-- tasks/visits/deals (Manager/Seller continuam usando SELECT direto +
-- tasks_select/visits_select/deals_select, exatamente como hoje —
-- PRECHECK §5/§11/§12 do EXEC: "Manager e Seller NÃO devem passar a usar
-- as novas RPCs sem necessidade"). As 3 RPCs abaixo são o bridge
-- EXCLUSIVO do Super Admin contextual (/company/[id]).
--
-- ═══════════════════════════════════════════════════════════════════════
-- 1) _resolve_commercial_read_company(p_company_id) — autoridade ÚNICA
--    compartilhada pelas 3 RPCs (§3/§4/§12 do EXEC: nunca duplicar
--    is_platform_super_admin()/can_access_company()/membership resolution
--    três vezes). READ ONLY — nunca cria estado de sessão, nunca
--    set_config, nunca "active company" persistida no servidor (mesmo
--    princípio já congelado desde o M1-F E0 contra
--    super_admin_active_company/select_active_company()/
--    effective_company_id()).
--
--    Manager/Seller: empresa SEMPRE da própria membership real —
--    p_company_id é IGNORADO (nunca lido) para eles, mesmo contrato de
--    resolve_lead_mutation_context (nunca aceita company arbitrária de
--    quem já tem uma empresa própria).
--    Super Admin: p_company_id OBRIGATÓRIO, validado via
--    can_access_company() (que já nega 'cancelada' e já aceita
--    'suspensa' — mesma autoridade reaproveitada do V1, nunca uma
--    segunda regra de status).
--    Sem sessão: deny. Company inválida: can_access_company() já
--    resolve para false (não existe -> false).
--
--    Função INTERNA: sem grant a authenticated (§4/§36 do EXEC — só as 3
--    RPCs públicas abaixo são chamáveis pelo client; este resolver nunca
--    é invocado diretamente).
-- ═══════════════════════════════════════════════════════════════════════
begin;

create function public._resolve_commercial_read_company(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if public.is_platform_super_admin() then
    if p_company_id is null then
      raise invalid_parameter_value using message = 'company_required';
    end if;
    if not public.can_access_company(p_company_id) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
    return p_company_id;
  end if;

  v_company_id := public.current_membership_company_id();
  if v_company_id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  return v_company_id;
end;
$$;

revoke all on function public._resolve_commercial_read_company(uuid) from public;
revoke all on function public._resolve_commercial_read_company(uuid) from anon;
revoke all on function public._resolve_commercial_read_company(uuid) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2) list_platform_tasks_for_company — mesmo filtro de status='pending'
--    já aplicado por fetchPendingTaskRows (lib/tasks/remoteTaskRepository.ts)
--    e mesma ordenação (due_at asc, id asc) — paridade exata com o que a
--    tela Pendências já mostra para Manager/Seller, nunca "minhas
--    tarefas" (§4/§7 do EXEC — company-wide, sem filtro de responsável).
-- ═══════════════════════════════════════════════════════════════════════
create function public.list_platform_tasks_for_company(p_company_id uuid)
returns setof public.tasks
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
      from public.tasks t
     where t.company_id = v_company_id
       and t.status = 'pending'
     order by t.due_at asc, t.id asc;
end;
$$;

revoke all on function public.list_platform_tasks_for_company(uuid) from public;
revoke all on function public.list_platform_tasks_for_company(uuid) from anon;
revoke all on function public.list_platform_tasks_for_company(uuid) from authenticated;
grant execute on function public.list_platform_tasks_for_company(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) list_platform_visits_for_company — mesmo shape de
--    fetchVisibleVisitRows (sem filtro de status — a tela decide qual
--    subconjunto mostrar), mesma ordenação (scheduled_at asc, id asc).
-- ═══════════════════════════════════════════════════════════════════════
create function public.list_platform_visits_for_company(p_company_id uuid)
returns setof public.visits
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
      from public.visits v
     where v.company_id = v_company_id
     order by v.scheduled_at asc, v.id asc;
end;
$$;

revoke all on function public.list_platform_visits_for_company(uuid) from public;
revoke all on function public.list_platform_visits_for_company(uuid) from anon;
revoke all on function public.list_platform_visits_for_company(uuid) from authenticated;
grant execute on function public.list_platform_visits_for_company(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4) list_platform_deals_for_company — mesmo shape de
--    fetchVisibleDealRows (sem filtro de status), mesma ordenação
--    (created_at desc, id asc).
-- ═══════════════════════════════════════════════════════════════════════
create function public.list_platform_deals_for_company(p_company_id uuid)
returns setof public.deals
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
      from public.deals d
     where d.company_id = v_company_id
     order by d.created_at desc, d.id asc;
end;
$$;

revoke all on function public.list_platform_deals_for_company(uuid) from public;
revoke all on function public.list_platform_deals_for_company(uuid) from anon;
revoke all on function public.list_platform_deals_for_company(uuid) from authenticated;
grant execute on function public.list_platform_deals_for_company(uuid) to authenticated;

commit;
