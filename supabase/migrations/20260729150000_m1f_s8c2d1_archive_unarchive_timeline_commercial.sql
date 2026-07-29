-- M1-F S8-C2-D1 (parte 2/2) — archive_lead/unarchive_lead/
-- add_lead_timeline_entry com contexto comercial explícito
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §38. Depende de
-- 20260729140000 (mesma etapa, parte 1/2) e 20260729100000
-- (resolve_lead_mutation_context).
--
-- Mesmo molde das duas migrations anteriores: DROP FUNCTION da assinatura
-- antiga + CREATE da nova (p_company_id no final), na MESMA transação.
-- archive_lead/unarchive_lead: Seller nunca chama (forbidden); Manager/
-- Super Admin conforme resolve_lead_mutation_context. SELECT FOR UPDATE e
-- o caminho idempotente (estado já alcançado -> devolve a linha, SEM
-- update, SEM bump de version, SEM stale_write mesmo com versão antiga)
-- preservados caractere a caractere do m1e_03 original.
--
-- add_lead_timeline_entry: lead_timeline_actor_fk (m1e_02) referencia
-- public.profiles(company_id, id) — não é alterada nesta etapa (fora do
-- escopo autorizado: "não alterar as FKs"). Para Manager/Seller o valor
-- inserido em actor_profile_id é idêntico ao que já era inserido antes
-- (o próprio profile derivado de auth.uid(), agora via
-- resolve_lead_mutation_context em vez de leitura direta de profiles) —
-- nenhuma mudança de comportamento ou de risco em relação ao que já
-- estava publicado. Para Super Admin, que nunca chamou esta RPC antes
-- (profiles.company_id sempre null o bloqueava na checagem inicial
-- original), actor_profile_id fica NULL — mesma decisão humana já
-- aplicada a leads.created_by_profile_id/updated_by_profile_id (§34.3):
-- a FK aceita NULL, e a autoria real do Super Admin fica inteiramente
-- registrada em audit_log.actor_profile_id.
--
-- audit_log: somente mutations de Super Admin BEM-SUCEDIDAS (uma
-- transição de estado real acontece) — o caminho idempotente de archive/
-- unarchive (estado já alcançado, nenhum UPDATE) não escreve audit_log,
-- pois não há delta algum para registrar; uma chamada repetida do mesmo
-- Super Admin no mesmo estado não produz entradas redundantes.

begin;

-- ── 1. archive_lead ──────────────────────────────────────────────────────

drop function public.archive_lead(uuid, integer);

create function public.archive_lead(
  p_lead_id          uuid,
  p_expected_version integer,
  p_company_id       uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx  record;
  v_lead public.leads;
  v_row  public.leads;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  if v_ctx.actor_kind = 'seller' then
    raise exception 'forbidden';
  end if;

  select l.* into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_ctx.resolved_company_id
    for update;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;

  -- Estado desejado já alcançado: idempotente, nenhuma escrita, nenhuma
  -- auditoria (nenhum delta a registrar).
  if v_lead.archived_at is not null then
    return v_lead;
  end if;

  if p_expected_version is null or v_lead.version <> p_expected_version then
    raise exception 'stale_write';
  end if;

  update public.leads
    set archived_at = now(),
        updated_by_profile_id = case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end
    where id = p_lead_id and company_id = v_ctx.resolved_company_id
    returning * into v_row;

  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_archived', 'lead', v_row.id::text, 'success', null,
       jsonb_build_object('archived', false),
       jsonb_build_object('archived', true, 'archived_at', v_row.archived_at),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ── 2. unarchive_lead ────────────────────────────────────────────────────

drop function public.unarchive_lead(uuid, integer);

create function public.unarchive_lead(
  p_lead_id          uuid,
  p_expected_version integer,
  p_company_id       uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx  record;
  v_lead public.leads;
  v_row  public.leads;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  if v_ctx.actor_kind = 'seller' then
    raise exception 'forbidden';
  end if;

  select l.* into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_ctx.resolved_company_id
    for update;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;

  -- Estado desejado já alcançado: idempotente, nenhuma escrita, nenhuma
  -- auditoria (nenhum delta a registrar).
  if v_lead.archived_at is null then
    return v_lead;
  end if;

  if p_expected_version is null or v_lead.version <> p_expected_version then
    raise exception 'stale_write';
  end if;

  update public.leads
    set archived_at = null,
        updated_by_profile_id = case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end
    where id = p_lead_id and company_id = v_ctx.resolved_company_id
    returning * into v_row;

  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_unarchived', 'lead', v_row.id::text, 'success', null,
       jsonb_build_object('archived', true),
       jsonb_build_object('archived', false),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ── 3. add_lead_timeline_entry ───────────────────────────────────────────

drop function public.add_lead_timeline_entry(uuid, text, text, text, text);

create function public.add_lead_timeline_entry(
  p_lead_id    uuid,
  p_icon       text,
  p_label      text,
  p_color      text,
  p_detail     text default null,
  p_company_id uuid default null
) returns public.lead_timeline_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx  record;
  v_lead record;
  v_row  public.lead_timeline_entries;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  select l.id, l.seller_id, l.archived_at into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_ctx.resolved_company_id;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if v_lead.archived_at is not null then
    raise exception 'lead_archived';
  end if;
  if v_ctx.actor_kind = 'seller'
     and v_lead.seller_id is distinct from v_ctx.actor_seller_id then
    raise exception 'forbidden';
  end if;

  insert into public.lead_timeline_entries (
    company_id, lead_id, actor_profile_id, icon, color, label, detail
  ) values (
    v_ctx.resolved_company_id, p_lead_id,
    case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end,
    p_icon, p_color, p_label, p_detail
  )
  returning * into v_row;

  -- Auditoria: registra somente que uma entrada foi adicionada (id da
  -- timeline + do lead) — nunca o conteúdo (label/detail são comerciais,
  -- a timeline em si já é a fonte da verdade para a equipe comercial).
  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_timeline_entry_added', 'lead_timeline_entry', v_row.id::text, 'success', null,
       null,
       jsonb_build_object('lead_id', p_lead_id, 'timeline_entry_id', v_row.id),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ─────

revoke all on function public.archive_lead(uuid, integer, uuid) from public;
revoke all on function public.archive_lead(uuid, integer, uuid) from anon;
revoke all on function public.archive_lead(uuid, integer, uuid) from authenticated;
grant execute on function public.archive_lead(uuid, integer, uuid) to authenticated;

revoke all on function public.unarchive_lead(uuid, integer, uuid) from public;
revoke all on function public.unarchive_lead(uuid, integer, uuid) from anon;
revoke all on function public.unarchive_lead(uuid, integer, uuid) from authenticated;
grant execute on function public.unarchive_lead(uuid, integer, uuid) to authenticated;

revoke all on function public.add_lead_timeline_entry(uuid, text, text, text, text, uuid) from public;
revoke all on function public.add_lead_timeline_entry(uuid, text, text, text, text, uuid) from anon;
revoke all on function public.add_lead_timeline_entry(uuid, text, text, text, text, uuid) from authenticated;
grant execute on function public.add_lead_timeline_entry(uuid, text, text, text, text, uuid) to authenticated;

commit;
