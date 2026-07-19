-- M1-E / Módulo 1 — m1e_01: enums + public.leads
-- Fonte: docs/M1-E-DESIGN.md (Revisão 3), §2, §4, §5, §7, §8.
-- Depende de m1c_01 (helpers endurecidos + uniques compostas de profiles e
-- sellers) e m1c_02 (pipeline_stages com unique (company_id, id)).
--
-- Escopo: 4 enums, tabela leads, triggers de version/updated_at, índices,
-- RLS (somente SELECT) e grants (somente SELECT). NÃO cria a timeline
-- (m1e_02) nem nenhuma RPC (m1e_03) — toda escrita em leads é exclusiva das
-- RPCs; nenhum grant de INSERT/UPDATE/DELETE é concedido aqui ou depois.

begin;

-- ── enums ───────────────────────────────────────────────────────────────
-- lead_event_type: conjunto FECHADO com exatamente os eventos reais de
-- calculateLeadHealth (lib/services.ts), achatados conforme o §6.4 do
-- design. Não adicionar valores sem nova aprovação do design.

create type public.lead_urgency as enum ('red', 'amber', 'green');

create type public.lead_temperature as enum ('hot', 'warm', 'cold');

create type public.lead_event_type as enum (
  'call_outcome_visit',
  'call_outcome_proposal',
  'call_outcome_callback',
  'call_outcome_no_answer',
  'visit_scheduled_complete',
  'visit_scheduled_incomplete',
  'visit_confirmed',
  'visit_canceled',
  'visit_rescheduled',
  'deal_created_needs_approval',
  'deal_created_direct',
  'deal_approved',
  'deal_rejected',
  'sale_registered',
  'sale_canceled',
  'visit_result_done',
  'visit_result_thinking',
  'visit_result_no_interest'
);

create type public.lead_duplicate_status as enum ('none', 'accessible', 'restricted');

-- ── tabela ──────────────────────────────────────────────────────────────
-- seller_id é text porque sellers.id é text nesta fase (decisão M1-B).
-- As FKs compostas usam as uniques (company_id, id) criadas em m1c_01/02:
-- estágio, vendedor e profiles de OUTRA empresa são estruturalmente
-- impossíveis. As FKs de auditoria usam ON DELETE SET NULL com lista de
-- colunas (PostgreSQL 15+; local roda 17): ao remover o profile, somente a
-- coluna de profile vai a null — company_id nunca é tocado.
-- version é o token de concorrência (§5); updated_at é apenas auditoria.

create table public.leads (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  name                  text not null,
  phone                 text not null,
  phone_digits          text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  car                   text not null,
  stage_id              uuid not null,
  seller_id             text,
  urgency               public.lead_urgency not null default 'red',
  temperature           public.lead_temperature,
  last_activity_label   text,
  alert_label           text,
  payment_preference    text,
  value_amount          numeric(12,2),
  source                text,
  created_by_profile_id uuid,
  updated_by_profile_id uuid,
  archived_at           timestamptz,
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (company_id, id),

  constraint leads_name_not_blank_ck  check (btrim(name) <> ''),
  constraint leads_phone_not_blank_ck check (btrim(phone) <> ''),
  constraint leads_phone_digits_ck    check (phone_digits <> ''),
  constraint leads_car_not_blank_ck   check (btrim(car) <> ''),
  constraint leads_value_amount_ck    check (value_amount >= 0),
  constraint leads_version_ck         check (version >= 1),

  constraint leads_company_stage_fk
    foreign key (company_id, stage_id)
    references public.pipeline_stages (company_id, id) on delete restrict,
  constraint leads_company_seller_fk
    foreign key (company_id, seller_id)
    references public.sellers (company_id, id) on delete restrict,
  constraint leads_created_by_fk
    foreign key (company_id, created_by_profile_id)
    references public.profiles (company_id, id)
    on delete set null (created_by_profile_id),
  constraint leads_updated_by_fk
    foreign key (company_id, updated_by_profile_id)
    references public.profiles (company_id, id)
    on delete set null (updated_by_profile_id)
);

-- ── índices (§4 do design) ──────────────────────────────────────────────

create index leads_company_active_idx       on public.leads (company_id) where archived_at is null;
create index leads_company_stage_idx        on public.leads (company_id, stage_id);
create index leads_company_seller_idx       on public.leads (company_id, seller_id);
create index leads_company_phone_digits_idx on public.leads (company_id, phone_digits);

-- ── triggers ────────────────────────────────────────────────────────────
-- version: incrementada em todo UPDATE efetivo, sempre a partir de OLD —
-- qualquer valor vindo do statement é ignorado (o frontend nunca escreve
-- version; nem teria grant para isso). BEFORE UPDATE simples, sem
-- recursão: nenhum dos triggers executa outro UPDATE.

create function public.leads_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger leads_bump_version
  before update on public.leads
  for each row execute function public.leads_bump_version();

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ── RLS (§8): somente SELECT ────────────────────────────────────────────
-- admin/manager: todos os leads da empresa (inclusive arquivados — a
-- visualização de arquivados é filtro de query). Seller: somente lead
-- próprio e não arquivado; lead sem vendedor não aparece (comparação com
-- NULL nega). Profile inativo: helpers retornam NULL → zero linhas.
-- Nenhuma policy de INSERT/UPDATE/DELETE: escrita é exclusiva das RPCs
-- SECURITY DEFINER (m1e_03) — negação dupla junto com a ausência de grants.

alter table public.leads enable row level security;

create policy leads_select on public.leads
  for select to authenticated
  using (
    company_id = public.current_profile_company_id()
    and (
      public.is_manager_or_admin()
      or (seller_id = public.current_profile_seller_id() and archived_at is null)
    )
  );

-- ── grants (§7): SELECT-only ────────────────────────────────────────────

revoke all on table public.leads from public;
revoke all on table public.leads from anon;
revoke all on table public.leads from authenticated;

grant select on public.leads to authenticated;
-- Sem grant de INSERT, sem grant de UPDATE, sem grant de DELETE.

commit;
