-- LGPD — eliminação dos dados pessoais de um titular no KAPA CRM (LOCAL; não aplicada em nenhum ambiente).
--
-- Antes desta migration o CRM não tinha como atender um pedido de eliminação: leads nunca são apagados
-- (tarefas, visitas, negociações e vendas os referenciam com ON DELETE RESTRICT) e o nome/telefone
-- ficavam também em respostas de formulário, linha do tempo, tarefas, visitas e negociações.
--
-- Modelo: ANONIMIZAÇÃO no lugar (não DELETE do lead), para preservar a integridade e os números
-- comerciais que não identificam ninguém (vendas, valores, contagens, ranking):
--   leads                     nome → "Titular removido (LGPD)", telefone → "0", arquivado
--   lead_form_submissions     apagadas (nome, telefone, e-mail e respostas)
--   lead_timeline_entries     apagadas (o texto livre pode conter dados pessoais); 1 registro técnico
--   tasks / visits / deals    textos livres e nome do cliente substituídos
--   kapa_leads_inbound_events payload apagado; a linha fica SEM dados pessoais como marca técnica, para
--                             o mesmo lead do KAPA Leads nunca ser importado de novo
--   sales, meta_leadgen_events, audit_log: sem dados pessoais do titular (nada a fazer)
--
-- Uso: SOMENTE pelo operador do banco (SQL Editor / service_role), nunca pela aplicação, com a
-- referência do pedido (protocolo, sem dados pessoais). Primeiro a simulação (p_confirm = false),
-- depois a execução (p_confirm = true). Runbook: docs/LGPD-ELIMINACAO.md.
--
-- Ordem com o KAPA Leads: excluir lá PRIMEIRO (delete_lead + liberação do CPF) e só depois aqui,
-- 5 minutos mais tarde (a sincronização tem até ~3 min de atraso).

-- ═══ 1. nova resolução na fila do KAPA Leads ════════════════════════════

alter table public.kapa_leads_inbound_events drop constraint kapa_leads_inbound_events_resolution_ck;
alter table public.kapa_leads_inbound_events
  add constraint kapa_leads_inbound_events_resolution_ck check (
    resolution is null or resolution in ('handled_manually', 'duplicate', 'test_event', 'not_recoverable', 'lgpd_erased')
  );

-- ═══ 2. normalização das chaves do pedido ═══════════════════════════════

create or replace function public._lgpd_normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null then null
    when regexp_replace(p_phone, '\D', '', 'g') ~ '^55[1-9][0-9]{9,10}$' then substr(regexp_replace(p_phone, '\D', '', 'g'), 3)
    when regexp_replace(p_phone, '\D', '', 'g') ~ '^[1-9][0-9]{9,10}$' then regexp_replace(p_phone, '\D', '', 'g')
    else null
  end
$$;

-- Leads do titular (todas as empresas): telefone do lead OU telefone/e-mail de uma resposta de formulário.
create or replace function public._lgpd_subject_leads(p_phone text, p_email text)
returns table (company_id uuid, lead_id uuid)
language sql
stable
set search_path = ''
as $$
  select l.company_id, l.id
    from public.leads l
   where p_phone is not null and l.phone_digits in (p_phone, '55' || p_phone)
  union
  select s.company_id, s.lead_id
    from public.lead_form_submissions s
   where (p_phone is not null and s.contact_phone = p_phone)
      or (p_email is not null and lower(s.contact_email) = p_email)
$$;

-- Eventos da fila ainda com dados pessoais do titular (pendentes/falhos ou de um lead do titular).
create or replace function public._lgpd_subject_queue_events(p_phone text, p_email text)
returns table (event_id uuid)
language sql
stable
set search_path = ''
as $$
  select e.id
    from public.kapa_leads_inbound_events e
   where e.payload <> '{}'::jsonb
     and ((p_phone is not null and e.payload #>> '{contact,phone}' = p_phone)
       or (p_email is not null and lower(e.payload #>> '{contact,email}') = p_email))
  union
  select e.id
    from public.kapa_leads_inbound_events e
    join public._lgpd_subject_leads(p_phone, p_email) sl on sl.lead_id = e.crm_lead_id
   where e.payload <> '{}'::jsonb
$$;

-- ═══ 3. localizar (somente leitura; sem nome, telefone ou e-mail na saída) ═

create or replace function public.lgpd_subject_lookup(p_phone text default null, p_email text default null)
returns table (
  company_id uuid,
  company_name text,
  lead_id uuid,
  lead_created_at timestamptz,
  archived boolean,
  already_erased boolean,
  form_submissions integer,
  sales integer,
  queue_events_with_data integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := public._lgpd_normalize_phone(p_phone);
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if v_phone is null and v_email is null then
    raise invalid_parameter_value using message = 'phone_or_email_required';
  end if;
  return query
    select l.company_id, c.name::text, l.id, l.created_at, l.archived_at is not null,
           l.name = 'Titular removido (LGPD)',
           (select count(*)::int from public.lead_form_submissions s where s.lead_id = l.id),
           (select count(*)::int from public.sales sa where sa.lead_id = l.id),
           (select count(*)::int from public.kapa_leads_inbound_events e where e.crm_lead_id = l.id and e.payload <> '{}'::jsonb)
      from (select distinct sl.company_id, sl.lead_id from public._lgpd_subject_leads(v_phone, v_email) sl) x
      join public.leads l on l.id = x.lead_id and l.company_id = x.company_id
      join public.companies c on c.id = l.company_id
    union all
    -- Eventos ainda não transformados em lead (pendentes ou com falha).
    select e.company_id, c.name::text, null::uuid, e.received_at, false, false, 0, 0, 1
      from public.kapa_leads_inbound_events e
      join public.companies c on c.id = e.company_id
     where e.crm_lead_id is null
       and e.id in (select q.event_id from public._lgpd_subject_queue_events(v_phone, v_email) q)
    order by 4;
end;
$$;

-- ═══ 4. eliminar ═════════════════════════════════════════════════════════
-- p_confirm = false (padrão): só conta o que seria alterado (nada é gravado).
-- p_confirm = true: anonimiza tudo numa transação e registra na auditoria (sem dados pessoais).

create or replace function public.lgpd_erase_subject(
  p_phone text,
  p_email text,
  p_request_ref text,
  p_confirm boolean default false
)
returns table (step text, affected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := public._lgpd_normalize_phone(p_phone);
  v_email text := nullif(lower(btrim(p_email)), '');
  v_leads uuid[];
  v_events uuid[];
  v_rows integer;
  v_counts jsonb := '{}'::jsonb;
  v_company uuid;
begin
  if nullif(btrim(p_phone), '') is not null and v_phone is null then
    raise invalid_parameter_value using message = 'invalid_phone';
  end if;
  if v_phone is null and v_email is null then
    raise invalid_parameter_value using message = 'phone_or_email_required';
  end if;
  -- Protocolo do pedido: só letras, números e . _ / - (nunca CPF, nome ou e-mail).
  if p_request_ref is null or p_request_ref !~ '^[A-Za-z0-9._/-]{3,64}$' or p_request_ref ~ '^[0-9]{11}$' then
    raise invalid_parameter_value using message = 'invalid_request_ref';
  end if;
  if p_confirm is null then
    raise invalid_parameter_value using message = 'invalid_input';
  end if;

  select coalesce(array_agg(distinct sl.lead_id), '{}') into v_leads from public._lgpd_subject_leads(v_phone, v_email) sl;
  select coalesce(array_agg(distinct q.event_id), '{}') into v_events from public._lgpd_subject_queue_events(v_phone, v_email) q;

  if not p_confirm then
    return query
      select 'leads'::text, cardinality(v_leads)
      union all select 'lead_form_submissions', (select count(*)::int from public.lead_form_submissions s where s.lead_id = any (v_leads))
      union all select 'lead_timeline_entries', (select count(*)::int from public.lead_timeline_entries t where t.lead_id = any (v_leads))
      union all select 'tasks', (select count(*)::int from public.tasks t where t.lead_id = any (v_leads))
      union all select 'visits', (select count(*)::int from public.visits v where v.lead_id = any (v_leads))
      union all select 'deals', (select count(*)::int from public.deals d where d.lead_id = any (v_leads))
      union all select 'kapa_leads_inbound_events', cardinality(v_events)
      union all select 'dry_run', 1;
    return;
  end if;

  -- 1º a mesma trava por telefone do Meta Lead Ads e do KAPA Leads (nenhuma origem cria ou associa
  -- um lead deste telefone no meio da eliminação); 2º as linhas dos leads. Mesma ordem dos
  -- processadores (trava consultiva antes de tocar no lead), então não há deadlock.
  perform pg_advisory_xact_lock(hashtextextended('meta_lead_phone:' || k.company_id::text || ':' || k.phone, 0))
     from (
       select distinct l.company_id, public._lgpd_normalize_phone(l.phone_digits) as phone
         from public.leads l where l.id = any (v_leads)
       union
       select distinct e.company_id, v_phone from public.kapa_leads_inbound_events e
        where e.id = any (v_events) and v_phone is not null
     ) k
    where k.phone is not null
    order by k.company_id, k.phone;
  perform 1 from public.leads l where l.id = any (v_leads) order by l.id for update;

  delete from public.lead_form_submissions s where s.lead_id = any (v_leads);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('lead_form_submissions', v_rows);
  step := 'lead_form_submissions'; affected := v_rows; return next;

  delete from public.lead_timeline_entries t where t.lead_id = any (v_leads);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('lead_timeline_entries', v_rows);
  step := 'lead_timeline_entries'; affected := v_rows; return next;

  update public.tasks t
     set title = 'Tarefa (dados removidos — LGPD)', note = ''
   where t.lead_id = any (v_leads);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('tasks', v_rows);
  step := 'tasks'; affected := v_rows; return next;

  update public.visits v
     set client_name = null, note = '', result_note = case when v.result_note is null then null else 'Removido (LGPD)' end
   where v.lead_id = any (v_leads);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('visits', v_rows);
  step := 'visits'; affected := v_rows; return next;

  update public.deals d
     set client_name_snapshot = 'Titular removido (LGPD)', note = ''
   where d.lead_id = any (v_leads);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('deals', v_rows);
  step := 'deals'; affected := v_rows; return next;

  update public.kapa_leads_inbound_events e
     set payload = '{}'::jsonb,
         status = case when e.status in ('pending', 'failed') then 'dismissed' else e.status end,
         resolution = case when e.status in ('pending', 'failed') then 'lgpd_erased' else e.resolution end,
         resolved_at = case when e.status in ('pending', 'failed') then now() else e.resolved_at end,
         last_error_code = case when e.status in ('pending', 'failed') then null else e.last_error_code end
   where e.id = any (v_events);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('kapa_leads_inbound_events', v_rows);
  step := 'kapa_leads_inbound_events'; affected := v_rows; return next;

  update public.leads l
     set name = 'Titular removido (LGPD)',
         phone = '0',
         last_activity_label = 'Dados removidos (LGPD)',
         alert_label = null,
         archived_at = coalesce(l.archived_at, now())
   where l.id = any (v_leads);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_rows);
  step := 'leads'; affected := v_rows; return next;

  -- Um registro técnico (sem dados pessoais) na linha do tempo de cada lead.
  insert into public.lead_timeline_entries (company_id, lead_id, actor_profile_id, icon, color, label, detail)
  select l.company_id, l.id, null, 'message', '#9CA3AF', 'Dados pessoais removidos (LGPD)', null
    from public.leads l where l.id = any (v_leads);

  -- Auditoria por empresa afetada (sem dados pessoais: só o protocolo e as contagens).
  for v_company in select distinct l.company_id from public.leads l where l.id = any (v_leads)
    union select distinct e.company_id from public.kapa_leads_inbound_events e where e.id = any (v_events)
  loop
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (null, v_company, 'lgpd_subject_erased', 'lgpd_request', p_request_ref, 'success', null, null,
       v_counts || jsonb_build_object('leads_in_company',
         (select count(*) from public.leads l where l.id = any (v_leads) and l.company_id = v_company)),
       'sql_operator');
  end loop;

  return;
end;
$$;

revoke all on function public._lgpd_normalize_phone(text) from public, anon, authenticated, service_role;
revoke all on function public._lgpd_subject_leads(text, text) from public, anon, authenticated, service_role;
revoke all on function public._lgpd_subject_queue_events(text, text) from public, anon, authenticated, service_role;
revoke all on function public.lgpd_subject_lookup(text, text) from public, anon, authenticated;
revoke all on function public.lgpd_erase_subject(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.lgpd_subject_lookup(text, text) to service_role;
grant execute on function public.lgpd_erase_subject(text, text, text, boolean) to service_role;
