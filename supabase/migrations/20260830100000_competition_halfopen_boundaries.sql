-- COMPETITION-BOUNDARY-HALFOPEN-B1-EXEC — janelas temporais da competição
-- passam a ser SEMI-ABERTAS: [period_start, period_end).
--
--   period_start : INCLUSIVO  (t >= period_start)
--   period_end   : EXCLUSIVO  (t <  period_end)
--
-- period_end continua sendo o INÍCIO do mês/período seguinte
-- (_lock_company_and_resolve_official_period NÃO muda). Só a
-- interpretação nos consumidores muda: um evento exatamente em
-- period_end pertence unicamente ao período seguinte — nunca aos dois.
--
-- Escopo: Competition V2 (ranking ao vivo), Podium/movement, Competition
-- Events e a finalização de Rewards. NÃO toca KPI Reports
-- (get_company_management_report já tem contrato próprio [start,end)),
-- NÃO reescreve eventos/vendas/snapshots existentes, NÃO faz backfill.
-- Apenas CREATE OR REPLACE de funções existentes, mesma assinatura.
begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1) _rank_company_sellers — ranking AO VIVO. sold_at / closed_at /
--    created_at do fim do período passam de "<=" para "<".
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._rank_company_sellers(
  p_company_id uuid,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone
)
returns setof public.seller_rank_row
language sql
stable security definer
set search_path to ''
as $fn$
  with roster as (
    select s.id, s.name
      from public.sellers s
     where s.company_id = p_company_id
       and s.is_active
  ),
  sales_agg as (
    select sa.assigned_seller_id as id,
           count(*)::int as sale_count,
           max(sa.sold_at) as last_sale_at
      from public.sales sa
     where sa.company_id = p_company_id
       and sa.sold_at >= p_period_start
       and sa.sold_at <  p_period_end
     group by sa.assigned_seller_id
  ),
  visits_agg as (
    select v.assigned_seller_id as id,
           count(*)::int as completed_visit_count
      from public.visits v
     where v.company_id = p_company_id
       and v.status = 'completed'
       and v.closed_at >= p_period_start
       and v.closed_at <  p_period_end
     group by v.assigned_seller_id
  ),
  scheduled_agg as (
    -- §2/§3/§13 — "agendamentos gerados no período": visits.created_at no
    -- período competitivo, por assigned_seller_id, SEM filtro de status.
    -- Janela SEMI-ABERTA [start,end), igual aos outros dois critérios.
    select v.assigned_seller_id as id,
           count(*)::int as scheduled_visit_count
      from public.visits v
     where v.company_id = p_company_id
       and v.created_at >= p_period_start
       and v.created_at <  p_period_end
     group by v.assigned_seller_id
  ),
  ranked as (
    select
      r.id   as seller_id,
      r.name as seller_label,
      coalesce(sa.sale_count, 0)::int as sale_count,
      coalesce(va.completed_visit_count, 0)::int as completed_visit_count,
      coalesce(sc.scheduled_visit_count, 0)::int as scheduled_visit_count,
      (row_number() over (
         order by
           coalesce(sa.sale_count, 0) desc,
           coalesce(va.completed_visit_count, 0) desc,
           coalesce(sc.scheduled_visit_count, 0) desc,
           sa.last_sale_at asc nulls last,
           r.name asc,
           r.id asc
       ))::int as rank
      from roster r
      left join sales_agg sa on sa.id = r.id
      left join visits_agg va on va.id = r.id
      left join scheduled_agg sc on sc.id = r.id
  )
  select seller_id, seller_label, sale_count, completed_visit_count, scheduled_visit_count, rank
    from ranked
   order by rank;
$fn$;

revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from public;
revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from anon;
revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2) _rank_company_sellers_snapshot — ranking do SNAPSHOT histórico.
--    MESMA semântica [start,end) do ranking ao vivo (§4). Roster estendido
--    inalterado.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._rank_company_sellers_snapshot(
  p_company_id uuid,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone
)
returns setof public.seller_rank_row
language sql
stable security definer
set search_path to ''
as $fn$
  with roster as (
    select s.id, s.name
      from public.sellers s
     where s.company_id = p_company_id
       and (
         s.is_active
         or exists (
           select 1 from public.sales sa
            where sa.company_id = p_company_id
              and sa.assigned_seller_id = s.id
              and sa.sold_at >= p_period_start
              and sa.sold_at <  p_period_end
         )
         or exists (
           select 1 from public.visits v
            where v.company_id = p_company_id
              and v.assigned_seller_id = s.id
              and v.created_at >= p_period_start
              and v.created_at <  p_period_end
         )
         or exists (
           select 1 from public.visits v
            where v.company_id = p_company_id
              and v.assigned_seller_id = s.id
              and v.status = 'completed'
              and v.closed_at is not null
              and v.closed_at >= p_period_start
              and v.closed_at <  p_period_end
         )
       )
  ),
  sales_agg as (
    select sa.assigned_seller_id as id,
           count(*)::int as sale_count,
           max(sa.sold_at) as last_sale_at
      from public.sales sa
     where sa.company_id = p_company_id
       and sa.sold_at >= p_period_start
       and sa.sold_at <  p_period_end
     group by sa.assigned_seller_id
  ),
  visits_agg as (
    select v.assigned_seller_id as id,
           count(*)::int as completed_visit_count
      from public.visits v
     where v.company_id = p_company_id
       and v.status = 'completed'
       and v.closed_at >= p_period_start
       and v.closed_at <  p_period_end
     group by v.assigned_seller_id
  ),
  scheduled_agg as (
    select v.assigned_seller_id as id,
           count(*)::int as scheduled_visit_count
      from public.visits v
     where v.company_id = p_company_id
       and v.created_at >= p_period_start
       and v.created_at <  p_period_end
     group by v.assigned_seller_id
  ),
  ranked as (
    select
      r.id   as seller_id,
      r.name as seller_label,
      coalesce(sa.sale_count, 0)::int as sale_count,
      coalesce(va.completed_visit_count, 0)::int as completed_visit_count,
      coalesce(sc.scheduled_visit_count, 0)::int as scheduled_visit_count,
      (row_number() over (
         order by
           coalesce(sa.sale_count, 0) desc,
           coalesce(va.completed_visit_count, 0) desc,
           coalesce(sc.scheduled_visit_count, 0) desc,
           sa.last_sale_at asc nulls last,
           r.name asc,
           r.id asc
       ))::int as rank
      from roster r
      left join sales_agg sa on sa.id = r.id
      left join visits_agg va on va.id = r.id
      left join scheduled_agg sc on sc.id = r.id
  )
  select seller_id, seller_label, sale_count, completed_visit_count, scheduled_visit_count, rank
    from ranked
   order by rank;
$fn$;

revoke all on function public._rank_company_sellers_snapshot(uuid, timestamptz, timestamptz) from public;
revoke all on function public._rank_company_sellers_snapshot(uuid, timestamptz, timestamptz) from anon;
revoke all on function public._rank_company_sellers_snapshot(uuid, timestamptz, timestamptz) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) register_sale — guard mensal de competition_started: a "primeira
--    venda do mês" passa a ignorar uma venda que caia exatamente em
--    period_end (ela pertence ao próximo mês).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.register_sale(
  p_deal_id uuid,
  p_expected_version integer,
  p_sold_value_cents bigint,
  p_payment_method public.deal_payment_method
)
returns public.deals
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_ctx                 record;
  v_deal                public.deals;
  v_row                 public.deals;
  v_period              record;
  v_competition_started boolean;
  v_old_ranking         public.seller_rank_row[];
  v_new_ranking         public.seller_rank_row[];
  v_old_rank            integer;
  v_new_rank            integer;
  v_new_sale_count      integer;
  v_related_seller_id   text;
  v_sale_id             uuid;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  if p_sold_value_cents is null or p_sold_value_cents <= 0 then
    raise exception 'invalid_value';
  end if;

  if p_payment_method is null then
    raise exception 'invalid_payment_method';
  end if;

  select * into v_period from public._lock_company_and_resolve_official_period(v_ctx.resolved_company_id);

  select d.* into v_deal
    from public.deals d
    where d.id = p_deal_id and d.company_id = v_ctx.resolved_company_id
    for update;
  if v_deal.id is null then
    raise exception 'deal_not_found';
  end if;

  if v_ctx.actor_kind = 'seller' and v_deal.assigned_seller_id is distinct from v_ctx.actor_seller_id then
    raise exception 'forbidden';
  end if;

  if v_deal.status <> 'open' then
    raise exception 'deal_closed';
  end if;

  v_competition_started := not exists (
    select 1 from public.sales sa
     where sa.company_id = v_ctx.resolved_company_id
       and sa.sold_at >= v_period.period_start
       and sa.sold_at <  v_period.period_end
  );

  select coalesce(array_agg(r), '{}') into v_old_ranking
    from public._rank_company_sellers(v_ctx.resolved_company_id, v_period.period_start, v_period.period_end) r;

  select x.rank into v_old_rank
    from unnest(v_old_ranking) x
    where x.seller_id = v_deal.assigned_seller_id;

  insert into public.sales (
    company_id, deal_id, lead_id, assigned_seller_id,
    sold_value_cents, payment_method, sold_by
  ) values (
    v_deal.company_id, v_deal.id, v_deal.lead_id, v_deal.assigned_seller_id,
    p_sold_value_cents, p_payment_method, v_ctx.actor_profile_id
  )
  returning id into v_sale_id;

  update public.deals
    set status     = 'sold',
        updated_by = v_ctx.actor_profile_id
    where id = p_deal_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status = 'open'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  select coalesce(array_agg(r), '{}') into v_new_ranking
    from public._rank_company_sellers(v_ctx.resolved_company_id, v_period.period_start, v_period.period_end) r;

  select x.rank, x.sale_count into v_new_rank, v_new_sale_count
    from unnest(v_new_ranking) x
    where x.seller_id = v_deal.assigned_seller_id;

  if v_old_rank is not null and v_new_rank is not null
     and (v_new_rank < v_old_rank or v_competition_started) then
    v_related_seller_id := null;
    if not v_competition_started then
      select x.seller_id into v_related_seller_id
        from unnest(v_old_ranking) x
        where x.rank = v_new_rank and x.seller_id is distinct from v_deal.assigned_seller_id;
    end if;

    insert into public.seller_competition_events (
      company_id, seller_id, actor_profile_id, source_type, source_sale_id, event_type,
      old_rank, new_rank, sale_count, related_seller_id,
      competition_started, period_start, period_end
    ) values (
      v_ctx.resolved_company_id, v_deal.assigned_seller_id, v_ctx.actor_profile_id, 'sale', v_sale_id, 'rank_up',
      v_old_rank, v_new_rank, coalesce(v_new_sale_count, 0), v_related_seller_id,
      v_competition_started, v_period.period_start, v_period.period_end
    );
  end if;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_deal.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'trophy', '#E8CE72', 'Venda registrada', null);

  return v_row;
end;
$fn$;

revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from public;
revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from anon;
revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from authenticated;
grant execute on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4) register_visit_result — guard v_has_sales_this_month: uma venda
--    exatamente em period_end não faz o mês anterior "ter competição".
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.register_visit_result(
  p_id uuid,
  p_expected_version integer,
  p_outcome public.visit_outcome,
  p_result_note text default ''::text
)
returns public.visits
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_ctx                  record;
  v_visit                 public.visits;
  v_row                   public.visits;
  v_label text;
  v_icon  text;
  v_color text;
  v_period                record;
  v_has_sales_this_month  boolean;
  v_old_ranking           public.seller_rank_row[];
  v_new_ranking           public.seller_rank_row[];
  v_old_rank              integer;
  v_new_rank              integer;
  v_new_sale_count        integer;
  v_related_seller_id     text;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select v.* into v_visit
    from public.visits v
    where v.id = p_id and v.company_id = v_ctx.resolved_company_id;
  if v_visit.id is null then
    raise exception 'visit_not_found';
  end if;

  if v_ctx.actor_kind = 'seller' and v_visit.assigned_seller_id is distinct from v_ctx.actor_seller_id then
    raise exception 'forbidden';
  end if;

  if v_visit.status in ('completed', 'canceled') then
    raise exception 'visit_closed';
  end if;

  select * into v_period from public._lock_company_and_resolve_official_period(v_ctx.resolved_company_id);

  select exists (
    select 1 from public.sales sa
     where sa.company_id = v_ctx.resolved_company_id
       and sa.sold_at >= v_period.period_start
       and sa.sold_at <  v_period.period_end
  ) into v_has_sales_this_month;

  if v_has_sales_this_month then
    select coalesce(array_agg(r), '{}') into v_old_ranking
      from public._rank_company_sellers(v_ctx.resolved_company_id, v_period.period_start, v_period.period_end) r;

    select x.rank into v_old_rank
      from unnest(v_old_ranking) x
      where x.seller_id = v_visit.assigned_seller_id;
  end if;

  update public.visits
    set status      = 'completed',
        outcome     = p_outcome,
        result_note = coalesce(p_result_note, ''),
        closed_at   = now(),
        closed_by   = v_ctx.actor_profile_id,
        updated_by  = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status in ('scheduled', 'confirmed')
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  if v_has_sales_this_month and v_old_rank is not null then
    select coalesce(array_agg(r), '{}') into v_new_ranking
      from public._rank_company_sellers(v_ctx.resolved_company_id, v_period.period_start, v_period.period_end) r;

    select x.rank, x.sale_count into v_new_rank, v_new_sale_count
      from unnest(v_new_ranking) x
      where x.seller_id = v_visit.assigned_seller_id;

    if v_new_rank is not null and v_new_rank < v_old_rank then
      select x.seller_id into v_related_seller_id
        from unnest(v_old_ranking) x
        where x.rank = v_new_rank and x.seller_id is distinct from v_visit.assigned_seller_id;

      insert into public.seller_competition_events (
        company_id, seller_id, actor_profile_id, source_type, source_visit_id, event_type,
        old_rank, new_rank, sale_count, related_seller_id,
        competition_started, period_start, period_end
      ) values (
        v_ctx.resolved_company_id, v_visit.assigned_seller_id, v_ctx.actor_profile_id, 'visit', v_row.id, 'rank_up',
        v_old_rank, v_new_rank, coalesce(v_new_sale_count, 0), v_related_seller_id,
        false, v_period.period_start, v_period.period_end
      );
    end if;
  end if;

  if v_visit.lead_id is not null then
    v_label := case p_outcome
      when 'sold'        then 'Visita: Fechou negócio'
      when 'negotiating' then 'Visita: Em negociação'
      when 'thinking'    then 'Visita: Vai pensar'
      when 'no_interest' then 'Visita: Sem interesse'
    end;
    v_icon := case p_outcome
      when 'sold'        then 'trophy'
      when 'negotiating' then 'handshake'
      when 'thinking'    then 'clock'
      when 'no_interest' then 'xCircle'
    end;
    v_color := case p_outcome
      when 'sold'        then '#E8CE72'
      when 'negotiating' then '#27C75F'
      when 'thinking'    then '#FFA31F'
      when 'no_interest' then '#8B8B93'
    end;
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, v_visit.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      v_icon, v_color, v_label, null);
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from public;
revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from anon;
revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from authenticated;
grant execute on function public.register_visit_result(uuid, integer, public.visit_outcome, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5) create_visit — guard v_has_sales_this_month: idem. A venda da
--    fronteira pertence ao NOVO mês, então um create_visit no novo mês
--    a enxerga como venda deste mês (não do anterior).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.create_visit(
  p_scheduled_at timestamp with time zone,
  p_vehicles text[],
  p_lead_id uuid default null::uuid,
  p_client_name text default null::text,
  p_assigned_seller_id text default null::text,
  p_note text default ''::text
)
returns public.visits
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_ctx                   record;
  v_seller                text;
  v_lead_seller           text;
  v_lead_archived         boolean;
  v_lead_found            boolean := false;
  v_row                   public.visits;
  v_period                record;
  v_has_sales_this_month  boolean;
  v_old_ranking           public.seller_rank_row[];
  v_new_ranking           public.seller_rank_row[];
  v_old_rank              integer;
  v_new_rank              integer;
  v_new_sale_count        integer;
  v_related_seller_id     text;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if not public.visits_vehicles_valid(p_vehicles) then
    raise exception 'invalid_vehicles';
  end if;

  if p_lead_id is not null then
    select l.seller_id, (l.archived_at is not null)
      into v_lead_seller, v_lead_archived
      from public.leads l
      where l.id = p_lead_id and l.company_id = v_ctx.resolved_company_id;
    if not found then
      raise exception 'lead_not_found';
    end if;
    if v_lead_archived then
      raise exception 'lead_archived';
    end if;
    v_lead_found := true;
  end if;

  if not v_lead_found and btrim(coalesce(p_client_name, '')) = '' then
    raise exception 'client_name_required';
  end if;

  if v_ctx.actor_kind = 'seller' then
    if p_assigned_seller_id is not null and p_assigned_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_ctx.actor_seller_id;
  else
    if p_assigned_seller_id is not null then
      perform 1 from public.sellers s
        where s.id = p_assigned_seller_id
          and s.company_id = v_ctx.resolved_company_id
          and s.is_active;
      if not found then
        raise exception 'seller_not_found';
      end if;
      v_seller := p_assigned_seller_id;
    elsif v_lead_found and v_lead_seller is not null then
      perform 1 from public.sellers s
        where s.id = v_lead_seller
          and s.company_id = v_ctx.resolved_company_id
          and s.is_active;
      if found then
        v_seller := v_lead_seller;
      else
        raise exception 'seller_required';
      end if;
    else
      raise exception 'seller_required';
    end if;
  end if;

  -- §19 — trava a company + mês oficial (mesmo helper de register_sale/
  -- register_visit_result), DEPOIS de toda a validação.
  select * into v_period from public._lock_company_and_resolve_official_period(v_ctx.resolved_company_id);

  -- §7/§19 — sem NENHUMA Sale no mês oficial, a disputa ainda não existe:
  -- Visit nunca gera evento nesse caso, e sequer calculamos old_rank.
  -- Janela SEMI-ABERTA: venda exatamente em period_end é do próximo mês.
  select exists (
    select 1 from public.sales sa
     where sa.company_id = v_ctx.resolved_company_id
       and sa.sold_at >= v_period.period_start
       and sa.sold_at <  v_period.period_end
  ) into v_has_sales_this_month;

  if v_has_sales_this_month then
    select coalesce(array_agg(r), '{}') into v_old_ranking
      from public._rank_company_sellers(v_ctx.resolved_company_id, v_period.period_start, v_period.period_end) r;

    select x.rank into v_old_rank
      from unnest(v_old_ranking) x
      where x.seller_id = v_seller;
  end if;

  insert into public.visits (
    company_id, lead_id, client_name, assigned_seller_id, vehicles,
    scheduled_at, note, created_by, updated_by
  ) values (
    v_ctx.resolved_company_id, p_lead_id,
    case when p_lead_id is null then p_client_name else null end,
    v_seller, p_vehicles, p_scheduled_at, coalesce(p_note, ''),
    v_ctx.actor_profile_id, v_ctx.actor_profile_id
  )
  returning * into v_row;

  -- §8/§19 — evento SOMENTE em melhora real. Nunca competition_started
  -- (conceito exclusivo de Sale). Guarda defensiva: old_rank NULL
  -- (beneficiário offboarded) ⇒ evento omitido.
  if v_has_sales_this_month and v_old_rank is not null then
    select coalesce(array_agg(r), '{}') into v_new_ranking
      from public._rank_company_sellers(v_ctx.resolved_company_id, v_period.period_start, v_period.period_end) r;

    select x.rank, x.sale_count into v_new_rank, v_new_sale_count
      from unnest(v_new_ranking) x
      where x.seller_id = v_seller;

    if v_new_rank is not null and v_new_rank < v_old_rank then
      select x.seller_id into v_related_seller_id
        from unnest(v_old_ranking) x
        where x.rank = v_new_rank and x.seller_id is distinct from v_seller;

      insert into public.seller_competition_events (
        company_id, seller_id, actor_profile_id, source_type, source_appointment_visit_id, event_type,
        old_rank, new_rank, sale_count, related_seller_id,
        competition_started, period_start, period_end
      ) values (
        v_ctx.resolved_company_id, v_seller, v_ctx.actor_profile_id, 'appointment', v_row.id, 'rank_up',
        v_old_rank, v_new_rank, coalesce(v_new_sale_count, 0), v_related_seller_id,
        false, v_period.period_start, v_period.period_end
      );
    end if;
  end if;

  if p_lead_id is not null then
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, p_lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      'calendar', '#E8CE72', 'Visita agendada', null);
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from public;
revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from anon;
revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from authenticated;
grant execute on function public.create_visit(timestamptz, text[], uuid, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6) list_company_seller_leaderboard — filtro de MOVEMENT do mês oficial:
--    um seller_competition_events exatamente em v_official_period_end
--    pertence ao movimento do PRÓXIMO mês, não deste. positive-only,
--    movement_positions_gained e movement_happened_at inalterados.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.list_company_seller_leaderboard(
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_company_id uuid default null::uuid
)
returns table (
  seller_id text,
  seller_label text,
  sale_count integer,
  completed_visit_count integer,
  scheduled_visit_count integer,
  rank integer,
  movement_positions_gained integer,
  movement_happened_at timestamp with time zone
)
language plpgsql
security definer
set search_path to ''
as $fn$
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

  v_official_period_start := date_trunc('month', now() at time zone v_timezone) at time zone v_timezone;
  v_official_period_end   := (date_trunc('month', now() at time zone v_timezone) + interval '1 month') at time zone v_timezone;

  return query
  with movement as (
    select distinct on (e.seller_id)
      e.seller_id,
      (e.old_rank - e.new_rank) as positions_gained,
      e.created_at as happened_at
      from public.seller_competition_events e
     where e.company_id = v_company_id
       and e.competition_started = false
       and e.created_at >= v_official_period_start
       and e.created_at <  v_official_period_end
     order by e.seller_id, e.created_at desc
  )
  select
    rc.seller_id,
    rc.seller_label,
    rc.sale_count,
    rc.completed_visit_count,
    rc.scheduled_visit_count,
    rc.rank,
    m.positions_gained as movement_positions_gained,
    m.happened_at as movement_happened_at
    from public._rank_company_sellers(v_company_id, p_period_start, p_period_end) rc
    left join movement m on m.seller_id = rc.seller_id
   order by rc.rank;
end;
$fn$;

revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from public;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7) _finalize_due_competition_reward_months — had_competition (existe
--    Sale no mês da campanha) passa a usar [start,end). Enumeração de
--    campanhas, advisory lock, idempotência e a lógica de snapshot
--    (delegada a _rank_company_sellers_snapshot, já half-open) inalteradas.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public._finalize_due_competition_reward_months(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_camp            record;
  v_period_start    timestamptz;
  v_period_end      timestamptz;
  v_month_id        uuid;
  v_had_competition boolean;
begin
  if p_company_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('comp_rewards_finalize:' || p_company_id::text));

  for v_camp in
    select c.id, c.month_start, c.timezone
      from public.competition_reward_campaigns c
     where c.company_id = p_company_id
       and c.status = 'published'
       and c.month_start < (date_trunc('month', now() at time zone c.timezone))::date
       and not exists (
         select 1 from public.competition_months m
          where m.company_id = p_company_id
            and m.month_start = c.month_start
       )
     order by c.month_start asc
  loop
    -- §21 — boundary competitivo do mês da campanha, na timezone congelada
    -- (NUNCA now()). Mesma fórmula de _lock_company_and_resolve_official_period.
    v_period_start := (v_camp.month_start::timestamp) at time zone v_camp.timezone;
    v_period_end   := ((v_camp.month_start + interval '1 month')::timestamp) at time zone v_camp.timezone;

    -- §22 — had_competition = existe Sale da empresa no mês oficial da
    -- campanha, janela SEMI-ABERTA [start,end) (uma venda exatamente em
    -- period_end é do mês seguinte).
    v_had_competition := exists (
      select 1 from public.sales sa
       where sa.company_id = p_company_id
         and sa.sold_at >= v_period_start
         and sa.sold_at <  v_period_end
    );

    -- §26 — idempotência: UNIQUE(company_id, month_start) + ON CONFLICT DO
    -- NOTHING RETURNING. Sem id de volta ⇒ outra chamada concorrente já
    -- fechou este mês ⇒ pula (sem inserir rows).
    insert into public.competition_months (
      company_id, month_start, period_start, period_end, timezone,
      had_competition, campaign_id
    ) values (
      p_company_id, v_camp.month_start, v_period_start, v_period_end, v_camp.timezone,
      v_had_competition, v_camp.id
    )
    on conflict (company_id, month_start) do nothing
    returning id into v_month_id;

    if v_month_id is null then
      continue;
    end if;

    -- §6 — campanha publicada + zero Sales: header já inserido,
    -- had_competition=false, ZERO rows, ZERO vencedor.
    if not v_had_competition then
      continue;
    end if;

    -- §23 — ranking final: mesma lógica de _rank_company_sellers, roster
    -- estendido (função irmã _rank_company_sellers_snapshot — §16). Sem SQL
    -- paralelo, sem ORDER BY duplicado. §24/§25 — reward + nome copiados
    -- AGORA; o history nunca reconsulta tiers/sellers.
    insert into public.competition_month_rows (
      competition_month_id, company_id, seller_id, seller_name_snapshot, rank,
      sale_count, completed_visit_count, scheduled_visit_count,
      reward_amount_cents, reward_text
    )
    select
      v_month_id, p_company_id, rc.seller_id, rc.seller_label, rc.rank,
      rc.sale_count, rc.completed_visit_count, rc.scheduled_visit_count,
      t.amount_cents, t.reward_text
    from public._rank_company_sellers_snapshot(
           p_company_id, v_period_start, v_period_end
         ) rc
    left join public.competition_reward_tiers t
           on t.campaign_id = v_camp.id
          and t.position = rc.rank;
  end loop;
end;
$fn$;

revoke all on function public._finalize_due_competition_reward_months(uuid) from public;
revoke all on function public._finalize_due_competition_reward_months(uuid) from anon;
revoke all on function public._finalize_due_competition_reward_months(uuid) from authenticated;

commit;
