-- M1-F S8-C2-C1 — create_lead/update_lead/check_lead_phone_duplicate com
-- contexto comercial explícito
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §34 (decisões
-- humanas aprovadas). Depende de 20260729100000 (resolve_lead_mutation_
-- context).
--
-- As três funções mudam de IDENTIDADE (ganham um parâmetro uuid no final),
-- o que o Postgres trata como uma assinatura NOVA — CREATE OR REPLACE não
-- reaproveitaria a função antiga, criaria um overload ambíguo para o
-- PostgREST. Por isso: DROP FUNCTION da assinatura antiga + CREATE da nova,
-- na MESMA transação (nunca existe janela em que as duas coexistem no
-- resultado final da migration).
--
-- Nenhuma das três lê mais profiles.company_id/profiles.role/
-- profiles.seller_id diretamente — toda autorização passa por
-- resolve_lead_mutation_context(), que já deriva tudo de auth.uid() via
-- current_membership_company_id()/current_membership_role()/
-- current_profile_seller_id_for_company()/is_platform_super_admin().
--
-- move_lead_to_stage/apply_lead_event/assign_lead_seller/archive_lead/
-- unarchive_lead/add_lead_timeline_entry NÃO são tocadas nesta migration —
-- continuam lendo profiles diretamente, exatamente como publicado no M1-E.
-- pipeline_stages (S8-C1-B) e profiles/sellers (S8-C1-A) permanecem
-- intocados.

begin;

-- ── 1. create_lead ───────────────────────────────────────────────────────

drop function public.create_lead(text, text, text, text, public.lead_temperature, text, text);

-- p_company_id no final, DEFAULT NULL: ignorado para Manager/Seller
-- (autoridade real é sempre a membership ativa, nunca o valor enviado pelo
-- cliente); obrigatório na prática para Super Admin (resolve_lead_mutation_
-- context recusa com company_required se vier null). Todos os parâmetros
-- anteriores preservados na mesma ordem/defaults — nenhuma mudança de
-- contrato para os 6 primeiros.
--
-- DECISÃO HUMANA (divergência encontrada em teste, S8-C2-C1): leads_
-- created_by_fk/leads_updated_by_fk (m1e_01) exigem que created_by_
-- profile_id/updated_by_profile_id pertençam à MESMA company_id do lead —
-- Super Admin nunca tem profiles.company_id (sempre null, por desenho:
-- é um ator global da KAPA, nunca de uma empresa), então nenhuma dessas
-- FKs pode ser satisfeita por ele em nenhuma empresa. Resolvido SEM tocar
-- a FK/schema de leads: quando o ator é Super Admin, created_by_profile_id/
-- updated_by_profile_id ficam NULL (a FK aceita NULL) — NUNCA auth.uid()/
-- v_ctx.actor_profile_id nesses dois campos para esse ator. A autoria real
-- continua integralmente preservada, só que em audit_log.actor_profile_id
-- (que não tem essa restrição de mesma empresa) — nunca uma perda de
-- rastreabilidade, apenas a coluna certa para um ator que estrutural e
-- corretamente não pertence a nenhuma empresa. Manager/Seller continuam
-- exatamente como antes (created_by/updated_by sempre o profile real).
create function public.create_lead(
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
    -- Seller sempre autoatribuído; escolher outro seller é proibido.
    if p_seller_id is not null and p_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_ctx.actor_seller_id;
  else
    -- Manager/Super Admin: seller-alvo (se informado) precisa pertencer à
    -- EMPRESA RESOLVIDA (nunca a qualquer outra) e estar ativo.
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

  -- created_by/updated_by_profile_id: NULL para Super Admin (decisão
  -- humana registrada acima — leads_created_by_fk/leads_updated_by_fk
  -- exigem profiles.company_id = leads.company_id, e Super Admin nunca
  -- tem company_id). Manager/Seller preservam o profile real, sem nenhuma
  -- mudança de comportamento.
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

  -- Auditoria: somente mutation de Super Admin (leitura nunca audita;
  -- Manager/Seller usam o próprio caminho operacional de sempre, sem
  -- registro de plataforma). before_data null (nada existia antes);
  -- after_data restrito a identificadores/estado, nunca nome/telefone/
  -- carro (PII/dados comerciais não necessários para a trilha de
  -- auditoria — §34.4).
  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_created', 'lead', v_row.id::text, 'success', null,
       null,
       jsonb_build_object('lead_id', v_row.id, 'stage_id', v_row.stage_id, 'seller_id', v_row.seller_id, 'archived', false),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ── 2. update_lead ───────────────────────────────────────────────────────

drop function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text);

create function public.update_lead(
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

  -- updated_by_profile_id: NULL para Super Admin (mesma decisão de
  -- create_lead — leads_updated_by_fk exige profiles.company_id =
  -- leads.company_id, nunca satisfeito por um ator sem empresa).
  -- created_by_profile_id do lead NUNCA é tocado aqui — a autoria original
  -- da criação é preservada intacta, seja ela de Manager/Seller ou (já)
  -- null de uma criação anterior por Super Admin.
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

  -- Auditoria: somente mutation de Super Admin. name/phone NUNCA levam o
  -- valor (mesmo mudando) — só a flag de mudança; car/temperature/
  -- payment_preference/source (não sensíveis) levam antes/depois reais.
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

  return v_row;
end;
$$;

-- ── 3. check_lead_phone_duplicate (leitura controlada) ───────────────────
-- Chama o resolver com p_read_only=true: Super Admin pode checar
-- duplicidade em QUALQUER status (inclusive suspensa/cancelada — leitura
-- histórica, nunca mutation); Manager/Seller continuam restritos a
-- 'ativa' (o parâmetro não afeta a branch deles). Nunca escreve em
-- audit_log — leitura não é ação auditável (mesma decisão das 4 RPCs de
-- leitura do S8-C2-B1, §31.12).

drop function public.check_lead_phone_duplicate(text);

create function public.check_lead_phone_duplicate(
  p_phone      text,
  p_company_id uuid default null
)
returns table (
  status        public.lead_duplicate_status,
  lead_id       uuid,
  lead_name     text,
  lead_archived boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx              record;
  v_digits           text;
  v_has_restricted   boolean;
  v_found_accessible boolean := false;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id, true);

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits = '' then
    raise exception 'invalid_phone';
  end if;

  if v_ctx.actor_kind in ('manager', 'super_admin') then
    return query
      select 'accessible'::public.lead_duplicate_status,
             l.id, l.name, (l.archived_at is not null)
        from public.leads l
        where l.company_id = v_ctx.resolved_company_id
          and l.phone_digits = v_digits
        order by (l.archived_at is not null), l.created_at desc, l.id;
    if not found then
      return query
        select 'none'::public.lead_duplicate_status,
               null::uuid, null::text, null::boolean;
    end if;
    return;
  end if;

  -- Seller: dados somente de leads próprios e ativos, da empresa resolvida
  -- (sempre a da própria membership).
  return query
    select 'accessible'::public.lead_duplicate_status,
           l.id, l.name, false
      from public.leads l
      where l.company_id = v_ctx.resolved_company_id
        and l.phone_digits = v_digits
        and l.seller_id = v_ctx.actor_seller_id
        and l.archived_at is null
      order by l.created_at desc, l.id;
  v_found_accessible := found;

  select exists (
    select 1 from public.leads l
      where l.company_id = v_ctx.resolved_company_id
        and l.phone_digits = v_digits
        and (l.seller_id is distinct from v_ctx.actor_seller_id
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

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ─────

revoke all on function public.create_lead(text, text, text, text, public.lead_temperature, text, text, uuid) from public;
revoke all on function public.create_lead(text, text, text, text, public.lead_temperature, text, text, uuid) from anon;
revoke all on function public.create_lead(text, text, text, text, public.lead_temperature, text, text, uuid) from authenticated;
grant execute on function public.create_lead(text, text, text, text, public.lead_temperature, text, text, uuid) to authenticated;

revoke all on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text, uuid) from public;
revoke all on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text, uuid) from anon;
revoke all on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text, uuid) from authenticated;
grant execute on function public.update_lead(uuid, integer, text, text, text, public.lead_temperature, text, text, uuid) to authenticated;

revoke all on function public.check_lead_phone_duplicate(text, uuid) from public;
revoke all on function public.check_lead_phone_duplicate(text, uuid) from anon;
revoke all on function public.check_lead_phone_duplicate(text, uuid) from authenticated;
grant execute on function public.check_lead_phone_duplicate(text, uuid) to authenticated;

commit;
