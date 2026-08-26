-- FOLLOW-UP-TEMPLATES-A2-EXEC-BACKEND — Company Follow-up Template Authority
-- Fonte: FOLLOW-UP-TEMPLATES-A1-PRECHECK (COMPLETE). Backend puro: nenhuma
-- UI, nenhum botão Follow-up, nenhuma alteração em create_task/update_task/
-- complete_task, nenhuma abertura de Task mutation para Super Admin, nenhum
-- template_id em public.tasks, nenhum seed/default template neste lote.
--
-- Templates são só um atalho de CRIAÇÃO — depois de aplicado, o resultado é
-- uma Task normal (public.tasks), criada pela mesma create_task já existente
-- (A3, frontend futuro). Esta migration não toca tasks/create_task em nada.
--
-- ── Decisão de design que DIVERGE do padrão de tasks.created_by/updated_by
--    (precheck A1 §27) ──────────────────────────────────────────────────
-- tasks_created_by_fk/tasks_updated_by_fk (20260819100000) usam FK COMPOSTA
-- (company_id, profile_id) -> company_memberships(company_id, profile_id),
-- porque Super Admin é hard-forbidden em create_task/update_task — essa FK
-- nunca precisa aceitar um ator sem membership na empresa. Aqui é diferente:
-- Super Admin contextual PODE gerenciar templates (§17), e Super Admin nunca
-- tem company_memberships na empresa que administra (por desenho, desde o
-- M1-F E0). Uma FK composta igual à de tasks quebraria TODO create/update
-- de template feito por Super Admin. Por isso created_by/updated_by aqui são
-- FK SIMPLES para public.profiles(id) — não uma FK composta por empresa.
-- Isso é seguro porque followup_templates.company_id já é validado pelo
-- resolver (resolve_followup_template_mutation_context) contra a empresa
-- real do ator antes de qualquer INSERT/UPDATE — a FK simples só garante
-- "profile existe", a authorização real nunca depende dela.
begin;

-- ── enum offset_unit: texto + CHECK, não um enum novo (precheck A1 §7,
--    confirmado no shape do EXEC §3: "offset_unit text not null") ─────────

create table public.followup_templates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  task_title   text not null,
  task_note    text not null default '',
  priority     public.task_priority not null,
  offset_value integer not null,
  offset_unit  text not null,
  default_time text,
  is_active    boolean not null default true,
  sort_order   integer not null,
  created_by   uuid not null references public.profiles(id) on delete restrict,
  updated_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  unique (company_id, sort_order) deferrable initially deferred,

  constraint followup_templates_name_not_blank_ck
    check (btrim(name) <> ''),
  constraint followup_templates_task_title_not_blank_ck
    check (btrim(task_title) <> ''),
  constraint followup_templates_version_ck
    check (version >= 1),
  constraint followup_templates_sort_order_nonnegative_ck
    check (sort_order >= 0),
  constraint followup_templates_offset_unit_ck
    check (offset_unit in ('hour', 'day')),
  constraint followup_templates_offset_value_ck
    check (offset_value > 0),
  -- Teto defensivo (precheck A1 §7, sugestão adotada): 168h = 7 dias em
  -- horas (mesmo teto do lado "day" expresso em horas, nunca um número
  -- arbitrário maior); 90 dias é um trimestre — nenhum atalho de follow-up
  -- real precisa de mais que isso; um caso assim usa "Personalizado" no
  -- flow normal (precheck A1 §17), nunca um template.
  constraint followup_templates_offset_ceiling_ck
    check (
      (offset_unit = 'hour' and offset_value <= 168)
      or (offset_unit = 'day' and offset_value <= 90)
    ),
  -- Formato HH:mm 24h, mesmo contrato de <input type="time"> já usado pelo
  -- flow atual (lib/tasks/dueAtHelpers.ts TIME_PATTERN) — nunca uma segunda
  -- definição de "hora válida" divergente.
  constraint followup_templates_default_time_format_ck
    check (default_time is null or default_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- precheck A1 §8: offset em HORAS nunca combina com horário civil fixo —
  -- "amanhã às 09:00" faz sentido, "daqui a 3 horas às 09:00" não.
  constraint followup_templates_hour_offset_no_default_time_ck
    check (offset_unit <> 'hour' or default_time is null)
);

create index followup_templates_company_active_sort_idx
  on public.followup_templates (company_id, is_active, sort_order);

-- ── triggers (mesmo padrão de tasks_bump_version/set_updated_at) ────────

create function public.followup_templates_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger followup_templates_bump_version
  before update on public.followup_templates
  for each row execute function public.followup_templates_bump_version();

create trigger followup_templates_set_updated_at
  before update on public.followup_templates
  for each row execute function public.set_updated_at();

-- ── RLS: somente SELECT (mesmo padrão de tasks — escrita só por RPC) ────
-- Manager: ativos + inativos da própria empresa (precheck A1 §19 — precisa
-- gerenciar os dois). Seller: só ativos da própria empresa (nunca vê
-- templates desativados). Super Admin: nenhuma policy própria aqui — nunca
-- tem membership, current_membership_company_id() é sempre NULL para ele,
-- então esta policy nega por construção (mesmo raciocínio de tasks_select);
-- leitura de Super Admin é exclusivamente via
-- list_platform_followup_templates_for_company.

alter table public.followup_templates enable row level security;

create policy followup_templates_select on public.followup_templates
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and exists (
      select 1 from public.companies c
      where c.id = followup_templates.company_id and c.status = 'ativa'
    )
    and (
      public.current_membership_role() = 'manager'
      or (
        public.current_membership_role() = 'seller'
        and followup_templates.is_active
      )
    )
  );

revoke all on table public.followup_templates from public;
revoke all on table public.followup_templates from anon;
revoke all on table public.followup_templates from authenticated;

grant select on table public.followup_templates to authenticated;

-- ── resolve_followup_template_mutation_context(p_company_id) ────────────
-- Resolver interno NOVO, espelhando resolve_lead_mutation_context (precheck
-- A1 §14) — NUNCA resolve_commercial_mutation_context, que bane Super Admin
-- por design. Diferença deliberada: Seller é negado AQUI DENTRO (raise
-- 'forbidden' direto), não deixado passar com actor_kind='seller' como
-- resolve_lead_mutation_context faz — nas 4 RPCs consumidoras, Seller NUNCA
-- tem nenhum caminho de sucesso (precheck A1 §16), então centralizar a
-- negação num único lugar evita repetir a checagem 4 vezes.
--
-- Manager/Seller: p_company_id é IGNORADO — empresa sempre da membership
-- ativa real. Empresa precisa estar exatamente 'ativa' (nunca implantacao,
-- mesmo contrato do ramo não-Super-Admin de resolve_lead_mutation_context).
-- Super Admin: p_company_id OBRIGATÓRIO; aceita 'ativa'/'implantacao'
-- ('company_read_only' para suspensa/cancelada — mesmo contrato do ramo
-- Super Admin de resolve_lead_mutation_context).
create function public.resolve_followup_template_mutation_context(
  p_company_id uuid default null
) returns table (
  actor_profile_id     uuid,
  actor_kind           text,
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
  v_is_super_admin     boolean;
  v_membership_company uuid;
  v_membership_role    public.company_role;
  v_status             public.company_status;
begin
  select p.id into v_profile_id
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile_id is null then
    raise exception 'forbidden';
  end if;

  v_is_super_admin := public.is_platform_super_admin();

  if v_is_super_admin then
    if p_company_id is null then
      raise exception 'company_required';
    end if;

    select c.status into v_status
      from public.companies c
      where c.id = p_company_id;
    if v_status is null then
      raise exception 'company_not_found';
    end if;
    if v_status not in ('ativa', 'implantacao') then
      raise exception 'company_read_only';
    end if;

    return query select v_profile_id, 'super_admin'::text, p_company_id, v_status;
    return;
  end if;

  v_membership_company := public.current_membership_company_id();
  v_membership_role := public.current_membership_role();
  if v_membership_company is null or v_membership_role is null then
    raise exception 'forbidden';
  end if;

  if v_membership_role = 'seller' then
    raise exception 'forbidden';
  end if;

  select c.status into v_status
    from public.companies c
    where c.id = v_membership_company;
  if v_status is distinct from 'ativa' then
    raise exception 'forbidden';
  end if;

  return query select v_profile_id, 'manager'::text, v_membership_company, v_status;
end;
$$;

-- Nenhum GRANT a authenticated/anon/public de propósito — resolver interno,
-- nunca chamado diretamente pelo frontend (mesmo padrão de
-- resolve_commercial_mutation_context/resolve_lead_mutation_context).
revoke all on function public.resolve_followup_template_mutation_context(uuid) from public;
revoke all on function public.resolve_followup_template_mutation_context(uuid) from anon;
revoke all on function public.resolve_followup_template_mutation_context(uuid) from authenticated;

-- ── _followup_template_active_count(company_id) — helper de limite ──────
-- Interno, reaproveitado por create_followup_template e
-- set_followup_template_active (reativação) — nunca duplicar a contagem.
create function public._followup_template_active_count(p_company_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.followup_templates
   where company_id = p_company_id and is_active;
$$;

revoke all on function public._followup_template_active_count(uuid) from public;
revoke all on function public._followup_template_active_count(uuid) from anon;
revoke all on function public._followup_template_active_count(uuid) from authenticated;

-- Limite de produto congelado (precheck A2-EXEC §9) — 12 templates ATIVOS
-- por empresa. Inativos nunca contam.
create function public._followup_template_active_limit() returns integer
language sql immutable as $$
  select 12;
$$;

revoke all on function public._followup_template_active_limit() from public;
revoke all on function public._followup_template_active_limit() from anon;
revoke all on function public._followup_template_active_limit() from authenticated;

-- ── create_followup_template ─────────────────────────────────────────────
-- Erros estáveis: forbidden, company_required, company_not_found,
-- company_read_only, followup_template_invalid_name,
-- followup_template_invalid_task_title, followup_template_invalid_offset,
-- followup_template_invalid_time, followup_template_limit_reached.
create function public.create_followup_template(
  p_name         text,
  p_task_title   text,
  p_priority     public.task_priority,
  p_offset_value integer,
  p_offset_unit  text,
  p_task_note    text default '',
  p_default_time text default null,
  p_sort_order   integer default null,
  p_company_id   uuid default null
) returns public.followup_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx           record;
  v_offset_unit   text;
  v_default_time  text;
  v_sort_order    integer;
  v_active_count  integer;
  v_row           public.followup_templates;
begin
  select * into v_ctx from public.resolve_followup_template_mutation_context(p_company_id);

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'followup_template_invalid_name';
  end if;
  if btrim(coalesce(p_task_title, '')) = '' then
    raise exception 'followup_template_invalid_task_title';
  end if;

  v_offset_unit := lower(btrim(coalesce(p_offset_unit, '')));
  if v_offset_unit not in ('hour', 'day') then
    raise exception 'followup_template_invalid_offset';
  end if;
  if p_offset_value is null or p_offset_value <= 0 then
    raise exception 'followup_template_invalid_offset';
  end if;
  if v_offset_unit = 'hour' and p_offset_value > 168 then
    raise exception 'followup_template_invalid_offset';
  end if;
  if v_offset_unit = 'day' and p_offset_value > 90 then
    raise exception 'followup_template_invalid_offset';
  end if;

  v_default_time := nullif(btrim(coalesce(p_default_time, '')), '');
  if v_default_time is not null and v_default_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'followup_template_invalid_time';
  end if;
  if v_offset_unit = 'hour' and v_default_time is not null then
    raise exception 'followup_template_invalid_time';
  end if;

  -- Lock por empresa (advisory, transacional) antes de contar ativos —
  -- evita duas criações concorrentes da MESMA empresa ultrapassarem o
  -- limite juntas (mesmo espírito de reserve_invite_rate_limit, S4-A2A.1).
  perform pg_advisory_xact_lock(hashtext('followup_templates:' || v_ctx.resolved_company_id::text));

  v_active_count := public._followup_template_active_count(v_ctx.resolved_company_id);
  if v_active_count >= public._followup_template_active_limit() then
    raise exception 'followup_template_limit_reached';
  end if;

  v_sort_order := coalesce(
    p_sort_order,
    (select coalesce(max(sort_order), -1) + 1
       from public.followup_templates
      where company_id = v_ctx.resolved_company_id)
  );

  insert into public.followup_templates (
    company_id, name, task_title, task_note, priority,
    offset_value, offset_unit, default_time, sort_order,
    created_by, updated_by
  ) values (
    v_ctx.resolved_company_id, p_name, p_task_title, coalesce(p_task_note, ''), p_priority,
    p_offset_value, v_offset_unit, v_default_time, v_sort_order,
    v_ctx.actor_profile_id, v_ctx.actor_profile_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ── update_followup_template ─────────────────────────────────────────────
-- FULL REPLACE (mesmo contrato de update_task, precheck A1 §7/§9) — nunca
-- PATCH parcial. Não toca is_active (RPC dedicada) nem sort_order (RPC de
-- reorder dedicada) — precheck A2-EXEC §24.
-- Erros estáveis: forbidden, company_required, company_not_found,
-- company_read_only, followup_template_not_found,
-- followup_template_invalid_name, followup_template_invalid_task_title,
-- followup_template_invalid_offset, followup_template_invalid_time,
-- followup_template_conflict.
create function public.update_followup_template(
  p_id             uuid,
  p_expected_version integer,
  p_name           text,
  p_task_title     text,
  p_task_note      text,
  p_priority       public.task_priority,
  p_offset_value   integer,
  p_offset_unit    text,
  p_default_time   text,
  p_company_id     uuid default null
) returns public.followup_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx          record;
  v_template     public.followup_templates;
  v_offset_unit  text;
  v_default_time text;
  v_row          public.followup_templates;
begin
  select * into v_ctx from public.resolve_followup_template_mutation_context(p_company_id);

  if p_expected_version is null then
    raise exception 'followup_template_conflict';
  end if;

  select t.* into v_template
    from public.followup_templates t
    where t.id = p_id and t.company_id = v_ctx.resolved_company_id;
  if v_template.id is null then
    raise exception 'followup_template_not_found';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'followup_template_invalid_name';
  end if;
  if btrim(coalesce(p_task_title, '')) = '' then
    raise exception 'followup_template_invalid_task_title';
  end if;

  v_offset_unit := lower(btrim(coalesce(p_offset_unit, '')));
  if v_offset_unit not in ('hour', 'day') then
    raise exception 'followup_template_invalid_offset';
  end if;
  if p_offset_value is null or p_offset_value <= 0 then
    raise exception 'followup_template_invalid_offset';
  end if;
  if v_offset_unit = 'hour' and p_offset_value > 168 then
    raise exception 'followup_template_invalid_offset';
  end if;
  if v_offset_unit = 'day' and p_offset_value > 90 then
    raise exception 'followup_template_invalid_offset';
  end if;

  v_default_time := nullif(btrim(coalesce(p_default_time, '')), '');
  if v_default_time is not null and v_default_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'followup_template_invalid_time';
  end if;
  if v_offset_unit = 'hour' and v_default_time is not null then
    raise exception 'followup_template_invalid_time';
  end if;

  update public.followup_templates
    set name         = p_name,
        task_title   = p_task_title,
        task_note    = coalesce(p_task_note, ''),
        priority     = p_priority,
        offset_value = p_offset_value,
        offset_unit  = v_offset_unit,
        default_time = v_default_time,
        updated_by   = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
    returning * into v_row;

  if v_row.id is null then
    raise exception 'followup_template_conflict';
  end if;

  return v_row;
end;
$$;

-- ── set_followup_template_active ─────────────────────────────────────────
-- Toggle dedicado (nunca via update_followup_template — precheck A2-EXEC
-- §24/§25). Reativar (false->true) revalida o limite de 12 ativos; desativar
-- nunca é bloqueado por limite. Desativar/reativar NUNCA altera Tasks já
-- criadas a partir do template (precheck A1 §29 — sem template_id em tasks,
-- não há nada a alcançar).
-- Erros estáveis: forbidden, company_required, company_not_found,
-- company_read_only, followup_template_not_found,
-- followup_template_limit_reached, followup_template_conflict.
create function public.set_followup_template_active(
  p_id               uuid,
  p_expected_version integer,
  p_is_active        boolean,
  p_company_id       uuid default null
) returns public.followup_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx          record;
  v_template     public.followup_templates;
  v_active_count integer;
  v_row          public.followup_templates;
begin
  select * into v_ctx from public.resolve_followup_template_mutation_context(p_company_id);

  if p_expected_version is null or p_is_active is null then
    raise exception 'followup_template_conflict';
  end if;

  select t.* into v_template
    from public.followup_templates t
    where t.id = p_id and t.company_id = v_ctx.resolved_company_id;
  if v_template.id is null then
    raise exception 'followup_template_not_found';
  end if;

  if p_is_active and not v_template.is_active then
    perform pg_advisory_xact_lock(hashtext('followup_templates:' || v_ctx.resolved_company_id::text));
    v_active_count := public._followup_template_active_count(v_ctx.resolved_company_id);
    if v_active_count >= public._followup_template_active_limit() then
      raise exception 'followup_template_limit_reached';
    end if;
  end if;

  update public.followup_templates
    set is_active  = p_is_active,
        updated_by = v_ctx.actor_profile_id
    where id = p_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
    returning * into v_row;

  if v_row.id is null then
    raise exception 'followup_template_conflict';
  end if;

  return v_row;
end;
$$;

-- ── reorder_followup_templates ───────────────────────────────────────────
-- Mesma mecânica de reorder_pipeline_stages (m1c_03): lock explícito em
-- ordem determinística (ORDER BY id), permutação COMPLETA obrigatória
-- (ativos + inativos — precheck A2-EXEC §13, lista única de gerenciamento
-- do Manager), sem IDs cross-company. unique(company_id, sort_order) é
-- DEFERRABLE INITIALLY DEFERRED, permitindo os estados intermediários do
-- laço dentro desta transação.
-- Erros estáveis: forbidden, company_required, company_not_found,
-- company_read_only, followup_template_not_found,
-- followup_template_reorder_incomplete.
create function public.reorder_followup_templates(
  p_ordered_ids uuid[],
  p_company_id  uuid default null
) returns setof public.followup_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx      record;
  v_id       uuid;
  v_idx      int := 0;
  v_matching int;
  v_total    int;
begin
  select * into v_ctx from public.resolve_followup_template_mutation_context(p_company_id);

  if p_ordered_ids is null or cardinality(p_ordered_ids) = 0 then
    raise exception 'followup_template_reorder_incomplete';
  end if;
  if array_ndims(p_ordered_ids) <> 1 then
    raise exception 'followup_template_reorder_incomplete';
  end if;

  perform 1 from public.followup_templates
    where company_id = v_ctx.resolved_company_id
    order by id
    for update;

  select count(distinct t.id) into v_matching
    from public.followup_templates t
    where t.id = any(p_ordered_ids) and t.company_id = v_ctx.resolved_company_id;
  select count(*) into v_total
    from public.followup_templates
    where company_id = v_ctx.resolved_company_id;

  if v_matching <> cardinality(p_ordered_ids) then
    raise exception 'followup_template_not_found';
  end if;
  if v_matching <> v_total or v_total = 0 then
    raise exception 'followup_template_reorder_incomplete';
  end if;

  foreach v_id in array p_ordered_ids loop
    update public.followup_templates
      set sort_order = v_idx,
          updated_by = v_ctx.actor_profile_id
      where id = v_id and company_id = v_ctx.resolved_company_id;
    v_idx := v_idx + 1;
  end loop;

  return query
    select * from public.followup_templates
    where company_id = v_ctx.resolved_company_id
    order by sort_order;
end;
$$;

-- ── list_platform_followup_templates_for_company ─────────────────────────
-- Leitura contextual EXCLUSIVA de Super Admin (mesmo molde de
-- list_platform_tasks_for_company, 20260825160000) — Manager/Seller
-- continuam usando SELECT direto + followup_templates_select, nunca esta
-- RPC. Reaproveita _resolve_commercial_read_company (função INTERNA já
-- existente, sem GRANT a authenticated — chamável aqui porque esta função
-- roda SECURITY DEFINER sob o mesmo owner/privilégio implícito, exatamente
-- como list_platform_tasks_for_company já faz) — nunca uma segunda cópia de
-- is_platform_super_admin()/can_access_company(). p_include_inactive:
-- default false (paridade com a superfície comercial-read já existente);
-- Manager/Super Admin gerenciando templates usa true (precheck A1 §20).
create function public.list_platform_followup_templates_for_company(
  p_company_id        uuid,
  p_include_inactive  boolean default false
) returns setof public.followup_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  v_company_id := public._resolve_commercial_read_company(p_company_id);
  return query
    select *
      from public.followup_templates t
     where t.company_id = v_company_id
       and (p_include_inactive or t.is_active)
     order by t.sort_order asc, t.id asc;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────

revoke all on function public.create_followup_template(text, text, public.task_priority, integer, text, text, text, integer, uuid) from public;
revoke all on function public.create_followup_template(text, text, public.task_priority, integer, text, text, text, integer, uuid) from anon;
revoke all on function public.create_followup_template(text, text, public.task_priority, integer, text, text, text, integer, uuid) from authenticated;
grant execute on function public.create_followup_template(text, text, public.task_priority, integer, text, text, text, integer, uuid) to authenticated;

revoke all on function public.update_followup_template(uuid, integer, text, text, text, public.task_priority, integer, text, text, uuid) from public;
revoke all on function public.update_followup_template(uuid, integer, text, text, text, public.task_priority, integer, text, text, uuid) from anon;
revoke all on function public.update_followup_template(uuid, integer, text, text, text, public.task_priority, integer, text, text, uuid) from authenticated;
grant execute on function public.update_followup_template(uuid, integer, text, text, text, public.task_priority, integer, text, text, uuid) to authenticated;

revoke all on function public.set_followup_template_active(uuid, integer, boolean, uuid) from public;
revoke all on function public.set_followup_template_active(uuid, integer, boolean, uuid) from anon;
revoke all on function public.set_followup_template_active(uuid, integer, boolean, uuid) from authenticated;
grant execute on function public.set_followup_template_active(uuid, integer, boolean, uuid) to authenticated;

revoke all on function public.reorder_followup_templates(uuid[], uuid) from public;
revoke all on function public.reorder_followup_templates(uuid[], uuid) from anon;
revoke all on function public.reorder_followup_templates(uuid[], uuid) from authenticated;
grant execute on function public.reorder_followup_templates(uuid[], uuid) to authenticated;

revoke all on function public.list_platform_followup_templates_for_company(uuid, boolean) from public;
revoke all on function public.list_platform_followup_templates_for_company(uuid, boolean) from anon;
revoke all on function public.list_platform_followup_templates_for_company(uuid, boolean) from authenticated;
grant execute on function public.list_platform_followup_templates_for_company(uuid, boolean) to authenticated;

commit;
