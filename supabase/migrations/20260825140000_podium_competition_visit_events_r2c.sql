-- PODIUM-COMPETITION-R2C-B1-EXEC — eventos reais de melhora de ranking
-- causados por Visit completed (fecha a lacuna documentada no R2C-A1-
-- PRECHECK). Mesma tabela seller_competition_events do R2B, evoluída para
-- suportar 2 origens (sale/visit) — nenhuma tabela nova, nenhuma
-- alteração de RLS em sales/visits/sellers, nenhum movement arrow, nenhum
-- evento negativo, nenhuma comemoração antes da primeira Sale do mês.
begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1) _lock_company_and_resolve_official_period — extraído de dentro de
--    register_sale (R2B): trava a company (serializa Sale/Visit
--    concorrentes da MESMA empresa) + resolve o mês civil oficial via
--    companies.timezone. §26 do EXEC — duplicação clara entre
--    register_sale e o novo bloco de register_visit_result, extraída
--    para um helper pequeno (não um framework genérico).
-- ═══════════════════════════════════════════════════════════════════════

create function public._lock_company_and_resolve_official_period(p_company_id uuid)
returns table (period_start timestamptz, period_end timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
begin
  select c.timezone into v_timezone
    from public.companies c
    where c.id = p_company_id
    for update;

  period_start := date_trunc('month', now() at time zone v_timezone) at time zone v_timezone;
  period_end   := (date_trunc('month', now() at time zone v_timezone) + interval '1 month') at time zone v_timezone;
  return next;
end;
$$;

revoke all on function public._lock_company_and_resolve_official_period(uuid) from public;
revoke all on function public._lock_company_and_resolve_official_period(uuid) from anon;
revoke all on function public._lock_company_and_resolve_official_period(uuid) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2) seller_competition_events — evolução de schema para 2 origens.
--    source_sale_id vira nullable; source_visit_id novo (nullable, FK,
--    UNIQUE — mesma proteção de idempotência de source_sale_id);
--    source_type discrimina qual dos dois está populado. Retrocompatível:
--    linhas do R2B recebem source_type='sale' automaticamente no backfill
--    abaixo, source_sale_id continua exatamente como estava.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.seller_competition_events
  add column source_type text,
  add column source_visit_id uuid references public.visits(id) on delete restrict;

update public.seller_competition_events set source_type = 'sale' where source_type is null;

alter table public.seller_competition_events
  alter column source_type set not null,
  alter column source_sale_id drop not null;

alter table public.seller_competition_events
  add constraint seller_competition_events_source_type_ck
    check (source_type in ('sale', 'visit')),
  -- Exatamente uma origem: nunca as duas preenchidas, nunca as duas NULL
  -- (§9 do EXEC).
  add constraint seller_competition_events_source_xor_ck
    check (
      (source_type = 'sale'  and source_sale_id  is not null and source_visit_id is null)
      or
      (source_type = 'visit' and source_visit_id is not null and source_sale_id  is null)
    ),
  add constraint seller_competition_events_source_visit_id_uniq
    unique (source_visit_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3) register_sale — mesmo contrato público exato; só passa a usar o
--    helper extraído acima em vez do bloco de lock+timezone inline, e
--    grava source_type='sale' explicitamente no insert do evento.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.register_sale(
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

  -- §16/§26 do EXEC: trava a company + resolve o mês oficial via helper
  -- compartilhado (mesmo usado por register_visit_result agora).
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
-- 4) register_visit_result — mesmo contrato público exato (auth, retorno,
--    erros, closed_at/outcome/imutabilidade, stale-write — §3 do EXEC).
--    Adiciona, dentro da MESMA transação (§25): lock+mês oficial, guarda
--    de empresa-sem-Sale (§15/§17 — nunca gera evento de Visit antes da
--    primeira Sale do mês, mesmo que a ordenação técnica entre Sellers
--    zerados mude), rank before/after via _rank_company_sellers, e
--    insert condicional do MESMO tipo de evento do R2B
--    (event_type='rank_up', nunca um tipo novo — a origem já é
--    source_type='visit').
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.register_visit_result(
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

  -- §16/§17 do EXEC — trava a company + mês oficial ANTES do UPDATE
  -- (mesmo helper de register_sale). Sem NENHUMA Sale no mês oficial, a
  -- disputa ainda não existe (§15/§21 do R2B) — Visit nunca gera evento
  -- nesse caso, e sequer calculamos old_rank (evita trabalho e qualquer
  -- ambiguidade sobre "rank técnico entre zerados").
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

  -- §20 do EXEC — evento SOMENTE quando new_rank < old_rank (nunca
  -- competition_started aqui: esse conceito é exclusivo de Sale — uma
  -- Visit nunca é "a primeira venda do mês"). Guarda defensiva idêntica à
  -- de register_sale: se o beneficiário não estiver no roster ativo
  -- (offboarded), old_rank/new_rank vêm NULL e o evento é omitido — a
  -- Visit já foi concluída normalmente acima de qualquer forma.
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
-- 5) list_my_unseen_competition_events — mesmo contrato + source_type
--    (§12 do EXEC). Assinatura de parâmetros inalterada, mas o RETURNS
--    TABLE ganhou uma coluna -> precisa DROP + CREATE (CREATE OR REPLACE
--    não permite mudar o shape de retorno).
-- ═══════════════════════════════════════════════════════════════════════

drop function public.list_my_unseen_competition_events();

create function public.list_my_unseen_competition_events()
returns table (
  id                    uuid,
  event_type            text,
  source_type           text,
  old_rank              integer,
  new_rank              integer,
  sale_count            integer,
  related_seller_id     text,
  related_seller_label  text,
  competition_started   boolean,
  period_start          timestamptz,
  period_end            timestamptz,
  created_at            timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_seller_id  text;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if public.is_platform_super_admin() then
    return;
  end if;

  v_company_id := public.current_membership_company_id();
  if v_company_id is null or public.current_membership_role() is distinct from 'seller' then
    return;
  end if;

  v_seller_id := public.current_profile_seller_id_for_company(v_company_id);
  if v_seller_id is null then
    return;
  end if;

  return query
  select
    e.id, e.event_type, e.source_type, e.old_rank, e.new_rank, e.sale_count,
    e.related_seller_id, rs.name as related_seller_label,
    e.competition_started, e.period_start, e.period_end, e.created_at
    from public.seller_competition_events e
    left join public.sellers rs on rs.company_id = e.company_id and rs.id = e.related_seller_id
   where e.company_id = v_company_id
     and e.seller_id = v_seller_id
     and e.seen_at is null
   order by e.created_at desc;
end;
$$;

revoke all on function public.list_my_unseen_competition_events() from public;
revoke all on function public.list_my_unseen_competition_events() from anon;
revoke all on function public.list_my_unseen_competition_events() from authenticated;
grant execute on function public.list_my_unseen_competition_events() to authenticated;

commit;
