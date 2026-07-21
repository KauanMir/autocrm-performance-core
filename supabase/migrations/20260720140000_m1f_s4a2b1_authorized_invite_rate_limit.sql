-- M1-F / Módulo 1 — m1f_s4a2b1: rate limit de convites AUTORIZADO
-- Fonte: auditoria adversarial pós-S4-A2B (Route Handler) — vulnerabilidade
-- real encontrada e reproduzida empiricamente (DO block isolado,
-- BEGIN/ROLLBACK): reserve_invite_rate_limit() só valida existência do
-- ator + formato do e-mail/operação — NUNCA autorização. O Route Handler
-- chamava essa função ANTES de create_invite()/resend_invite() executarem
-- a autorização definitiva. Um Seller, Manager inativo, ADMIN legado ou
-- qualquer autenticado tentando convite de plataforma (company_id null)
-- conseguia CONSUMIR o rate limit (20/15min por ator, 3/24h por
-- e-mail+escopo) antes de receber `forbidden` — negação de serviço real
-- contra convites legítimos de outro ator para o mesmo e-mail/escopo.
-- Comprovado: Seller sintético reservou 1 evento (0→1) para um e-mail
-- alvo antes de create_invite() rejeitar com insufficient_privilege;
-- Manager (não super_admin) reservou 1 evento no escopo de PLATAFORMA
-- (company_id null, role_kind super_admin) da mesma forma.
--
-- ESCOPO ESTRITO (S4-A2B.1, banco apenas): reserve_invite_rate_limit()
-- rebaixada a helper interno (REVOKE EXECUTE de service_role — permanece
-- chamável só por SECURITY DEFINER cujo owner é postgres, que nunca
-- precisa de GRANT sobre suas próprias funções); duas novas funções
-- server-only que revalidam autorização/elegibilidade completa ANTES de
-- reservar: reserve_create_invite_rate_limit() e
-- reserve_resend_invite_rate_limit(). Fora de escopo: Route Handler (etapa
-- separada), accept_invite(), qualquer alteração em create_invite()/
-- resend_invite()/complete_invite_delivery()/complete_invite_resend_
-- delivery() (permanecem autoridade final, revalidando tudo de novo —
-- defesa em profundidade deliberada, não redundância descartável).
--
-- Depende de m1f_s1_01/02, m1f_s2_01/015/02, m1f_s11, m1f_s3a, m1f_s4a1,
-- m1f_s4a2a, m1f_s4a2a1.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- reserve_invite_rate_limit() rebaixado a helper interno
-- ═══════════════════════════════════════════════════════════════════════
-- Nenhuma mudança de corpo/lógica/algoritmo/locks/thresholds — só ACL.
-- service_role deixa de poder chamá-la diretamente; as duas funções abaixo
-- (owner postgres, mesma role desta migration) continuam conseguindo
-- chamá-la internamente porque um owner nunca precisa de GRANT sobre o
-- próprio objeto — SECURITY DEFINER faz o corpo executar como o OWNER da
-- função chamadora, não como o caller original.
revoke execute on function public.reserve_invite_rate_limit(uuid, uuid, text, text) from service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- reserve_create_invite_rate_limit()
-- ═══════════════════════════════════════════════════════════════════════
-- Revalida INTEGRALMENTE a autorização e elegibilidade de create_invite()
-- (mesma lógica, deliberadamente duplicada — defesa em profundidade) ANTES
-- de reservar o rate limit. Só reserva (chama o helper interno) quando
-- TUDO passa. Qualquer falha de autorização (42501, zero audit_log — mesmo
-- padrão de create_invite) ou de domínio (audit_log de falha, mesmos
-- reason codes de create_invite, já que representam o MESMO evento
-- lógico só detectado uma camada antes) devolve allowed=false SEM tocar
-- em invite_rate_limit_events. create_invite() continua sendo chamada
-- depois (quando o Route Handler prossegue) e continua revalidando tudo
-- de novo — cobre o caso raro de TOCTOU entre as duas chamadas RPC
-- separadas (duas transações distintas, sem lock compartilhado entre
-- elas).
create function public.reserve_create_invite_rate_limit(
  p_actor_profile_id uuid,
  p_company_id        uuid,
  p_email             text,
  p_role_kind         public.invite_role_kind
) returns table (
  allowed              boolean,
  code                 text,
  retry_after_seconds  integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor              public.profiles;
  v_is_super_admin     boolean;
  v_manager_membership public.company_memberships;
  v_email_normalized   text;
  v_attempt_id         uuid := gen_random_uuid();
  v_company            public.companies;
  v_target_profile     public.profiles;
  v_already_member     boolean;
  v_not_eligible       boolean;
  v_after_partial      jsonb;
  v_rl                 record;
begin
  -- ── 1. ator: existe e está ativo ────────────────────────────────────
  select p.* into v_actor
    from public.profiles p
   where p.id = p_actor_profile_id
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);

  -- ── 2. capacidade do ator (idêntico a create_invite, nunca lê
  --      profiles.role) ───────────────────────────────────────────────
  if not v_is_super_admin then
    if p_company_id is null then
      raise insufficient_privilege using message = 'forbidden';
    end if;

    select cm.* into v_manager_membership
      from public.company_memberships cm
      join public.profiles p on p.id = cm.profile_id
     where cm.profile_id = p_actor_profile_id
       and cm.company_id = p_company_id
       and cm.role = 'manager'
       and cm.is_active
       and p.is_active;

    if v_manager_membership.id is null then
      raise insufficient_privilege using message = 'forbidden';
    end if;

    if p_role_kind is distinct from 'seller' then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  -- ── 3. validações de entrada (domínio, não autorização) ─────────────
  v_email_normalized := lower(btrim(coalesce(p_email, '')));

  if v_email_normalized = '' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'invalid_input', null, null, 'rpc');
    return query select false, 'invalid_input'::text, null::integer;
    return;
  end if;

  if p_role_kind is null
     or (p_role_kind = 'super_admin' and p_company_id is not null)
     or (p_role_kind in ('manager', 'seller') and p_company_id is null)
  then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'invalid_role', null,
       jsonb_build_object('role_kind', p_role_kind, 'company_id', p_company_id), 'rpc');
    return query select false, 'invalid_role'::text, null::integer;
    return;
  end if;

  v_after_partial := jsonb_build_object('email_normalized', v_email_normalized, 'role_kind', p_role_kind, 'company_id', p_company_id);

  -- ── 4. empresa (só quando company_id não é nulo) ────────────────────
  if p_company_id is not null then
    select c.* into v_company from public.companies c where c.id = p_company_id;

    if v_company.id is null then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, null, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'invalid_company', null, v_after_partial, 'rpc');
      return query select false, 'invalid_company'::text, null::integer;
      return;
    end if;

    if v_company.status not in ('implantacao', 'ativa') then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, v_company.id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'company_not_operational', null, v_after_partial, 'rpc');
      return query select false, 'company_not_operational'::text, null::integer;
      return;
    end if;
  end if;

  -- ── 5. já-membro / não-elegível (idêntico a create_invite) ──────────
  v_already_member := false;
  v_not_eligible    := false;

  if p_role_kind = 'super_admin' then
    select exists (
      select 1 from public.profiles p
       where lower(btrim(p.email)) = v_email_normalized
         and p.platform_role = 'super_admin'
    ) into v_already_member;
  else
    select p.* into v_target_profile
      from public.profiles p
     where lower(btrim(p.email)) = v_email_normalized
       and (select count(*) from public.profiles p2 where lower(btrim(p2.email)) = v_email_normalized) = 1;

    if v_target_profile.id is not null then
      select exists (
        select 1 from public.company_memberships cm
         where cm.profile_id = v_target_profile.id
           and cm.company_id = p_company_id
      ) into v_already_member;

      if not v_already_member and not v_is_super_admin then
        select exists (
          select 1 from public.company_memberships cm
           where cm.profile_id = v_target_profile.id
             and cm.company_id <> p_company_id
             and cm.is_active
        ) into v_not_eligible;
      end if;
    end if;
  end if;

  if v_already_member then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'already_member', null, v_after_partial, 'rpc');
    return query select false, 'already_member'::text, null::integer;
    return;
  end if;

  if v_not_eligible then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'not_eligible', null, v_after_partial, 'rpc');
    return query select false, 'not_eligible'::text, null::integer;
    return;
  end if;

  -- ── 6. convite pending duplicado (mesma condição dos 2 índices únicos
  --      parciais de invites — S4-A1) ─────────────────────────────────
  if p_company_id is not null then
    if exists (
      select 1 from public.invites i
       where i.company_id = p_company_id
         and i.email_normalized = v_email_normalized
         and i.status = 'pending'
    ) then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'duplicate_pending', null, v_after_partial, 'rpc');
      return query select false, 'duplicate_pending'::text, null::integer;
      return;
    end if;
  else
    if exists (
      select 1 from public.invites i
       where i.company_id is null
         and i.email_normalized = v_email_normalized
         and i.status = 'pending'
    ) then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, null, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'duplicate_pending', null, v_after_partial, 'rpc');
      return query select false, 'duplicate_pending'::text, null::integer;
      return;
    end if;
  end if;

  -- ── 7. tudo autorizado e elegível — só agora reserva o rate limit ───
  select * into v_rl from public.reserve_invite_rate_limit(p_actor_profile_id, p_company_id, p_email, 'create');
  return query select v_rl.allowed, v_rl.code, v_rl.retry_after_seconds;
end;
$$;

revoke all on function public.reserve_create_invite_rate_limit(uuid, uuid, text, public.invite_role_kind) from public;
revoke all on function public.reserve_create_invite_rate_limit(uuid, uuid, text, public.invite_role_kind) from anon;
revoke all on function public.reserve_create_invite_rate_limit(uuid, uuid, text, public.invite_role_kind) from authenticated;
grant execute on function public.reserve_create_invite_rate_limit(uuid, uuid, text, public.invite_role_kind) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- reserve_resend_invite_rate_limit()
-- ═══════════════════════════════════════════════════════════════════════
-- Deriva company_id/email/role_kind/invited_by_profile_id/status/
-- expires_at INTEIRAMENTE do convite — nunca aceita esses dados do Route
-- Handler (só p_invite_id). Revalida autorização/elegibilidade completa
-- de resend_invite() (mesma lógica, deliberadamente duplicada). NÃO
-- materializa a expiração preguiçosa (isso continua sendo exclusividade
-- de resend_invite() — esta função só CALCULA o status efetivo em memória
-- para decidir elegibilidade, nunca escreve em invites).
create function public.reserve_resend_invite_rate_limit(
  p_actor_profile_id uuid,
  p_invite_id        uuid
) returns table (
  allowed              boolean,
  code                 text,
  retry_after_seconds  integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor            public.profiles;
  v_is_super_admin   boolean;
  v_old              public.invites;
  v_authorized       boolean := false;
  v_effective_status public.invite_status;
  v_company          public.companies;
  v_rl               record;
begin
  -- ── 1. ator: existe, ativo, tem ALGUMA capacidade administrativa
  --      (checagem de capacidade geral, idêntica a resend_invite) ──────
  select p.* into v_actor
    from public.profiles p
   where p.id = p_actor_profile_id
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);

  if not v_is_super_admin then
    if not exists (
      select 1 from public.company_memberships cm
       where cm.profile_id = p_actor_profile_id
         and cm.role = 'manager'
         and cm.is_active
    ) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  -- ── 2. localizar o convite (SEM lock — pré-checagem de leitura, em
  --      transação separada da chamada real de resend_invite()) ───────
  select i.* into v_old from public.invites i where i.id = p_invite_id;

  if v_old.id is null then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_resent', 'invite', p_invite_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::integer;
    return;
  end if;

  -- ── 3. autorização sobre ESTA linha (idêntico a resend_invite,
  --      coalesce(...,false) obrigatório — invited_by_profile_id é
  --      nullable) — colapsa em invite_not_found, nunca revela detalhe ──
  if v_is_super_admin then
    v_authorized := true;
  elsif v_old.company_id is not null then
    v_authorized := coalesce(
      exists (
        select 1 from public.company_memberships cm
         where cm.profile_id = p_actor_profile_id
           and cm.company_id = v_old.company_id
           and cm.role = 'manager'
           and cm.is_active
      ) and v_old.invited_by_profile_id = p_actor_profile_id,
      false
    );
  end if;

  if not v_authorized then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_resent', 'invite', p_invite_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::integer;
    return;
  end if;

  -- ── 4. status efetivo (expiração preguiçosa calculada em memória,
  --      NUNCA escrita aqui — resend_invite() materializa depois) ─────
  v_effective_status := v_old.status;
  if v_old.status = 'pending' and v_old.expires_at <= now() then
    v_effective_status := 'expired';
  end if;

  if v_effective_status not in ('pending', 'expired') then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'invite_not_actionable',
       jsonb_build_object('status', v_old.status), null, 'rpc');
    return query select false, 'invite_not_actionable'::text, null::integer;
    return;
  end if;

  -- ── 5. empresa operacional (convite empresarial) ────────────────────
  if v_old.company_id is not null then
    select c.* into v_company from public.companies c where c.id = v_old.company_id;

    if v_company.id is null or v_company.status not in ('implantacao', 'ativa') then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'company_not_operational', null, null, 'rpc');
      return query select false, 'company_not_operational'::text, null::integer;
      return;
    end if;
  end if;

  -- ── 6. tudo autorizado e elegível — só agora reserva o rate limit,
  --      com company_id/email DERIVADOS do convite (nunca do chamador) ─
  select * into v_rl from public.reserve_invite_rate_limit(p_actor_profile_id, v_old.company_id, v_old.email, 'resend');
  return query select v_rl.allowed, v_rl.code, v_rl.retry_after_seconds;
end;
$$;

revoke all on function public.reserve_resend_invite_rate_limit(uuid, uuid) from public;
revoke all on function public.reserve_resend_invite_rate_limit(uuid, uuid) from anon;
revoke all on function public.reserve_resend_invite_rate_limit(uuid, uuid) from authenticated;
grant execute on function public.reserve_resend_invite_rate_limit(uuid, uuid) to service_role;

commit;
