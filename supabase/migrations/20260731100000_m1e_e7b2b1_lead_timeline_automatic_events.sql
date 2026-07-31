-- M1-E E7-B2-B1 — eventos automáticos e transacionais da timeline
-- Fonte: docs/M1-E-DESIGN.md §15.18 (auditoria E7-B2-A0/A1), confirmada por
-- leitura direta das migrations vigentes. Nenhuma das 7 RPCs de mutation de
-- Leads (create_lead/update_lead/move_lead_to_stage/apply_lead_event/
-- assign_lead_seller/archive_lead/unarchive_lead) gravava em
-- lead_timeline_entries até esta migration — decisão humana já registrada
-- desde o E5-A1 ("a solução atômica de evento+timeline fica reservada ao
-- E7"), confirmada em remoteMutationRepository.ts/useApplyLeadEvent.ts.
--
-- CREATE OR REPLACE (não DROP+CREATE): as 7 assinaturas públicas
-- permanecem EXATAMENTE as mesmas — nenhum parâmetro novo, nenhuma mudança
-- de tipo/default/retorno — então nenhuma mudança de "identidade" de
-- função ocorre e os GRANTs/REVOKEs já publicados nas migrations anteriores
-- permanecem intactos automaticamente (CREATE OR REPLACE preserva
-- privilégios; só DROP+CREATE os perderia). check_lead_phone_duplicate e
-- add_lead_timeline_entry NÃO são tocadas — fora do escopo desta etapa.
--
-- Transação única por chamada de RPC (nenhuma transação manual — funções
-- PL/pgSQL já executam dentro da transação implícita da chamada): o INSERT
-- na timeline acontece DEPOIS da mutation principal e ANTES do retorno,
-- na MESMA função — se o INSERT falhar, a mutation inteira sofre rollback
-- (nenhum evento sem mutation, nenhuma mutation sem evento quando aplicável);
-- se a RPC lançar exceção antes de chegar ao INSERT (forbidden/not_found/
-- archived/stale_write/etc.), nenhuma linha de timeline é criada. Nenhum
-- dual-write do frontend, nenhum trigger.
--
-- Ator: NUNCA aceito do cliente — sempre v_ctx.actor_profile_id/actor_kind
-- já resolvidos por resolve_lead_mutation_context (mesmo padrão das 7
-- RPCs). Super Admin: actor_profile_id NULL na timeline (mesma regra já
-- aplicada a created_by/updated_by_profile_id e ao próprio
-- add_lead_timeline_entry) — audit_log continua registrando a autoria real
-- dele, sem nenhuma alteração; a timeline comercial ganha uma entrada
-- adicional com ator NULL quando a mutation for bem-sucedida (nunca
-- duplica a auditoria, nunca reduz audit_log).
--
-- Idempotência real das 7 RPCs (auditada nesta etapa, não inventada):
--   create_lead/update_lead/apply_lead_event: sem noção formal de
--     request_id — cada chamada bem-sucedida É uma mutação real (nenhuma
--     detecta "sem mudança" hoje) — um evento por chamada bem-sucedida,
--     risco residual documentado abaixo.
--   move_lead_to_stage/assign_lead_seller: o INSERT só ocorre quando o
--     valor efetivamente muda (v_lead.* IS DISTINCT FROM v_row.*) — mover
--     para a MESMA etapa ou atribuir o MESMO vendedor nunca produz evento.
--   archive_lead/unarchive_lead: já têm caminho idempotente real (SELECT
--     FOR UPDATE + retorno antecipado sem UPDATE quando o estado desejado
--     já foi alcançado) — o INSERT só é alcançado na transição real,
--     nunca na chamada repetida idempotente.
-- Risco residual documentado (não corrigido nesta etapa, fora do escopo
-- autorizado): create_lead/update_lead/apply_lead_event não têm
-- request_id/operation_id formal — um retry de rede que reenvia a MESMA
-- chamada após a primeira já ter sido aplicada no servidor (resposta
-- perdida antes de chegar ao cliente) produziria uma SEGUNDA mutação real
-- e um SEGUNDO evento, porque, do ponto de vista do servidor, é uma
-- chamada nova e válida — mesma limitação estrutural que já existe hoje
-- para a própria mutation (não é introduzida por esta migration).
--
-- Sem backfill: eventos automáticos anteriores a esta migration NÃO são
-- reconstruídos — nenhuma tentativa de inferir histórico a partir de
-- updated_at/audit_log/version/StoreAdapter/dados locais/demo.

begin;

-- ── helper interno: grava exatamente uma entrada de timeline ────────────
-- NUNCA exposto a authenticated/anon (sem GRANT EXECUTE) — chamado
-- exclusivamente de dentro das 7 RPCs SECURITY DEFINER abaixo, sempre com
-- valores já validados por resolve_lead_mutation_context (nunca
-- company_id/actor livres vindos do cliente). Mesmo padrão de
-- resolve_lead_mutation_context: função interna, nunca vira API pública.
create function public.record_lead_timeline_event(
  p_company_id       uuid,
  p_lead_id          uuid,
  p_actor_kind       text,
  p_actor_profile_id uuid,
  p_icon             text,
  p_color            text,
  p_label            text,
  p_detail           text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.lead_timeline_entries (
    company_id, lead_id, actor_profile_id, icon, color, label, detail
  ) values (
    p_company_id, p_lead_id,
    case when p_actor_kind = 'super_admin' then null else p_actor_profile_id end,
    p_icon, p_color, p_label, p_detail
  );
end;
$$;

revoke all on function public.record_lead_timeline_event(uuid, uuid, text, uuid, text, text, text, text) from public;
revoke all on function public.record_lead_timeline_event(uuid, uuid, text, uuid, text, text, text, text) from anon;
revoke all on function public.record_lead_timeline_event(uuid, uuid, text, uuid, text, text, text, text) from authenticated;
-- Nenhum GRANT a authenticated de propósito — helper interno.

-- ── 1. create_lead ───────────────────────────────────────────────────────
-- Evento: "Lead criado", sem detail (nenhum dado pessoal repetido).
-- Inserido depois do INSERT do lead e da auditoria de Super Admin, antes
-- do retorno final — corpo idêntico ao publicado em 20260729110000,
-- assinatura inalterada (CREATE OR REPLACE).

create or replace function public.create_lead(
  p_name               text,
  p_phone              text,
  p_car                text,
  p_seller_id          text default null,
  p_temperature        public.lead_temperature default null,
  p_payment_preference text default null,
  p_source             text default null,
  p_company_id         uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx      record;
  v_stage_id uuid;
  v_seller   text;
  v_row      public.leads;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  if v_ctx.actor_kind = 'seller' then
    if p_seller_id is not null and p_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_ctx.actor_seller_id;
  else
    if p_seller_id is not null then
      perform 1 from public.sellers s
        where s.id = p_seller_id
          and s.company_id = v_ctx.resolved_company_id
          and s.is_active;
      if not found then
        raise exception 'seller_not_found';
      end if;
    end if;
    v_seller := p_seller_id;
  end if;

  select ps.id into v_stage_id
    from public.pipeline_stages ps
    where ps.company_id = v_ctx.resolved_company_id and ps.code = 'new';
  if v_stage_id is null then
    raise exception 'initial_stage_missing';
  end if;

  insert into public.leads (
    company_id, name, phone, car, stage_id, seller_id,
    urgency, temperature, last_activity_label, alert_label,
    payment_preference, source,
    created_by_profile_id, updated_by_profile_id
  ) values (
    v_ctx.resolved_company_id, p_name, p_phone, p_car, v_stage_id, v_seller,
    'red', p_temperature, 'Sem contato ainda', 'Fazer primeiro contato',
    p_payment_preference, p_source,
    case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end,
    case when v_ctx.actor_kind = 'super_admin' then null else v_ctx.actor_profile_id end
  )
  returning * into v_row;

  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_created', 'lead', v_row.id::text, 'success', null,
       null,
       jsonb_build_object('lead_id', v_row.id, 'stage_id', v_row.stage_id, 'seller_id', v_row.seller_id, 'archived', false),
       'rpc');
  end if;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'plus', '#E8CE72', 'Lead criado', null);

  return v_row;
end;
$$;

-- ── 2. update_lead ───────────────────────────────────────────────────────
-- Evento: "Dados do lead atualizados", sem detail (nunca telefone/valores
-- antes-depois — a RPC não detecta "sem mudança real" hoje, então toda
-- chamada bem-sucedida é uma atualização real por definição atual).

create or replace function public.update_lead(
  p_lead_id            uuid,
  p_expected_version   integer,
  p_name               text,
  p_phone              text,
  p_car                text,
  p_temperature        public.lead_temperature default null,
  p_payment_preference text default null,
  p_source             text default null,
  p_company_id         uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx    record;
  v_lead   public.leads;
  v_row    public.leads;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select l.* into v_lead
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

  update public.leads
    set name = p_name,
        phone = p_phone,
        car = p_car,
        temperature = p_temperature,
        payment_preference = p_payment_preference,
        source = p_source,
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
    v_before := jsonb_build_object(
      'name_changed', (p_name is distinct from v_lead.name),
      'phone_changed', (p_phone is distinct from v_lead.phone),
      'car', v_lead.car,
      'temperature', v_lead.temperature,
      'payment_preference', v_lead.payment_preference,
      'source', v_lead.source
    );
    v_after := jsonb_build_object(
      'name_changed', (p_name is distinct from v_lead.name),
      'phone_changed', (p_phone is distinct from v_lead.phone),
      'car', p_car,
      'temperature', p_temperature,
      'payment_preference', p_payment_preference,
      'source', p_source
    );
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_updated', 'lead', v_row.id::text, 'success', null,
       v_before, v_after, 'rpc');
  end if;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'edit', '#8B8B93', 'Dados do lead atualizados', null);

  return v_row;
end;
$$;

-- ── 3. move_lead_to_stage ────────────────────────────────────────────────
-- Evento: "Etapa alterada", detail "De {etapa anterior} para {etapa nova}"
-- com nomes reais de pipeline_stages (nunca UUID). Só insere quando a
-- etapa realmente mudou (v_lead.stage_id, capturado ANTES do update,
-- comparado a v_row.stage_id) — mover para a mesma etapa nunca gera
-- evento. Nunca alcançado em stage_not_found/lead_archived/forbidden/
-- stale_write (todos lançam exceção antes).

create or replace function public.move_lead_to_stage(
  p_lead_id          uuid,
  p_stage_id         uuid,
  p_expected_version integer default null,
  p_company_id       uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx           record;
  v_lead          record;
  v_row           public.leads;
  v_old_stage_name text;
  v_new_stage_name text;
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

  if v_lead.stage_id is distinct from v_row.stage_id then
    select name into v_old_stage_name from public.pipeline_stages where id = v_lead.stage_id;
    select name into v_new_stage_name from public.pipeline_stages where id = v_row.stage_id;
    perform public.record_lead_timeline_event(
      v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
      'flow', '#E8CE72', 'Etapa alterada',
      'De ' || coalesce(v_old_stage_name, 'etapa anterior') || ' para ' || coalesce(v_new_stage_name, 'nova etapa'));
  end if;

  return v_row;
end;
$$;

-- ── 4. apply_lead_event ──────────────────────────────────────────────────
-- Mapeamento evento -> health/labels/estagio PRESERVADO integralmente,
-- caractere a caractere. Mapa NOVO e SEPARADO evento -> texto sanitizado
-- da timeline (nunca o código bruto do enum, nunca payload) — evento
-- sempre único por chamada bem-sucedida (a RPC não detecta idempotência
-- formal hoje, mesmo risco residual documentado no cabeçalho).

create or replace function public.apply_lead_event(
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
  v_tl_icon   text;
  v_tl_color  text;
  v_tl_label  text;
  v_tl_detail text;
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

  -- Mapa sanitizado evento -> texto da timeline (nunca o código do enum,
  -- nunca payload/JSON/stack). Agrupado por categoria de produto: ligação
  -- (verde, telefone), visita (dourado/vermelho se cancelada, calendário),
  -- proposta (dourado/verde/vermelho, aperto de mãos), venda (dourado/
  -- vermelho, troféu), atendimento (azul, atualização).
  case p_event_type
    when 'call_outcome_visit'          then v_tl_icon:='phone';     v_tl_color:='#27C75F'; v_tl_label:='Ligação registrada';     v_tl_detail:='Visita agendada por telefone';
    when 'call_outcome_proposal'       then v_tl_icon:='phone';     v_tl_color:='#27C75F'; v_tl_label:='Ligação registrada';     v_tl_detail:='Cliente pediu proposta';
    when 'call_outcome_callback'       then v_tl_icon:='phone';     v_tl_color:='#27C75F'; v_tl_label:='Ligação registrada';     v_tl_detail:='Cliente pediu retorno';
    when 'call_outcome_no_answer'      then v_tl_icon:='phone';     v_tl_color:='#27C75F'; v_tl_label:='Ligação registrada';     v_tl_detail:='Cliente não atendeu';
    when 'visit_scheduled_complete'    then v_tl_icon:='calendar';  v_tl_color:='#E8CE72'; v_tl_label:='Visita agendada';        v_tl_detail:=null;
    when 'visit_scheduled_incomplete'  then v_tl_icon:='calendar';  v_tl_color:='#E8CE72'; v_tl_label:='Agendamento de visita atualizado'; v_tl_detail:=null;
    when 'visit_confirmed'             then v_tl_icon:='calendar';  v_tl_color:='#E8CE72'; v_tl_label:='Visita confirmada';      v_tl_detail:=null;
    when 'visit_canceled'              then v_tl_icon:='calendar';  v_tl_color:='#FF3B3B'; v_tl_label:='Visita cancelada';       v_tl_detail:=null;
    when 'visit_rescheduled'           then v_tl_icon:='calendar';  v_tl_color:='#E8CE72'; v_tl_label:='Visita remarcada';       v_tl_detail:=null;
    when 'deal_created_needs_approval' then v_tl_icon:='handshake'; v_tl_color:='#E8CE72'; v_tl_label:='Proposta criada';        v_tl_detail:='Aguardando aprovação do gestor';
    when 'deal_created_direct'         then v_tl_icon:='handshake'; v_tl_color:='#E8CE72'; v_tl_label:='Proposta criada';        v_tl_detail:=null;
    when 'deal_approved'               then v_tl_icon:='handshake'; v_tl_color:='#27C75F'; v_tl_label:='Proposta aprovada';      v_tl_detail:=null;
    when 'deal_rejected'               then v_tl_icon:='handshake'; v_tl_color:='#FF3B3B'; v_tl_label:='Proposta recusada';      v_tl_detail:=null;
    when 'sale_registered'             then v_tl_icon:='trophy';    v_tl_color:='#E8CE72'; v_tl_label:='Venda registrada';       v_tl_detail:=null;
    when 'sale_canceled'               then v_tl_icon:='trophy';    v_tl_color:='#FF3B3B'; v_tl_label:='Venda cancelada';        v_tl_detail:=null;
    when 'visit_result_done'           then v_tl_icon:='refresh';   v_tl_color:='#3B82F6'; v_tl_label:='Atendimento atualizado'; v_tl_detail:='Visita realizada';
    when 'visit_result_thinking'       then v_tl_icon:='refresh';   v_tl_color:='#3B82F6'; v_tl_label:='Atendimento atualizado'; v_tl_detail:='Cliente vai pensar';
    when 'visit_result_no_interest'    then v_tl_icon:='refresh';   v_tl_color:='#3B82F6'; v_tl_label:='Atendimento atualizado'; v_tl_detail:='Sem interesse no momento';
    else
      v_tl_icon:='history'; v_tl_color:='#8B8B93'; v_tl_label:='Atendimento atualizado'; v_tl_detail:=null;
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

  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, p_event_type::text, 'lead', v_row.id::text, 'success', null,
       jsonb_build_object('stage_id', v_lead.stage_id, 'urgency', v_lead.urgency),
       jsonb_build_object('stage_id', v_row.stage_id, 'urgency', v_row.urgency),
       'rpc');
  end if;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    v_tl_icon, v_tl_color, v_tl_label, v_tl_detail);

  return v_row;
end;
$$;

-- ── 5. assign_lead_seller ────────────────────────────────────────────────
-- Evento: "Responsável alterado" (detail "Atribuído a {nome}") quando um
-- Seller é atribuído; "Responsável removido" (sem detail) quando
-- desatribuído. Só insere quando o seller_id realmente mudou
-- (v_lead.seller_id, capturado ANTES do update, comparado a
-- v_row.seller_id) — reatribuir o MESMO vendedor nunca gera evento.

create or replace function public.assign_lead_seller(
  p_lead_id          uuid,
  p_seller_id        text,
  p_expected_version integer,
  p_company_id       uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx         record;
  v_lead        record;
  v_row         public.leads;
  v_seller_name text;
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

  if v_lead.seller_id is distinct from v_row.seller_id then
    if v_row.seller_id is not null then
      select s.name into v_seller_name from public.sellers s where s.id = v_row.seller_id;
      perform public.record_lead_timeline_event(
        v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
        'users', '#3B82F6', 'Responsável alterado',
        'Atribuído a ' || coalesce(v_seller_name, 'vendedor'));
    else
      perform public.record_lead_timeline_event(
        v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
        'users', '#3B82F6', 'Responsável removido', null);
    end if;
  end if;

  return v_row;
end;
$$;

-- ── 6. archive_lead ──────────────────────────────────────────────────────
-- Evento: "Lead arquivado", sem detail. O caminho idempotente (estado já
-- alcançado) retorna ANTES desta linha ser alcançada — nunca duplica
-- evento numa chamada repetida.

create or replace function public.archive_lead(
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

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'inbox', '#FF3B3B', 'Lead arquivado', null);

  return v_row;
end;
$$;

-- ── 7. unarchive_lead ────────────────────────────────────────────────────
-- Evento: "Lead restaurado", sem detail. Mesmo caminho idempotente de
-- archive_lead — retorno antecipado nunca alcança o INSERT.

create or replace function public.unarchive_lead(
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

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_row.id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'refresh', '#27C75F', 'Lead restaurado', null);

  return v_row;
end;
$$;

commit;
