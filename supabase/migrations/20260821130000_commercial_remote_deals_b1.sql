-- COMMERCIAL-REMOTE-DEALS-B1 — Negociações remoto: schema + RLS + RPC.
-- Fonte: COMMERCIAL-REMOTE-DEALS-B1-PRECHECK + B1-A-PRECHECK + -R1 +
-- B1-A-PRODUCT-PIVOT-PRECHECK (contract freeze, pivot de produto). Escopo:
-- exclusivamente o backend local-only de Deals. Nenhum frontend, nenhuma
-- feature flag, nenhuma alteração em Leads/Tasks/Visits/Sales. Migration
-- NÃO aplicada remotamente neste lote — editada IN-PLACE (nunca chegou ao
-- histórico remoto, LOCAL=53/REMOTE=52 durante todo o B1-A), não existe
-- migration #54 corretiva.
--
-- PIVOT DE PRODUTO (B1-A-PRODUCT-PIVOT-PRECHECK): o CRM deve ser simples,
-- rápido e não depender de gerente online para o vendedor operar. Manager é
-- SUPERVISOR, não approval gate. O design original (aberto/aprovação
-- pendente/aprovado/recusado, decide_deal Manager-only) foi removido por
-- completo antes de qualquer rollout remoto — nenhum consumidor frontend
-- jamais existiu para o contrato antigo.
--
-- Entidade: DEAL = NEGOCIAÇÃO — mesma entidade histórica de "Proposta"
-- (FlowNovaProposta chamava exclusivamente DealService.create), mas o
-- vocabulário de produto migra para "Negociação" (timeline, futura UI).
-- Nenhuma tabela/entidade Proposal separada, nenhum proposal_id.
--
-- Resolver de contexto: resolve_commercial_mutation_context (20260819100000)
-- — compartilhado por Tasks/Visits/Deals/Sales — reutilizado sem alteração.
--
-- Lead: sempre obrigatório (lead_id NOT NULL). client_name_snapshot
-- resolvido do Lead pelo backend na criação, nunca mais sincronizado —
-- sobrevive a rename/arquivamento posterior do Lead. Sem
-- seller_name_snapshot: nome do Seller resolvido via join/labels RPC
-- existente, mesmo padrão de Visits/Tasks.
--
-- Lifecycle simplificado (pivot): open -> lost (mark_deal_lost) ou
-- open -> sold FUTURAMENTE via Sale (nenhum RPC deste lote escreve sold —
-- existe no enum só por compatibilidade futura). lost é terminal. sold é
-- terminal para Deals (Sale será autoridade exclusiva da conversão).
-- Nenhuma aprovação, nenhum threshold de desconto controla lifecycle.
--
-- discount_percent permanece smallint 0..10 — preservação deliberada da
-- superfície atual (slider legado), NÃO uma nova regra de produto validada;
-- documentado como FUTURE-REVIEW no relatório do EXEC. Nunca mais decide
-- status — é só um dado comercial armazenado.
--
-- payment_method é enum FECHADO de 4 valores (FlowsShared.tsx PAYS),
-- inalterado neste pivot. installments continua texto livre.
--
-- Money: value_cents/down_payment_cents em centavos — conversão é
-- responsabilidade da borda do frontend, não deste backend.
--
-- update_deal (decisão reaberta no pivot — B1-A-PRODUCT-PIVOT-PRECHECK §7,
-- diverge da decisão original do B1-A-PRECHECK §16): negociação é um
-- processo vivo, condições mudam com frequência na operação real. Editável
-- somente enquanto open; Seller só a própria, Manager qualquer da company
-- (pode reatribuir Seller, mesmo padrão de update_visit). lead_id e
-- client_name_snapshot são imutáveis — trocar o Lead é outra negociação.
-- Nenhum evento de timeline em edição comum (evitar poluir a timeline do
-- Lead numa negociação editada com frequência) — exceção: reatribuição real
-- de Seller gera "Responsável alterado", mesmo critério de "só evento
-- quando o valor muda de fato" já usado em assign_lead_seller/
-- move_lead_to_stage/update_visit.
--
-- mark_deal_lost: encerramento simples, sem burocracia — sem lost_reason
-- estruturado (FUTURE, o campo note livre já cobre o caso mínimo). Segue
-- funcionando mesmo se o Lead for arquivado depois (fechar uma negociação
-- órfã não deve exigir reativar o Lead) — diferente de update_deal, que
-- bloqueia contra Lead arquivado (editar termos comerciais de uma
-- oportunidade já encerrada não faz sentido).
--
-- Concorrência: version + expected_version + stale_write, mesmo contrato de
-- Tasks/Leads/Visits, agora também em update_deal.
--
-- Timeline: record_lead_timeline_event (helper interno de 20260731100000,
-- nunca exposto a authenticated) — chamado de dentro de cada RPC, na mesma
-- transação. lead_id sempre NOT NULL -> toda Deal sempre tem timeline
-- target.
--
-- Sem Health remoto: deal_created/deal_lost permanecem gap client-side
-- conhecido, não tocado aqui.
--
-- Sem DELETE: nenhum RPC de remoção física — lost/sold são estados
-- terminais, mesmo padrão de archive_lead/complete_task/cancel_visit.

begin;

-- ── enums ─────────────────────────────────────────────────────────────

create type public.deal_status as enum ('open', 'lost', 'sold');

-- Mapping UI -> enum (confirmado em FlowsShared.tsx PAYS): 'À vista' ->
-- a_vista; 'Financiamento 100%' -> financiamento_100; 'Entrada +
-- Financiamento' -> entrada_financiamento; 'Troca' -> troca.
create type public.deal_payment_method as enum (
  'a_vista', 'financiamento_100', 'entrada_financiamento', 'troca'
);

-- ── table public.deals ───────────────────────────────────────────────────

create table public.deals (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  lead_id               uuid not null,
  client_name_snapshot  text not null,
  assigned_seller_id    text not null,
  vehicle               text not null,
  value_cents           bigint not null,
  discount_percent      smallint not null,
  payment_method        public.deal_payment_method not null,
  down_payment_cents    bigint,
  installments          text,
  note                  text not null default '',
  status                public.deal_status not null default 'open',
  created_by            uuid not null,
  updated_by            uuid not null,
  lost_by               uuid,
  lost_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1,

  constraint deals_vehicle_ck check (btrim(vehicle) <> ''),
  constraint deals_value_ck check (value_cents > 0),
  constraint deals_down_payment_ck check (down_payment_cents is null or down_payment_cents >= 0),
  constraint deals_discount_ck check (discount_percent between 0 and 10),
  constraint deals_version_ck check (version >= 1),

  -- Actor/timestamp pair: nunca metade preenchida.
  constraint deals_lost_pair_ck check ((lost_by is null) = (lost_at is null)),

  -- Lost consistency: open/sold nunca carregam lost metadata; lost sempre
  -- carrega. sold permanece inalcançável pelos RPCs deste lote, mas o
  -- schema já é compatível com a futura Sale (open -> sold direto, sem
  -- nenhum metadata de perda envolvido).
  constraint deals_lost_consistency_ck check (
    case status
      when 'open' then lost_by is null
      when 'lost' then lost_by is not null
      when 'sold' then lost_by is null
      else false
    end
  ),

  constraint deals_company_lead_fk
    foreign key (company_id, lead_id)
    references public.leads (company_id, id)
    on delete restrict,

  constraint deals_company_seller_fk
    foreign key (company_id, assigned_seller_id)
    references public.sellers (company_id, id)
    on delete restrict,

  constraint deals_created_by_fk
    foreign key (company_id, created_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint deals_updated_by_fk
    foreign key (company_id, updated_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint deals_lost_by_fk
    foreign key (company_id, lost_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict
);

-- ── indexes (somente os justificados pelos readers reais, mesmo critério
-- de Tasks/Visits) ────────────────────────────────────────────────────────

create index deals_company_status_created_idx
  on public.deals (company_id, status, created_at);

create index deals_company_seller_status_created_idx
  on public.deals (company_id, assigned_seller_id, status, created_at);

create index deals_company_lead_idx
  on public.deals (company_id, lead_id);

-- ── triggers ──────────────────────────────────────────────────────────
-- Mesmo padrão exato de tasks_bump_version/visits_bump_version — autoridade
-- única de version, nunca incrementado manualmente nos RPCs. updated_at
-- reusa o trigger genérico já existente (public.set_updated_at()).

create function public.deals_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger deals_bump_version
  before update on public.deals
  for each row execute function public.deals_bump_version();

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- ── RLS: somente SELECT ───────────────────────────────────────────────
-- Espelha visits_select/tasks_select. Seller aqui é SEMPRE own-only (Deal
-- sempre tem assigned_seller_id NOT NULL). Super Admin não recebe nenhuma
-- policy neste B1 — current_membership_company_id() é sempre NULL para
-- Super Admin, então a policy nega por construção.

alter table public.deals enable row level security;

create policy deals_select on public.deals
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and exists (
      select 1 from public.companies c
      where c.id = deals.company_id and c.status = 'ativa'
    )
    and (
      public.current_membership_role() = 'manager'
      or (
        public.current_membership_role() = 'seller'
        and assigned_seller_id = public.current_profile_seller_id_for_company(deals.company_id)
      )
    )
  );

-- ── grants: SELECT-only ──────────────────────────────────────────────

revoke all on table public.deals from public;
revoke all on table public.deals from anon;
revoke all on table public.deals from authenticated;

grant select on public.deals to authenticated;

-- ── create_deal ───────────────────────────────────────────────────────
-- Toda Deal nasce open — discount nunca altera lifecycle, nenhuma
-- aprovação envolvida.
-- Erros estáveis: forbidden, lead_not_found, lead_archived, seller_required,
-- seller_not_found, invalid_vehicle, invalid_value, invalid_discount.
create function public.create_deal(
  p_lead_id             uuid,
  p_vehicle             text,
  p_value_cents         bigint,
  p_discount_percent    smallint,
  p_payment_method      public.deal_payment_method,
  p_down_payment_cents  bigint default null,
  p_installments        text default null,
  p_note                text default '',
  p_assigned_seller_id  text default null
) returns public.deals
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx           record;
  v_seller        text;
  v_lead_name     text;
  v_lead_seller   text;
  v_lead_archived boolean;
  v_row           public.deals;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if btrim(coalesce(p_vehicle, '')) = '' then
    raise exception 'invalid_vehicle';
  end if;

  if p_value_cents is null or p_value_cents <= 0 then
    raise exception 'invalid_value';
  end if;

  if p_discount_percent is null or p_discount_percent < 0 or p_discount_percent > 10 then
    raise exception 'invalid_discount';
  end if;

  select l.name, l.seller_id, (l.archived_at is not null)
    into v_lead_name, v_lead_seller, v_lead_archived
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_ctx.resolved_company_id;
  if not found then
    raise exception 'lead_not_found';
  end if;
  if v_lead_archived then
    raise exception 'lead_archived';
  end if;

  if v_ctx.actor_kind = 'seller' then
    -- Seller sempre autoatribuído; escolher outro seller é proibido.
    if p_assigned_seller_id is not null and p_assigned_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_ctx.actor_seller_id;
  else
    -- Manager: responsável explícito sempre vence. Sem parâmetro, tenta o
    -- seller do Lead (se ativo); sem seller ativo, responsável é
    -- obrigatório.
    if p_assigned_seller_id is not null then
      perform 1 from public.sellers s
        where s.id = p_assigned_seller_id
          and s.company_id = v_ctx.resolved_company_id
          and s.is_active;
      if not found then
        raise exception 'seller_not_found';
      end if;
      v_seller := p_assigned_seller_id;
    elsif v_lead_seller is not null then
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

  insert into public.deals (
    company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle,
    value_cents, discount_percent, payment_method, down_payment_cents,
    installments, note, status, created_by, updated_by
  ) values (
    v_ctx.resolved_company_id, p_lead_id, v_lead_name, v_seller, btrim(p_vehicle),
    p_value_cents, p_discount_percent, p_payment_method, p_down_payment_cents,
    p_installments, coalesce(p_note, ''), 'open',
    v_ctx.actor_profile_id, v_ctx.actor_profile_id
  )
  returning * into v_row;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, p_lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'handshake', '#E8CE72', 'Negociação criada', null);

  return v_row;
end;
$$;

-- ── update_deal ───────────────────────────────────────────────────────
-- Negociação é processo vivo — condições mudam com frequência. Válido
-- somente enquanto open. lead_id/client_name_snapshot são imutáveis (trocar
-- o Lead é outra negociação). Nenhum evento de timeline em edição comum
-- (evitar poluir a timeline) — exceção: reatribuição real de Seller gera
-- "Responsável alterado", só quando o valor muda de fato.
-- Erros estáveis: forbidden, deal_not_found, deal_closed, lead_archived,
-- seller_not_found, invalid_vehicle, invalid_value, invalid_discount,
-- stale_write.
create function public.update_deal(
  p_id                  uuid,
  p_expected_version    integer,
  p_vehicle             text,
  p_value_cents         bigint,
  p_discount_percent    smallint,
  p_payment_method      public.deal_payment_method,
  p_down_payment_cents  bigint default null,
  p_installments        text default null,
  p_note                text default '',
  p_assigned_seller_id  text default null
) returns public.deals
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx            record;
  v_deal           public.deals;
  v_row            public.deals;
  v_new_seller     text;
  v_lead_archived  boolean;
  v_seller_changed boolean;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  if btrim(coalesce(p_vehicle, '')) = '' then
    raise exception 'invalid_vehicle';
  end if;

  if p_value_cents is null or p_value_cents <= 0 then
    raise exception 'invalid_value';
  end if;

  if p_discount_percent is null or p_discount_percent < 0 or p_discount_percent > 10 then
    raise exception 'invalid_discount';
  end if;

  select d.* into v_deal
    from public.deals d
    where d.id = p_id and d.company_id = v_ctx.resolved_company_id;
  if v_deal.id is null then
    raise exception 'deal_not_found';
  end if;

  if v_deal.status <> 'open' then
    raise exception 'deal_closed';
  end if;

  if v_ctx.actor_kind = 'seller' then
    -- Seller só edita a própria Deal e nunca pode reatribuir.
    if v_deal.assigned_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    if p_assigned_seller_id is distinct from v_deal.assigned_seller_id then
      raise exception 'forbidden';
    end if;
    v_new_seller := v_deal.assigned_seller_id;
  else
    -- Manager: pode reatribuir para qualquer Seller ativo elegível da
    -- empresa; responsável continua obrigatório.
    if p_assigned_seller_id is null then
      raise exception 'seller_required';
    end if;
    if p_assigned_seller_id is distinct from v_deal.assigned_seller_id then
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

  -- Lead arquivado bloqueia edição de termos comerciais — mas não a
  -- leitura, nem mark_deal_lost (ver §24 do EXEC).
  select (l.archived_at is not null) into v_lead_archived
    from public.leads l
    where l.id = v_deal.lead_id and l.company_id = v_ctx.resolved_company_id;
  if v_lead_archived then
    raise exception 'lead_archived';
  end if;

  v_seller_changed := v_new_seller is distinct from v_deal.assigned_seller_id;

  update public.deals
    set vehicle             = btrim(p_vehicle),
        value_cents         = p_value_cents,
        discount_percent    = p_discount_percent,
        payment_method      = p_payment_method,
        down_payment_cents  = p_down_payment_cents,
        installments        = p_installments,
        note                = coalesce(p_note, ''),
        assigned_seller_id  = v_new_seller,
        updated_by          = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status = 'open'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  if v_seller_changed then
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, v_deal.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      'users', '#3B82F6', 'Responsável alterado', null);
  end if;

  return v_row;
end;
$$;

-- ── mark_deal_lost ────────────────────────────────────────────────────
-- Encerramento simples, sem burocracia — sem lost_reason estruturado
-- (FUTURE). Continua funcionando mesmo se o Lead relacionado já estiver
-- arquivado (fechar uma negociação órfã não deve exigir reativar o Lead).
-- Erros estáveis: forbidden, deal_not_found, deal_closed, stale_write.
create function public.mark_deal_lost(
  p_id                uuid,
  p_expected_version  integer
) returns public.deals
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx  record;
  v_deal public.deals;
  v_row  public.deals;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select d.* into v_deal
    from public.deals d
    where d.id = p_id and d.company_id = v_ctx.resolved_company_id;
  if v_deal.id is null then
    raise exception 'deal_not_found';
  end if;

  if v_ctx.actor_kind = 'seller' and v_deal.assigned_seller_id is distinct from v_ctx.actor_seller_id then
    raise exception 'forbidden';
  end if;

  if v_deal.status <> 'open' then
    raise exception 'deal_closed';
  end if;

  update public.deals
    set status     = 'lost',
        lost_by    = v_ctx.actor_profile_id,
        lost_at    = now(),
        updated_by = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status = 'open'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_deal.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'xCircle', '#FF3B3B', 'Negociação perdida', null);

  return v_row;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────

revoke all on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from public;
revoke all on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from anon;
revoke all on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from authenticated;
grant execute on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) to authenticated;

revoke all on function public.update_deal(uuid, integer, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from public;
revoke all on function public.update_deal(uuid, integer, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from anon;
revoke all on function public.update_deal(uuid, integer, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from authenticated;
grant execute on function public.update_deal(uuid, integer, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) to authenticated;

revoke all on function public.mark_deal_lost(uuid, integer) from public;
revoke all on function public.mark_deal_lost(uuid, integer) from anon;
revoke all on function public.mark_deal_lost(uuid, integer) from authenticated;
grant execute on function public.mark_deal_lost(uuid, integer) to authenticated;

commit;
