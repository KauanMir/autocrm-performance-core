-- M1-E / Módulo 1 — m1e_03: as 9 RPCs de leads
-- Fonte: docs/M1-E-DESIGN.md (Revisão 3), §5 (atomicidade), §6, §7, §9.
-- Depende de m1e_01 (leads + enums) e m1e_02 (timeline).
--
-- 8 RPCs de escrita + 1 RPC de leitura controlada. Todas SECURITY DEFINER,
-- search_path vazio, objetos totalmente qualificados, profile derivado de
-- auth.uid() com is_active obrigatório, company derivada do profile —
-- nunca aceitam company_id, role ou user_id como autoridade do cliente.
-- Erros estáveis: forbidden, lead_not_found, stage_not_found,
-- seller_not_found, stale_write, lead_archived, initial_stage_missing,
-- invalid_phone (invalid_event = falha de cast do enum).
--
-- Concorrência (§5): update/assign usam UPDATE condicional por version
-- (zero linhas depois da autorização = stale_write); archive/unarchive usam
-- SELECT FOR UPDATE por causa do caminho idempotente; move é atômico e
-- last-write-wins quando chamado sem versão (drag do Kanban);
-- apply_lead_event é escrita de sistema sem precondition.

begin;

-- ── 1. create_lead ──────────────────────────────────────────────────────
-- Estágio inicial SEMPRE resolvido pelo code 'new' da empresa (§9); o
-- frontend não envia stage. Defaults de sistema do servidor: urgency 'red',
-- labels iniciais do produto. value_amount não é parâmetro e nasce null.

create function public.create_lead(
  p_name               text,
  p_phone              text,
  p_car                text,
  p_seller_id          text default null,
  p_temperature        public.lead_temperature default null,
  p_payment_preference text default null,
  p_source             text default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_stage_id uuid;
  v_seller text;
  v_row public.leads;
begin
  select p.id, p.company_id, p.role, p.seller_id
    into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;

  if v_profile.role = 'seller' then
    -- Seller sempre autoatribuído; escolher outro seller é proibido.
    if v_profile.seller_id is null then
      raise exception 'forbidden';
    end if;
    if p_seller_id is not null and p_seller_id is distinct from v_profile.seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_profile.seller_id;
  else
    if p_seller_id is not null then
      perform 1 from public.sellers s
        where s.id = p_seller_id
          and s.company_id = v_profile.company_id
          and s.is_active;
      if not found then
        raise exception 'seller_not_found';
      end if;
    end if;
    v_seller := p_seller_id;
  end if;

  select ps.id into v_stage_id
    from public.pipeline_stages ps
    where ps.company_id = v_profile.company_id and ps.code = 'new';
  if v_stage_id is null then
    raise exception 'initial_stage_missing';
  end if;

  insert into public.leads (
    company_id, name, phone, car, stage_id, seller_id,
    urgency, temperature, last_activity_label, alert_label,
    payment_preference, source,
    created_by_profile_id, updated_by_profile_id
  ) values (
    v_profile.company_id, p_name, p_phone, p_car, v_stage_id, v_seller,
    'red', p_temperature, 'Sem contato ainda', 'Fazer primeiro contato',
    p_payment_preference, p_source,
    v_profile.id, v_profile.id
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ── 2. update_lead ──────────────────────────────────────────────────────
-- Substituição integral dos campos editáveis. p_expected_version
-- obrigatório; o UPDATE condicional por version é a única porta de escrita
-- (zero linhas depois da autorização = stale_write). Não altera stage,
-- seller, health, archive, auditoria nem value_amount.

create function public.update_lead(
  p_lead_id            uuid,
  p_expected_version   integer,
  p_name               text,
  p_phone              text,
  p_car                text,
  p_temperature        public.lead_temperature default null,
  p_payment_preference text default null,
  p_source             text default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_lead record;
  v_row public.leads;
begin
  select p.id, p.company_id, p.role, p.seller_id
    into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;
  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select l.id, l.seller_id, l.archived_at into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_profile.company_id;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if v_lead.archived_at is not null then
    raise exception 'lead_archived';
  end if;
  if v_profile.role = 'seller'
     and v_lead.seller_id is distinct from v_profile.seller_id then
    raise exception 'forbidden';
  end if;

  update public.leads
    set name = p_name,
        phone = p_phone,
        car = p_car,
        temperature = p_temperature,
        payment_preference = p_payment_preference,
        source = p_source,
        updated_by_profile_id = v_profile.id
    where id = p_lead_id
      and company_id = v_profile.company_id
      and archived_at is null
      and version = p_expected_version
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;
  return v_row;
end;
$$;

-- ── 3. move_lead_to_stage ───────────────────────────────────────────────
-- Drag do Kanban chama sem p_expected_version (last-write-wins aprovado).
-- Stage validado na MESMA empresa; seller move somente o próprio lead.

create function public.move_lead_to_stage(
  p_lead_id          uuid,
  p_stage_id         uuid,
  p_expected_version integer default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_lead record;
  v_row public.leads;
begin
  select p.id, p.company_id, p.role, p.seller_id
    into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;

  select l.id, l.seller_id, l.archived_at into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_profile.company_id;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if v_lead.archived_at is not null then
    raise exception 'lead_archived';
  end if;
  if v_profile.role = 'seller'
     and v_lead.seller_id is distinct from v_profile.seller_id then
    raise exception 'forbidden';
  end if;

  perform 1 from public.pipeline_stages ps
    where ps.id = p_stage_id and ps.company_id = v_profile.company_id;
  if not found then
    raise exception 'stage_not_found';
  end if;

  update public.leads
    set stage_id = p_stage_id,
        updated_by_profile_id = v_profile.id
    where id = p_lead_id
      and company_id = v_profile.company_id
      and archived_at is null
      and (p_expected_version is null or version = p_expected_version)
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;
  return v_row;
end;
$$;

-- ── 4. apply_lead_event ─────────────────────────────────────────────────
-- O cliente envia SOMENTE lead + tipo do evento; urgency, labels e estágio
-- são derivados aqui, do mapeamento fechado do §6.4 do design (espelho de
-- calculateLeadHealth). Health e estágio mudam na mesma transação. Valor
-- fora do enum falha no cast (invalid_event). Sem uso financeiro (§6.4).

create function public.apply_lead_event(
  p_lead_id    uuid,
  p_event_type public.lead_event_type
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_lead record;
  v_urgency public.lead_urgency;
  v_alert text;
  v_last text;
  v_stage_code text;
  v_stage_id uuid;
  v_row public.leads;
begin
  select p.id, p.company_id, p.role, p.seller_id
    into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;

  select l.id, l.seller_id, l.archived_at into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_profile.company_id;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if v_lead.archived_at is not null then
    raise exception 'lead_archived';
  end if;
  if v_profile.role = 'seller'
     and v_lead.seller_id is distinct from v_profile.seller_id then
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
      where ps.company_id = v_profile.company_id and ps.code = v_stage_code;
    if v_stage_id is null then
      raise exception 'stage_not_found';
    end if;
  end if;

  update public.leads
    set urgency = v_urgency,
        alert_label = v_alert,
        last_activity_label = v_last,
        stage_id = coalesce(v_stage_id, stage_id),
        updated_by_profile_id = v_profile.id
    where id = p_lead_id
      and company_id = v_profile.company_id
      and archived_at is null
    returning * into v_row;

  if v_row.id is null then
    raise exception 'lead_archived';
  end if;
  return v_row;
end;
$$;

-- ── 5. assign_lead_seller ───────────────────────────────────────────────
-- Somente manager/admin; p_expected_version OBRIGATÓRIO — atribuição nunca
-- é last-write-wins. UPDATE condicional atômico por version.

create function public.assign_lead_seller(
  p_lead_id          uuid,
  p_seller_id        text,
  p_expected_version integer
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_lead record;
  v_row public.leads;
begin
  select p.id, p.company_id, p.role, p.seller_id
    into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;
  if v_profile.role not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;
  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  select l.id, l.archived_at into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_profile.company_id;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if v_lead.archived_at is not null then
    raise exception 'lead_archived';
  end if;

  if p_seller_id is not null then
    perform 1 from public.sellers s
      where s.id = p_seller_id
        and s.company_id = v_profile.company_id
        and s.is_active;
    if not found then
      raise exception 'seller_not_found';
    end if;
  end if;

  update public.leads
    set seller_id = p_seller_id,
        updated_by_profile_id = v_profile.id
    where id = p_lead_id
      and company_id = v_profile.company_id
      and archived_at is null
      and version = p_expected_version
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;
  return v_row;
end;
$$;

-- ── 6/7. archive_lead e unarchive_lead ──────────────────────────────────
-- Somente manager/admin; SELECT FOR UPDATE por causa do caminho
-- idempotente (§6.6): estado já alcançado retorna a linha SEM UPDATE, sem
-- bump de version e SEM stale_write mesmo com versão antiga; mudança real
-- valida p_expected_version ainda sob o lock.

create function public.archive_lead(
  p_lead_id          uuid,
  p_expected_version integer
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_lead public.leads;
  v_row public.leads;
begin
  select p.id, p.company_id, p.role into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;
  if v_profile.role not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  select l.* into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_profile.company_id
    for update;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;

  -- Estado desejado já alcançado: idempotente, nenhuma escrita.
  if v_lead.archived_at is not null then
    return v_lead;
  end if;

  if p_expected_version is null or v_lead.version <> p_expected_version then
    raise exception 'stale_write';
  end if;

  update public.leads
    set archived_at = now(),
        updated_by_profile_id = v_profile.id
    where id = p_lead_id and company_id = v_profile.company_id
    returning * into v_row;
  return v_row;
end;
$$;

create function public.unarchive_lead(
  p_lead_id          uuid,
  p_expected_version integer
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_lead public.leads;
  v_row public.leads;
begin
  select p.id, p.company_id, p.role into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;
  if v_profile.role not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  select l.* into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_profile.company_id
    for update;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;

  -- Estado desejado já alcançado: idempotente, nenhuma escrita.
  if v_lead.archived_at is null then
    return v_lead;
  end if;

  if p_expected_version is null or v_lead.version <> p_expected_version then
    raise exception 'stale_write';
  end if;

  update public.leads
    set archived_at = null,
        updated_by_profile_id = v_profile.id
    where id = p_lead_id and company_id = v_profile.company_id
    returning * into v_row;
  return v_row;
end;
$$;

-- ── 8. add_lead_timeline_entry ──────────────────────────────────────────
-- Actor e company derivados; occurred_at = now() do servidor (não existe
-- parâmetro de horário). Seller somente em lead próprio e ativo. Checks de
-- btrim vêm das constraints da tabela (m1e_02).

create function public.add_lead_timeline_entry(
  p_lead_id uuid,
  p_icon    text,
  p_label   text,
  p_color   text,
  p_detail  text default null
) returns public.lead_timeline_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_lead record;
  v_row public.lead_timeline_entries;
begin
  select p.id, p.company_id, p.role, p.seller_id
    into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;

  select l.id, l.seller_id, l.archived_at into v_lead
    from public.leads l
    where l.id = p_lead_id and l.company_id = v_profile.company_id;
  if v_lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if v_lead.archived_at is not null then
    raise exception 'lead_archived';
  end if;
  if v_profile.role = 'seller'
     and v_lead.seller_id is distinct from v_profile.seller_id then
    raise exception 'forbidden';
  end if;

  insert into public.lead_timeline_entries (
    company_id, lead_id, actor_profile_id, icon, color, label, detail
  ) values (
    v_profile.company_id, p_lead_id, v_profile.id, p_icon, p_color, p_label, p_detail
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ── 9. check_lead_phone_duplicate (leitura controlada) ──────────────────
-- Resolve a checagem de duplicidade sob RLS (§6.9): considera a empresa
-- inteira sem vazar dados que o chamador não pode acessar. Não presume
-- unicidade (várias linhas possíveis). Restritos = no máximo UMA linha
-- 'restricted' sem dados e sem quantidade. Ordenação determinística:
-- não-arquivados primeiro, created_at desc, id.

create function public.check_lead_phone_duplicate(p_phone text)
returns table (
  status        public.lead_duplicate_status,
  lead_id       uuid,
  lead_name     text,
  lead_archived boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_digits text;
  v_has_restricted boolean;
  v_found_accessible boolean := false;
begin
  select p.id, p.company_id, p.role, p.seller_id
    into v_profile
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile.id is null or v_profile.company_id is null then
    raise exception 'forbidden';
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits = '' then
    raise exception 'invalid_phone';
  end if;

  if v_profile.role in ('manager', 'admin') then
    return query
      select 'accessible'::public.lead_duplicate_status,
             l.id, l.name, (l.archived_at is not null)
        from public.leads l
        where l.company_id = v_profile.company_id
          and l.phone_digits = v_digits
        order by (l.archived_at is not null), l.created_at desc, l.id;
    if not found then
      return query
        select 'none'::public.lead_duplicate_status,
               null::uuid, null::text, null::boolean;
    end if;
    return;
  end if;

  -- Seller: dados somente de leads próprios e ativos.
  return query
    select 'accessible'::public.lead_duplicate_status,
           l.id, l.name, false
      from public.leads l
      where l.company_id = v_profile.company_id
        and l.phone_digits = v_digits
        and l.seller_id = v_profile.seller_id
        and l.archived_at is null
      order by l.created_at desc, l.id;
  v_found_accessible := found;

  select exists (
    select 1 from public.leads l
      where l.company_id = v_profile.company_id
        and l.phone_digits = v_digits
        and (l.seller_id is distinct from v_profile.seller_id
             or l.archived_at is not null)
  ) into v_has_restricted;

  if v_has_restricted then
    return query
      select 'restricted'::public.lead_duplicate_status,
             null::uuid, null::text, null::boolean;
  elsif not v_found_accessible then
    return query
      select 'none'::public.lead_duplicate_status,
             null::uuid, null::text, null::boolean;
  end if;
  return;
end;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────

revoke all on function public.create_lead(text, text, text, text, public.lead_temperature, text, text) from public;
revoke all on function public.create_lead(text, text, text, text, public.lead_temperature, text, text) from anon;
revoke all on function public.create_lead(text, text, text, text, public.lead_temperature, text, text) from authenticated;
grant execute on function public.create_lead(text, text, text, text, public.lead_temperature, text, text) to authenticated;

revoke all on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text) from public;
revoke all on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text) from anon;
revoke all on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text) from authenticated;
grant execute on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text) to authenticated;

revoke all on function public.move_lead_to_stage(uuid, uuid, integer) from public;
revoke all on function public.move_lead_to_stage(uuid, uuid, integer) from anon;
revoke all on function public.move_lead_to_stage(uuid, uuid, integer) from authenticated;
grant execute on function public.move_lead_to_stage(uuid, uuid, integer) to authenticated;

revoke all on function public.apply_lead_event(uuid, public.lead_event_type) from public;
revoke all on function public.apply_lead_event(uuid, public.lead_event_type) from anon;
revoke all on function public.apply_lead_event(uuid, public.lead_event_type) from authenticated;
grant execute on function public.apply_lead_event(uuid, public.lead_event_type) to authenticated;

revoke all on function public.assign_lead_seller(uuid, text, integer) from public;
revoke all on function public.assign_lead_seller(uuid, text, integer) from anon;
revoke all on function public.assign_lead_seller(uuid, text, integer) from authenticated;
grant execute on function public.assign_lead_seller(uuid, text, integer) to authenticated;

revoke all on function public.archive_lead(uuid, integer) from public;
revoke all on function public.archive_lead(uuid, integer) from anon;
revoke all on function public.archive_lead(uuid, integer) from authenticated;
grant execute on function public.archive_lead(uuid, integer) to authenticated;

revoke all on function public.unarchive_lead(uuid, integer) from public;
revoke all on function public.unarchive_lead(uuid, integer) from anon;
revoke all on function public.unarchive_lead(uuid, integer) from authenticated;
grant execute on function public.unarchive_lead(uuid, integer) to authenticated;

revoke all on function public.add_lead_timeline_entry(uuid, text, text, text, text) from public;
revoke all on function public.add_lead_timeline_entry(uuid, text, text, text, text) from anon;
revoke all on function public.add_lead_timeline_entry(uuid, text, text, text, text) from authenticated;
grant execute on function public.add_lead_timeline_entry(uuid, text, text, text, text) to authenticated;

revoke all on function public.check_lead_phone_duplicate(text) from public;
revoke all on function public.check_lead_phone_duplicate(text) from anon;
revoke all on function public.check_lead_phone_duplicate(text) from authenticated;
grant execute on function public.check_lead_phone_duplicate(text) to authenticated;

commit;
