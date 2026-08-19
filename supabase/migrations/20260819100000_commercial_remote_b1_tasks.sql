-- COMMERCIAL-REMOTE-B1-A — Tasks remoto: schema + RLS + RPC
-- Fonte: precheck COMMERCIAL-REMOTE-B1-PRECHECK (design freeze) e correções
-- obrigatórias de COMMERCIAL-REMOTE-B1-A-EXEC (§0).
--
-- Escopo desta migration: exclusivamente o backend de Tasks. Nenhum
-- frontend, nenhuma feature flag, nenhum import de localStorage, nenhuma
-- alteração em Leads/Timeline/Visit/Deal/Sale. Tasks NÃO geram evento de
-- Lead Timeline neste lote (decisão congelada do precheck §18).
--
-- Modelo moderno de identidade, sem nenhuma dependência de
-- profiles.company_id/role/seller_id (removidos fisicamente em
-- 20260729190000/20260729200000): toda autorização deriva de auth.uid()
-- via company_memberships/sellers, através de um novo resolver interno
-- (resolve_commercial_mutation_context) espelhando o contrato já
-- comprovado por resolve_lead_mutation_context, sem tocá-lo.
--
-- FKs compostas usam os alvos UNIQUE já existentes: leads(company_id, id)
-- (m1e_01), sellers(company_id, id) (m1c_01), company_memberships
-- (company_id, profile_id) (m1f_s1_01) — nenhum índice/constraint novo é
-- necessário nas tabelas de destino.
--
-- ON DELETE RESTRICT em Lead/Seller/Actor (nunca SET NULL/CASCADE neste
-- lote, correção B do precheck) — mesma política já usada por
-- leads_company_seller_fk/leads_created_by_fk/leads_updated_by_fk/
-- lead_timeline_actor_fk. company_id -> companies(id) usa ON DELETE CASCADE
-- espelhando exatamente leads.company_id (m1e_01) — não é um CASCADE
-- silencioso: não existe nenhuma rotina de hard-delete de company no
-- catálogo (companies só transita por status ativa/implantacao/suspensa/
-- cancelada), a mesma premissa que já vale hoje para leads.company_id.

begin;

-- ── enums ─────────────────────────────────────────────────────────────

create type public.task_priority as enum ('alta', 'media', 'baixa');

-- Somente conclusão persistida (pending/completed) — LATE/TODAY/UPCOMING
-- são derivados no frontend a partir de status+due_at (precheck §6),
-- nunca colunas do banco.
create type public.task_status as enum ('pending', 'completed');

-- ── table public.tasks ───────────────────────────────────────────────────

create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  lead_id             uuid,
  -- Nullable na tabela (integridade/histórico/futuro, precheck §8) — mas
  -- create_task exige responsável válido em toda chamada (o produto atual
  -- nunca cria Task sem responsável, confirmado por auditoria de código,
  -- correção obrigatória §6 do B1-A-EXEC).
  assigned_seller_id  text,
  title               text not null,
  note                text not null default '',
  priority            public.task_priority not null,
  status              public.task_status not null default 'pending',
  due_at              timestamptz not null,
  completed_at        timestamptz,
  created_by          uuid,
  updated_by          uuid,
  completed_by        uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1,

  constraint tasks_title_not_blank_ck check (btrim(title) <> ''),
  constraint tasks_version_ck         check (version >= 1),

  -- Consistência de conclusão (precheck §8/correção §8 do B1-A-EXEC):
  -- pending nunca carrega completed_at/completed_by; completed sempre
  -- carrega os dois — nenhum actor Super Admin é preparado artificialmente
  -- (Super Admin não tem escrita comercial neste B1).
  constraint tasks_completion_consistency_ck check (
    (status = 'pending'   and completed_at is null     and completed_by is null)
    or
    (status = 'completed' and completed_at is not null and completed_by is not null)
  ),

  constraint tasks_company_lead_fk
    foreign key (company_id, lead_id)
    references public.leads (company_id, id)
    on delete restrict,

  constraint tasks_company_seller_fk
    foreign key (company_id, assigned_seller_id)
    references public.sellers (company_id, id)
    on delete restrict,

  constraint tasks_created_by_fk
    foreign key (company_id, created_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint tasks_updated_by_fk
    foreign key (company_id, updated_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict,

  constraint tasks_completed_by_fk
    foreign key (company_id, completed_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict
);

-- ── indexes (precheck §10 — somente os justificados pelos readers reais) ──
-- ScreenPendencias agrupa por status/due_at dentro do escopo da company
-- (Manager); a mesma consulta, filtrada por assigned_seller_id, cobre o
-- escopo Seller (own + unassigned via IS NULL, não precisa de index
-- parcial dedicado — o composto já cobre ambos os casos via IN/OR no
-- planner). tasks_company_lead_idx cobre o único outro reader real: jump
-- to lead / futura listagem "tasks deste lead".

create index tasks_company_status_due_idx
  on public.tasks (company_id, status, due_at);

create index tasks_company_seller_status_due_idx
  on public.tasks (company_id, assigned_seller_id, status, due_at);

create index tasks_company_lead_idx
  on public.tasks (company_id, lead_id);

-- ── triggers ──────────────────────────────────────────────────────────
-- version: mesmo padrão de leads_bump_version (m1e_01) — nenhum mecanismo
-- alternativo. updated_at reaproveita o trigger genérico já usado por
-- companies/profiles/sellers/pipeline_stages/leads/company_memberships/
-- invites (public.set_updated_at(), m1b) — não recriado.

create function public.tasks_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger tasks_bump_version
  before update on public.tasks
  for each row execute function public.tasks_bump_version();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ── RLS: somente SELECT ───────────────────────────────────────────────
-- Espelha leads_select (20260728160000_m1f_s8c2b1_leads_timeline_
-- membership_access.sql): company da membership ativa, empresa
-- exatamente 'ativa', Manager vê tudo da empresa, Seller vê a própria
-- (assigned_seller_id) OU sem responsável (assigned_seller_id IS NULL —
-- único ponto em que Tasks diverge de Leads/Visits/Deals/Sales, que são
-- estritamente own-only; comportamento já existente em _filteredTasks no
-- store local, preservado aqui). Super Admin não recebe nenhuma policy
-- neste B1 (sem leitura comercial de Tasks ainda) — current_membership_
-- company_id() é sempre NULL para Super Admin (nunca tem membership),
-- então a policy nega por construção, sem precisar de branch explícita.

alter table public.tasks enable row level security;

create policy tasks_select on public.tasks
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and exists (
      select 1 from public.companies c
      where c.id = tasks.company_id and c.status = 'ativa'
    )
    and (
      public.current_membership_role() = 'manager'
      or (
        public.current_membership_role() = 'seller'
        and (
          assigned_seller_id is null
          or assigned_seller_id = public.current_profile_seller_id_for_company(tasks.company_id)
        )
      )
    )
  );

-- ── grants: SELECT-only ──────────────────────────────────────────────
-- Nenhuma policy/grant de INSERT/UPDATE/DELETE — escrita é exclusiva das
-- RPCs SECURITY DEFINER abaixo.

revoke all on table public.tasks from public;
revoke all on table public.tasks from anon;
revoke all on table public.tasks from authenticated;

grant select on public.tasks to authenticated;

-- ── resolve_commercial_mutation_context() ────────────────────────────
-- Resolver interno NOVO (precheck §12 — decisão A: infra compartilhável
-- para Tasks/Visits/Deals/Sales, escrito do zero ao lado de
-- resolve_lead_mutation_context, sem refatorá-lo). Mesmo contrato
-- essencial: parte sempre de auth.uid(), nunca aceita profile_id/role/
-- seller_id/company_id do cliente. Diferença deliberada: Tasks não tem
-- nenhuma superfície de Super Admin neste B1 (nem leitura, nem escrita) —
-- o resolver RECONHECE Super Admin explicitamente só para negar com
-- 'forbidden' (nunca autoriza), em vez de aceitar um p_company_id como
-- resolve_lead_mutation_context faz. Sem parâmetros: não há necessidade
-- de nenhum parâmetro de compatibilidade nesta primeira etapa (precheck
-- §12, "não expor parâmetro desnecessário em B1").
create function public.resolve_commercial_mutation_context()
returns table (
  actor_profile_id     uuid,
  actor_kind           text,
  actor_seller_id      text,
  resolved_company_id  uuid,
  company_status       public.company_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id         uuid;
  v_membership_company uuid;
  v_membership_role    public.company_role;
  v_status             public.company_status;
  v_seller_id          text;
begin
  select p.id into v_profile_id
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile_id is null then
    raise exception 'forbidden';
  end if;

  -- Super Admin: reconhecido explicitamente, sempre negado — Tasks não
  -- tem leitura/escrita comercial de Super Admin neste B1.
  if public.is_platform_super_admin() then
    raise exception 'forbidden';
  end if;

  v_membership_company := public.current_membership_company_id();
  v_membership_role := public.current_membership_role();
  if v_membership_company is null or v_membership_role is null then
    raise exception 'forbidden';
  end if;

  select c.status into v_status
    from public.companies c
    where c.id = v_membership_company;
  if v_status is distinct from 'ativa' then
    raise exception 'forbidden';
  end if;

  if v_membership_role = 'seller' then
    v_seller_id := public.current_profile_seller_id_for_company(v_membership_company);
    if v_seller_id is null then
      raise exception 'forbidden';
    end if;
    return query select v_profile_id, 'seller'::text, v_seller_id, v_membership_company, v_status;
    return;
  end if;

  return query select v_profile_id, 'manager'::text, null::text, v_membership_company, v_status;
end;
$$;

-- Nenhum GRANT a authenticated/anon/public de propósito — resolver
-- interno, nunca chamado diretamente pelo frontend, só pelas RPCs
-- SECURITY DEFINER abaixo (mesmo padrão de resolve_lead_mutation_context).
revoke all on function public.resolve_commercial_mutation_context() from public;
revoke all on function public.resolve_commercial_mutation_context() from anon;
revoke all on function public.resolve_commercial_mutation_context() from authenticated;

-- ── create_task ───────────────────────────────────────────────────────
-- Erros estáveis: forbidden, seller_required, seller_not_found,
-- lead_not_found, invalid_title.
create function public.create_task(
  p_title              text,
  p_priority           public.task_priority,
  p_due_at             timestamptz,
  p_assigned_seller_id text default null,
  p_lead_id            uuid default null,
  p_note               text default ''
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx    record;
  v_seller text;
  v_row    public.tasks;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if v_ctx.actor_kind = 'seller' then
    -- Seller sempre autoatribuído; escolher outro seller é proibido.
    if p_assigned_seller_id is not null and p_assigned_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_ctx.actor_seller_id;
  else
    -- Manager: responsável é obrigatório neste B1 (produto atual nunca
    -- cria Task sem responsável) e precisa ser um Seller ativo da mesma
    -- empresa resolvida.
    if p_assigned_seller_id is null then
      raise exception 'seller_required';
    end if;
    perform 1 from public.sellers s
      where s.id = p_assigned_seller_id
        and s.company_id = v_ctx.resolved_company_id
        and s.is_active;
    if not found then
      raise exception 'seller_not_found';
    end if;
    v_seller := p_assigned_seller_id;
  end if;

  if p_lead_id is not null then
    perform 1 from public.leads l
      where l.id = p_lead_id and l.company_id = v_ctx.resolved_company_id;
    if not found then
      raise exception 'lead_not_found';
    end if;
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'invalid_title';
  end if;

  insert into public.tasks (
    company_id, lead_id, assigned_seller_id, title, note, priority, due_at,
    created_by, updated_by
  ) values (
    v_ctx.resolved_company_id, p_lead_id, v_seller, p_title, coalesce(p_note, ''), p_priority, p_due_at,
    v_ctx.actor_profile_id, v_ctx.actor_profile_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ── update_task ───────────────────────────────────────────────────────
-- Cobre também "reagendar" (due_at é só mais um campo editável — precheck
-- §16, sem RPC dedicada). p_expected_version obrigatório (precheck §17 —
-- nenhuma exceção last-write-wins neste domínio). Task completed é
-- imutável neste B1 (precheck §13 — nenhuma evidência de edição
-- pós-conclusão no produto atual).
-- Erros estáveis: forbidden, task_not_found, task_completed,
-- seller_required, seller_not_found, invalid_title, stale_write.
create function public.update_task(
  p_id                 uuid,
  p_expected_version   integer,
  p_title              text,
  p_note               text,
  p_priority           public.task_priority,
  p_due_at             timestamptz,
  p_assigned_seller_id text
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx        record;
  v_task       public.tasks;
  v_row        public.tasks;
  v_new_seller text;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select t.* into v_task
    from public.tasks t
    where t.id = p_id and t.company_id = v_ctx.resolved_company_id;
  if v_task.id is null then
    raise exception 'task_not_found';
  end if;
  if v_task.status = 'completed' then
    raise exception 'task_completed';
  end if;

  if v_ctx.actor_kind = 'seller' then
    -- Seller só edita a própria Task e nunca pode reatribuir.
    if v_task.assigned_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    if p_assigned_seller_id is distinct from v_task.assigned_seller_id then
      raise exception 'forbidden';
    end if;
    v_new_seller := v_task.assigned_seller_id;
  else
    -- Manager: pode reatribuir para qualquer Seller ativo elegível da
    -- empresa resolvida; responsável continua obrigatório.
    if p_assigned_seller_id is null then
      raise exception 'seller_required';
    end if;
    if p_assigned_seller_id is distinct from v_task.assigned_seller_id then
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

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'invalid_title';
  end if;

  update public.tasks
    set title              = p_title,
        note               = coalesce(p_note, ''),
        priority           = p_priority,
        due_at             = p_due_at,
        assigned_seller_id = v_new_seller,
        updated_by         = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status = 'pending'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  return v_row;
end;
$$;

-- ── complete_task ─────────────────────────────────────────────────────
-- Uma via só (sem reopen_task, decisão congelada). already_completed é um
-- erro determinístico distinto de stale_write (checado ANTES do UPDATE
-- condicional, com um SELECT simples de autorização/estado) — decisão do
-- precheck §14: sinaliza "já concluída" de forma estável, em vez de
-- confundir com conflito de concorrência real.
-- Erros estáveis: forbidden, task_not_found, already_completed,
-- stale_write.
create function public.complete_task(
  p_id               uuid,
  p_expected_version integer
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx  record;
  v_task public.tasks;
  v_row  public.tasks;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select t.* into v_task
    from public.tasks t
    where t.id = p_id and t.company_id = v_ctx.resolved_company_id;
  if v_task.id is null then
    raise exception 'task_not_found';
  end if;

  if v_ctx.actor_kind = 'seller' and v_task.assigned_seller_id is distinct from v_ctx.actor_seller_id then
    raise exception 'forbidden';
  end if;

  if v_task.status = 'completed' then
    raise exception 'already_completed';
  end if;

  update public.tasks
    set status       = 'completed',
        completed_at = now(),
        completed_by = v_ctx.actor_profile_id,
        updated_by   = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status = 'pending'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  return v_row;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────

revoke all on function public.create_task(text, public.task_priority, timestamptz, text, uuid, text) from public;
revoke all on function public.create_task(text, public.task_priority, timestamptz, text, uuid, text) from anon;
revoke all on function public.create_task(text, public.task_priority, timestamptz, text, uuid, text) from authenticated;
grant execute on function public.create_task(text, public.task_priority, timestamptz, text, uuid, text) to authenticated;

revoke all on function public.update_task(uuid, integer, text, text, public.task_priority, timestamptz, text) from public;
revoke all on function public.update_task(uuid, integer, text, text, public.task_priority, timestamptz, text) from anon;
revoke all on function public.update_task(uuid, integer, text, text, public.task_priority, timestamptz, text) from authenticated;
grant execute on function public.update_task(uuid, integer, text, text, public.task_priority, timestamptz, text) to authenticated;

revoke all on function public.complete_task(uuid, integer) from public;
revoke all on function public.complete_task(uuid, integer) from anon;
revoke all on function public.complete_task(uuid, integer) from authenticated;
grant execute on function public.complete_task(uuid, integer) to authenticated;

commit;
