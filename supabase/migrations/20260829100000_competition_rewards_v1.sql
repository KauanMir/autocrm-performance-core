-- COMPETITION-REWARDS-V1-B1-EXEC — premiação mensal opcional para a
-- Competition V2. PRECHECKS: A1 (COMPLETE) + A2 pre-finalization guard
-- (COMPLETE).
--
-- Regra de produto: a competição roda todo mês normalmente (INALTERADA).
-- O snapshot histórico deste V1 nasce SOMENTE para meses que tiveram uma
-- reward campaign status='published'. Sem campanha publicada → nenhum
-- competition_month, e o histórico de rewards simplesmente não possui
-- aquele mês. Relatórios de Sales/KPI continuam no domínio de Sales.
--
-- NÃO reseta Sales/Leads/Visits/Deals/Tasks. NÃO altera o ranking da
-- Competition V2 (Sales → completed Visits → scheduled Visits →
-- first-to-reach → fallback determinístico). NÃO cria pontos. NÃO corrige
-- o boundary <= period_end (fica para um EXEC separado). NÃO adiciona
-- cron/Edge Function/scheduler — fechamento é lazy + idempotente. ZERO UI.
begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1) Ranking para o SNAPSHOT histórico.
--
--    O spec pediu adicionar um parâmetro opcional `p_roster_mode` a
--    _rank_company_sellers. Isso NÃO é seguro: o pgTAP de baseline
--    (62_podium_competition_events_r2b.sql, atualmente PASSANDO e que DEVE
--    continuar passando) chama
--      has_function_privilege('authenticated',
--        'public._rank_company_sellers(uuid,timestamptz,timestamptz)', 'EXECUTE')
--    com a assinatura EXATA de 3 args. `regprocedure` faz match exato de
--    aridade e ignora defaults — ao acrescentar um 4º parâmetro (mesmo com
--    DEFAULT), essa string de 3 args deixa de resolver e o assert vira
--    ERRO. Confirmado empiricamente no Postgres local.
--
--    Portanto _rank_company_sellers fica INTOCADA (byte a byte). O modo de
--    roster estendido vive numa função IRMÃ, exclusiva da finalização
--    histórica: _rank_company_sellers_snapshot(uuid,timestamptz,timestamptz).
--    Corpo idêntico ao de _rank_company_sellers exceto o roster CTE, que
--    além de sellers.is_active inclui o Seller que teve atividade em
--    qualquer um dos 3 critérios dentro do período (assim um Seller
--    desligado DEPOIS de competir não some do snapshot). Agregações
--    (sales_agg/visits_agg/scheduled_agg), boundary inclusivo e o ORDER BY
--    de 6 chaves são CÓPIA EXATA. Sem GRANT — função interna.
-- ═══════════════════════════════════════════════════════════════════════
create function public._rank_company_sellers_snapshot(
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
       and (
         s.is_active
         or exists (
           select 1 from public.sales sa
            where sa.company_id = p_company_id
              and sa.assigned_seller_id = s.id
              and sa.sold_at >= p_period_start
              and sa.sold_at <= p_period_end
         )
         or exists (
           select 1 from public.visits v
            where v.company_id = p_company_id
              and v.assigned_seller_id = s.id
              and v.created_at >= p_period_start
              and v.created_at <= p_period_end
         )
         or exists (
           select 1 from public.visits v
            where v.company_id = p_company_id
              and v.assigned_seller_id = s.id
              and v.status = 'completed'
              and v.closed_at is not null
              and v.closed_at >= p_period_start
              and v.closed_at <= p_period_end
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

revoke all on function public._rank_company_sellers_snapshot(uuid, timestamptz, timestamptz) from public;
revoke all on function public._rank_company_sellers_snapshot(uuid, timestamptz, timestamptz) from anon;
revoke all on function public._rank_company_sellers_snapshot(uuid, timestamptz, timestamptz) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2) TABELAS. RLS enable + ZERO policy + REVOKE de authenticated/anon —
--    mesmo precedente de seller_competition_events. Todo acesso via as
--    RPCs SECURITY DEFINER abaixo.
-- ═══════════════════════════════════════════════════════════════════════

-- 2a) competition_reward_campaigns — config editável (mês atual/futuro).
create table public.competition_reward_campaigns (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete cascade,
  -- primeiro dia do mês civil da campanha, na timezone da empresa (§47).
  month_start               date not null,
  -- timezone da empresa NO MOMENTO da campanha — congelada aqui e no
  -- snapshot; histórico nunca depende de companies.timezone futura (§8).
  timezone                  text not null,
  status                    text not null default 'draft'
                              check (status in ('draft', 'published')),
  title                     text,
  created_by_profile_id     uuid not null,
  published_at              timestamptz,
  published_by_profile_id   uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint competition_reward_campaigns_company_month_uniq
    unique (company_id, month_start),
  constraint competition_reward_campaigns_month_start_is_first_ck
    check (date_part('day', month_start) = 1),
  constraint competition_reward_campaigns_title_ck
    check (title is null or char_length(btrim(title)) between 1 and 120),
  constraint competition_reward_campaigns_publish_consistency_ck
    check (
      (status = 'draft'     and published_at is null     and published_by_profile_id is null)
      or (status = 'published' and published_at is not null and published_by_profile_id is not null)
    ),
  -- criador teve membership real na empresa (mesmo shape de
  -- seller_competition_events_actor_fk).
  constraint competition_reward_campaigns_creator_fk
    foreign key (company_id, created_by_profile_id)
    references public.company_memberships (company_id, profile_id)
    on delete restrict
);

create index competition_reward_campaigns_company_month_idx
  on public.competition_reward_campaigns (company_id, month_start desc);

-- 2b) competition_reward_tiers — posições premiadas de uma campanha.
create table public.competition_reward_tiers (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.competition_reward_campaigns(id) on delete cascade,
  position       integer not null check (position between 1 and 10),
  amount_cents   bigint  check (amount_cents is null or amount_cents > 0),
  reward_text    text    check (reward_text is null or char_length(btrim(reward_text)) between 1 and 120),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint competition_reward_tiers_campaign_position_uniq
    unique (campaign_id, position),
  -- §9 — pelo menos um dos dois; ambos podem coexistir (R$ + texto).
  constraint competition_reward_tiers_has_reward_ck
    check (amount_cents is not null or reward_text is not null)
);

create index competition_reward_tiers_campaign_idx
  on public.competition_reward_tiers (campaign_id, position);

-- 2c) competition_months — snapshot-header. Write-once (INSERT only).
--     Nasce SOMENTE via _finalize_due_competition_reward_months, e SOMENTE
--     para uma campanha publicada de um mês já encerrado → campaign_id
--     NOT NULL (§12).
create table public.competition_months (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  month_start      date not null,
  -- boundary competitivo EXATO daquele mês, na timezone congelada (§21).
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  timezone         text not null,
  closed_at        timestamptz not null default now(),
  -- exists(Sale da empresa naquele mês oficial). false → header sem rows.
  had_competition  boolean not null,
  campaign_id      uuid not null references public.competition_reward_campaigns(id) on delete restrict,

  constraint competition_months_company_month_uniq unique (company_id, month_start),
  constraint competition_months_period_ck check (period_start < period_end),
  constraint competition_months_month_start_is_first_ck check (date_part('day', month_start) = 1)
);

create index competition_months_company_month_desc_idx
  on public.competition_months (company_id, month_start desc);

-- 2d) competition_month_rows — standings finais congelados. Write-once
--     exceto acknowledged_at. seller_id SEM FK (histórico sobrevive a um
--     eventual hard-delete futuro de seller; hoje sellers só são
--     desativados). company_id denormalizado p/ o índice "meu histórico".
create table public.competition_month_rows (
  id                     uuid primary key default gen_random_uuid(),
  competition_month_id   uuid not null references public.competition_months(id) on delete cascade,
  company_id             uuid not null references public.companies(id) on delete cascade,
  seller_id              text not null,
  seller_name_snapshot   text not null,
  rank                   integer not null check (rank > 0),
  sale_count             integer not null check (sale_count >= 0),
  completed_visit_count  integer not null check (completed_visit_count >= 0),
  scheduled_visit_count  integer not null check (scheduled_visit_count >= 0),
  reward_amount_cents    bigint  check (reward_amount_cents is null or reward_amount_cents > 0),
  reward_text            text    check (reward_text is null or char_length(btrim(reward_text)) between 1 and 120),
  acknowledged_at        timestamptz,

  constraint competition_month_rows_month_seller_uniq unique (competition_month_id, seller_id)
);

create index competition_month_rows_month_rank_idx
  on public.competition_month_rows (competition_month_id, rank);
create index competition_month_rows_company_seller_idx
  on public.competition_month_rows (company_id, seller_id, competition_month_id);

alter table public.competition_reward_campaigns enable row level security;
alter table public.competition_reward_tiers     enable row level security;
alter table public.competition_months           enable row level security;
alter table public.competition_month_rows       enable row level security;

revoke all on table public.competition_reward_campaigns from public, anon, authenticated;
revoke all on table public.competition_reward_tiers     from public, anon, authenticated;
revoke all on table public.competition_months           from public, anon, authenticated;
revoke all on table public.competition_month_rows       from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) _finalize_due_competition_reward_months — fecho LAZY + IDEMPOTENTE.
--    Interno, SECURITY DEFINER, ZERO grant.
--
--    Finaliza SOMENTE campanhas: status='published' AND month_start <
--    current official month (na timezone da campanha) AND sem
--    competition_month correspondente. ORDER BY month_start ASC → uma
--    campanha antiga ainda pendente é fechada na próxima chamada; sem cap
--    artificial (o volume é o número de campanhas publicadas pendentes,
--    naturalmente pequeno). NÃO enumera meses genéricos, NÃO cria janela
--    de N meses.
--
--    Locking (A2 §14): pg_advisory_xact_lock(hashtext('comp_rewards_
--    finalize:'||company)) no início; leitura de company SEM FOR UPDATE →
--    nenhum ciclo com _lock_company_and_resolve_official_period usado
--    pelas Competition mutations.
-- ═══════════════════════════════════════════════════════════════════════
create function public._finalize_due_competition_reward_months(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

    -- §22 — had_competition = existe Sale da empresa naquele mês oficial
    -- (boundary inclusivo, igual à Competition V2 atual — §47).
    v_had_competition := exists (
      select 1 from public.sales sa
       where sa.company_id = p_company_id
         and sa.sold_at >= v_period_start
         and sa.sold_at <= v_period_end
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
$$;

revoke all on function public._finalize_due_competition_reward_months(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4) A2 §5/§30 — pre-mutation guard. update_visit pode reatribuir
--    assigned_seller_id de uma Visit criada no mês anterior → reescreveria
--    scheduled_visit_count histórico. Por isso: APÓS resolver o contexto e
--    ANTES de ler/alterar a Visit, PERFORM
--    _finalize_due_competition_reward_months(company) — congela qualquer
--    campanha publicada passada pendente antes da reassignment. No-op
--    barato quando não há campanha pendente.
--
--    Contrato público de update_visit INALTERADO (assinatura, retorno,
--    ordem/textos de erro). Única diferença: 1 PERFORM logo após o SELECT
--    do contexto.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.update_visit(
  p_id                 uuid,
  p_expected_version   integer,
  p_scheduled_at       timestamptz,
  p_vehicles           text[],
  p_note               text,
  p_assigned_seller_id text
) returns public.visits
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx          record;
  v_visit        public.visits;
  v_row          public.visits;
  v_new_seller   text;
  v_new_status   public.visit_status;
  v_time_changed boolean;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  -- COMPETITION-REWARDS-V1 §29 — congela o mês anterior pendente ANTES de
  -- qualquer leitura/alteração da Visit (reassignment reescreveria
  -- scheduled_visit_count histórico).
  perform public._finalize_due_competition_reward_months(v_ctx.resolved_company_id);

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  if not public.visits_vehicles_valid(p_vehicles) then
    raise exception 'invalid_vehicles';
  end if;

  select v.* into v_visit
    from public.visits v
    where v.id = p_id and v.company_id = v_ctx.resolved_company_id;
  if v_visit.id is null then
    raise exception 'visit_not_found';
  end if;
  if v_visit.status in ('completed', 'canceled') then
    raise exception 'visit_closed';
  end if;

  if v_ctx.actor_kind = 'seller' then
    -- Seller só edita a própria Visit e nunca pode reatribuir.
    if v_visit.assigned_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    if p_assigned_seller_id is distinct from v_visit.assigned_seller_id then
      raise exception 'forbidden';
    end if;
    v_new_seller := v_visit.assigned_seller_id;
  else
    -- Manager: pode reatribuir para qualquer Seller ativo elegível da
    -- empresa; responsável continua obrigatório.
    if p_assigned_seller_id is null then
      raise exception 'seller_required';
    end if;
    if p_assigned_seller_id is distinct from v_visit.assigned_seller_id then
      perform 1 from public.sellers s
        where s.id = p_assigned_seller_id
          and s.company_id = v_ctx.resolved_company_id
          and s.is_active;
      if not found then
        raise exception 'seller_not_found';
      end if;
    end if;
    v_new_seller := p_assigned_seller_id;
  end if;

  v_time_changed := p_scheduled_at is distinct from v_visit.scheduled_at;
  -- confirmed + horário mudou -> volta para scheduled (a confirmação era
  -- para o horário antigo, R1 §6). scheduled continua scheduled.
  v_new_status := case
    when v_time_changed and v_visit.status = 'confirmed' then 'scheduled'::public.visit_status
    else v_visit.status
  end;

  update public.visits
    set scheduled_at       = p_scheduled_at,
        vehicles           = p_vehicles,
        note               = coalesce(p_note, ''),
        assigned_seller_id = v_new_seller,
        status             = v_new_status,
        updated_by         = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status in ('scheduled', 'confirmed')
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  -- Evento só quando scheduled_at de fato mudou (mesmo critério de
  -- move_lead_to_stage/assign_lead_seller).
  if v_time_changed and v_visit.lead_id is not null then
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, v_visit.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      'calendar', '#FFA31F', 'Visita remarcada', null);
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_visit(uuid, integer, timestamptz, text[], text, text) from public;
revoke all on function public.update_visit(uuid, integer, timestamptz, text[], text, text) from anon;
revoke all on function public.update_visit(uuid, integer, timestamptz, text[], text, text) from authenticated;
grant execute on function public.update_visit(uuid, integer, timestamptz, text[], text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5) A2 §30 — defesa em profundidade para churn administrativo.
--    offboard_seller / transfer_membership / suspend_membership /
--    update_membership_role (seller→manager) TODOS desativam a linha em
--    public.sellers (is_active true→false, sem deletar, sem mover
--    company_id — A2 §3). Um trigger BEFORE UPDATE OF is_active nessa
--    transição cobre TODOS esses caminhos com ~10 linhas, sem re-declarar
--    as funções gigantes de offboard/transfer (200-400 linhas cada). Em
--    BEFORE, o snapshot enxerga o Seller ainda ativo → congela o mês
--    anterior antes de ele sair do roster. Funcionalmente redundante com
--    'active_or_had_activity', mas garante o fecho antes do churn.
-- ═══════════════════════════════════════════════════════════════════════
create function public._competition_rewards_freeze_on_seller_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._finalize_due_competition_reward_months(old.company_id);
  return new;
end;
$$;

create trigger competition_rewards_freeze_before_seller_deactivate
  before update of is_active on public.sellers
  for each row
  when (old.is_active = true and new.is_active = false and old.company_id is not null)
  execute function public._competition_rewards_freeze_on_seller_deactivate();

-- ═══════════════════════════════════════════════════════════════════════
-- 6) upsert_competition_reward_campaign — Manager only. Cria/edita
--    draft-ou-published + substitui os tiers atomicamente. Company SEMPRE
--    de current_membership_company_id() (nunca parâmetro do Manager, §32).
--    Rejeita month_start < mês oficial corrente (§33). status='published'
--    seta published_at/by (§35), sem aprovação extra. Sem version table —
--    updated_at basta para a config atual (§36).
-- ═══════════════════════════════════════════════════════════════════════
create function public.upsert_competition_reward_campaign(
  p_month_start date,
  p_status      text,
  p_title       text,
  p_tiers       jsonb
)
returns public.competition_reward_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id    uuid;
  v_timezone      text;
  v_current_month date;
  v_campaign      public.competition_reward_campaigns;
  v_tier          record;
  v_positions     int[] := '{}';
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  v_company_id := public.current_membership_company_id();
  if v_company_id is null or public.current_membership_role() is distinct from 'manager'::public.company_role then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if p_status is null or p_status not in ('draft', 'published') then
    raise invalid_parameter_value using message = 'invalid_status';
  end if;
  if p_month_start is null or date_part('day', p_month_start) <> 1 then
    raise invalid_parameter_value using message = 'invalid_month';
  end if;
  if p_title is not null and char_length(btrim(p_title)) not between 1 and 120 then
    raise invalid_parameter_value using message = 'invalid_title';
  end if;

  select c.timezone into v_timezone from public.companies c where c.id = v_company_id;
  v_current_month := (date_trunc('month', now() at time zone v_timezone))::date;
  if p_month_start < v_current_month then
    raise invalid_parameter_value using message = 'month_closed';
  end if;

  -- Valida tiers ANTES de qualquer escrita.
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' then
    raise invalid_parameter_value using message = 'invalid_tiers';
  end if;
  if jsonb_array_length(p_tiers) > 10 then
    raise invalid_parameter_value using message = 'too_many_tiers';
  end if;
  for v_tier in
    select (elem->>'position')::int                  as position,
           nullif(elem->>'amount_cents', '')::bigint as amount_cents,
           nullif(btrim(elem->>'reward_text'), '')   as reward_text
      from jsonb_array_elements(p_tiers) as arr(elem)
  loop
    if v_tier.position is null or v_tier.position not between 1 and 10 then
      raise invalid_parameter_value using message = 'invalid_tier_position';
    end if;
    if v_tier.position = any(v_positions) then
      raise invalid_parameter_value using message = 'duplicate_tier_position';
    end if;
    v_positions := v_positions || v_tier.position;
    if v_tier.amount_cents is not null and v_tier.amount_cents <= 0 then
      raise invalid_parameter_value using message = 'invalid_tier_amount';
    end if;
    if v_tier.reward_text is not null and char_length(v_tier.reward_text) > 120 then
      raise invalid_parameter_value using message = 'invalid_tier_text';
    end if;
    if v_tier.amount_cents is null and v_tier.reward_text is null then
      raise invalid_parameter_value using message = 'empty_tier';
    end if;
  end loop;

  insert into public.competition_reward_campaigns (
    company_id, month_start, timezone, status, title, created_by_profile_id,
    published_at, published_by_profile_id
  ) values (
    v_company_id, p_month_start, v_timezone, p_status, nullif(btrim(p_title), ''), auth.uid(),
    case when p_status = 'published' then now() end,
    case when p_status = 'published' then auth.uid() end
  )
  on conflict (company_id, month_start) do update
    set status = excluded.status,
        title  = excluded.title,
        updated_at = now(),
        -- timezone NÃO é reescrita no update — a da criação fica valendo.
        published_at = case
          when excluded.status = 'published'
            then coalesce(public.competition_reward_campaigns.published_at, now())
          else null
        end,
        published_by_profile_id = case
          when excluded.status = 'published'
            then coalesce(public.competition_reward_campaigns.published_by_profile_id, auth.uid())
          else null
        end
  returning * into v_campaign;

  -- Substitui os tiers atomicamente.
  delete from public.competition_reward_tiers where campaign_id = v_campaign.id;
  insert into public.competition_reward_tiers (campaign_id, position, amount_cents, reward_text)
  select v_campaign.id,
         (elem->>'position')::int,
         nullif(elem->>'amount_cents', '')::bigint,
         nullif(btrim(elem->>'reward_text'), '')
    from jsonb_array_elements(p_tiers) as arr(elem);

  return v_campaign;
end;
$$;

revoke all on function public.upsert_competition_reward_campaign(date, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_competition_reward_campaign(date, text, text, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7) get_competition_rewards_overview — a ÚNICA chamada de Home/Pódio.
--    Finaliza pendências primeiro. Auth: Manager/Seller via membership;
--    Super Admin contextual via p_company_id + is_platform_super_admin() +
--    can_access_company(); Super Admin global / sem membership → '{}'.
--
--    Manager: campanha do mês oficial corrente (draft OU published) +
--    tiers + total monetário. Seller: campanha SÓ se published E
--    month_start = mês oficial corrente (§34/§38); + rank oficial atual
--    (via _rank_company_sellers 'active') + prêmio do rank + prêmio do 1º
--    (§39); + último resultado finalizado NÃO reconhecido (§42).
-- ═══════════════════════════════════════════════════════════════════════
create function public.get_competition_rewards_overview(p_company_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id    uuid;
  v_is_manager    boolean := false;
  v_is_seller     boolean := false;
  v_timezone      text;
  v_current_month date;
  v_period_start  timestamptz;
  v_period_end    timestamptz;
  v_seller_id     text;
  v_campaign      public.competition_reward_campaigns;
  v_tiers         jsonb;
  v_total_cents   bigint;
  v_my_rank       integer;
  v_my_reward     jsonb;
  v_first_reward  jsonb;
  v_last_result   jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_company_id is not null then
    if not (public.is_platform_super_admin() and public.can_access_company(p_company_id)) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
    v_company_id := p_company_id;
    v_is_manager := true; -- Super Admin contextual: shape de gestão (read-only), draft incluído
  else
    if public.is_platform_super_admin() then
      return '{}'::jsonb; -- Super Admin global: nenhum contexto implícito
    end if;
    v_company_id := public.current_membership_company_id();
    if v_company_id is null then
      return '{}'::jsonb;
    end if;
    v_is_manager := public.current_membership_role() = 'manager'::public.company_role;
    v_is_seller  := public.current_membership_role() = 'seller'::public.company_role;
  end if;

  perform public._finalize_due_competition_reward_months(v_company_id);

  select c.timezone into v_timezone from public.companies c where c.id = v_company_id;
  if v_timezone is null then
    return '{}'::jsonb;
  end if;
  v_current_month := (date_trunc('month', now() at time zone v_timezone))::date;
  v_period_start  := (v_current_month::timestamp) at time zone v_timezone;
  v_period_end    := ((v_current_month + interval '1 month')::timestamp) at time zone v_timezone;

  if v_is_seller then
    v_seller_id := public.current_profile_seller_id_for_company(v_company_id);
  end if;

  -- Campanha do mês corrente. Manager/SA contextual: qualquer status.
  -- Seller: só 'published'.
  select * into v_campaign
    from public.competition_reward_campaigns c
   where c.company_id = v_company_id
     and c.month_start = v_current_month
     and (v_is_manager or c.status = 'published');

  if v_campaign.id is not null then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'position', t.position,
               'amount_cents', t.amount_cents,
               'reward_text', t.reward_text
             ) order by t.position
           ), '[]'::jsonb),
           coalesce(sum(t.amount_cents), 0)
      into v_tiers, v_total_cents
      from public.competition_reward_tiers t
     where t.campaign_id = v_campaign.id;
  end if;

  -- Seller: rank oficial atual + prêmios.
  if v_is_seller and v_seller_id is not null then
    select rc.rank into v_my_rank
      from public._rank_company_sellers(v_company_id, v_period_start, v_period_end) rc
     where rc.seller_id = v_seller_id;

    if v_campaign.id is not null and v_my_rank is not null then
      select jsonb_build_object('amount_cents', t.amount_cents, 'reward_text', t.reward_text)
        into v_my_reward
        from public.competition_reward_tiers t
       where t.campaign_id = v_campaign.id and t.position = v_my_rank;
    end if;
    if v_campaign.id is not null then
      select jsonb_build_object('amount_cents', t.amount_cents, 'reward_text', t.reward_text)
        into v_first_reward
        from public.competition_reward_tiers t
       where t.campaign_id = v_campaign.id and t.position = 1;
    end if;

    -- §42 — último resultado finalizado NÃO reconhecido do Seller.
    select jsonb_build_object(
             'competition_month_id', mr.competition_month_id,
             'month_start', m.month_start,
             'had_competition', m.had_competition,
             'rank', mr.rank,
             'sale_count', mr.sale_count,
             'completed_visit_count', mr.completed_visit_count,
             'scheduled_visit_count', mr.scheduled_visit_count,
             'reward_amount_cents', mr.reward_amount_cents,
             'reward_text', mr.reward_text
           )
      into v_last_result
      from public.competition_month_rows mr
      join public.competition_months m on m.id = mr.competition_month_id
     where mr.company_id = v_company_id
       and mr.seller_id = v_seller_id
       and mr.acknowledged_at is null
     order by m.month_start desc
     limit 1;
  end if;

  return jsonb_build_object(
    'company_id', v_company_id,
    'current_month', jsonb_build_object(
      'month_start', v_current_month,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'campaign', case when v_campaign.id is null then null else jsonb_build_object(
        'id', v_campaign.id,
        'status', v_campaign.status,
        'title', v_campaign.title,
        'total_amount_cents', v_total_cents,
        'tiers', v_tiers
      ) end,
      'my_rank', v_my_rank,
      'my_reward', v_my_reward,
      'first_place_reward', v_first_reward
    ),
    'last_result', v_last_result
  );
end;
$$;

revoke all on function public.get_competition_rewards_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_competition_rewards_overview(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8) list_competition_reward_history — SOMENTE competition_months (que só
--    existem para campanhas publicadas). Nunca inventa meses sem
--    premiação. Manager/SA contextual: standings completos. Seller:
--    própria row + Top 3. Global: vazio.
-- ═══════════════════════════════════════════════════════════════════════
create function public.list_competition_reward_history(
  p_company_id uuid default null,
  p_limit      int default 12
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_is_seller  boolean := false;
  v_seller_id  text;
  v_limit      int := least(greatest(coalesce(p_limit, 12), 1), 60);
  v_result     jsonb;
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
    if public.is_platform_super_admin() then
      return '[]'::jsonb;
    end if;
    v_company_id := public.current_membership_company_id();
    if v_company_id is null then
      return '[]'::jsonb;
    end if;
    v_is_seller := public.current_membership_role() = 'seller'::public.company_role;
  end if;

  perform public._finalize_due_competition_reward_months(v_company_id);

  if v_is_seller then
    v_seller_id := public.current_profile_seller_id_for_company(v_company_id);
  end if;

  select coalesce(jsonb_agg(month_obj order by (month_obj->>'month_start') desc), '[]'::jsonb)
    into v_result
  from (
    select jsonb_build_object(
             'competition_month_id', m.id,
             'month_start', m.month_start,
             'had_competition', m.had_competition,
             'campaign', jsonb_build_object('title', cc.title),
             'rows', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'seller_id', mr.seller_id,
                        'seller_name', mr.seller_name_snapshot,
                        'rank', mr.rank,
                        'sale_count', mr.sale_count,
                        'completed_visit_count', mr.completed_visit_count,
                        'scheduled_visit_count', mr.scheduled_visit_count,
                        'reward_amount_cents', mr.reward_amount_cents,
                        'reward_text', mr.reward_text
                      ) order by mr.rank)
                 from public.competition_month_rows mr
                where mr.competition_month_id = m.id
                  and (
                    not v_is_seller
                    or mr.rank <= 3
                    or (v_seller_id is not null and mr.seller_id = v_seller_id)
                  )
             ), '[]'::jsonb)
           ) as month_obj
      from public.competition_months m
      join public.competition_reward_campaigns cc on cc.id = m.campaign_id
     where m.company_id = v_company_id
     order by m.month_start desc
     limit v_limit
  ) sub;

  return v_result;
end;
$$;

revoke all on function public.list_competition_reward_history(uuid, int) from public, anon, authenticated;
grant execute on function public.list_competition_reward_history(uuid, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 9) acknowledge_competition_month_result — Seller only, só a PRÓPRIA row
--    da PRÓPRIA company. Idempotente (já reconhecida → 0). Mesmo padrão de
--    mark_competition_events_seen.
-- ═══════════════════════════════════════════════════════════════════════
create function public.acknowledge_competition_month_result(p_competition_month_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_seller_id  text;
  v_count      integer;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;
  if p_competition_month_id is null then
    return 0;
  end if;

  if public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_company_id := public.current_membership_company_id();
  if v_company_id is null or public.current_membership_role() is distinct from 'seller'::public.company_role then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_seller_id := public.current_profile_seller_id_for_company(v_company_id);
  if v_seller_id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  update public.competition_month_rows
     set acknowledged_at = now()
   where competition_month_id = p_competition_month_id
     and company_id = v_company_id
     and seller_id = v_seller_id
     and acknowledged_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.acknowledge_competition_month_result(uuid) from public, anon, authenticated;
grant execute on function public.acknowledge_competition_month_result(uuid) to authenticated;

commit;
