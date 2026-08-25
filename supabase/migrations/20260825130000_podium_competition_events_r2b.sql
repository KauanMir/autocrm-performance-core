-- PODIUM-COMPETITION-R2B-B1-EXEC — eventos reais de melhora de ranking +
-- comemoração persistente do Seller. PRECHECK: PODIUM-COMPETITION-R2B-A1.
--
-- Este lote NÃO altera RLS de sales/visits/sellers. NÃO implementa
-- Realtime, evento por Visit, Central de notificações, ou movement arrows
-- (fora de escopo, ver PRECHECK §35/EXEC cabeçalho).
--
-- ═══════════════════════════════════════════════════════════════════════
-- 1) _rank_company_sellers — ÚNICA autoridade SQL do critério de
--    classificação (PRECHECK §5/EXEC §3/§4). Extraído do corpo de
--    list_company_seller_leaderboard (20260825120000) SEM alterar nenhum
--    critério: sale_count DESC, completed_visit_count DESC, MAX(sold_at)
--    ASC NULLS LAST (first-to-reach), seller_label/seller_id ASC
--    (fallback), row_number() para posições únicas. Retorna
--    setof seller_rank_row (não TABLE inline) para que register_sale possa
--    capturar o resultado como array (public.seller_rank_row[]) e
--    consultá-lo depois via unnest() — nenhuma tabela temporária, nenhuma
--    segunda query "quem ocupava a posição X" que pudesse divergir do
--    critério oficial.
--
--    SEM auth/authorization aqui de propósito: quem chama decide o que é
--    permitido (list_company_seller_leaderboard mantém sua própria
--    validação de Manager/Seller/Super Admin/company status; register_sale
--    já validou tudo via resolve_commercial_mutation_context antes de
--    chamar). Função puramente SQL (não plpgsql), stable, security
--    definer, sem GRANT a authenticated/anon/public — nunca chamada
--    diretamente pelo client, mesmo padrão de
--    resolve_commercial_mutation_context.
-- ═══════════════════════════════════════════════════════════════════════
begin;

create type public.seller_rank_row as (
  seller_id              text,
  seller_label           text,
  sale_count             integer,
  completed_visit_count  integer,
  rank                   integer
);

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
  ranked as (
    select
      r.id   as seller_id,
      r.name as seller_label,
      coalesce(sa.sale_count, 0)::int as sale_count,
      coalesce(va.completed_visit_count, 0)::int as completed_visit_count,
      (row_number() over (
         order by
           coalesce(sa.sale_count, 0) desc,
           coalesce(va.completed_visit_count, 0) desc,
           sa.last_sale_at asc nulls last,
           r.name asc,
           r.id asc
       ))::int as rank
      from roster r
      left join sales_agg sa on sa.id = r.id
      left join visits_agg va on va.id = r.id
  )
  select seller_id, seller_label, sale_count, completed_visit_count, rank
    from ranked
   order by rank;
$$;

revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from public;
revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from anon;
revoke all on function public._rank_company_sellers(uuid, timestamptz, timestamptz) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2) list_company_seller_leaderboard — mesmo contrato público EXATO
--    (assinatura, colunas, autorização, mensagens de erro), corpo
--    reescrito para delegar a classificação em si a _rank_company_sellers.
--    R1 não muda de comportamento — só para de duplicar a query.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.list_company_seller_leaderboard(
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_company_id   uuid default null
)
returns table (
  seller_id              text,
  seller_label           text,
  sale_count             integer,
  completed_visit_count  integer,
  rank                   integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_status     public.company_status;
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

  select c.status into v_status from public.companies c where c.id = v_company_id;
  if v_status is distinct from 'ativa' then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  return query
  select rc.seller_id, rc.seller_label, rc.sale_count, rc.completed_visit_count, rc.rank
    from public._rank_company_sellers(v_company_id, p_period_start, p_period_end) rc
   order by rc.rank;
end;
$$;

revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from public;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) public.seller_competition_events — log imutável (mesmo padrão de
--    public.sales: só created_at, nunca updated_at/version, exceto
--    seen_at que É a única coluna com escrita posterior permitida — e só
--    via mark_competition_events_seen, nunca UPDATE direto do client).
--
--    RLS: enable, ZERO policy, ZERO grant a authenticated/anon (mesmo
--    padrão de public.audit_log/public.company_memberships) — nenhum
--    acesso direto do browser, nem SELECT. Toda leitura/escrita passa
--    pelas 2 RPCs SECURITY DEFINER abaixo (§19 do EXEC: "se isso permitir
--    manter a tabela sem policy pública, melhor").
-- ═══════════════════════════════════════════════════════════════════════
create table public.seller_competition_events (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  -- beneficiário (§14 do EXEC) — SEMPRE o assigned_seller_id real da Sale
  -- que originou o evento, nunca quem chamou o RPC.
  seller_id             text not null,
  -- ator real (§14) — quem de fato chamou register_sale (Manager OU o
  -- próprio Seller). Preserva a distinção actor vs beneficiary mesmo
  -- quando os dois coincidem.
  actor_profile_id      uuid not null,
  -- idempotência (§15/§17 do EXEC) — uma Sale nunca produz mais de um
  -- evento, garantido estruturalmente pelo UNIQUE abaixo, não só pela
  -- lógica de aplicação.
  source_sale_id        uuid not null,
  -- V1 enxuta (§6 do EXEC): um único tipo; "assumiu 1º"/"entrou Top 3"/
  -- "ganhou N posições" são todos DERIVADOS de old_rank/new_rank/
  -- competition_started no frontend — nunca um enum por combinação.
  event_type            text not null default 'rank_up',
  old_rank              integer not null,
  new_rank              integer not null,
  sale_count            integer not null,
  -- quem ocupava new_rank no snapshot ANTERIOR à venda (§13 do EXEC) —
  -- nunca uma lista de todos os ultrapassados. NULL quando
  -- competition_started (não existe "quem eu ultrapassei" quando todo
  -- mundo estava em zero vendas no mês).
  related_seller_id     text,
  -- §7 do EXEC — primeira Sale da empresa no mês oficial: UI nunca deve
  -- dizer "ganhou N posições" nesse caso, mesmo que old_rank/new_rank
  -- tecnicamente existam entre Sellers zerados.
  competition_started   boolean not null default false,
  -- mês civil oficial da empresa no momento da venda (§2 do EXEC) — nunca
  -- o período visual do Pódio (Hoje/7/15/30/Personalizado).
  period_start          timestamptz not null,
  period_end            timestamptz not null,
  created_at            timestamptz not null default now(),
  -- null = ainda não visto. Setado SOMENTE por mark_competition_events_seen
  -- (§22/§23 do EXEC) — nunca ao simples fetch (§23: marcar seen só
  -- quando o usuário fecha/confirma a comemoração, nunca antes de
  -- garantir que ela realmente apareceu).
  seen_at               timestamptz,

  constraint seller_competition_events_source_sale_id_uniq unique (source_sale_id),
  constraint seller_competition_events_event_type_ck check (event_type = 'rank_up'),
  constraint seller_competition_events_rank_ck check (old_rank > 0 and new_rank > 0),
  -- ZERO evento negativo (§12/§26 do EXEC) — new_rank nunca pode ser pior
  -- que old_rank nesta tabela, reforçado estruturalmente, não só pela
  -- lógica condicional de register_sale.
  constraint seller_competition_events_improvement_ck check (new_rank <= old_rank),
  constraint seller_competition_events_period_ck check (period_start < period_end),

  constraint seller_competition_events_company_seller_fk
    foreign key (company_id, seller_id)
    references public.sellers (company_id, id)
    on delete restrict,

  -- composto e nullable: um FK MATCH SIMPLE (default) é satisfeito
  -- automaticamente quando related_seller_id é NULL — não exige uma linha
  -- correspondente nesse caso (mesmo raciocínio de invited_by_profile_id
  -- em public.invites).
  constraint seller_competition_events_company_related_seller_fk
    foreign key (company_id, related_seller_id)
    references public.sellers (company_id, id)
    on delete restrict,

  -- mesmo shape de sales_sold_by_fk — valida que o ator tinha membership
  -- real na empresa no momento do evento.
  constraint seller_competition_events_actor_fk
    foreign key (company_id, actor_profile_id)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint seller_competition_events_source_sale_fk
    foreign key (source_sale_id)
    references public.sales (id)
    on delete restrict
);

-- índice parcial: a query real (list_my_unseen_competition_events) só lê
-- linhas com seen_at is null, para 1 company_id + seller_id — mesmo
-- critério de "só os índices justificados pelos readers reais" já usado
-- em sales/visits/deals.
create index seller_competition_events_seller_unseen_idx
  on public.seller_competition_events (company_id, seller_id, created_at desc)
  where seen_at is null;

create index seller_competition_events_company_id_idx
  on public.seller_competition_events (company_id);

alter table public.seller_competition_events enable row level security;

revoke all on table public.seller_competition_events from public;
revoke all on table public.seller_competition_events from anon;
revoke all on table public.seller_competition_events from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4) register_sale — mesmo contrato público EXATO (assinatura, retorno
--    public.deals, erros estáveis, ordem de validação, autoridade de
--    assigned_seller/sold_at/imutabilidade — §10/§18 do EXEC: "não alterar
--    o return contract público só para transportar evento"). Adiciona,
--    dentro da MESMA transação (§16 do EXEC):
--      a) trava a company (§8) ANTES do cálculo old/new rank — serializa
--         vendas concorrentes de Deals DIFERENTES da mesma empresa (a
--         trava de Deal já existente só serializa a MESMA Deal);
--      b) resolve o mês civil oficial via companies.timezone (§2);
--      c) calcula competition_started ANTES do insert (§7);
--      d) calcula old_rank ANTES do insert, new_rank DEPOIS, mesma função
--         _rank_company_sellers (§3/§4/§9/§11);
--      e) insere 1 evento SOMENTE se new_rank < old_rank OU
--         competition_started — nunca em piora/igual (§12);
--      f) related_seller = ocupante anterior de new_rank, nunca uma lista
--         (§13).
--
--    Guarda defensiva NÃO pedida literalmente pelo EXEC mas necessária
--    para nunca quebrar uma venda legítima: se o Seller beneficiário não
--    aparecer no roster ativo (ex.: Deal ainda assignada a um Seller já
--    offboarded — sellers.is_active=false, fora do roster de
--    _rank_company_sellers), old_rank/new_rank vêm NULL — nesse caso o
--    evento é simplesmente omitido (a Sale continua sendo criada
--    normalmente). A camada competitiva é aditiva, nunca pode bloquear o
--    fluxo comercial real.
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
  v_company_timezone    text;
  v_period_start        timestamptz;
  v_period_end          timestamptz;
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

  -- §8 do EXEC: trava a company ANTES de qualquer cálculo de ranking —
  -- mesma linha já obtém o timezone oficial (§2), uma única leitura.
  select c.timezone into v_company_timezone
    from public.companies c
    where c.id = v_ctx.resolved_company_id
    for update;

  v_period_start := date_trunc('month', now() at time zone v_company_timezone) at time zone v_company_timezone;
  v_period_end   := (date_trunc('month', now() at time zone v_company_timezone) + interval '1 month') at time zone v_company_timezone;

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

  -- §7 do EXEC — calculado ANTES do insert: a empresa ainda não tinha
  -- NENHUMA Sale no mês oficial corrente.
  v_competition_started := not exists (
    select 1 from public.sales sa
     where sa.company_id = v_ctx.resolved_company_id
       and sa.sold_at >= v_period_start
       and sa.sold_at <= v_period_end
  );

  -- §9 do EXEC — ranking ANTES do insert, capturado como array para
  -- consultar depois "quem ocupava a posição X" sem uma segunda query
  -- fora do critério oficial (§13).
  select coalesce(array_agg(r), '{}') into v_old_ranking
    from public._rank_company_sellers(v_ctx.resolved_company_id, v_period_start, v_period_end) r;

  select x.rank into v_old_rank
    from unnest(v_old_ranking) x
    where x.seller_id = v_deal.assigned_seller_id;

  -- company_id/lead_id/assigned_seller_id vêm SEMPRE da Deal já travada —
  -- nunca do cliente (evita spoofing, PRECHECK §6/§15 do A1 original).
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

  -- §11 do EXEC — ranking DEPOIS do insert, mesma transação, mesma
  -- função interna (nunca um segundo critério).
  select coalesce(array_agg(r), '{}') into v_new_ranking
    from public._rank_company_sellers(v_ctx.resolved_company_id, v_period_start, v_period_end) r;

  select x.rank, x.sale_count into v_new_rank, v_new_sale_count
    from unnest(v_new_ranking) x
    where x.seller_id = v_deal.assigned_seller_id;

  -- §12 do EXEC — evento SOMENTE em melhora real ou abertura da disputa.
  -- Guarda defensiva: old_rank/new_rank podem vir NULL se o Seller
  -- beneficiário não estiver no roster ativo (ex.: offboarded) — nesse
  -- caso a Sale já foi criada normalmente acima, só o evento é omitido.
  if v_old_rank is not null and v_new_rank is not null
     and (v_new_rank < v_old_rank or v_competition_started) then
    v_related_seller_id := null;
    if not v_competition_started then
      -- §13 do EXEC — quem ocupava new_rank no snapshot ANTERIOR.
      select x.seller_id into v_related_seller_id
        from unnest(v_old_ranking) x
        where x.rank = v_new_rank and x.seller_id is distinct from v_deal.assigned_seller_id;
    end if;

    insert into public.seller_competition_events (
      company_id, seller_id, actor_profile_id, source_sale_id, event_type,
      old_rank, new_rank, sale_count, related_seller_id,
      competition_started, period_start, period_end
    ) values (
      v_ctx.resolved_company_id, v_deal.assigned_seller_id, v_ctx.actor_profile_id, v_sale_id, 'rank_up',
      v_old_rank, v_new_rank, coalesce(v_new_sale_count, 0), v_related_seller_id,
      v_competition_started, v_period_start, v_period_end
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
-- 5) list_my_unseen_competition_events — Seller-only (§20 do EXEC).
--    Company e Seller SEMPRE derivados da identidade real (nunca um
--    p_company_id/p_seller_id de parâmetro). Manager/Super Admin sem
--    company/sem membership de Seller: conjunto vazio, nunca erro (não é
--    uma condição excepcional, é o estado normal de quem não tem
--    comemoração pessoal — §31 do EXEC). JOIN com sellers só para
--    resolver related_seller_label pronto (nunca o client monta o nome a
--    partir de um id cru de outro Seller).
-- ═══════════════════════════════════════════════════════════════════════
create function public.list_my_unseen_competition_events()
returns table (
  id                    uuid,
  event_type            text,
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
    e.id, e.event_type, e.old_rank, e.new_rank, e.sale_count,
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

-- ═══════════════════════════════════════════════════════════════════════
-- 6) mark_competition_events_seen — Seller só marca os PRÓPRIOS eventos
--    (§22 do EXEC). Filtro company_id+seller_id no próprio UPDATE (não só
--    um check prévio) — mesmo se IDs de outro Seller/empresa forem
--    passados, são silenciosamente ignorados (0 linhas afetadas para
--    eles), nunca um erro que vaze existência de eventos alheios.
--    Diferente do RPC de leitura acima, aqui é mutação: Manager/Super
--    Admin/sem membership de Seller recebem 'forbidden' (mesmo padrão de
--    mutation RPCs existentes — resolve_commercial_mutation_context-style
--    denial), não um "0 silencioso" — não há razão legítima para esses
--    papéis chamarem esta RPC.
-- ═══════════════════════════════════════════════════════════════════════
create function public.mark_competition_events_seen(
  p_event_ids uuid[]
)
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

  if p_event_ids is null or array_length(p_event_ids, 1) is null then
    return 0;
  end if;

  if public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_company_id := public.current_membership_company_id();
  if v_company_id is null or public.current_membership_role() is distinct from 'seller' then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_seller_id := public.current_profile_seller_id_for_company(v_company_id);
  if v_seller_id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  update public.seller_competition_events
     set seen_at = now()
   where id = any(p_event_ids)
     and company_id = v_company_id
     and seller_id = v_seller_id
     and seen_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_competition_events_seen(uuid[]) from public;
revoke all on function public.mark_competition_events_seen(uuid[]) from anon;
revoke all on function public.mark_competition_events_seen(uuid[]) from authenticated;
grant execute on function public.mark_competition_events_seen(uuid[]) to authenticated;

commit;
