-- M1-F / Módulo 1 — m1f_s4a2a: RPCs de ciclo de vida de convites (banco)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §9,
-- §14, §16 (linha S4) — combinado com as decisões de arquitetura
-- explicitamente aprovadas nesta subetapa (M1-F S4-A2 E0 + correção de
-- privilégios de service_role): create_invite()/resend_invite() são
-- server-only por ACL (só service_role tem EXECUTE — NUNCA authenticated,
-- porque a conta Auth do convidado é criada no ENVIO, por um Route Handler
-- futuro (S4-B) que ainda não existe; uma chamada direta do navegador que
-- criasse a linha sem o Route Handler produziria um "convite fantasma"
-- sem conta Auth correspondente). cancel_invite() não tem esse problema
-- (nunca toca auth.users) e continua pública para authenticated, com
-- auth.uid() nativo, mesmo padrão de create_company()/create_lead().
--
-- ESCOPO ESTRITO (S4-A2A, banco apenas): as 3 RPCs abaixo. Fora de escopo,
-- propositalmente: geração de token bruto (Route Handler, S4-B), Route
-- Handler em si, acesso a auth.users/Supabase Auth, envio de e-mail,
-- accept_invite() (S4-C), interface (S4-D), rate limit (S4-B, citado em
-- §9.3 do design como requisito não-negociável, não implementado aqui).
--
-- Depende de m1f_s1_01/02, m1f_s2_01/015/02, m1f_s11, m1f_s3a, m1f_s4a1.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- create_invite()
-- ═══════════════════════════════════════════════════════════════════════
-- Nunca gera nem retorna token bruto — recebe p_token_hash já calculado
-- pelo Route Handler (Node crypto, fora desta etapa). Nunca lê auth.uid():
-- roda com service_role, então auth.uid() dentro do Postgres é NULL para
-- essa role — o ator real chega como p_actor_profile_id, já validado por
-- JWT no servidor ANTES desta chamada (validação essa que esta função não
-- pode enxergar nem confiar cegamente — por isso ela mesma revalida a
-- autorização real de p_actor_profile_id contra profiles/
-- company_memberships/platform_role abaixo, nunca aceitando o parâmetro
-- como prova de autoridade por si só).
--
-- Duas classes de falha, deliberadamente distintas (mesmo padrão de
-- create_company()/require_company_access() já usado em toda a base):
--   1. FALTA DE AUTORIZAÇÃO (ator inexistente/inativo; ator sem NENHUMA
--      capacidade administrativa relevante — Seller, ADMIN legado sem
--      membership de manager real, profile aleatório; Manager tentando
--      operar fora da própria empresa ou papel diferente de seller) —
--      RAISE EXCEPTION SQLSTATE 42501, ZERO escrita, zero audit_log. Não
--      há "linha específica" cuja existência precise ser protegida contra
--      enumeração aqui (diferente de resend/cancel, §S4-A2 E0 §12) — é
--      uma checagem de capacidade do ator, não de uma entidade existente.
--   2. FALHA DE DOMÍNIO (entrada malformada, empresa inexistente/não
--      operacional, duplicidade, já-membro) — retorno estruturado
--      (success=false, code=...), SEM RAISE, COM audit_log de falha —
--      resolve o problema transacional de "log de falha desaparece com o
--      rollback de uma EXCEPTION" (S4-A2 E0 §13).
--
-- IMPORTANTE — profiles.role NUNCA é lido aqui. A autorização de "Manager"
-- é 100% via company_memberships (role='manager', is_active) — nunca via
-- profiles.role='admin'/'manager' (coluna legada, deprecated desde §5.2 do
-- design; a migration de backfill m1f_s1_02 já remapeia ADMIN legado para
-- uma company_memberships real com role='manager', então um ADMIN legado
-- COM membership de manager de fato válida é, para todos os efeitos
-- observáveis por esta função, um Manager legítimo — exatamente a garantia
-- de "sem perda de acesso" que o §5.4 do design promete. "ADMIN legado
-- negado" (teste 23) cobre o caso de um profile com profiles.role='admin'
-- que NÃO tem nenhuma company_memberships ativa de manager — prova que a
-- função nunca concede autoridade a partir da coluna legada isoladamente.

create function public.create_invite(
  p_actor_profile_id uuid,
  p_company_id        uuid,
  p_email             text,
  p_name              text,
  p_role_kind         public.invite_role_kind,
  p_token_hash        text
) returns table (
  success     boolean,
  code        text,
  invite_id   uuid,
  status      public.invite_status,
  expires_at  timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor             public.profiles;
  v_is_super_admin    boolean;
  v_manager_membership public.company_memberships;
  v_email_normalized  text;
  v_name_check        text;
  v_expires_at        timestamptz := now() + interval '7 days';
  v_attempt_id        uuid := gen_random_uuid();
  v_company           public.companies;
  v_target_profile    public.profiles;
  v_already_member    boolean;
  v_not_eligible      boolean;
  v_invite_id         uuid;
  v_constraint        text;
  v_after_partial     jsonb;
begin
  -- ── 1. ator: existe e está ativo ────────────────────────────────────
  select p.* into v_actor
    from public.profiles p
   where p.id = p_actor_profile_id
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- coalesce(..., false) é obrigatório: platform_role é NULL para a
  -- imensa maioria dos profiles, e `NULL = 'super_admin'` avalia para
  -- NULL (não false) em SQL — um `if not v_is_super_admin` subsequente
  -- trataria NULL como "nem verdadeiro nem falso" e puraria o bloco de
  -- autorização inteiro (bug real, comprovado empiricamente e corrigido
  -- nesta versão). Mesmo padrão defensivo já usado em
  -- is_platform_super_admin() (m1f_s2_02).
  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);

  -- ── 2. capacidade do ator (nunca lê profiles.role) ──────────────────
  if not v_is_super_admin then
    if p_company_id is null then
      -- só Super Admin pode operar com company_id nulo (convite de
      -- plataforma) — Manager jamais tem esse caminho.
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
      -- cobre: Seller, ADMIN legado sem membership de manager real,
      -- Manager de OUTRA empresa tentando esta empresa, profile sem
      -- nenhuma autorização.
      raise insufficient_privilege using message = 'forbidden';
    end if;

    if p_role_kind is distinct from 'seller' then
      -- Manager só convida seller — nunca manager, nunca super_admin.
      -- IS DISTINCT FROM trata p_role_kind NULL corretamente (NULL não
      -- deve silenciosamente escapar desta checagem).
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  -- ── 3. validações de entrada (domínio, não autorização) ─────────────
  v_email_normalized := lower(btrim(coalesce(p_email, '')));
  v_name_check        := btrim(coalesce(p_name, ''));

  if v_name_check = '' or v_email_normalized = '' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'invalid_input', null, null, 'rpc');
    return query select false, 'invalid_input'::text, null::uuid, null::public.invite_status, null::timestamptz;
    return;
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'invalid_token_hash', null, null, 'rpc');
    return query select false, 'invalid_token_hash'::text, null::uuid, null::public.invite_status, null::timestamptz;
    return;
  end if;

  -- coerência estrutural role_kind x company_id (mesma regra do CHECK
  -- invites_company_role_coherence_ck, revalidada aqui ANTES do insert
  -- para devolver um código de domínio preciso, não um erro de
  -- constraint traduzido às cegas).
  if p_role_kind is null
     or (p_role_kind = 'super_admin' and p_company_id is not null)
     or (p_role_kind in ('manager', 'seller') and p_company_id is null)
  then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'invalid_role', null,
       jsonb_build_object('role_kind', p_role_kind, 'company_id', p_company_id), 'rpc');
    return query select false, 'invalid_role'::text, null::uuid, null::public.invite_status, null::timestamptz;
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
      return query select false, 'invalid_company'::text, null::uuid, null::public.invite_status, null::timestamptz;
      return;
    end if;

    if v_company.status not in ('implantacao', 'ativa') then
      -- can_access_company() sozinha NÃO basta aqui: ela permite Super
      -- Admin acessar empresa 'suspensa' (suporte/auditoria, §7.4 do
      -- design) — mas a decisão de produto (#10, aprovada) proíbe
      -- create/resend/accept em empresa suspensa/cancelada para
      -- QUALQUER ator, então esta checagem é explícita e independente.
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, v_company.id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'company_not_operational', null, v_after_partial, 'rpc');
      return query select false, 'company_not_operational'::text, null::uuid, null::public.invite_status, null::timestamptz;
      return;
    end if;
  end if;

  -- ── 5. já-membro / não-elegível (nunca consulta a tabela do GoTrue) ──
  v_already_member := false;
  v_not_eligible    := false;

  if p_role_kind = 'super_admin' then
    select exists (
      select 1 from public.profiles p
       where lower(btrim(p.email)) = v_email_normalized
         and p.platform_role = 'super_admin'
    ) into v_already_member;
  else
    -- falha fechado contra e-mail ambíguo (mais de um profile
    -- normalizando para o mesmo e-mail é um estado de dado pré-existente
    -- fora de escopo desta etapa, mas a função nunca escolhe uma linha
    -- arbitrária entre duas — mesmo padrão de current_membership_
    -- company_id()/current_profile_seller_id_for_company()).
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
    return query select false, 'already_member'::text, null::uuid, null::public.invite_status, null::timestamptz;
    return;
  end if;

  if v_not_eligible then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'not_eligible', null, v_after_partial, 'rpc');
    return query select false, 'not_eligible'::text, null::uuid, null::public.invite_status, null::timestamptz;
    return;
  end if;

  -- ── 6. inserção (duplicidade/token tratados como falha de domínio,
  --      nunca como exceção não capturada) ─────────────────────────────
  begin
    insert into public.invites
      (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id)
    values
      (p_company_id, p_email, p_name, p_role_kind, p_token_hash, 'pending', v_expires_at, p_actor_profile_id)
    returning id into v_invite_id;
  exception
    when unique_violation then
      -- Mapeamento EXPLÍCITO e EXAUSTIVO das únicas 3 constraints/índices
      -- únicos que existem em invites (S4-A1): invites_token_hash_key →
      -- token_conflict; os 2 índices parciais de pending →
      -- duplicate_pending. QUALQUER outro nome de constraint (schema
      -- alterado no futuro sem esta função ser revisada, ou bug
      -- genuíno) NUNCA é silenciosamente classificado como um desses
      -- dois códigos conhecidos — o RAISE original propaga, reverte a
      -- transação inteira, e falha alto (não mascara bug de schema como
      -- erro de domínio já catalogado).
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'invites_token_hash_key' then
        insert into public.audit_log
          (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
        values
          (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'token_conflict', null, v_after_partial, 'rpc');
        return query select false, 'token_conflict'::text, null::uuid, null::public.invite_status, null::timestamptz;
        return;
      elsif v_constraint in ('invites_pending_company_email_uidx', 'invites_pending_platform_email_uidx') then
        insert into public.audit_log
          (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
        values
          (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'duplicate_pending', null, v_after_partial, 'rpc');
        return query select false, 'duplicate_pending'::text, null::uuid, null::public.invite_status, null::timestamptz;
        return;
      else
        raise;
      end if;
    when check_violation then
      -- defesa em profundidade: a checagem de invalid_role acima já
      -- deveria ter impedido qualquer combinação incoerente de chegar
      -- aqui; se ainda assim a constraint da tabela disparar, o erro de
      -- domínio continua preciso em vez de propagar a exceção crua —
      -- MAS só para a constraint especificamente esperada
      -- (invites_company_role_coherence_ck). invites_email_not_blank_ck
      -- e invites_accepted_coherence_ck são estruturalmente impossíveis
      -- de violar a partir desta função (email já validado não-branco
      -- acima; status sempre 'pending' com accepted_at/accepted_
      -- profile_id sempre omitidos/NULL no INSERT) — se algum dia
      -- dispararem, é sinal de bug real, não de invalid_role.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'invites_company_role_coherence_ck' then
        insert into public.audit_log
          (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
        values
          (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_attempt_id::text, 'failure', 'invalid_role', null, v_after_partial, 'rpc');
        return query select false, 'invalid_role'::text, null::uuid, null::public.invite_status, null::timestamptz;
        return;
      else
        raise;
      end if;
  end;

  -- ── 7. sucesso ───────────────────────────────────────────────────────
  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (p_actor_profile_id, p_company_id, 'invite_sent', 'invite', v_invite_id::text, 'success', null, null,
     jsonb_build_object(
       'invite_id', v_invite_id,
       'company_id', p_company_id,
       'email_normalized', v_email_normalized,
       'role_kind', p_role_kind,
       'status', 'pending',
       'expires_at', v_expires_at
     ),
     'rpc');

  return query select true, 'ok'::text, v_invite_id, 'pending'::public.invite_status, v_expires_at;
end;
$$;

revoke all on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) from public;
revoke all on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) from anon;
revoke all on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) from authenticated;
grant execute on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- resend_invite()
-- ═══════════════════════════════════════════════════════════════════════
-- Mesma ACL server-only de create_invite() e pelo mesmo motivo: também
-- alimenta a criação de um novo convite pending que exige e-mail real
-- disparado pelo Route Handler.
--
-- Diferente de create_invite(), esta função opera sobre uma linha JÁ
-- EXISTENTE — "wrong company"/"não é o convite deste ator" NUNCA vira
-- `forbidden`: colapsa em invite_not_found (mesmo padrão de
-- lead_not_found do M1-E, §15.2) para não revelar a um chamador sem
-- autoridade que aquele id existe em outra empresa/pertence a outro
-- convidador. `forbidden` (42501) fica reservado só para um ator sem
-- NENHUMA capacidade administrativa (inexistente/inativo, ou nem Super
-- Admin nem Manager de empresa nenhuma) — checagem de capacidade geral,
-- não de uma linha específica.
--
-- Aplica a decisão já congelada "Manager só administra convites criados
-- por ele" (arquitetura aprovada, decisão #6) de forma consistente com
-- cancel_invite() — o texto desta subetapa só repete essa regra
-- explicitamente para cancel (§12), mas é a mesma regra geral de
-- administração já aprovada, aplicada aqui por consistência, não como
-- invenção nova.

create function public.resend_invite(
  p_actor_profile_id uuid,
  p_invite_id         uuid,
  p_token_hash        text
) returns table (
  success             boolean,
  code                text,
  invite_id           uuid,
  previous_invite_id  uuid,
  status              public.invite_status,
  expires_at          timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor           public.profiles;
  v_is_super_admin  boolean;
  v_old             public.invites;
  v_authorized      boolean := false;
  v_company         public.companies;
  v_new_id          uuid;
  v_expires_at      timestamptz := now() + interval '7 days';
  v_constraint      text;
  v_before          jsonb;
  v_after           jsonb;
begin
  -- ── 1. ator: existe, está ativo, tem ALGUMA capacidade administrativa
  --      (checagem de capacidade geral, não de uma linha específica) ────
  select p.* into v_actor
    from public.profiles p
   where p.id = p_actor_profile_id
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- coalesce(..., false) é obrigatório: platform_role é NULL para a
  -- imensa maioria dos profiles, e `NULL = 'super_admin'` avalia para
  -- NULL (não false) em SQL — um `if not v_is_super_admin` subsequente
  -- trataria NULL como "nem verdadeiro nem falso" e puraria o bloco de
  -- autorização inteiro (bug real, comprovado empiricamente e corrigido
  -- nesta versão). Mesmo padrão defensivo já usado em
  -- is_platform_super_admin() (m1f_s2_02).
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

  -- ── 2. localizar e travar o convite alvo ────────────────────────────
  select i.* into v_old from public.invites i where i.id = p_invite_id for update;

  if v_old.id is null then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_resent', 'invite', p_invite_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::uuid, null::uuid, null::public.invite_status, null::timestamptz;
    return;
  end if;

  -- ── 3. autorização sobre ESTA linha específica (colapsa em
  --      invite_not_found quando negada, nunca revela detalhe) ─────────
  -- coalesce(..., false) OBRIGATÓRIO aqui: invited_by_profile_id é
  -- nullable (ON DELETE SET NULL, S4-A1 — sobrevive à exclusão do
  -- profile convidador). Se essa coluna for NULL, `v_old.invited_by_
  -- profile_id = p_actor_profile_id` avalia NULL (não false); `TRUE AND
  -- NULL` também é NULL — sem o coalesce, v_authorized ficaria NULL, e o
  -- `if not v_authorized` seguinte trataria isso como "nem verdadeiro
  -- nem falso" e puraria o bloco de negação, permitindo que QUALQUER
  -- Manager com membership ativa na mesma empresa reenviasse um convite
  -- que nunca criou, assim que o convidador original fosse desativado/
  -- removido. Bug real, comprovado empiricamente (DO block isolado +
  -- chamada real da RPC) e corrigido nesta versão — mesma classe do bug
  -- de v_is_super_admin acima, só que escondido dentro de uma expressão
  -- composta (AND) em vez de uma comparação simples.
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
  -- convite de plataforma (company_id null): só Super Admin (v_authorized
  -- já é true nesse caso, senão permanece false).

  if not v_authorized then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, null, 'invite_resent', 'invite', p_invite_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::uuid, null::uuid, null::public.invite_status, null::timestamptz;
    return;
  end if;

  -- ── 4. materializar expiração preguiçosa, se aplicável ──────────────
  if v_old.status = 'pending' and v_old.expires_at <= now() then
    update public.invites i
       set status = 'expired'
     where i.id = v_old.id
       and i.status = 'pending';
    v_old.status := 'expired';

    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_old.company_id, 'invite_expired', 'invite', v_old.id::text, 'success', null,
       jsonb_build_object('status', 'pending', 'expires_at', v_old.expires_at),
       jsonb_build_object('status', 'expired'),
       'rpc');
  end if;

  -- ── 5. status precisa ser reenviável ─────────────────────────────────
  if v_old.status not in ('pending', 'expired') then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'invite_not_actionable',
       jsonb_build_object('status', v_old.status), null, 'rpc');
    return query select false, 'invite_not_actionable'::text, null::uuid, v_old.id, v_old.status, null::timestamptz;
    return;
  end if;

  -- ── 6. validação de hash ─────────────────────────────────────────────
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'invalid_token_hash', null, null, 'rpc');
    return query select false, 'invalid_token_hash'::text, null::uuid, v_old.id, null::public.invite_status, null::timestamptz;
    return;
  end if;

  -- ── 7. empresa operacional (convite empresarial) ────────────────────
  if v_old.company_id is not null then
    select c.* into v_company from public.companies c where c.id = v_old.company_id;

    if v_company.id is null or v_company.status not in ('implantacao', 'ativa') then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'company_not_operational', null, null, 'rpc');
      return query select false, 'company_not_operational'::text, null::uuid, v_old.id, null::public.invite_status, null::timestamptz;
      return;
    end if;
  end if;

  -- ── 8. supersede + novo convite, atômico via savepoint implícito de
  --      BEGIN/EXCEPTION — se o INSERT falhar, o UPDATE deste bloco
  --      também é desfeito, então o convite antigo NUNCA fica
  --      'superseded' sem substituto (S4-A2 E0 §10) ───────────────────
  v_before := jsonb_build_object('previous_invite_id', v_old.id, 'status', v_old.status, 'expires_at', v_old.expires_at);

  begin
    update public.invites i
       set status = 'superseded'
     where i.id = v_old.id
       and i.status in ('pending', 'expired');

    if not found then
      raise exception using errcode = 'P0001', message = 'invite_state_changed';
    end if;

    insert into public.invites
      (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id)
    values
      (v_old.company_id, v_old.email, v_old.name, v_old.role_kind, p_token_hash, 'pending', v_expires_at, v_old.invited_by_profile_id)
    returning id into v_new_id;
  exception
    when unique_violation then
      -- Mesmo mapeamento explícito e exaustivo de create_invite() — ver
      -- comentário completo lá. Constraint desconhecida propaga (RAISE),
      -- nunca é mascarada como duplicate_pending/token_conflict.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'invites_token_hash_key' then
        insert into public.audit_log
          (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
        values
          (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'token_conflict', v_before, null, 'rpc');
        return query select false, 'token_conflict'::text, null::uuid, v_old.id, null::public.invite_status, null::timestamptz;
        return;
      elsif v_constraint in ('invites_pending_company_email_uidx', 'invites_pending_platform_email_uidx') then
        insert into public.audit_log
          (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
        values
          (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'duplicate_pending', v_before, null, 'rpc');
        return query select false, 'duplicate_pending'::text, null::uuid, v_old.id, null::public.invite_status, null::timestamptz;
        return;
      else
        raise;
      end if;
    when sqlstate 'P0001' then
      insert into public.audit_log
        (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
      values
        (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'failure', 'invite_not_actionable', v_before, null, 'rpc');
      return query select false, 'invite_not_actionable'::text, null::uuid, v_old.id, null::public.invite_status, null::timestamptz;
      return;
  end;

  -- ── 9. sucesso ───────────────────────────────────────────────────────
  v_after := jsonb_build_object(
    'previous_invite_id', v_old.id,
    'new_invite_id', v_new_id,
    'company_id', v_old.company_id,
    'role_kind', v_old.role_kind,
    'status', 'pending',
    'expires_at', v_expires_at
  );

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (p_actor_profile_id, v_old.company_id, 'invite_resent', 'invite', v_old.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select true, 'ok'::text, v_new_id, v_old.id, 'pending'::public.invite_status, v_expires_at;
end;
$$;

revoke all on function public.resend_invite(uuid, uuid, text) from public;
revoke all on function public.resend_invite(uuid, uuid, text) from anon;
revoke all on function public.resend_invite(uuid, uuid, text) from authenticated;
grant execute on function public.resend_invite(uuid, uuid, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- cancel_invite()
-- ═══════════════════════════════════════════════════════════════════════
-- Nunca toca auth.users, nunca cria conta, nunca depende do Route
-- Handler — permanece uma RPC comum, pública para authenticated, ator
-- sempre auth.uid() nativo (nunca um parâmetro, nunca confiado de fora),
-- mesmo padrão de create_company()/create_lead(). Mesma regra de colapso
-- em invite_not_found de resend_invite() (§ acima) para não revelar
-- convites de outra empresa/outro convidador.

create function public.cancel_invite(p_invite_id uuid)
returns table (
  success    boolean,
  code       text,
  invite_id  uuid,
  status     public.invite_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor           public.profiles;
  v_is_super_admin  boolean;
  v_old             public.invites;
  v_authorized      boolean := false;
begin
  select p.* into v_actor
    from public.profiles p
   where p.id = auth.uid()
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- coalesce(..., false) é obrigatório: platform_role é NULL para a
  -- imensa maioria dos profiles, e `NULL = 'super_admin'` avalia para
  -- NULL (não false) em SQL — um `if not v_is_super_admin` subsequente
  -- trataria NULL como "nem verdadeiro nem falso" e puraria o bloco de
  -- autorização inteiro (bug real, comprovado empiricamente e corrigido
  -- nesta versão). Mesmo padrão defensivo já usado em
  -- is_platform_super_admin() (m1f_s2_02).
  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);

  if not v_is_super_admin then
    if not exists (
      select 1 from public.company_memberships cm
       where cm.profile_id = auth.uid()
         and cm.role = 'manager'
         and cm.is_active
    ) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  select i.* into v_old from public.invites i where i.id = p_invite_id for update;

  if v_old.id is null then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (auth.uid(), null, 'invite_canceled', 'invite', p_invite_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::uuid, null::public.invite_status;
    return;
  end if;

  -- coalesce(..., false) OBRIGATÓRIO aqui: invited_by_profile_id é
  -- nullable (ON DELETE SET NULL, S4-A1). Sem o coalesce, um convite cujo
  -- convidador original foi removido teria v_authorized = NULL (não
  -- false) para qualquer outro Manager da mesma empresa, e o `if not
  -- v_authorized` seguinte pularia o bloco de negação — permitindo
  -- cancelar convite alheio. Bug real, comprovado empiricamente (DO block
  -- isolado + chamada real de cancel_invite(), que retornou
  -- success=true/status=canceled para um Manager que nunca convidou
  -- ninguém) e corrigido nesta versão — mesma classe do bug de
  -- v_is_super_admin, escondido dentro de uma expressão composta.
  if v_is_super_admin then
    v_authorized := true;
  elsif v_old.company_id is not null then
    v_authorized := coalesce(
      v_old.invited_by_profile_id = auth.uid()
      and exists (
        select 1 from public.company_memberships cm
         where cm.profile_id = auth.uid()
           and cm.company_id = v_old.company_id
           and cm.role = 'manager'
           and cm.is_active
      ),
      false
    );
  end if;

  if not v_authorized then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (auth.uid(), null, 'invite_canceled', 'invite', p_invite_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::uuid, null::public.invite_status;
    return;
  end if;

  -- cancelamento é permitido mesmo com empresa suspensa/cancelada
  -- (ação corretiva, nunca gate operacional — S4-A2 E0 §11) — de
  -- propósito NENHUMA checagem de companies.status entra aqui.

  if v_old.status = 'pending' and v_old.expires_at <= now() then
    update public.invites i
       set status = 'expired'
     where i.id = v_old.id
       and i.status = 'pending';

    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (auth.uid(), v_old.company_id, 'invite_expired', 'invite', v_old.id::text, 'success', null,
       jsonb_build_object('status', 'pending', 'expires_at', v_old.expires_at),
       jsonb_build_object('status', 'expired'),
       'rpc');

    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (auth.uid(), v_old.company_id, 'invite_canceled', 'invite', v_old.id::text, 'failure', 'invite_not_actionable',
       jsonb_build_object('status', 'pending'), null, 'rpc');

    return query select false, 'invite_not_actionable'::text, v_old.id, 'expired'::public.invite_status;
    return;
  end if;

  if v_old.status <> 'pending' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (auth.uid(), v_old.company_id, 'invite_canceled', 'invite', v_old.id::text, 'failure', 'invite_not_actionable',
       jsonb_build_object('status', v_old.status), null, 'rpc');
    return query select false, 'invite_not_actionable'::text, v_old.id, v_old.status;
    return;
  end if;

  update public.invites i
     set status = 'canceled'
   where i.id = v_old.id
     and i.status = 'pending';

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_old.company_id, 'invite_canceled', 'invite', v_old.id::text, 'success', null,
     jsonb_build_object('status', 'pending'),
     jsonb_build_object('status', 'canceled'),
     'rpc');

  return query select true, 'ok'::text, v_old.id, 'canceled'::public.invite_status;
end;
$$;

revoke all on function public.cancel_invite(uuid) from public;
revoke all on function public.cancel_invite(uuid) from anon;
revoke all on function public.cancel_invite(uuid) from authenticated;
grant execute on function public.cancel_invite(uuid) to authenticated;

commit;
