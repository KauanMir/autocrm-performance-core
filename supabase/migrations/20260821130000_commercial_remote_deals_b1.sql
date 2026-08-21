-- COMMERCIAL-REMOTE-DEALS-B1 — Deals ("Propostas") remoto: schema + RLS +
-- RPC. Fonte: COMMERCIAL-REMOTE-DEALS-B1-PRECHECK + B1-A-PRECHECK + -R1
-- (contract freeze). Escopo: exclusivamente o backend local-only de Deals.
-- Nenhum frontend, nenhuma feature flag, nenhuma alteração em
-- Leads/Tasks/Visits/Sales. Migration NÃO aplicada remotamente neste lote.
--
-- Entidade (B1-PRECHECK §9, B1-A-PRECHECK §2-3): DEAL = NEGOCIAÇÃO =
-- "PROPOSTA" no produto atual — mesma entidade, provado pelo código
-- (FlowNovaProposta chama exclusivamente DealService.create). Nenhuma
-- tabela/entidade Proposal separada, nenhum proposal_id. A UI poderá
-- continuar chamando "Propostas" — o nome remoto é deals.
--
-- Resolver de contexto: resolve_commercial_mutation_context (20260819100000)
-- — já escrito para ser compartilhado por Tasks/Visits/Deals/Sales
-- ("precheck §12 — decisão A", comentário original da função) —
-- reutilizado sem nenhuma alteração.
--
-- Lead: sempre obrigatório (lead_id NOT NULL, diferente de Visits/Tasks que
-- permitem null) — a UX real de FlowNovaProposta trava sem lead
-- selecionado (canNext do step 0, B1-A-PRECHECK §6). client_name_snapshot
-- é resolvido do Lead pelo backend na criação e nunca mais sincronizado —
-- mesmo comportamento do legado (client: lead.name congelado no momento da
-- criação), preservado para sobreviver a rename/arquivamento posterior do
-- Lead. Sem seller_name_snapshot: nome do Seller resolvido via join/labels
-- RPC existente, mesmo padrão de Visits/Tasks.
--
-- Approval threshold (B1-A-PRECHECK §4, confirmado byte a byte no slider
-- 0-10 inteiro de FlowNovaProposta): discount_percent <= 5 -> open;
-- discount_percent > 5 -> pending_approval. Backend é autoridade — frontend
-- nunca envia status.
--
-- payment_method é enum FECHADO de 4 valores (achado corrigido em
-- B1-A-PRECHECK §12 — não é texto livre, é Segmented control fechado,
-- FlowsShared.tsx PAYS). installments continua texto livre (sem estrutura
-- numérica no legado).
--
-- Money: value_cents/down_payment_cents em centavos — legado usa reais
-- inteiros formatados como string ("R$ 120.000"), nunca centavos; a
-- conversão é responsabilidade da borda do frontend, não deste backend.
--
-- Sold compatibility (B1-A-PRECHECK-R1 §2/§6): SaleService.create pode
-- vender Deal em OPEN ou APPROVED; SaleService.cancel reverte para APPROVED
-- se approvedByUserId existia, senão OPEN — portanto approved_by/approved_at
-- NUNCA podem ser apagados na transição para sold. A constraint de
-- consistência abaixo reflete isso: sold aceita approval pair NULL (veio de
-- open) OU PRESENT (veio de approved), nunca rejection pair. Nenhum RPC
-- público desta série escreve status=sold — existe no enum só por
-- compatibilidade futura (Sale ainda não migrou).
--
-- Sem update_deal (B1-A-PRECHECK §16, achado confirmado): DealService.update
-- existe no legado mas tem zero caller de produção em todo o repo — não
-- inventar editor pós-criação que o produto nunca teve.
--
-- Concorrência: version + expected_version + stale_write, mesmo contrato de
-- Tasks/Leads/Visits. Único ponto de corrida real (sem update_deal): duas
-- decisões concorrentes sobre o mesmo Deal — resolvido pelo UPDATE
-- condicional (version + status='pending_approval').
--
-- Timeline: record_lead_timeline_event (helper interno de 20260731100000,
-- nunca exposto a authenticated) — chamado de dentro de cada RPC, na mesma
-- transação. Como lead_id é sempre NOT NULL, toda Deal sempre tem timeline
-- target (sem branch condicional como em Visits).
--
-- Sem Health remoto (B1-A-PRECHECK §24): deal_created/deal_approved/
-- deal_rejected permanecem gap client-side conhecido, não tocado aqui.
--
-- Sem DELETE: nenhum RPC de remoção física — rejected/sold são estados
-- terminais, mesmo padrão de archive_lead/complete_task/cancel_visit.

begin;

-- ── enums ─────────────────────────────────────────────────────────────

create type public.deal_status as enum (
  'open', 'pending_approval', 'approved', 'rejected', 'sold'
);

-- Mapping UI -> enum (B1-A-PRECHECK-R1 §9, confirmado em FlowsShared.tsx
-- PAYS): 'À vista' -> a_vista; 'Financiamento 100%' -> financiamento_100;
-- 'Entrada + Financiamento' -> entrada_financiamento; 'Troca' -> troca.
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
  approved_by           uuid,
  approved_at           timestamptz,
  rejected_by           uuid,
  rejected_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1,

  constraint deals_vehicle_ck check (btrim(vehicle) <> ''),
  constraint deals_value_ck check (value_cents > 0),
  constraint deals_down_payment_ck check (down_payment_cents is null or down_payment_cents >= 0),
  constraint deals_discount_ck check (discount_percent between 0 and 10),
  constraint deals_version_ck check (version >= 1),

  -- Actor/timestamp pairs (R1 §3): nunca metade de um par preenchida.
  constraint deals_approved_pair_ck check ((approved_by is null) = (approved_at is null)),
  constraint deals_rejected_pair_ck check ((rejected_by is null) = (rejected_at is null)),

  -- Decision consistency (R1 §2, corrigida): sold PRESERVA approval
  -- metadata quando veio de approved — nunca apagada na transição futura
  -- para sold. sold nunca carrega rejection metadata (rejected é terminal,
  -- sem caminho para sold).
  constraint deals_decision_consistency_ck check (
    case status
      when 'open'             then approved_by is null and rejected_by is null
      when 'pending_approval' then approved_by is null and rejected_by is null
      when 'approved'         then approved_by is not null and rejected_by is null
      when 'rejected'         then rejected_by is not null and approved_by is null
      when 'sold'             then rejected_by is null
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

  constraint deals_approved_by_fk
    foreign key (company_id, approved_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint deals_rejected_by_fk
    foreign key (company_id, rejected_by)
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
-- sempre tem assigned_seller_id NOT NULL, sem cláusula "ou sem
-- responsável"). Super Admin não recebe nenhuma policy neste B1 —
-- current_membership_company_id() é sempre NULL para Super Admin, então a
-- policy nega por construção.

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
  v_status        public.deal_status;
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

  -- Approval threshold (backend authority): discount <= 5 -> open;
  -- discount > 5 -> pending_approval. Frontend nunca envia status.
  v_status := case when p_discount_percent > 5 then 'pending_approval'::public.deal_status
                    else 'open'::public.deal_status end;

  insert into public.deals (
    company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle,
    value_cents, discount_percent, payment_method, down_payment_cents,
    installments, note, status, created_by, updated_by
  ) values (
    v_ctx.resolved_company_id, p_lead_id, v_lead_name, v_seller, btrim(p_vehicle),
    p_value_cents, p_discount_percent, p_payment_method, p_down_payment_cents,
    p_installments, coalesce(p_note, ''), v_status,
    v_ctx.actor_profile_id, v_ctx.actor_profile_id
  )
  returning * into v_row;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, p_lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'handshake', '#E8CE72', 'Proposta criada', null);

  return v_row;
end;
$$;

-- ── decide_deal ───────────────────────────────────────────────────────
-- Manager only. Válido somente a partir de pending_approval — nunca
-- re-decide um Deal já approved/rejected/open/sold (corrige lacuna real do
-- legado, que não checava status atual antes de aprovar/recusar).
-- p_decision aceita exatamente 'approved'/'rejected' — qualquer outro valor
-- é tratado como transição inválida (mesmo code de status incompatível).
-- Erros estáveis: forbidden, deal_not_found, invalid_status_transition,
-- stale_write.
create function public.decide_deal(
  p_id                uuid,
  p_expected_version  integer,
  p_decision          text
) returns public.deals
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx   record;
  v_deal  public.deals;
  v_row   public.deals;
  v_label text;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if v_ctx.actor_kind <> 'manager' then
    raise exception 'forbidden';
  end if;

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_status_transition';
  end if;

  select d.* into v_deal
    from public.deals d
    where d.id = p_id and d.company_id = v_ctx.resolved_company_id;
  if v_deal.id is null then
    raise exception 'deal_not_found';
  end if;

  if v_deal.status <> 'pending_approval' then
    raise exception 'invalid_status_transition';
  end if;

  if p_decision = 'approved' then
    update public.deals
      set status      = 'approved',
          approved_by = v_ctx.actor_profile_id,
          approved_at = now(),
          updated_by  = v_ctx.actor_profile_id
      where id = p_id
        and company_id = v_ctx.resolved_company_id
        and version = p_expected_version
        and status = 'pending_approval'
      returning * into v_row;
    v_label := 'Proposta aprovada';
  else
    update public.deals
      set status      = 'rejected',
          rejected_by = v_ctx.actor_profile_id,
          rejected_at = now(),
          updated_by  = v_ctx.actor_profile_id
      where id = p_id
        and company_id = v_ctx.resolved_company_id
        and version = p_expected_version
        and status = 'pending_approval'
      returning * into v_row;
    v_label := 'Proposta recusada';
  end if;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_deal.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'handshake', case when p_decision = 'approved' then '#27C75F' else '#FF3B3B' end,
    v_label, null);

  return v_row;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────

revoke all on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from public;
revoke all on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from anon;
revoke all on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) from authenticated;
grant execute on function public.create_deal(uuid, text, bigint, smallint, public.deal_payment_method, bigint, text, text, text) to authenticated;

revoke all on function public.decide_deal(uuid, integer, text) from public;
revoke all on function public.decide_deal(uuid, integer, text) from anon;
revoke all on function public.decide_deal(uuid, integer, text) from authenticated;
grant execute on function public.decide_deal(uuid, integer, text) to authenticated;

commit;
