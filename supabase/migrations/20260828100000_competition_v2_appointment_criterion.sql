-- COMPETITION-V2-B1-EXEC-BACKEND — terceiro critério do ranking
-- competitivo: Agendamentos de visitas (scheduled_visit_count). PRECHECK
-- COMPETITION-V2-A1 (COMPLETE). Decisões de produto CONGELADAS no EXEC.
--
-- UMA migration coesa. Backend/schema apenas (database.types.ts é
-- regenerado à parte). Nenhuma mudança de RLS, nenhuma tabela nova,
-- nenhum frontend.
--
-- ─────────────────────────────────────────────────────────────────────
-- ORDEM OFICIAL NOVA (§1 do EXEC) — row_number(), posições sempre únicas,
-- SEM sistema de pontos:
--   1. sale_count            DESC
--   2. completed_visit_count DESC
--   3. scheduled_visit_count DESC   ← NOVO
--   4. last_sale_at          ASC NULLS LAST   (first-to-reach, posição
--                                              relativa aos critérios de
--                                              produto INALTERADA)
--   5. seller_label          ASC
--   6. seller_id             ASC
--
-- ─────────────────────────────────────────────────────────────────────
-- AUTORIDADE DE scheduled_visit_count (§2/§3/§13):
--   count(public.visits) onde
--     company_id        = empresa do leaderboard
--     assigned_seller_id = seller do roster
--     created_at >= p_period_start  AND  created_at <= p_period_end
--   SEM filtro de status (scheduled/confirmed/completed/canceled contam
--   igualmente) — o KPI mede o ATO HISTÓRICO de gerar o agendamento; um
--   cancelamento ou reagendamento posterior não apaga esse mérito.
--   Boundary INCLUSIVO nos dois extremos (>= / <=), IGUAL a sales/visits
--   deste mesmo leaderboard — NUNCA [start,end): Competition e KPI
--   Reports são contratos independentes (§2).
--   created_at é imutável (nenhuma RPC de Visit o reescreve) →
--   reschedule-proof e cancel-proof.
--
-- ─────────────────────────────────────────────────────────────────────
-- MOVEMENT / EVENTOS (§6-§11/§19-§21):
--   - SOMENTE create_visit produz seller_competition_events de
--     source_type='appointment'. update_visit (reatribuição/reschedule),
--     confirm_visit e cancel_visit NUNCA produzem evento de appointment.
--   - Mesmo padrão seguro de register_visit_result:
--     _lock_company_and_resolve_official_period → guard "sem NENHUMA Sale
--     no mês oficial ⇒ sem evento competitivo" → snapshot old_rank →
--     INSERT Visit → snapshot new_rank → evento SOMENTE se
--     new_rank < old_rank (nunca competition_started aqui — uma Visit
--     nunca é "a primeira venda do mês").
--   - ZERO evento negativo: quem foi ultrapassado não recebe nada
--     (constraint seller_competition_events_improvement_ck + guarda de
--     insert, ambas preservadas).
--   - Eventos positivos de appointment alimentam movement_positions_gained
--     / movement_happened_at do mês oficial EXATAMENTE como sale/visit — a
--     CTE de movement em list_company_seller_leaderboard nunca filtrou por
--     source_type, então isso já vale por construção (§25).
--
-- ─────────────────────────────────────────────────────────────────────
-- EVENT SOURCE (§9-§11): seller_competition_events ganha
--   source_appointment_visit_id uuid (FK public.visits, UNIQUE) e o
--   source_type 'appointment'. Uma MESMA Visit pode gerar 1 evento
--   'appointment' (na criação) E 1 evento 'visit' (na conclusão) — por
--   isso NUNCA reutilizar source_visit_id para os dois conceitos. XOR
--   estrito: cada evento tem exatamente a source do seu source_type.
--
-- ─────────────────────────────────────────────────────────────────────
-- SELLER RANK TYPE (§12): public.seller_rank_row ganha
--   scheduled_visit_count integer. Seguindo o precedente seguro das
--   migrations de competition (drop/recreate ordenado das funções
--   dependentes + do type), NUNCA ALTER TYPE arriscado.
--
-- Dependências (ordem de DROP = inverso da dependência):
--   list_company_seller_leaderboard  -> _rank_company_sellers
--   register_sale / register_visit_result -> seller_rank_row (+ chamam
--       _rank_company_sellers) ; recriadas contra o novo type — corpo
--       funcionalmente INALTERADO (§17/§18).
--   create_visit -> (passa a chamar) _rank_company_sellers ; recriada COM
--       o bloco competitivo novo (§19).
--   _rank_company_sellers  -> seller_rank_row (RETURNS setof)
--
-- Baseline: LOCAL=66 / REMOTE=66. Depois: 67 / 67.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 0) DROP ordenado dos objetos dependentes (inverso da dependência).
-- ═══════════════════════════════════════════════════════════════════════
drop function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid);
drop function public.register_sale(uuid, integer, bigint, public.deal_payment_method);
drop function public.register_visit_result(uuid, integer, public.visit_outcome, text);
drop function public.create_visit(timestamptz, text[], uuid, text, text, text);
drop function public._rank_company_sellers(uuid, timestamptz, timestamptz);
drop type public.seller_rank_row;

-- ═══════════════════════════════════════════════════════════════════════
-- 1) seller_rank_row — +scheduled_visit_count (entre completed_visit_count
--    e rank: os três critérios de contagem ficam juntos).
-- ═══════════════════════════════════════════════════════════════════════
create type public.seller_rank_row as (
  seller_id              text,
  seller_label           text,
  sale_count             integer,
  completed_visit_count  integer,
  scheduled_visit_count  integer,
  rank                   integer
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2) _rank_company_sellers — +scheduled_agg (visits por created_at, sem
--    status filter) + novo ORDER BY de 6 chaves. Sales e completed-visits
--    INALTERADOS (§14/§15). Sem auth aqui de propósito (quem chama gateia).
-- ═══════════════════════════════════════════════════════════════════════
create function public._rank_company_sellers(
  p_company_id   uuid,
  p_period_start timestamptz,
  p_period_end   timestamptz
)
returns setof public.seller_rank_row
language sql
stable
security definer
set search_path = ''
as $$
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
       and sa.sold_at <= p_period_end
     group by sa.assigned_seller_id
  ),
  visits_agg as (
    select v.assigned_seller_id as id,
           count(*)::int as completed_visit_count
      from public.visits v
     where v.company_id = p_company_id
       and v.status = 'completed'
       and v.closed_at >= p_period_start
       and v.closed_at <= p_period_end
     group by v.assigned_seller_id
  ),
  scheduled_agg as (
    -- §2/§3/§13 — "agendamentos gerados no período": visits.created_at no
    -- período competitivo, por assigned_seller_id, SEM filtro de status.
    -- Boundary inclusivo nos dois extremos, igual aos outros dois
    -- critérios (NUNCA [start,end)).
    select v.assigned_seller_id as id,
           count(*)::int as scheduled_visit_count
      from public.visits v
     where v.company_id = p_company_id
       and v.created_at >= p_period_start
       and v.created_at <= p_period_end
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
$$;

revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from public;
revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from anon;
revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) seller_competition_events — nova source 'appointment'.
--    source_appointment_visit_id: FK public.visits, UNIQUE (idempotência —
--    um create_visit nunca produz dois eventos appointment para a mesma
--    Visit; um retry da transação também não). Modelo de inbox (seen_at)
--    inalterado — reload não cria linha nova.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.seller_competition_events
  add column source_appointment_visit_id uuid
    references public.visits (id) on delete restrict;

alter table public.seller_competition_events
  drop constraint seller_competition_events_source_type_ck;
alter table public.seller_competition_events
  add constraint seller_competition_events_source_type_ck
    check (source_type in ('sale', 'visit', 'appointment'));

-- XOR estrito (§11): exatamente uma source populada, compatível com o
-- source_type — nunca híbrida, nunca todas NULL.
alter table public.seller_competition_events
  drop constraint seller_competition_events_source_xor_ck;
alter table public.seller_competition_events
  add constraint seller_competition_events_source_xor_ck
    check (
      (source_type = 'sale'
        and source_sale_id is not null
        and source_visit_id is null
        and source_appointment_visit_id is null)
      or
      (source_type = 'visit'
        and source_visit_id is not null
        and source_sale_id is null
        and source_appointment_visit_id is null)
      or
      (source_type = 'appointment'
        and source_appointment_visit_id is not null
        and source_sale_id is null
        and source_visit_id is null)
    );

alter table public.seller_competition_events
  add constraint seller_competition_events_source_appointment_visit_id_uniq
    unique (source_appointment_visit_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4) list_company_seller_leaderboard — mesmo contrato público EXATO
--    (assinatura, autorização, mensagens de erro, mês oficial, colunas de
--    movement), +1 coluna scheduled_visit_count vinda de
--    _rank_company_sellers. Return-shape mudou ⇒ DROP+CREATE (já feito no
--    passo 0). Movement CTE INALTERADA: nunca filtrou source_type, então
--    eventos 'appointment' já alimentam a movimentação mensal (§25).
-- ═══════════════════════════════════════════════════════════════════════
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
  scheduled_visit_count      integer,
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
       and e.created_at <= v_official_period_end
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
$$;

revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from public;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5) register_sale — recriada contra o novo seller_rank_row.
--    Comportamento funcional INALTERADO (§17): a Sale continua podendo
--    causar movimento positivo normalmente; corpo idêntico ao da
--    20260825140000 (r2c) — só rebinda ao novo type.
-- ═══════════════════════════════════════════════════════════════════════
create function public.register_sale(
  p_deal_id            uuid,
  p_expected_version   integer,
  p_sold_value_cents   bigint,
  p_payment_method     public.deal_payment_method
) returns public.deals
language plpgsql security definer set search_path = '' as $$
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
       and sa.sold_at <= v_period.period_end
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
$$;

revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from public;
revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from anon;
revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from authenticated;
grant execute on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6) register_visit_result — recriada contra o novo seller_rank_row.
--    Comportamento funcional INALTERADO (§18): concluir Visit continua
--    podendo gerar movement source_type='visit'. Uma Visit antes contada
--    como appointment continua podendo gerar esse SEGUNDO mérito ao ser
--    realizada — sources distintas, sem conflito. Corpo idêntico ao da
--    20260825140000 (r2c) — só rebinda ao novo type.
-- ═══════════════════════════════════════════════════════════════════════
create function public.register_visit_result(
  p_id                uuid,
  p_expected_version  integer,
  p_outcome           public.visit_outcome,
  p_result_note       text default ''
) returns public.visits
language plpgsql security definer set search_path = '' as $$
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
       and sa.sold_at <= v_period.period_end
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
$$;

revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from public;
revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from anon;
revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from authenticated;
grant execute on function public.register_visit_result(uuid, integer, public.visit_outcome, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7) create_visit — mesmo contrato público EXATO (assinatura, retorno
--    public.visits, erros estáveis, autoridade de assigned_seller/lead,
--    Timeline "Visita agendada"). Adiciona, dentro da MESMA transação,
--    o MESMO padrão seguro de register_visit_result (§19):
--      a) _lock_company_and_resolve_official_period APÓS toda a validação
--         (nunca trava/calcula para uma chamada que vai falhar) e ANTES
--         do INSERT;
--      b) guard: nenhuma Sale no mês oficial ⇒ sem evento competitivo
--         (idêntico ao guard de register_visit_result — §7/§19);
--      c) snapshot old_rank do beneficiário ANTES do INSERT;
--      d) INSERT da Visit (created_at = now() por default → autoridade de
--         scheduled_visit_count);
--      e) snapshot new_rank DEPOIS;
--      f) evento SOMENTE se new_rank < old_rank (§8) — nunca
--         competition_started (uma Visit nunca é "a primeira venda do
--         mês"), source_type='appointment',
--         source_appointment_visit_id = id da Visit recém-criada.
--    related_seller = ocupante anterior de new_rank (mesma semântica de
--    sale/visit). Guarda defensiva: beneficiário fora do roster ativo
--    (offboarded) ⇒ old_rank NULL ⇒ evento omitido, Visit criada
--    normalmente.
-- ═══════════════════════════════════════════════════════════════════════
create function public.create_visit(
  p_scheduled_at       timestamptz,
  p_vehicles           text[],
  p_lead_id            uuid default null,
  p_client_name        text default null,
  p_assigned_seller_id text default null,
  p_note               text default ''
) returns public.visits
language plpgsql security definer set search_path = '' as $$
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
  select exists (
    select 1 from public.sales sa
     where sa.company_id = v_ctx.resolved_company_id
       and sa.sold_at >= v_period.period_start
       and sa.sold_at <= v_period.period_end
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
$$;

revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from public;
revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from anon;
revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from authenticated;
grant execute on function public.create_visit(timestamptz, text[], uuid, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8) Índice (§22) — EXATO, não parcial (visits canceladas ainda contam,
--    então sem predicado WHERE). Espelha sales_company_seller_sold_at_idx.
--    O composto existente (company_id, assigned_seller_id, status,
--    scheduled_at) não serve um range de created_at.
-- ═══════════════════════════════════════════════════════════════════════
create index visits_company_seller_created_at_idx
  on public.visits (company_id, assigned_seller_id, created_at);

commit;
