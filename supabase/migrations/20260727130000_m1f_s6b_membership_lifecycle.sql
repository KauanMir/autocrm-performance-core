-- M1-F S6-B — lifecycle da membership empresarial (suspensão/reativação).
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §24 (decisões
-- congeladas em S6-D0/S6-D1) — nenhuma decisão é reinterpretada aqui.
--
-- Schema: novo enum membership_lifecycle_status ('active','suspended',
-- 'offboarded') + coluna company_memberships.lifecycle_status. is_active
-- (boolean, já existente desde S1) permanece a ÚNICA coluna que os helpers/
-- RLS/índice único de S1-S5 consomem (can_access_company,
-- current_membership_company_id, current_membership_role,
-- company_memberships_profile_single_active_uidx) — nenhum deles é tocado
-- nesta migration. lifecycle_status é aditiva; a consistência entre as
-- duas é garantida por CHECK, nunca por disciplina de aplicação (§24.2).
--
-- Backfill: registros existentes com is_active=true viram 'active';
-- is_active=false viram 'suspended' — nunca 'offboarded' (estado que não
-- existia antes desta migration, não pode ser inferido retroativamente).
--
-- RPCs: suspend_membership/reactivate_membership, assinatura e contratos
-- fixados em §24.13. offboard_seller/offboard_manager/transfer_membership
-- e a leitura administrativa de inativos são S6-C/S6-D/S6-E — não
-- implementados aqui.
begin;

-- ── enum ──────────────────────────────────────────────────────────────────
create type public.membership_lifecycle_status as enum ('active', 'suspended', 'offboarded');

comment on type public.membership_lifecycle_status is
  'Estado do vínculo empresarial (§24.2 do design doc): active = vínculo operacional normal; suspended = temporário e reversível (active<->suspended); offboarded = encerramento definitivo por esta via, nunca revertido por reactivate_membership.';

-- ── coluna ────────────────────────────────────────────────────────────────
alter table public.company_memberships
  add column lifecycle_status public.membership_lifecycle_status not null default 'active';

comment on column public.company_memberships.lifecycle_status is
  'Fonte de verdade do motivo por trás de is_active=false (suspenso vs. desligado). is_active continua sendo a coluna consumida por RLS/helpers/índice até o S8 — mantida em lockstep por company_memberships_lifecycle_is_active_ck.';

-- ── backfill ──────────────────────────────────────────────────────────────
update public.company_memberships
   set lifecycle_status = 'suspended'
 where not is_active;

-- ── constraint de compatibilidade (§24.2) ────────────────────────────────
-- (lifecycle_status = 'active') = is_active: active+true e
-- suspended|offboarded+false são as únicas combinações válidas. Toda RPC
-- que grava lifecycle_status grava is_active na MESMA instrução — o CHECK
-- rejeita qualquer divergência, mesmo por erro de programação futuro.
alter table public.company_memberships
  add constraint company_memberships_lifecycle_is_active_ck
  check ((lifecycle_status = 'active') = is_active);

-- ── suspend_membership ───────────────────────────────────────────────────
-- Suspende uma membership Manager/Seller (active -> suspended), sincroniza
-- sellers.is_active na mesma transação quando a membership é de um Seller
-- vinculado, e protege o último Manager ativo da empresa. Ator: Super Admin
-- (qualquer empresa, exceto a própria membership e outro Super Admin) ou
-- Manager (só Seller da própria empresa) — nunca Seller (§24.3).
create function public.suspend_membership(
  p_membership_id uuid,
  p_note text
) returns table (
  membership_id    uuid,
  profile_id        uuid,
  company_id        uuid,
  company_role      public.company_role,
  lifecycle_status  public.membership_lifecycle_status,
  is_active         boolean,
  seller_id         text,
  seller_active     boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id_peek     uuid;
  v_company             public.companies;
  v_membership          public.company_memberships;
  v_target_profile      public.profiles;
  v_seller               public.sellers;
  v_actor_is_super_admin boolean;
  v_note                 text;
  v_other_manager_count  int;
  v_before                jsonb;
  v_after                  jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_membership_id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  -- ordem fixa de locks (§24 S6-B/§13): empresa -> membership -> profile ->
  -- seller. company_id é resolvido por leitura simples (reserve-then-
  -- revalidate, mesmo padrão das RPCs de lead do M1-E) — nunca recebido do
  -- cliente como parâmetro/autorização.
  select cm.company_id into v_company_id_peek
    from public.company_memberships cm
   where cm.id = p_membership_id;

  if v_company_id_peek is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select c.* into v_company from public.companies c where c.id = v_company_id_peek for update;
  if v_company.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_company.status not in ('implantacao', 'ativa') then
    raise using message = 'company_not_operational';
  end if;

  select cm.* into v_membership
    from public.company_memberships cm
   where cm.id = p_membership_id and cm.company_id = v_company.id
   for update;
  if v_membership.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select p.* into v_target_profile from public.profiles p where p.id = v_membership.profile_id for update;
  if v_target_profile.id is null or not v_target_profile.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  -- autorização: Super Admin (qualquer empresa) ou Manager (só a própria
  -- empresa, via is_manager_or_platform, S2) — nunca Seller. Company status
  -- já validado acima, então esta checagem não confunde "sem acesso" com
  -- "empresa não operacional".
  v_actor_is_super_admin := public.is_platform_super_admin();

  if not public.is_manager_or_platform(v_company.id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_target_profile.id = auth.uid() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if coalesce(v_target_profile.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if not v_actor_is_super_admin and v_membership.role = 'manager'::public.company_role then
    -- Manager nunca age sobre Manager (§24.3) — só Super Admin chega aqui.
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- motivo obrigatório (§24 S6-B/§6): trim, 3..500, sem caracteres de
  -- controle. Nunca autorização, nunca persistido em company_memberships —
  -- só no audit_log.
  v_note := btrim(p_note);
  if v_note is null or v_note = '' or length(v_note) < 3 or length(v_note) > 500 or v_note ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_note';
  end if;

  -- resolve o Seller vinculado a ESTA membership (nunca por
  -- company_id/profile_id — a ligação correta e única é membership_id,
  -- garantida por sellers_membership_id_uidx desde S2). Executado sempre
  -- que role='seller', mesmo em caminho idempotente, porque é uma checagem
  -- de invariante estrutural, não uma ação condicional à transição.
  if v_membership.role = 'seller'::public.company_role then
    select s.* into v_seller from public.sellers s where s.membership_id = v_membership.id for update;
    if v_seller.id is null
       or v_seller.company_id <> v_membership.company_id
       or v_seller.profile_id <> v_membership.profile_id then
      raise using message = 'seller_state_conflict';
    end if;
  end if;

  -- idempotência/conflito de estado (§24 S6-B/§7): active é a única origem
  -- válida para esta RPC.
  if v_membership.lifecycle_status = 'suspended'::public.membership_lifecycle_status then
    return query select
      v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
      v_membership.lifecycle_status, v_membership.is_active,
      v_seller.id, v_seller.is_active;
    return;
  end if;

  if v_membership.lifecycle_status = 'offboarded'::public.membership_lifecycle_status then
    raise using message = 'membership_lifecycle_conflict';
  end if;

  -- guarda do último Manager (§24 S6-B/§9) — só avaliada quando a
  -- transição é real (active -> suspended) e o alvo é Manager. Sucessor
  -- nunca é promovido automaticamente; a própria linha-alvo é excluída da
  -- contagem.
  if v_membership.role = 'manager'::public.company_role then
    select count(*)::int into v_other_manager_count
      from public.company_memberships cm
      join public.profiles p on p.id = cm.profile_id
     where cm.company_id = v_company.id
       and cm.role = 'manager'::public.company_role
       and cm.is_active
       and cm.lifecycle_status = 'active'::public.membership_lifecycle_status
       and p.is_active
       and cm.id <> v_membership.id;

    if v_other_manager_count = 0 then
      raise using message = 'last_manager_requires_successor';
    end if;
  end if;

  v_before := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active
  );

  update public.company_memberships
     set lifecycle_status = 'suspended', is_active = false
   where id = v_membership.id
  returning * into v_membership;

  if v_seller.id is not null then
    update public.sellers set is_active = false where id = v_seller.id
    returning * into v_seller;
  end if;

  v_after := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active
  ) || jsonb_build_object('note', v_note);

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'membership_suspended', 'membership', v_membership.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select
    v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
    v_membership.lifecycle_status, v_membership.is_active,
    v_seller.id, v_seller.is_active;
end;
$$;

revoke all on function public.suspend_membership(uuid, text) from public;
revoke all on function public.suspend_membership(uuid, text) from anon;
grant execute on function public.suspend_membership(uuid, text) to authenticated;

-- ── reactivate_membership ────────────────────────────────────────────────
-- Reverte uma suspensão (suspended -> active), sincroniza sellers.is_active
-- de volta quando aplicável. offboarded nunca é reativado por este
-- contrato (§24.5) — falha com membership_lifecycle_conflict. Mesma
-- autorização de suspend_membership; nenhuma guarda de último Manager
-- (reativar nunca remove um Manager).
create function public.reactivate_membership(
  p_membership_id uuid,
  p_note text default null
) returns table (
  membership_id    uuid,
  profile_id        uuid,
  company_id        uuid,
  company_role      public.company_role,
  lifecycle_status  public.membership_lifecycle_status,
  is_active         boolean,
  seller_id         text,
  seller_active     boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id_peek     uuid;
  v_company             public.companies;
  v_membership          public.company_memberships;
  v_target_profile      public.profiles;
  v_seller               public.sellers;
  v_actor_is_super_admin boolean;
  v_note                 text;
  v_before                jsonb;
  v_after                  jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_membership_id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select cm.company_id into v_company_id_peek
    from public.company_memberships cm
   where cm.id = p_membership_id;

  if v_company_id_peek is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select c.* into v_company from public.companies c where c.id = v_company_id_peek for update;
  if v_company.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_company.status not in ('implantacao', 'ativa') then
    raise using message = 'company_not_operational';
  end if;

  select cm.* into v_membership
    from public.company_memberships cm
   where cm.id = p_membership_id and cm.company_id = v_company.id
   for update;
  if v_membership.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select p.* into v_target_profile from public.profiles p where p.id = v_membership.profile_id for update;
  if v_target_profile.id is null or not v_target_profile.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  v_actor_is_super_admin := public.is_platform_super_admin();

  if not public.is_manager_or_platform(v_company.id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_target_profile.id = auth.uid() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if coalesce(v_target_profile.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if not v_actor_is_super_admin and v_membership.role = 'manager'::public.company_role then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- motivo opcional (§24 S6-B/§11): quando informado, mesma validação de
  -- suspend_membership; NULL é permitido e não é validado.
  if p_note is null then
    v_note := null;
  else
    v_note := btrim(p_note);
    if v_note = '' or length(v_note) < 3 or length(v_note) > 500 or v_note ~ '[[:cntrl:]]' then
      raise invalid_parameter_value using message = 'invalid_note';
    end if;
  end if;

  if v_membership.role = 'seller'::public.company_role then
    select s.* into v_seller from public.sellers s where s.membership_id = v_membership.id for update;
    if v_seller.id is null
       or v_seller.company_id <> v_membership.company_id
       or v_seller.profile_id <> v_membership.profile_id then
      raise using message = 'seller_state_conflict';
    end if;
  end if;

  if v_membership.lifecycle_status = 'active'::public.membership_lifecycle_status then
    return query select
      v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
      v_membership.lifecycle_status, v_membership.is_active,
      v_seller.id, v_seller.is_active;
    return;
  end if;

  if v_membership.lifecycle_status = 'offboarded'::public.membership_lifecycle_status then
    raise using message = 'membership_lifecycle_conflict';
  end if;

  v_before := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active
  );

  update public.company_memberships
     set lifecycle_status = 'active', is_active = true
   where id = v_membership.id
  returning * into v_membership;

  if v_seller.id is not null then
    update public.sellers set is_active = true where id = v_seller.id
    returning * into v_seller;
  end if;

  v_after := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active
  );
  if v_note is not null then
    v_after := v_after || jsonb_build_object('note', v_note);
  end if;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'membership_reactivated', 'membership', v_membership.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select
    v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
    v_membership.lifecycle_status, v_membership.is_active,
    v_seller.id, v_seller.is_active;
end;
$$;

revoke all on function public.reactivate_membership(uuid, text) from public;
revoke all on function public.reactivate_membership(uuid, text) from anon;
grant execute on function public.reactivate_membership(uuid, text) to authenticated;

commit;
