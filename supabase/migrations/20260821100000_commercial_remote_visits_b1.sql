-- COMMERCIAL-REMOTE-VISITS-B1 — Visits remoto: schema + RLS + RPC
-- Fonte: COMMERCIAL-REMOTE-VISITS-AUDIT + VISITS-B1-PRECHECK + -R1 (design
-- freeze). Escopo: exclusivamente o backend de Visits. Nenhum frontend,
-- nenhuma feature flag, nenhuma alteração em Tasks/Leads/Deals/Sales.
--
-- Modelo de identidade: mesmo resolver de Tasks
-- (resolve_commercial_mutation_context, 20260819100000), reutilizado sem
-- nenhuma alteração — já genérico o bastante (nenhum parâmetro
-- Tasks-específico). Nenhum segundo resolver criado.
--
-- status (ciclo de vida) vs outcome (resultado comercial) são conceitos
-- separados (R1 §1-2): status nunca carrega 'pending'/'awaiting_result'/
-- 'rescheduled'/'done'/'no_interest' — só scheduled/confirmed/canceled/
-- completed. outcome só existe quando completed (constraint
-- visits_outcome_consistency_ck). "Pending result" (visita já passou, sem
-- resultado) é estado DERIVADO no frontend (scheduled_at < now() AND status
-- IN ('scheduled','confirmed')) — nunca uma coluna/trigger aqui.
--
-- Reschedule (R1 §6-7, §11): update_visit na MESMA row (nunca cria uma
-- segunda Visit) — só quando scheduled_at realmente muda: confirmed volta
-- para scheduled (a confirmação era para o horário antigo); scheduled
-- continua scheduled. Evento de timeline "Visita remarcada" só quando
-- scheduled_at de fato mudou (mesmo padrão de move_lead_to_stage/
-- assign_lead_seller: só evento quando o valor muda de verdade).
--
-- Seller: sempre obrigatório (assigned_seller_id NOT NULL, diferente de
-- Tasks) — nunca "unassigned visível a qualquer Seller" (VISITS-AUDIT §33,
-- decisão explícita divergente de Tasks). Seller nunca escolhe/reatribui.
--
-- Lead arquivado: rejeitado apenas na CRIAÇÃO de uma nova Visit
-- (lead_archived) — nunca ao editar uma Visit já existente cujo Lead foi
-- arquivado depois (VISITS-B1-PRECHECK §9, decisão nova para este domínio,
-- Tasks/Leads não tinham essa regra pois nenhuma Visit é o objeto
-- "principal" de um Lead do jeito que um Lead é de si mesmo).
--
-- Timeline: reusa record_lead_timeline_event (helper interno de
-- 20260731100000, nunca exposto a authenticated) — chamado de dentro de
-- cada RPC, na mesma transação, só quando lead_id IS NOT NULL. RPC é a
-- única autoridade — nenhum dual-write do cliente.
--
-- Concorrência: version + expected_version + stale_write, mesmo contrato de
-- Tasks/Leads.
--
-- Sem DELETE: cancel_visit é o único "encerramento" não-destrutivo
-- disponível (mesmo padrão de archive_lead/complete_task).

begin;

-- ── enums ─────────────────────────────────────────────────────────────

create type public.visit_status as enum ('scheduled', 'confirmed', 'canceled', 'completed');

create type public.visit_outcome as enum ('sold', 'negotiating', 'thinking', 'no_interest');

-- ── helper: validação de vehicles (não pode ir em CHECK direto — CHECK não
-- aceita subquery, e unnest() é set-returning; função immutable resolve os
-- dois problemas sem precisar de uma segunda tabela de vehicles) ──────────

create function public.visits_vehicles_valid(p_vehicles text[]) returns boolean
language sql immutable as $$
  -- array_length(ARRAY[]::text[], 1) is NULL, not 0 — coalesce needed or an
  -- empty array would silently pass the ">= 1" check.
  select p_vehicles is not null
    and coalesce(array_length(p_vehicles, 1), 0) >= 1
    and not exists (select 1 from unnest(p_vehicles) v where btrim(v) = '');
$$;

revoke all on function public.visits_vehicles_valid(text[]) from public;
revoke all on function public.visits_vehicles_valid(text[]) from anon;
revoke all on function public.visits_vehicles_valid(text[]) from authenticated;
-- Nenhum GRANT a authenticated de propósito — só usada dentro das RPCs
-- SECURITY DEFINER abaixo (que executam como postgres, nunca como
-- authenticated, então nenhum EXECUTE explícito é necessário para elas
-- chamarem esta função).

-- ── table public.visits ──────────────────────────────────────────────────

create table public.visits (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  lead_id             uuid,
  -- Só preenchido quando NÃO há Lead (visita "avulsa") — quando lead_id
  -- existe, o nome vem sempre do Lead via join, nunca duplicado aqui.
  client_name         text,
  assigned_seller_id  text not null,
  vehicles            text[] not null,
  scheduled_at        timestamptz not null,
  status              public.visit_status not null default 'scheduled',
  outcome             public.visit_outcome,
  note                text not null default '',
  result_note         text,
  created_by          uuid,
  updated_by          uuid,
  closed_by           uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  closed_at           timestamptz,
  version             integer not null default 1,

  constraint visits_client_identity_ck check (
    lead_id is not null or btrim(coalesce(client_name, '')) <> ''
  ),
  constraint visits_vehicles_ck check (public.visits_vehicles_valid(vehicles)),
  constraint visits_version_ck check (version >= 1),

  -- status vs outcome (R1 §2-4): outcome só existe quando completed.
  constraint visits_outcome_consistency_ck check (
    (status = 'completed' and outcome is not null)
    or
    (status <> 'completed' and outcome is null)
  ),

  -- closed_at/closed_by (R1 §5-6): preenchidos exatamente em completed e
  -- canceled, nunca em scheduled/confirmed.
  constraint visits_closed_consistency_ck check (
    (status in ('scheduled', 'confirmed') and closed_at is null and closed_by is null)
    or
    (status in ('completed', 'canceled') and closed_at is not null and closed_by is not null)
  ),

  constraint visits_company_lead_fk
    foreign key (company_id, lead_id)
    references public.leads (company_id, id)
    on delete restrict,

  constraint visits_company_seller_fk
    foreign key (company_id, assigned_seller_id)
    references public.sellers (company_id, id)
    on delete restrict,

  constraint visits_created_by_fk
    foreign key (company_id, created_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint visits_updated_by_fk
    foreign key (company_id, updated_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint visits_closed_by_fk
    foreign key (company_id, closed_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict
);

-- ── indexes (somente os justificados pelos readers reais, mesmo critério
-- de Tasks §10) ──────────────────────────────────────────────────────────

create index visits_company_status_scheduled_idx
  on public.visits (company_id, status, scheduled_at);

create index visits_company_seller_status_scheduled_idx
  on public.visits (company_id, assigned_seller_id, status, scheduled_at);

create index visits_company_lead_idx
  on public.visits (company_id, lead_id);

-- ── triggers ──────────────────────────────────────────────────────────
-- Mesmo padrão exato de tasks_bump_version (m1e_01/B1 Tasks) — nenhum
-- mecanismo alternativo. updated_at reusa o trigger genérico já usado por
-- companies/profiles/sellers/pipeline_stages/leads/company_memberships/
-- invites/tasks (public.set_updated_at()) — não recriado.

create function public.visits_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger visits_bump_version
  before update on public.visits
  for each row execute function public.visits_bump_version();

create trigger visits_set_updated_at
  before update on public.visits
  for each row execute function public.set_updated_at();

-- ── RLS: somente SELECT ───────────────────────────────────────────────
-- Espelha tasks_select (20260819100000) na estrutura, mas Seller aqui é
-- SEMPRE own-only — nenhuma cláusula "ou sem responsável" (assigned_seller_
-- id é NOT NULL por design, R1 §C, decisão explícita divergente de Tasks).
-- Super Admin não recebe nenhuma policy neste B1 (mesma exclusão de Tasks)
-- — current_membership_company_id() é sempre NULL para Super Admin, então
-- a policy nega por construção.

alter table public.visits enable row level security;

create policy visits_select on public.visits
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and exists (
      select 1 from public.companies c
      where c.id = visits.company_id and c.status = 'ativa'
    )
    and (
      public.current_membership_role() = 'manager'
      or (
        public.current_membership_role() = 'seller'
        and assigned_seller_id = public.current_profile_seller_id_for_company(visits.company_id)
      )
    )
  );

-- ── grants: SELECT-only ──────────────────────────────────────────────

revoke all on table public.visits from public;
revoke all on table public.visits from anon;
revoke all on table public.visits from authenticated;

grant select on public.visits to authenticated;

-- ── create_visit ──────────────────────────────────────────────────────
-- Erros estáveis: forbidden, seller_required, seller_not_found,
-- lead_not_found, lead_archived, client_name_required, invalid_vehicles.
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
  v_ctx           record;
  v_seller        text;
  v_lead_seller   text;
  v_lead_archived boolean;
  v_lead_found    boolean := false;
  v_row           public.visits;
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
    -- Seller sempre autoatribuído; escolher outro seller é proibido.
    if p_assigned_seller_id is not null and p_assigned_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_ctx.actor_seller_id;
  else
    -- Manager: responsável explícito sempre vence. Sem parâmetro, tenta o
    -- seller do Lead (se ativo); sem Lead ou sem seller ativo no Lead,
    -- responsável é obrigatório.
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

  if p_lead_id is not null then
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, p_lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      'calendar', '#E8CE72', 'Visita agendada', null);
  end if;

  return v_row;
end;
$$;

-- ── update_visit ──────────────────────────────────────────────────────
-- Cobre também "reagendar" (mesma row, nunca cria uma segunda Visit — R1
-- §6-7/§11). p_expected_version obrigatório. Visit completed/canceled é
-- imutável.
-- Erros estáveis: forbidden, visit_not_found, visit_closed, seller_required,
-- seller_not_found, invalid_vehicles, stale_write.
create function public.update_visit(
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

-- ── confirm_visit ─────────────────────────────────────────────────────
-- Única via: scheduled -> confirmed. Não toca outcome/result_note/closed_*.
-- Erros estáveis: forbidden, visit_not_found, visit_closed,
-- invalid_status_transition, stale_write.
create function public.confirm_visit(
  p_id               uuid,
  p_expected_version integer
) returns public.visits
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx   record;
  v_visit public.visits;
  v_row   public.visits;
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
  if v_visit.status <> 'scheduled' then
    raise exception 'invalid_status_transition';
  end if;

  update public.visits
    set status     = 'confirmed',
        updated_by = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status = 'scheduled'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  if v_visit.lead_id is not null then
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, v_visit.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      'checkCircle', '#27C75F', 'Visita confirmada', null);
  end if;

  return v_row;
end;
$$;

-- ── cancel_visit ──────────────────────────────────────────────────────
-- scheduled/confirmed -> canceled. outcome permanece NULL. Terminal depois.
-- Erros estáveis: forbidden, visit_not_found, visit_closed, stale_write.
create function public.cancel_visit(
  p_id               uuid,
  p_expected_version integer
) returns public.visits
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx   record;
  v_visit public.visits;
  v_row   public.visits;
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

  update public.visits
    set status     = 'canceled',
        closed_at  = now(),
        closed_by  = v_ctx.actor_profile_id,
        updated_by = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status in ('scheduled', 'confirmed')
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  if v_visit.lead_id is not null then
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, v_visit.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      'xCircle', '#FF3B3B', 'Visita cancelada', null);
  end if;

  return v_row;
end;
$$;

-- ── register_visit_result ────────────────────────────────────────────
-- scheduled/confirmed -> completed, com outcome+result_note atômicos.
-- p_outcome é public.visit_outcome (tipado) — um valor fora do enum é
-- rejeitado pelo próprio Postgres (22P02) antes de chegar ao corpo da
-- função, mesmo padrão já usado por task_priority em create_task/
-- update_task — nenhum erro 'invalid_outcome' manual necessário.
-- note (observação geral) nunca é sobrescrita aqui.
-- Erros estáveis: forbidden, visit_not_found, visit_closed, stale_write.
create function public.register_visit_result(
  p_id                uuid,
  p_expected_version  integer,
  p_outcome           public.visit_outcome,
  p_result_note       text default ''
) returns public.visits
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx   record;
  v_visit public.visits;
  v_row   public.visits;
  v_label text;
  v_icon  text;
  v_color text;
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

  if v_visit.lead_id is not null then
    -- Copy/ícone/cor espelham exatamente os 4 outcomes de
    -- FlowRegistrarResultado (components/flows/Flows2.tsx) — nenhum título
    -- inventado.
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

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────

revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from public;
revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from anon;
revoke all on function public.create_visit(timestamptz, text[], uuid, text, text, text) from authenticated;
grant execute on function public.create_visit(timestamptz, text[], uuid, text, text, text) to authenticated;

revoke all on function public.update_visit(uuid, integer, timestamptz, text[], text, text) from public;
revoke all on function public.update_visit(uuid, integer, timestamptz, text[], text, text) from anon;
revoke all on function public.update_visit(uuid, integer, timestamptz, text[], text, text) from authenticated;
grant execute on function public.update_visit(uuid, integer, timestamptz, text[], text, text) to authenticated;

revoke all on function public.confirm_visit(uuid, integer) from public;
revoke all on function public.confirm_visit(uuid, integer) from anon;
revoke all on function public.confirm_visit(uuid, integer) from authenticated;
grant execute on function public.confirm_visit(uuid, integer) to authenticated;

revoke all on function public.cancel_visit(uuid, integer) from public;
revoke all on function public.cancel_visit(uuid, integer) from anon;
revoke all on function public.cancel_visit(uuid, integer) from authenticated;
grant execute on function public.cancel_visit(uuid, integer) to authenticated;

revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from public;
revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from anon;
revoke all on function public.register_visit_result(uuid, integer, public.visit_outcome, text) from authenticated;
grant execute on function public.register_visit_result(uuid, integer, public.visit_outcome, text) to authenticated;

commit;
