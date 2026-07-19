-- M1-E / Módulo 1 — m1e_02: public.lead_timeline_entries
-- Fonte: docs/M1-E-DESIGN.md (Revisão 3), §3, §4, §7, §8.
-- Depende de m1e_01 (unique (company_id, id) de leads) e m1c_01
-- (profiles_company_id_uidx).
--
-- Append-only: sem updated_at, sem UPDATE, sem DELETE. Escrita exclusiva
-- pela RPC add_lead_timeline_entry (m1e_03) — actor derivado de auth.uid()
-- no servidor, occurred_at = now() no servidor.

begin;

create table public.lead_timeline_entries (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  lead_id          uuid not null,
  actor_profile_id uuid,
  icon             text not null,
  color            text not null,
  label            text not null,
  detail           text,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  constraint lead_timeline_icon_not_blank_ck  check (btrim(icon) <> ''),
  constraint lead_timeline_color_not_blank_ck check (btrim(color) <> ''),
  constraint lead_timeline_label_not_blank_ck check (btrim(label) <> ''),

  -- FK composta: timeline de lead de OUTRA empresa é estruturalmente
  -- impossível; remoção do lead leva a timeline junto (cascade).
  constraint lead_timeline_company_lead_fk
    foreign key (company_id, lead_id)
    references public.leads (company_id, id) on delete cascade,

  -- FK composta de auditoria: actor da mesma empresa; remoção do profile
  -- anula SOMENTE actor_profile_id (PostgreSQL 15+; local roda 17) —
  -- company_id permanece obrigatório e intacto.
  constraint lead_timeline_actor_fk
    foreign key (company_id, actor_profile_id)
    references public.profiles (company_id, id)
    on delete set null (actor_profile_id)
);

-- ── índices (§4 do design) ──────────────────────────────────────────────

create index lead_timeline_lead_id_idx    on public.lead_timeline_entries (lead_id);
create index lead_timeline_company_id_idx on public.lead_timeline_entries (company_id);

-- ── RLS (§8): SELECT espelha exatamente a visibilidade do lead ──────────
-- admin/manager: timeline de qualquer lead da empresa. Seller: somente
-- timeline de lead próprio e ativo. Profile inativo: zero linhas.
-- Nenhuma policy de INSERT/UPDATE/DELETE (append-only via RPC).

alter table public.lead_timeline_entries enable row level security;

create policy lead_timeline_select on public.lead_timeline_entries
  for select to authenticated
  using (
    company_id = public.current_profile_company_id()
    and exists (
      select 1 from public.leads l
      where l.id = lead_timeline_entries.lead_id
        and l.company_id = lead_timeline_entries.company_id
        and (
          public.is_manager_or_admin()
          or (l.seller_id = public.current_profile_seller_id() and l.archived_at is null)
        )
    )
  );

-- ── grants (§7): SELECT-only ────────────────────────────────────────────

revoke all on table public.lead_timeline_entries from public;
revoke all on table public.lead_timeline_entries from anon;
revoke all on table public.lead_timeline_entries from authenticated;

grant select on public.lead_timeline_entries to authenticated;
-- Sem grant de INSERT, sem grant de UPDATE, sem grant de DELETE.

commit;
