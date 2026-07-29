-- M1-F S8-C2-D1 (parte 1/2) — move_lead_to_stage/apply_lead_event/
-- assign_lead_seller com contexto comercial explícito
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §38 (implementação),
-- que aplica as decisões já congeladas em §31/§34 ao restante das RPCs de
-- mutation de Leads. Depende de 20260729100000 (resolve_lead_mutation_
-- context) e 20260729120000 (FKs de autoria por membership histórica).
--
-- Mesmo molde de 20260729110000 (create_lead/update_lead/check_lead_phone_
-- duplicate): as três funções mudam de IDENTIDADE (ganham p_company_id no
-- final) — DROP FUNCTION da assinatura antiga + CREATE da nova, na MESMA
-- transação. Nenhuma lê mais profiles.company_id/profiles.role/
-- profiles.seller_id — toda autorização passa por
-- resolve_lead_mutation_context(p_company_id) (p_read_only=false: as três
-- são mutation real, exigem status ativa/implantacao para Super Admin e
-- exatamente ativa para Manager/Seller, idêntico a create_lead/update_lead).
--
-- archive_lead/unarchive_lead/add_lead_timeline_entry NÃO são tocadas aqui
-- — migradas na migration seguinte (20260729150000). create_lead/
-- update_lead/check_lead_phone_duplicate (S8-C2-C1) e as 4 RPCs de leitura
-- comercial (S8-C2-B1) permanecem exatamente como publicadas.
--
-- updated_by_profile_id: NULL para Super Admin (mesma decisão de create_
-- lead/update_lead, §34.3 — leads_updated_by_fk exige uma membership real
-- na mesma empresa; Super Admin nunca tem uma). Manager/Seller preservam o
-- profile real, sem nenhuma mudança de comportamento.
--
-- audit_log: somente mutations de Super Admin bem-sucedidas, mesma
-- transação da mutação comercial, nunca PII completa (§14 do pedido desta
-- etapa) — mesmo padrão já usado por create_lead/update_lead.

begin;

-- ── 1. move_lead_to_stage ────────────────────────────────────────────────

drop function public.move_lead_to_stage(uuid, uuid, integer);

create function public.move_lead_to_stage(
  p_lead_id          uuid,
  p_stage_id         uuid,
  p_expected_version integer default null,
  p_company_id       uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx      record;
  v_lead     record;
  v_row      public.leads;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  select l.id, l.seller_id, l.archived_at, l.stage_id into v_lead
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

  perform 1 from public.pipeline_stages ps
    where ps.id = p_stage_id and ps.company_id = v_ctx.resolved_company_id;
  if not found then
    raise exception 'stage_not_found';
  end if;

  update public.leads
    set stage_id = p_stage_id,
        updated_by_profile_id = case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end
    where id = p_lead_id
      and company_id = v_ctx.resolved_company_id
      and archived_at is null
      and (p_expected_version is null or version = p_expected_version)
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_stage_moved', 'lead', v_row.id::text, 'success', null,
       jsonb_build_object('stage_id', v_lead.stage_id),
       jsonb_build_object('stage_id', v_row.stage_id),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ── 2. apply_lead_event ──────────────────────────────────────────────────
-- Mapeamento evento -> health/labels/estagio PRESERVADO integralmente,
-- caractere a caractere, dos 18 valores já publicados em m1e_03.

drop function public.apply_lead_event(uuid, public.lead_event_type);

create function public.apply_lead_event(
  p_lead_id    uuid,
  p_event_type public.lead_event_type,
  p_company_id uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx       record;
  v_lead      record;
  v_urgency   public.lead_urgency;
  v_alert     text;
  v_last      text;
  v_stage_code text;
  v_stage_id  uuid;
  v_row       public.leads;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  select l.id, l.seller_id, l.archived_at, l.stage_id, l.urgency into v_lead
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

  case p_event_type
    when 'call_outcome_visit'          then v_urgency := 'amber'; v_stage_code := 'qualified';       v_alert := 'Agendar visita';                            v_last := 'Aguardando agendamento';
    when 'call_outcome_proposal'       then v_urgency := 'amber'; v_stage_code := 'negotiation';     v_alert := 'Montar proposta';                           v_last := 'Agora';
    when 'call_outcome_callback'       then v_urgency := 'amber'; v_stage_code := null;              v_alert := 'Fazer follow-up';                           v_last := 'Agora';
    when 'call_outcome_no_answer'      then v_urgency := 'amber'; v_stage_code := null;              v_alert := 'Tentar contato novamente';                  v_last := 'Agora';
    when 'visit_scheduled_complete'    then v_urgency := 'green'; v_stage_code := 'visit_scheduled'; v_alert := 'Visita agendada';                           v_last := 'No prazo';
    when 'visit_scheduled_incomplete'  then v_urgency := 'amber'; v_stage_code := 'qualified';       v_alert := 'Agendar visita';                            v_last := 'Aguardando agendamento';
    when 'visit_confirmed'             then v_urgency := 'green'; v_stage_code := null;              v_alert := 'Visita confirmada';                         v_last := 'Cliente confirmou presença';
    when 'visit_canceled'              then v_urgency := 'red';   v_stage_code := null;              v_alert := 'Visita cancelada — retomar contato';        v_last := 'Cliente cancelou a visita';
    when 'visit_rescheduled'           then v_urgency := 'amber'; v_stage_code := null;              v_alert := 'Visita remarcada — confirmar novo horário'; v_last := 'Aguardando nova confirmação';
    when 'deal_created_needs_approval' then v_urgency := 'amber'; v_stage_code := 'negotiation';     v_alert := 'Acompanhar proposta';                       v_last := 'Proposta enviada';
    when 'deal_created_direct'         then v_urgency := 'green'; v_stage_code := 'negotiation';     v_alert := 'Proposta enviada';                          v_last := 'Aguardando resposta do cliente';
    when 'deal_approved'               then v_urgency := 'green'; v_stage_code := null;              v_alert := 'Proposta aprovada — fechar venda';          v_last := 'Aprovada pelo gestor';
    when 'deal_rejected'               then v_urgency := 'amber'; v_stage_code := null;              v_alert := 'Renegociar proposta';                       v_last := 'Recusada pelo gestor';
    when 'sale_registered'             then v_urgency := 'green'; v_stage_code := 'closing';         v_alert := 'Venda registrada';                          v_last := 'Concluído';
    when 'sale_canceled'               then v_urgency := 'amber'; v_stage_code := 'negotiation';     v_alert := 'Venda cancelada';                           v_last := 'Retomar negociação';
    when 'visit_result_done'           then v_urgency := 'green'; v_stage_code := 'negotiation';     v_alert := 'Próximo passo comercial';                   v_last := 'Visita realizada';
    when 'visit_result_thinking'       then v_urgency := 'amber'; v_stage_code := 'negotiation';     v_alert := 'Acompanhar cliente';                        v_last := 'Cliente ficou de pensar';
    when 'visit_result_no_interest'    then v_urgency := 'amber'; v_stage_code := null;              v_alert := 'Sem interesse no momento';                  v_last := 'Registrar motivo de perda futuramente';
    else
      raise exception 'invalid_event';
  end case;

  if v_stage_code is not null then
    select ps.id into v_stage_id
      from public.pipeline_stages ps
      where ps.company_id = v_ctx.resolved_company_id and ps.code = v_stage_code;
    if v_stage_id is null then
      raise exception 'stage_not_found';
    end if;
  end if;

  update public.leads
    set urgency = v_urgency,
        alert_label = v_alert,
        last_activity_label = v_last,
        stage_id = coalesce(v_stage_id, stage_id),
        updated_by_profile_id = case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end
    where id = p_lead_id
      and company_id = v_ctx.resolved_company_id
      and archived_at is null
    returning * into v_row;

  if v_row.id is null then
    raise exception 'lead_archived';
  end if;

  -- Auditoria: action = o próprio tipo do evento (enum fechado, já
  -- inerentemente livre de PII) — nunca payload, nunca telefone/nome.
  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, p_event_type::text, 'lead', v_row.id::text, 'success', null,
       jsonb_build_object('stage_id', v_lead.stage_id, 'urgency', v_lead.urgency),
       jsonb_build_object('stage_id', v_row.stage_id, 'urgency', v_row.urgency),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ── 3. assign_lead_seller ────────────────────────────────────────────────
-- Seller nunca chama (forbidden, contrato preservado); Manager/Super Admin
-- atribuem/trocam/removem, seller-alvo sempre da EMPRESA RESOLVIDA.

drop function public.assign_lead_seller(uuid, text, integer);

create function public.assign_lead_seller(
  p_lead_id          uuid,
  p_seller_id        text,
  p_expected_version integer,
  p_company_id       uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx  record;
  v_lead record;
  v_row  public.leads;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  if v_ctx.actor_kind = 'seller' then
    raise exception 'forbidden';
  end if;
  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select l.id, l.seller_id, l.archived_at into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_ctx.resolved_company_id;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if v_lead.archived_at is not null then
    raise exception 'lead_archived';
  end if;

  if p_seller_id is not null then
    perform 1 from public.sellers s
      where s.id = p_seller_id
        and s.company_id = v_ctx.resolved_company_id
        and s.is_active;
    if not found then
      raise exception 'seller_not_found';
    end if;
  end if;

  update public.leads
    set seller_id = p_seller_id,
        updated_by_profile_id = case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end
    where id = p_lead_id
      and company_id = v_ctx.resolved_company_id
      and archived_at is null
      and version = p_expected_version
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_seller_assigned', 'lead', v_row.id::text, 'success', null,
       jsonb_build_object('seller_id', v_lead.seller_id),
       jsonb_build_object('seller_id', v_row.seller_id),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ─────

revoke all on function public.move_lead_to_stage(uuid, uuid, integer, uuid) from public;
revoke all on function public.move_lead_to_stage(uuid, uuid, integer, uuid) from anon;
revoke all on function public.move_lead_to_stage(uuid, uuid, integer, uuid) from authenticated;
grant execute on function public.move_lead_to_stage(uuid, uuid, integer, uuid) to authenticated;

revoke all on function public.apply_lead_event(uuid, public.lead_event_type, uuid) from public;
revoke all on function public.apply_lead_event(uuid, public.lead_event_type, uuid) from anon;
revoke all on function public.apply_lead_event(uuid, public.lead_event_type, uuid) from authenticated;
grant execute on function public.apply_lead_event(uuid, public.lead_event_type, uuid) to authenticated;

revoke all on function public.assign_lead_seller(uuid, text, integer, uuid) from public;
revoke all on function public.assign_lead_seller(uuid, text, integer, uuid) from anon;
revoke all on function public.assign_lead_seller(uuid, text, integer, uuid) from authenticated;
grant execute on function public.assign_lead_seller(uuid, text, integer, uuid) to authenticated;

commit;
