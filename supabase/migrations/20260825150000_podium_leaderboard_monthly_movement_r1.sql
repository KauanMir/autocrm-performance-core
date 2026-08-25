-- PODIUM-MOVEMENT-R1-B1-EXEC — reativa a seta de movimento real
-- (↑N) no Ranking completo. PRECHECK: PODIUM-MOVEMENT-R1-A1 (COMPLETE).
--
-- Nenhuma tabela nova (§28), nenhuma RPC nova (§29), nenhuma mudança de
-- RLS/grants em sales/visits/sellers/seller_competition_events (§9/§30).
-- Única alteração: list_company_seller_leaderboard ganha 2 colunas
-- agregadas (movement_positions_gained/movement_happened_at), calculadas
-- inteiramente dentro da própria função (SECURITY DEFINER), a partir de
-- seller_competition_events — que continua sem nenhum grant direto a
-- authenticated/anon (§9).
--
-- Semântica congelada (§2/§4/§5/§6/§11/§12/§13/§14 do EXEC, auditada no
-- PRECHECK):
--   - Movement = ÚLTIMA melhoria real de posição do Seller no MÊS OFICIAL
--     atual (companies.timezone), nunca soma de eventos, nunca o período
--     visual do Pódio (Hoje/7/15/30/Personalizado) — esse período continua
--     controlando só rank/sale_count/completed_visit_count, exatamente
--     como já fazia.
--   - Só eventos com competition_started=false contam (a primeira venda do
--     mês pode ranquear Sellers zerados sobre um critério técnico de
--     desempate que não representa uma subida competitiva real).
--   - source_type='sale' e 'visit' contam igualmente — a seta nunca expõe
--     a causa.
--   - seen_at é IRRELEVANTE aqui: movement é histórico, não inbox de
--     comemoração (list_my_unseen_competition_events continua sendo o
--     único lugar que filtra por seen_at, intocado nesta migration).
--   - Sem cleanup: eventos de meses anteriores continuam persistidos,
--     simplesmente saem do filtro de período do mês oficial corrente.
--
-- Privacy boundary (§8): a função nunca devolve event id/seen_at/
-- actor_profile_id/source_sale_id/source_visit_id/source_type/
-- related_seller_id/old_rank/new_rank brutos — só o delta já calculado
-- (positions_gained) e o timestamp do evento que o gerou. Mesmo Seller que
-- já enxerga sale_count/completed_visit_count/rank de todos os colegas
-- (nenhuma ampliação de superfície: um inteiro a mais no mesmo roster já
-- público dentro da empresa).
begin;

drop function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid);

create function public.list_company_seller_leaderboard(
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_company_id   uuid default null
)
returns table (
  seller_id                 text,
  seller_label               text,
  sale_count                 integer,
  completed_visit_count      integer,
  rank                       integer,
  movement_positions_gained  integer,
  movement_happened_at       timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id            uuid;
  v_status                 public.company_status;
  v_timezone                text;
  v_official_period_start  timestamptz;
  v_official_period_end    timestamptz;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_company_id is not null then
    if not (public.is_platform_super_admin() and public.can_access_company(p_company_id)) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
    v_company_id := p_company_id;
  else
    v_company_id := public.current_membership_company_id();
    if v_company_id is null then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise invalid_parameter_value using message = 'invalid_period';
  end if;

  select c.status, c.timezone into v_status, v_timezone
    from public.companies c
    where c.id = v_company_id;
  if v_status is distinct from 'ativa' then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- §6 do EXEC: mês oficial, SEMPRE independente de p_period_start/
  -- p_period_end (esses continuam só para rank/sale_count/
  -- completed_visit_count via _rank_company_sellers, sem mudança). Mesma
  -- fórmula timezone-aware já usada por register_sale/register_visit_result
  -- (_lock_company_and_resolve_official_period) — sem FOR UPDATE aqui
  -- porque esta função só lê, nunca deveria travar a linha da company só
  -- para exibir o Ranking.
  v_official_period_start := date_trunc('month', now() at time zone v_timezone) at time zone v_timezone;
  v_official_period_end   := (date_trunc('month', now() at time zone v_timezone) + interval '1 month') at time zone v_timezone;

  return query
  with movement as (
    -- §10/§12 do EXEC: 1 linha por seller_id = evento elegível mais
    -- recente do mês oficial corrente. competition_started=false
    -- estrutural (§5); positions_gained = old_rank - new_rank é sempre > 0
    -- aqui porque seller_competition_events só persiste new_rank < old_rank
    -- quando competition_started é false (constraint
    -- seller_competition_events_improvement_ck + condição de insert em
    -- register_sale/register_visit_result) — nunca 0, nunca negativo
    -- (§11), sem precisar de um WHERE extra para garantir isso.
    select distinct on (e.seller_id)
      e.seller_id,
      (e.old_rank - e.new_rank) as positions_gained,
      e.created_at as happened_at
      from public.seller_competition_events e
     where e.company_id = v_company_id
       and e.competition_started = false
       and e.created_at >= v_official_period_start
       and e.created_at <= v_official_period_end
     order by e.seller_id, e.created_at desc
  )
  select
    rc.seller_id,
    rc.seller_label,
    rc.sale_count,
    rc.completed_visit_count,
    rc.rank,
    m.positions_gained as movement_positions_gained,
    m.happened_at as movement_happened_at
    from public._rank_company_sellers(v_company_id, p_period_start, p_period_end) rc
    left join movement m on m.seller_id = rc.seller_id
   order by rc.rank;
end;
$$;

revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from public;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) to authenticated;

commit;
