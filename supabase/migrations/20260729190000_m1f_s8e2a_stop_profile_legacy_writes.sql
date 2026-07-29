-- M1-F S8-E2 (parte 1/2) — para todo leitor/escritor ativo restante das
-- 3 colunas legadas de profiles antes da remoção física na próxima
-- migration (docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §46).
--
-- Auditoria no estado ATIVO do catálogo (busca em prosrc de toda função
-- public.*, nunca migrations históricas) encontrou exatamente 2 funções
-- que ainda tocavam profiles.company_id/role/seller_id:
--
--   1. accept_invite() — único ESCRITOR: inseria company_id/role no
--      INSERT inicial de profiles. seller_id nunca foi escrito por
--      nenhuma função (coluna morta desde sempre).
--   2. update_membership_role() — um LEITOR remanescente: gravava
--      'profile_role' (o valor real de profiles.role, nunca mais
--      sincronizado desde o S8-D2-B) em before_data/after_data do
--      audit_log, só para documentar honestamente que a coluna não
--      mudava. Achado bloqueante desta etapa, resolvido com decisão
--      humana explícita (§46.2): a chave é removida por completo, sem
--      substituto — o audit_log passa a registrar só efeitos reais.
--
-- Nenhuma outra RPC ativa lê ou escreve qualquer uma das 3 colunas.
begin;

-- ── 1. accept_invite — para de escrever profiles.company_id/role ───────
-- Assinatura, parâmetros, retorno, SECURITY DEFINER, search_path e todo
-- o restante do contrato (token, rate limit, validação de convite/
-- empresa/e-mail, criação de company_memberships/sellers, lifecycle,
-- audit_log, idempotência, erros, grants) permanecem idênticos — único
-- efeito removido: o profile criado deixa de carregar company_id/role.
create or replace function public.accept_invite(p_token_hash text)
returns table (
  success boolean,
  code text,
  invite_id uuid,
  company_id uuid,
  role_kind public.invite_role_kind,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id            uuid := auth.uid();
  v_audit_actor_id      uuid;
  v_auth_email          text;
  v_email_normalized    text;
  v_invite_lookup       public.invites;
  v_invite              public.invites;
  v_company             public.companies;
  v_profile             public.profiles;
  v_attempt_id          uuid := gen_random_uuid();
  v_actor_count         int;
  v_invite_count        int;
  v_oldest_actor        timestamptz;
  v_oldest_invite       timestamptz;
  v_existing_membership public.company_memberships;
  v_other_active        public.company_memberships;
  v_conflict_count      int;
  v_new_membership_id   uuid;
  v_new_seller_id       text;
  v_membership_created  boolean := false;
  v_seller_created      boolean := false;
  v_constraint          text;
  v_before              jsonb;
  v_after               jsonb;
begin
  if v_actor_id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  select id into v_audit_actor_id from public.profiles where id = v_actor_id;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, null, 'invite_accepted', 'invite', v_attempt_id::text, 'failure', 'invalid_token_hash', null, null, 'rpc');
    return query select false, 'invalid_token_hash'::text, null::uuid, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  select i.* into v_invite_lookup from public.invites i where i.token_hash = p_token_hash;

  if v_invite_lookup.id is null then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, null, 'invite_accepted', 'invite', v_attempt_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::uuid, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('invite_accept_actor:' || v_actor_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invite_accept_invite:' || v_invite_lookup.id::text, 0));

  select count(*), min(occurred_at)
    into v_actor_count, v_oldest_actor
    from public.invite_activation_rate_limit_events e
   where e.dimension = 'accept_actor'
     and e.key_hash = v_actor_id::text
     and e.occurred_at > now() - interval '15 minutes';

  if v_actor_count >= 10 then
    return query select
      false, 'rate_limited'::text, v_invite_lookup.id, null::uuid, null::public.invite_role_kind,
      greatest(1, ceil(extract(epoch from (v_oldest_actor + interval '15 minutes' - now()))))::integer;
    return;
  end if;

  select count(*), min(occurred_at)
    into v_invite_count, v_oldest_invite
    from public.invite_activation_rate_limit_events e
   where e.dimension = 'accept_invite'
     and e.key_hash = v_invite_lookup.id::text
     and e.occurred_at > now() - interval '15 minutes';

  if v_invite_count >= 5 then
    return query select
      false, 'rate_limited'::text, v_invite_lookup.id, null::uuid, null::public.invite_role_kind,
      greatest(1, ceil(extract(epoch from (v_oldest_invite + interval '15 minutes' - now()))))::integer;
    return;
  end if;

  insert into public.invite_activation_rate_limit_events (dimension, key_hash, actor_profile_id)
  values ('accept_actor', v_actor_id::text, v_actor_id);
  insert into public.invite_activation_rate_limit_events (dimension, key_hash, invite_id)
  values ('accept_invite', v_invite_lookup.id::text, v_invite_lookup.id);

  select i.* into v_invite from public.invites i where i.id = v_invite_lookup.id for update;

  if v_invite.status = 'accepted' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'invite_already_used', null, null, 'rpc');
    return query select false, 'invite_already_used'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  if v_invite.status in ('canceled', 'superseded') then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'invite_not_actionable',
       jsonb_build_object('status', v_invite.status), null, 'rpc');
    return query select false, 'invite_not_actionable'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  if v_invite.expires_at <= now() then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'invite_expired', null, null, 'rpc');
    return query select false, 'invite_expired'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  if v_invite.delivery_status <> 'sent' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'invite_not_actionable',
       jsonb_build_object('delivery_status', v_invite.delivery_status), null, 'rpc');
    return query select false, 'invite_not_actionable'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  if v_invite.company_id is not null then
    select c.* into v_company from public.companies c where c.id = v_invite.company_id;

    if v_company.id is null or v_company.status not in ('implantacao', 'ativa') then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'company_not_operational', null, null, 'rpc');
      return query select false, 'company_not_operational'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
      return;
    end if;
  end if;

  select u.email into v_auth_email from auth.users u where u.id = v_actor_id;
  v_email_normalized := lower(btrim(coalesce(v_auth_email, '')));

  if v_email_normalized = '' or v_email_normalized <> v_invite.email_normalized then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'email_mismatch', null, null, 'rpc');
    return query select false, 'email_mismatch'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  v_before := jsonb_build_object('status', v_invite.status, 'role_kind', v_invite.role_kind, 'delivery_status', v_invite.delivery_status);

  select p.* into v_profile from public.profiles p where p.id = v_actor_id;

  if v_profile.id is null then
    select count(*) into v_conflict_count
      from public.profiles p2
     where lower(btrim(p2.email)) = v_invite.email_normalized
       and p2.id <> v_actor_id;

    if v_conflict_count > 0 then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'identity_conflict', v_before, null, 'rpc');
      return query select false, 'identity_conflict'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
      return;
    end if;
  end if;

  if v_profile.id is not null
     and coalesce(v_profile.platform_role = 'super_admin', false)
     and v_invite.role_kind in ('manager', 'seller')
  then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'invalid_relationship', v_before, null, 'rpc');
    return query select false, 'invalid_relationship'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  begin
    -- M1-F S8-E2: profile criado só com dados globais reais — empresa e
    -- cargo empresarial passam a existir exclusivamente em
    -- company_memberships (abaixo), nunca mais em profiles.
    if v_profile.id is null then
      insert into public.profiles (id, name, email, is_active)
      values (v_actor_id, v_invite.name, v_auth_email, true);
    end if;

    if v_invite.role_kind = 'super_admin' then
      if coalesce((select p.platform_role from public.profiles p where p.id = v_actor_id) = 'super_admin', false) then
        raise exception using errcode = 'P0001', message = 'already_member';
      end if;

      if exists (
        select 1 from public.company_memberships cm
         where cm.profile_id = v_actor_id
           and cm.is_active
      ) then
        raise exception using errcode = 'P0002', message = 'membership_conflict';
      end if;

      update public.profiles set platform_role = 'super_admin' where id = v_actor_id;

    else
      select cm.* into v_existing_membership
        from public.company_memberships cm
       where cm.company_id = v_invite.company_id
         and cm.profile_id = v_actor_id;

      if v_existing_membership.id is not null then
        if v_existing_membership.is_active then
          raise exception using errcode = 'P0001', message = 'already_member';
        else
          raise exception using errcode = 'P0002', message = 'membership_conflict';
        end if;
      end if;

      select cm.* into v_other_active
        from public.company_memberships cm
       where cm.profile_id = v_actor_id
         and cm.is_active
         and cm.company_id <> v_invite.company_id;

      if v_other_active.id is not null then
        raise exception using errcode = 'P0002', message = 'membership_conflict';
      end if;

      if v_invite.role_kind = 'seller' and exists (
        select 1 from public.sellers s
         where s.profile_id = v_actor_id
           and s.company_id = v_invite.company_id
      ) then
        raise exception using errcode = 'P0003', message = 'provisioning_failed';
      end if;

      if v_invite.role_kind = 'seller' and exists (
        select 1 from public.sellers s
         where s.profile_id = v_actor_id
           and s.company_id <> v_invite.company_id
           and (
             s.membership_id is null
             or not exists (
               select 1 from public.company_memberships cm
                where cm.id = s.membership_id
                  and cm.profile_id = s.profile_id
                  and cm.company_id = s.company_id
                  and cm.role = 'seller'
                  and not cm.is_active
             )
           )
      ) then
        raise exception using errcode = 'P0003', message = 'provisioning_failed';
      end if;

      insert into public.company_memberships (company_id, profile_id, role, is_active, joined_at)
      values (v_invite.company_id, v_actor_id, v_invite.role_kind::text::public.company_role, true, now())
      returning id into v_new_membership_id;

      v_membership_created := true;

      if v_invite.role_kind = 'seller' then
        insert into public.sellers (id, company_id, membership_id, profile_id, name, first_name, is_active)
        values (
          gen_random_uuid()::text,
          v_invite.company_id,
          v_new_membership_id,
          v_actor_id,
          v_invite.name,
          split_part(v_invite.name, ' ', 1),
          true
        )
        returning id into v_new_seller_id;

        v_seller_created := true;
      end if;
    end if;
  exception
    when sqlstate 'P0001' then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'already_member', v_before, null, 'rpc');
      return query select false, 'already_member'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
      return;
    when sqlstate 'P0002' then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'membership_conflict', v_before, null, 'rpc');
      return query select false, 'membership_conflict'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
      return;
    when sqlstate 'P0003' then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'provisioning_failed', v_before, null, 'rpc');
      return query select false, 'provisioning_failed'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
      return;
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint in ('company_memberships_profile_single_active_uidx', 'company_memberships_company_id_profile_id_key') then
        insert into public.audit_log
          (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
        values
          (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'membership_conflict', v_before, null, 'rpc');
        return query select false, 'membership_conflict'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
        return;
      elsif v_constraint in ('sellers_membership_id_uidx', 'sellers_company_id_uidx') then
        insert into public.audit_log
          (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
        values
          (v_audit_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'failure', 'provisioning_failed', v_before, null, 'rpc');
        return query select false, 'provisioning_failed'::text, v_invite.id, null::uuid, null::public.invite_role_kind, null::integer;
        return;
      else
        raise;
      end if;
  end;

  update public.invites i
     set status = 'accepted',
         accepted_at = now(),
         accepted_profile_id = v_actor_id
   where i.id = v_invite.id
     and i.status = 'pending';

  if not found then
    raise exception 'accept_invite: invite % mudou de estado inesperadamente sob lock', v_invite.id;
  end if;

  v_after := jsonb_build_object(
    'status', 'accepted',
    'profile_id', v_actor_id,
    'company_id', v_invite.company_id,
    'role_kind', v_invite.role_kind,
    'membership_created', v_membership_created,
    'seller_created', v_seller_created
  );

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (v_actor_id, v_invite.company_id, 'invite_accepted', 'invite', v_invite.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select true, 'ok'::text, v_invite.id, v_invite.company_id, v_invite.role_kind, null::integer;
end;
$$;

revoke all on function public.accept_invite(text) from public;
revoke all on function public.accept_invite(text) from anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ── 2. update_membership_role — para de LER profiles.role para o
--      audit_log (achado bloqueante §46.2, decisão humana explícita:
--      remover a chave 'profile_role' por completo, sem substituto) ─────
create or replace function public.update_membership_role(
  p_membership_id uuid,
  p_company_id uuid,
  p_role public.company_role
) returns table (
  membership_id uuid,
  profile_id uuid,
  company_id uuid,
  company_role public.company_role
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor                   public.profiles;
  v_company                 public.companies;
  v_membership              public.company_memberships;
  v_target_profile          public.profiles;
  v_other_manager_count     int;
  v_seller_count            int;
  v_seller                  public.sellers;
  v_needs_membership_update boolean;
  v_needs_seller_update     boolean;
  v_before                  jsonb;
  v_after                   jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  select p.* into v_actor from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_actor.id is null or not coalesce(v_actor.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if p_membership_id is null or p_company_id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if p_role is null then
    raise invalid_parameter_value using message = 'invalid_role';
  end if;

  select c.* into v_company from public.companies c where c.id = p_company_id for update;
  if v_company.id is null or v_company.status = 'cancelada' then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select cm.* into v_membership
    from public.company_memberships cm
   where cm.id = p_membership_id
     and cm.company_id = p_company_id
   for update;
  if v_membership.id is null or not v_membership.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select p.* into v_target_profile from public.profiles p where p.id = v_membership.profile_id for update;
  if v_target_profile.id is null or not v_target_profile.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_target_profile.id = v_actor.id then
    raise using message = 'self_role_change_forbidden';
  end if;

  if coalesce(v_target_profile.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_membership.role = 'manager'::public.company_role and p_role = 'seller'::public.company_role then
    select count(*)::int into v_other_manager_count
      from public.company_memberships cm
      join public.profiles p on p.id = cm.profile_id
     where cm.company_id = p_company_id
       and cm.role = 'manager'::public.company_role
       and cm.is_active
       and p.is_active
       and cm.id <> v_membership.id;

    if v_other_manager_count = 0 then
      raise using message = 'last_manager_requires_successor';
    end if;
  end if;

  select count(*)::int into v_seller_count
    from public.sellers s
   where s.company_id = p_company_id and s.profile_id = v_target_profile.id;

  if v_seller_count > 1 then
    raise using message = 'seller_state_conflict';
  end if;

  if v_seller_count = 1 then
    select s.* into v_seller
      from public.sellers s
     where s.company_id = p_company_id and s.profile_id = v_target_profile.id
     for update;

    if v_seller.membership_id is not null and v_seller.membership_id <> v_membership.id then
      raise using message = 'seller_state_conflict';
    end if;
  end if;

  v_needs_membership_update := (v_membership.role is distinct from p_role);

  if p_role = 'manager'::public.company_role then
    v_needs_seller_update := v_seller_count = 1
      and (v_seller.membership_id is not null or v_seller.is_active);
  else
    v_needs_seller_update := v_seller_count = 0
      or v_seller.membership_id is distinct from v_membership.id
      or not v_seller.is_active;
  end if;

  if not v_needs_membership_update and not v_needs_seller_update then
    return query select v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role;
    return;
  end if;

  -- M1-F S8-E2: profile_role removida por completo — profiles.role não
  -- existe mais como conceito nesta RPC, nenhuma chave substituta.
  v_before := jsonb_build_object(
    'company_role', v_membership.role,
    'seller_id', case when v_seller_count = 1 then v_seller.id else null end,
    'seller_active', case when v_seller_count = 1 then v_seller.is_active else null end,
    'seller_linked', case when v_seller_count = 1 then (v_seller.membership_id is not null) else false end
  );

  if p_role = 'manager'::public.company_role then
    if v_needs_seller_update then
      update public.sellers
         set membership_id = null,
             is_active = false
       where id = v_seller.id;
    end if;

    if v_needs_membership_update then
      update public.company_memberships set role = p_role where id = v_membership.id;
    end if;
  else
    if v_needs_membership_update then
      update public.company_memberships set role = p_role where id = v_membership.id;
    end if;

    if v_needs_seller_update then
      if v_seller_count = 1 then
        update public.sellers
           set membership_id = v_membership.id,
               is_active = true
         where id = v_seller.id
        returning * into v_seller;
      else
        insert into public.sellers (company_id, membership_id, profile_id, name, first_name, is_active)
        values (p_company_id, v_membership.id, v_target_profile.id, v_target_profile.name, split_part(v_target_profile.name, ' ', 1), true)
        returning * into v_seller;
      end if;
    end if;
  end if;

  v_after := jsonb_build_object(
    'company_role', p_role,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active,
    'seller_linked', (v_seller.membership_id is not null)
  );

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), p_company_id, 'user_membership_role_updated', 'membership', v_membership.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select v_membership.id, v_membership.profile_id, v_membership.company_id, p_role;
end;
$$;

revoke all on function public.update_membership_role(uuid, uuid, public.company_role) from public;
revoke all on function public.update_membership_role(uuid, uuid, public.company_role) from anon;
grant execute on function public.update_membership_role(uuid, uuid, public.company_role) to authenticated;

commit;
