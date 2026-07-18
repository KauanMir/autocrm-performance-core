-- M1-C / Módulo 1 — m1c_02: pipeline_stages
-- Fonte: docs/M1-C-DESIGN.md (Revisão 4), §4.2, §5.2, §6.1, §9, §14.1.
-- Depende de m1c_01 (helpers de RLS já endurecidos — as policies abaixo
-- nascem apoiadas nas versões com filtro de is_active e search_path vazio).
--
-- Escopo: tabela pipeline_stages + constraints multiempresa + RLS + trigger
-- de updated_at + grants explícitos por coluna + seed idempotente dos 5
-- estágios oficiais nas companies EXISTENTES.
-- NÃO cria leads/visits/deals/sales/tasks (migrations m1c_04+).

begin;

-- ── tabela ──────────────────────────────────────────────────────────────
-- `code` é o contrato estável de regra de negócio (Lead Health Engine);
-- `name` é apenas rótulo exibido, editável por manager/admin.
-- unique(company_id, sort_order) é DEFERRABLE para a RPC de reorder
-- (m1c_03) poder trocar posições dentro de uma transação sem violar a
-- unicidade num estado intermediário do laço de UPDATEs.
-- unique(company_id, id) é o alvo das FKs compostas multiempresa que
-- leads.stage_id vai referenciar em m1c_04.

create table public.pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  code         text not null,
  name         text not null,
  sort_order   int  not null,
  is_terminal  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (company_id, code),
  unique (company_id, name),
  unique (company_id, sort_order) deferrable initially deferred,
  unique (company_id, id),

  constraint pipeline_stages_sort_order_nonnegative_ck
    check (sort_order >= 0),
  constraint pipeline_stages_code_format_ck
    check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint pipeline_stages_name_not_blank_ck
    check (btrim(name) <> '')
);

create index pipeline_stages_company_id_idx on public.pipeline_stages(company_id);

-- ── updated_at automático ───────────────────────────────────────────────
-- set_updated_at() já existe desde o M1-B — só anexa o trigger.

create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Policies separadas por operação, todas TO authenticated (nunca FOR ALL).
-- Seller: apenas leitura. Manager/admin: administram dentro da própria
-- empresa. Sem policy de DELETE (e sem grant — negado duas vezes); remoção
-- de estágio é decisão de produto futura, e a FK RESTRICT de leads.stage_id
-- (m1c_04) bloquearia estágio em uso de qualquer forma.

alter table public.pipeline_stages enable row level security;

create policy stages_select on public.pipeline_stages
  for select to authenticated
  using (company_id = public.current_profile_company_id());

create policy stages_insert on public.pipeline_stages
  for insert to authenticated
  with check (
    company_id = public.current_profile_company_id()
    and public.is_manager_or_admin()
  );

create policy stages_update on public.pipeline_stages
  for update to authenticated
  using (
    company_id = public.current_profile_company_id()
    and public.is_manager_or_admin()
  )
  with check (
    company_id = public.current_profile_company_id()
    and public.is_manager_or_admin()
  );

-- ── grants explícitos por coluna (não depender dos defaults do Supabase) ─
-- INSERT: apenas nas colunas de negócio — id/created_at/updated_at ficam
-- FORA do grant e são preenchidos exclusivamente pelos defaults da tabela
-- (um INSERT client-side que tente especificá-los falha com permission
-- denied). O WITH CHECK da policy stages_insert garante
-- company_id = current_profile_company_id() and is_manager_or_admin().
-- UPDATE: apenas name/is_terminal — id, company_id, code (imutável),
-- sort_order (só via RPC m1c_03) e timestamps (só via default/trigger)
-- ficam fora do grant. A RPC de reorder é SECURITY DEFINER (roda como
-- owner) e não é afetada por estes grants de coluna.

revoke all on table public.pipeline_stages from public;
revoke all on table public.pipeline_stages from anon;
revoke all on table public.pipeline_stages from authenticated;

grant select on public.pipeline_stages to authenticated;
grant insert (company_id, code, name, sort_order, is_terminal)
  on public.pipeline_stages to authenticated;
grant update (name, is_terminal) on public.pipeline_stages to authenticated;
-- DELETE: nenhum grant.

-- ── seed idempotente dos 5 estágios oficiais ────────────────────────────
-- COBERTURA: somente as companies que EXISTEM no momento em que esta
-- migration roda (hoje, a única criada pelo seed do M1-B). Um INSERT em
-- migration não cobre empresas criadas depois — novas companies precisarão
-- receber os 5 estágios no futuro fluxo de provisionamento/onboarding de
-- empresa (fora do escopo do M1-C; nenhum trigger automático em companies
-- é criado aqui sem nova aprovação).
--
-- Idempotência e conflito de `name`: o alvo do ON CONFLICT é
-- (company_id, code) — reexecutar o seed com os mesmos codes não duplica
-- nem sobrescreve renomeações de `name` feitas pelo gestor. Porém a tabela
-- também tem unique(company_id, name): se uma company já tiver um estágio
-- com um dos names do seed sob OUTRO code (ex.: gestor renomeou um estágio
-- custom para 'Novo'), o INSERT violaria a unique de name — um conflito que
-- o ON CONFLICT(company_id, code) NÃO captura. O guard abaixo detecta esse
-- estado antes e FALHA COM MENSAGEM CLARA, em vez de deixar a migration
-- morrer com um erro críptico de constraint ou esconder a inconsistência.

do $$
declare
  v_conflict record;
begin
  select ps.company_id, ps.code as existing_code, ps.name
    into v_conflict
    from public.pipeline_stages ps
    join (
      values
        ('new',             'Novo'),
        ('qualified',       'Qualificado'),
        ('visit_scheduled', 'Visita agendada'),
        ('negotiation',     'Em negociação'),
        ('closing',         'Fechamento')
    ) as s(code, name)
      on ps.name = s.name and ps.code <> s.code
    limit 1;

  if found then
    raise exception
      'pipeline_stages seed conflict: company % already has a stage named "%" under code "%" — resolve manually before re-running this seed',
      v_conflict.company_id, v_conflict.name, v_conflict.existing_code;
  end if;
end $$;

insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal)
select c.id, s.code, s.name, s.sort_order, s.is_terminal
from public.companies c
cross join (
  values
    ('new',             'Novo',            0, false),
    ('qualified',       'Qualificado',     1, false),
    ('visit_scheduled', 'Visita agendada', 2, false),
    ('negotiation',     'Em negociação',   3, false),
    ('closing',         'Fechamento',      4, true)
) as s(code, name, sort_order, is_terminal)
on conflict (company_id, code) do nothing;

commit;
