-- M1-F / Módulo 1 — m1f_s4a2a1: fundação de status de entrega e rate
-- limit de convites (banco)
-- Fonte: revisão arquitetural pós-S4-A2A (M1-F S4-A2A.1) — lacuna real
-- encontrada: create_invite()/resend_invite() registravam
-- invite_sent/invite_resent com result='success' ANTES de qualquer
-- tentativa real de envio pelo Supabase Auth (que só existirá no Route
-- Handler, S4-B, ainda não implementado) — a auditoria podia afirmar que
-- um e-mail foi enviado mesmo que a Admin API viesse a falhar depois.
--
-- ESCOPO ESTRITO (S4-A2A.1, banco apenas): schema de status de entrega em
-- invites; proveniência explícita de convites (supersedes_invite_id);
-- ajuste de create_invite()/resend_invite() para não mais auditar
-- sucesso de envio prematuramente; funções server-only de finalização de
-- entrega, tanto do CREATE (complete_invite_delivery) quanto do REENVIO
-- (complete_invite_resend_delivery); fundação de rate limit (tabela
-- fechada + reserva atômica). Fora de escopo, propositalmente: Route
-- Handler, template de e-mail, chamada real ao Supabase Auth, geração de
-- token bruto, accept_invite() (S4-C).
--
-- CORREÇÃO DIRECIONADA DE PROVENIÊNCIA (revisão desta migration antes da
-- primeira aprovação para commit): a primeira versão parou antes de
-- criar complete_invite_delivery() por falta de um sinal seguro de
-- proveniência (create vs. resend) — decisão correta, mas a auditoria
-- seguinte encontrou que a MESMA lacuna também comprometia
-- complete_invite_resend_delivery(): validar só empresa/e-mail/papel/
-- status/ordem temporal prova COMPATIBILIDADE, nunca PROVENIÊNCIA real
-- (contra-exemplo concreto de falso positivo documentado junto à coluna
-- supersedes_invite_id, mais abaixo). Resolvido com uma referência
-- explícita gravada pelo próprio banco (supersedes_invite_id: NULL para
-- convite criado por create_invite(), preenchido com o id do convite
-- anterior para convite criado por resend_invite() — nunca escolhida por
-- quem chama). Com essa fonte de verdade, complete_invite_delivery()
-- agora existe e complete_invite_resend_delivery() teve sua validação de
-- relação corrigida de heurística para prova estrutural.
--
-- Depende de m1f_s1_01/02, m1f_s2_01/015/02, m1f_s11, m1f_s3a, m1f_s4a1,
-- m1f_s4a2a.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA — status de entrega
-- ═══════════════════════════════════════════════════════════════════════
-- delivery_status é INDEPENDENTE de invites.status (o "status do
-- convite" em si: pending/accepted/canceled/expired/superseded). Um
-- convite pode transicionar de status (ex.: pending -> superseded via
-- resend) sem que seu histórico de entrega seja apagado — a coerência
-- abaixo só relaciona delivery_status às SUAS PRÓPRIAS 3 colunas
-- (attempted_at/sent_at/error_code), nunca a invites.status. Isso
-- garante, por construção, que um convite superseded/accepted/canceled
-- preserva intacto o resultado da última tentativa de entrega que teve
-- enquanto ainda era o convite ativo — nenhuma dessas transições grava
-- ou apaga delivery_status (nenhuma das RPCs abaixo toca essas 4 colunas
-- fora do fluxo de criação/finalização de entrega).

create type public.invite_delivery_status as enum ('not_sent', 'sent', 'failed');

alter table public.invites
  add column delivery_status         public.invite_delivery_status not null default 'not_sent',
  add column delivery_attempted_at   timestamptz,
  add column email_sent_at           timestamptz,
  add column last_delivery_error_code text;

-- Backfill: ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT 'not_sent' já
-- aplica o default a TODAS as linhas existentes (inclusive as 663+
-- fixtures sintéticas dos testes 22/23, criadas antes desta migration em
-- qualquer reset local) — nenhum UPDATE explícito é necessário nem mais
-- correto que isso. Nenhuma linha histórica é marcada como 'sent'
-- automaticamente: o default é 'not_sent', com as 3 colunas de
-- timestamp/erro permanecendo NULL, exatamente a semântica de "nunca
-- tentamos entregar isto" — correta tanto para convites de teste locais
-- quanto para qualquer convite real que um dia exista em produção sem
-- histórico de entrega registrado antes desta coluna existir.

-- Whitelist de last_delivery_error_code (§12): catálogo fechado, nunca
-- mensagem bruta da Admin API, stack trace, e-mail, status HTTP bruto,
-- URL ou payload — mesmo padrão de audit_log.result (S4-A1: CHECK, não
-- enum, para um conjunto pequeno e fechado que nunca precisa de troca de
-- valor sem migration).
alter table public.invites
  add constraint invites_delivery_error_code_ck check (
    last_delivery_error_code is null
    or last_delivery_error_code in (
      'auth_email_failed',
      'auth_rate_limited',
      'auth_unavailable',
      'unexpected_delivery_error'
    )
  );

-- Coerência delivery_status x (attempted_at, sent_at, error_code) — as 3
-- combinações válidas do §6, nada além delas.
alter table public.invites
  add constraint invites_delivery_coherence_ck check (
    (delivery_status = 'not_sent'
      and delivery_attempted_at is null
      and email_sent_at is null
      and last_delivery_error_code is null)
    or (delivery_status = 'sent'
      and delivery_attempted_at is not null
      and email_sent_at is not null
      and last_delivery_error_code is null)
    or (delivery_status = 'failed'
      and delivery_attempted_at is not null
      and email_sent_at is null
      and last_delivery_error_code is not null
      and btrim(last_delivery_error_code) <> '')
  );

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA — proveniência explícita (correção direcionada pós-auditoria)
-- ═══════════════════════════════════════════════════════════════════════
-- A revisão da primeira versão desta migration encontrou que a mesma
-- lacuna que impediu complete_invite_delivery() de ser criada (nenhum
-- sinal seguro de "este pending nasceu de create ou de resend") também
-- comprometia complete_invite_resend_delivery(): validar só empresa/
-- e-mail/papel/status/ordem temporal NÃO prova que o convite novo foi
-- de fato gerado a partir do convite anterior informado — um convite C
-- criado de forma totalmente independente (via create_invite, meses
-- depois) para o mesmo e-mail/empresa/papel de um convite A há muito
-- superseded por outra cadeia de reenvio passaria pela heurística
-- antiga sem nenhuma relação real com A.
--
-- Resolvido com o único sinal genuinamente inequívoco: uma referência
-- direta, gravada pelo próprio banco no momento da criação, nunca
-- escolhida por quem chama. supersedes_invite_id NULL = convite nasceu
-- de create_invite() (não é reenvio de nada). Preenchido = convite
-- nasceu de resend_invite() e aponta EXATAMENTE para o convite que ele
-- substituiu — nenhum outro estado é possível, porque só essas duas RPCs
-- inserem em invites, e cada uma decide o valor internamente (nunca
-- como parâmetro aceito de fora).
--
-- ON DELETE RESTRICT (nunca CASCADE, nunca SET NULL): a relação
-- histórica entre um convite e o que ele substituiu é, pelo próprio
-- design (§9.3: convites "nunca apagados"), um fato permanente — não
-- pode desaparecer silenciosamente se o convite anterior for afetado por
-- qualquer operação futura. Mesmo raciocínio já aplicado a
-- invites.company_id (RESTRICT, S4-A1) e mesma exceção deliberada ao
-- padrão CASCADE/SET NULL do resto do schema.
--
-- Índice único parcial: garante estruturalmente (não só por convenção)
-- que um convite anterior pode ser apontado por, no máximo, UM convite
-- novo diretamente — impossível dois resends distintos reivindicarem o
-- mesmo predecessor.
--
-- BACKFILL: nenhuma linha real existe hoje (nenhuma migration M1-F foi
-- aplicada ao Supabase remoto — confirmado no preflight desta correção;
-- localmente, todo reset recria o banco do zero a cada teste). As únicas
-- linhas que já existiam antes desta coluna nascer são fixtures
-- sintéticas de teste, recriadas a cada `db reset`. Por isso, NENHUM
-- backfill heurístico de reenvios históricos é inventado aqui — seria
-- exatamente o tipo de suposição não verificável que motivou esta
-- correção em primeiro lugar. A coluna nasce nullable, sem DEFAULT
-- explícito: toda linha pré-existente (nesta migration, nenhuma real)
-- receberia NULL automaticamente, que também é a leitura mais
-- conservadora possível ("proveniência desconhecida" nunca deve virar
-- "não é reenvio" nem "é reenvio de X" por adivinhação).

alter table public.invites
  add column supersedes_invite_id uuid references public.invites(id) on delete restrict;

alter table public.invites
  add constraint invites_supersedes_not_self_ck check (supersedes_invite_id is distinct from id);

create unique index invites_supersedes_invite_id_uidx
  on public.invites (supersedes_invite_id)
  where supersedes_invite_id is not null;

-- ═══════════════════════════════════════════════════════════════════════
-- create_invite() — CREATE OR REPLACE: só remove a auditoria prematura
-- ═══════════════════════════════════════════════════════════════════════
-- ÚNICA mudança de comportamento em relação à versão do S4-A2A: a
-- inserção de audit_log (action='invite_sent', result='success') que
-- acontecia logo após o INSERT bem-sucedido em invites foi REMOVIDA —
-- essa RPC nunca soube (nem podia saber, é banco puro) se o Supabase
-- Auth de fato enviaria o e-mail depois. Registrar 'success' ali era
-- literalmente afirmar um envio que ainda nem foi tentado. Essa auditoria
-- passa a ser responsabilidade EXCLUSIVA da finalização de entrega
-- (complete_invite_resend_delivery, para reenvio; complete_invite_delivery
-- para criação, NÃO implementada nesta etapa — ver bloco de comentário
-- mais abaixo). Nome, argumentos, retorno, ACL, SECURITY DEFINER,
-- search_path, autorização, validações, 7 dias e atomicidade permanecem
-- IDÊNTICOS à versão anterior — só a etapa 7 (antigo "sucesso") muda: a
-- linha nasce com delivery_status='not_sent' (default da coluna, nenhuma
-- mudança na lista de colunas do INSERT) e a função RETORNA sucesso
-- normalmente (criar a linha continua sendo, em si, uma operação bem-
-- sucedida do ponto de vista desta RPC), só sem gravar audit_log ainda.

create or replace function public.create_invite(
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

  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);

  -- ── 2. capacidade do ator (nunca lê profiles.role) ──────────────────
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

  -- ── 6. inserção (duplicidade/token tratados como falha de domínio) ──
  -- supersedes_invite_id explicitamente NULL: create_invite() nunca cria
  -- um convite que substitui outro — isso é exclusividade de
  -- resend_invite(). Não é parâmetro aceito de fora (não há p_supersedes_
  -- invite_id nesta assinatura), então não há como um chamador escolher
  -- a proveniência.
  begin
    insert into public.invites
      (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id, supersedes_invite_id)
    values
      (p_company_id, p_email, p_name, p_role_kind, p_token_hash, 'pending', v_expires_at, p_actor_profile_id, null)
    returning id into v_invite_id;
  exception
    when unique_violation then
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

  -- ── 7. linha criada — SEM auditoria de sucesso de envio ainda ───────
  -- delivery_status já nasce 'not_sent' (default da coluna). Nenhum
  -- audit_log é gravado aqui — a criação da linha em si não é mentira
  -- nenhuma (ela realmente foi criada), só o antigo registro de
  -- "invite_sent success" é que afirmava, incorretamente, que o e-mail
  -- também já tinha sido enviado. O retorno da RPC continua o mesmo:
  -- criar a linha é, por si só, uma operação bem-sucedida.
  return query select true, 'ok'::text, v_invite_id, 'pending'::public.invite_status, v_expires_at;
end;
$$;

revoke all on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) from public;
revoke all on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) from anon;
revoke all on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) from authenticated;
grant execute on function public.create_invite(uuid, uuid, text, text, public.invite_role_kind, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- resend_invite() — CREATE OR REPLACE: só remove a auditoria prematura
-- ═══════════════════════════════════════════════════════════════════════
-- Mesma mudança única: a inserção de audit_log (action='invite_resent',
-- result='success') do antigo passo 9 foi REMOVIDA. O convite antigo
-- continua virando 'superseded' exatamente como antes (nenhuma mudança
-- de coluna nem de comportamento ali); o novo convite nasce
-- delivery_status='not_sent' (default da coluna, INSERT inalterado).
-- Nenhuma restauração do convite antigo em nenhum caminho. Falhas de
-- domínio continuam auditadas exatamente como antes (nenhuma mudança).

create or replace function public.resend_invite(
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
begin
  -- ── 1. ator: existe, está ativo, tem ALGUMA capacidade administrativa ─
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

  -- ── 3. autorização sobre ESTA linha específica ──────────────────────
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

  -- ── 8. supersede + novo convite, atômico via savepoint implícito ────
  v_before := jsonb_build_object('previous_invite_id', v_old.id, 'status', v_old.status, 'expires_at', v_old.expires_at);

  begin
    update public.invites i
       set status = 'superseded'
     where i.id = v_old.id
       and i.status in ('pending', 'expired');

    if not found then
      raise exception using errcode = 'P0001', message = 'invite_state_changed';
    end if;

    -- supersedes_invite_id = v_old.id, gravado internamente pelo banco —
    -- é a fonte de verdade que complete_invite_resend_delivery() valida
    -- depois; nenhum chamador de resend_invite() escolhe nem influencia
    -- este valor (não é parâmetro desta função).
    insert into public.invites
      (company_id, email, name, role_kind, token_hash, status, expires_at, invited_by_profile_id, supersedes_invite_id)
    values
      (v_old.company_id, v_old.email, v_old.name, v_old.role_kind, p_token_hash, 'pending', v_expires_at, v_old.invited_by_profile_id, v_old.id)
    returning id into v_new_id;
  exception
    when unique_violation then
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

  -- ── 9. novo convite preparado — SEM auditoria de sucesso de envio
  --      ainda. A entrega ainda não aconteceu; complete_invite_resend_
  --      delivery() é quem grava invite_resent success/failure depois ──
  return query select true, 'ok'::text, v_new_id, v_old.id, 'pending'::public.invite_status, v_expires_at;
end;
$$;

revoke all on function public.resend_invite(uuid, uuid, text) from public;
revoke all on function public.resend_invite(uuid, uuid, text) from anon;
revoke all on function public.resend_invite(uuid, uuid, text) from authenticated;
grant execute on function public.resend_invite(uuid, uuid, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- complete_invite_delivery()
-- ═══════════════════════════════════════════════════════════════════════
-- CORREÇÃO DIRECIONADA (pós-auditoria): a lacuna que impediu esta função
-- de ser criada na primeira versão desta migration ("nenhum sinal seguro
-- de que este pending nasceu de create, não de resend") está fechada por
-- supersedes_invite_id (schema acima) — a fonte de verdade agora é a
-- própria linha: supersedes_invite_id IS NULL prova estruturalmente que
-- o convite nasceu de create_invite() (só essa RPC insere com esse valor
-- fixo em NULL; resend_invite() sempre grava o id do convite anterior).
-- Server-only (só service_role) — chamada pelo futuro Route Handler
-- (S4-B) depois de uma tentativa de envio do Supabase Auth para o
-- convite criado por create_invite().

create function public.complete_invite_delivery(
  p_actor_profile_id uuid,
  p_invite_id        uuid,
  p_success          boolean,
  p_error_code       text default null
) returns table (
  success boolean,
  code    text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor           public.profiles;
  v_is_super_admin  boolean;
  v_invite          public.invites;
  v_authorized      boolean := false;
  v_before          jsonb;
  v_after           jsonb;
begin
  -- ── 1. ator: existe, está ativo, tem ALGUMA capacidade administrativa ─
  select p.* into v_actor
    from public.profiles p
   where p.id = p_actor_profile_id
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);

  -- ── 2. localizar e travar o convite alvo ────────────────────────────
  select i.* into v_invite from public.invites i where i.id = p_invite_id for update;

  if v_invite.id is null then
    return query select false, 'invite_not_found'::text;
    return;
  end if;

  -- ── 3. autorização sobre ESTA linha específica — mesmo padrão de
  --      complete_invite_resend_delivery()/resend_invite() ─────────────
  if v_is_super_admin then
    v_authorized := true;
  elsif v_invite.company_id is not null then
    v_authorized := coalesce(
      exists (
        select 1 from public.company_memberships cm
         where cm.profile_id = p_actor_profile_id
           and cm.company_id = v_invite.company_id
           and cm.role = 'manager'
           and cm.is_active
      ) and v_invite.invited_by_profile_id = p_actor_profile_id,
      false
    );
  end if;

  if not v_authorized then
    return query select false, 'invite_not_found'::text;
    return;
  end if;

  -- ── 4. o convite precisa corresponder a uma CRIAÇÃO INICIAL, nunca a
  --      um reenvio — prova estrutural via supersedes_invite_id, não
  --      heurística. Um convite com supersedes_invite_id preenchido só
  --      pode ser finalizado por complete_invite_resend_delivery() ─────
  if v_invite.supersedes_invite_id is not null then
    return query select false, 'invalid_relationship'::text;
    return;
  end if;

  -- ── 5. estado exato esperado (pending + not_sent) — chamada duplicada
  --      e convite vencido são negados aqui ────────────────────────────
  if v_invite.status <> 'pending' or v_invite.delivery_status <> 'not_sent' then
    return query select false, 'invite_not_actionable'::text;
    return;
  end if;

  if v_invite.expires_at <= now() then
    return query select false, 'invite_not_actionable'::text;
    return;
  end if;

  -- ── 6. coerência do resultado informado ─────────────────────────────
  if p_success and p_error_code is not null then
    return query select false, 'invalid_input'::text;
    return;
  end if;

  if not p_success and (
    p_error_code is null
    or p_error_code not in ('auth_email_failed', 'auth_rate_limited', 'auth_unavailable', 'unexpected_delivery_error')
  ) then
    return query select false, 'invalid_input'::text;
    return;
  end if;

  v_before := jsonb_build_object('invite_id', v_invite.id, 'delivery_status', v_invite.delivery_status);

  -- ── 7. finalização — nunca lança exception para código de entrega
  --      conhecido ────────────────────────────────────────────────────
  if p_success then
    update public.invites
       set delivery_status = 'sent',
           delivery_attempted_at = now(),
           email_sent_at = now(),
           last_delivery_error_code = null
     where id = v_invite.id;

    v_after := jsonb_build_object('invite_id', v_invite.id, 'delivery_status', 'sent');

    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_invite.company_id, 'invite_sent', 'invite', v_invite.id::text, 'success', null, v_before, v_after, 'rpc');
  else
    update public.invites
       set delivery_status = 'failed',
           delivery_attempted_at = now(),
           email_sent_at = null,
           last_delivery_error_code = p_error_code
     where id = v_invite.id;

    v_after := jsonb_build_object('invite_id', v_invite.id, 'delivery_status', 'failed', 'error_code', p_error_code);

    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_invite.company_id, 'invite_sent', 'invite', v_invite.id::text, 'failure', p_error_code, v_before, v_after, 'rpc');
  end if;

  -- success=true aqui significa "a finalização em si foi aplicada
  -- corretamente" — não confundir com p_success (o resultado do envio
  -- que está sendo registrado), mesma convenção de
  -- complete_invite_resend_delivery().
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.complete_invite_delivery(uuid, uuid, boolean, text) from public;
revoke all on function public.complete_invite_delivery(uuid, uuid, boolean, text) from anon;
revoke all on function public.complete_invite_delivery(uuid, uuid, boolean, text) from authenticated;
grant execute on function public.complete_invite_delivery(uuid, uuid, boolean, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- complete_invite_resend_delivery()
-- ═══════════════════════════════════════════════════════════════════════
-- Server-only (só service_role) — chamada pelo futuro Route Handler
-- (S4-B) depois de uma tentativa de envio do Supabase Auth para o convite
-- NOVO criado por resend_invite(). p_previous_invite_id é o
-- previous_invite_id que o próprio resend_invite() já devolveu na mesma
-- operação — não é redescoberto aqui, é REVALIDADO.

create function public.complete_invite_resend_delivery(
  p_actor_profile_id    uuid,
  p_invite_id           uuid,
  p_previous_invite_id  uuid,
  p_success             boolean,
  p_error_code          text default null
) returns table (
  success boolean,
  code    text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      public.profiles;
  v_is_super_admin boolean;
  v_new        public.invites;
  v_old        public.invites;
  v_before     jsonb;
  v_after      jsonb;
begin
  -- ── 1. ator: existe, está ativo, tem ALGUMA capacidade administrativa ─
  select p.* into v_actor
    from public.profiles p
   where p.id = p_actor_profile_id
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);

  -- ── 2. localizar e travar o convite NOVO (o que recebeu a tentativa
  --      de entrega) ───────────────────────────────────────────────────
  select i.* into v_new from public.invites i where i.id = p_invite_id for update;

  if v_new.id is null then
    return query select false, 'invite_not_found'::text;
    return;
  end if;

  -- ── 3. autorização sobre a linha NOVA — mesmo padrão de resend_invite:
  --      Super Admin sempre; Manager só se membership ativa na mesma
  --      empresa E for o convidador ORIGINAL preservado (coalesce(...,
  --      false) obrigatório pelo mesmo motivo já documentado em
  --      resend_invite/cancel_invite: invited_by_profile_id é nullable) ─
  if not v_is_super_admin then
    if v_new.company_id is null then
      raise insufficient_privilege using message = 'forbidden';
    end if;
    if not coalesce(
      exists (
        select 1 from public.company_memberships cm
         where cm.profile_id = p_actor_profile_id
           and cm.company_id = v_new.company_id
           and cm.role = 'manager'
           and cm.is_active
      ) and v_new.invited_by_profile_id = p_actor_profile_id,
      false
    ) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  -- ── 4. o convite novo precisa estar no estado exato esperado
  --      (pending + not_sent) — chamada duplicada é negada aqui ────────
  if v_new.status <> 'pending' or v_new.delivery_status <> 'not_sent' then
    return query select false, 'invite_not_actionable'::text;
    return;
  end if;

  -- ── 5. localizar o convite ANTERIOR e validar a relação REAL entre
  --      as duas linhas ────────────────────────────────────────────────
  -- CORREÇÃO DIRECIONADA (pós-auditoria): a checagem antiga (empresa/
  -- e-mail/papel/status/ordem temporal) era uma HEURÍSTICA — validava
  -- COMPATIBILIDADE, nunca prova de que o convite novo foi de fato
  -- gerado a partir de p_previous_invite_id. Um convite C criado de
  -- forma totalmente independente (create_invite() honesto, meses
  -- depois) para o mesmo e-mail/empresa/papel de um convite A há muito
  -- superseded por OUTRA cadeia de reenvio passava por essa heurística
  -- sem nenhuma relação real com A. A fonte de verdade agora é a
  -- referência explícita gravada pelo próprio banco no momento da
  -- criação (supersedes_invite_id, nunca escolhida por quem chama) —
  -- checada abaixo como condição OBRIGATÓRIA, não mais como uma entre
  -- várias pistas. As demais checagens (empresa/e-mail/papel/ordem
  -- temporal) permanecem como defesa em profundidade — reforçam a mesma
  -- conclusão que a referência explícita já prova, nunca a substituem.
  if v_new.supersedes_invite_id is distinct from p_previous_invite_id then
    return query select false, 'invalid_relationship'::text;
    return;
  end if;

  select i.* into v_old from public.invites i where i.id = p_previous_invite_id;

  if v_old.id is null then
    return query select false, 'invite_not_found'::text;
    return;
  end if;

  if v_old.id = v_new.id then
    return query select false, 'invalid_relationship'::text;
    return;
  end if;

  if v_old.status <> 'superseded' then
    return query select false, 'invalid_relationship'::text;
    return;
  end if;

  -- created_at usa `>` (nunca `>=`): dentro de uma única transação
  -- (padrão de todo teste pgTAP deste projeto, e potencialmente de uma
  -- única chamada de função aninhada em produção), now() é CONGELADO no
  -- início da transação — old e new podem legitimamente ter o MESMO
  -- created_at. O que precisa ser estruturalmente impossível é o
  -- convite ANTERIOR ter sido criado ESTRITAMENTE DEPOIS do novo (`>`),
  -- nunca igual. Defesa em profundidade (não mais a única prova): com
  -- supersedes_invite_id já validado acima, estas 4 condições NUNCA
  -- deveriam falhar para um par (novo, anterior) legítimo — se falharem,
  -- é sinal de corrupção de dado mais grave que um simples erro de
  -- domínio (o índice único parcial de supersedes_invite_id já impede
  -- duas linhas apontarem para o mesmo anterior, e create_invite()/
  -- resend_invite() são as únicas 2 fontes de escrita em invites), mas a
  -- checagem continua aqui para nunca confiar cegamente em uma única
  -- coluna sem corroboração.
  if v_old.company_id is distinct from v_new.company_id
     or v_old.email_normalized is distinct from v_new.email_normalized
     or v_old.role_kind is distinct from v_new.role_kind
     or v_old.created_at > v_new.created_at
  then
    return query select false, 'invalid_relationship'::text;
    return;
  end if;

  -- ── 6. coerência do resultado informado ─────────────────────────────
  if p_success and p_error_code is not null then
    return query select false, 'invalid_input'::text;
    return;
  end if;

  if not p_success and (
    p_error_code is null
    or p_error_code not in ('auth_email_failed', 'auth_rate_limited', 'auth_unavailable', 'unexpected_delivery_error')
  ) then
    return query select false, 'invalid_input'::text;
    return;
  end if;

  v_before := jsonb_build_object(
    'previous_invite_id', v_old.id,
    'new_invite_id', v_new.id,
    'delivery_status', v_new.delivery_status
  );

  -- ── 7. finalização — nunca lança exception para código de entrega
  --      conhecido; nenhuma restauração do convite anterior em nenhum
  --      caminho; convite anterior permanece superseded sempre ─────────
  if p_success then
    update public.invites
       set delivery_status = 'sent',
           delivery_attempted_at = now(),
           email_sent_at = now(),
           last_delivery_error_code = null
     where id = v_new.id;

    v_after := jsonb_build_object(
      'previous_invite_id', v_old.id,
      'new_invite_id', v_new.id,
      'delivery_status', 'sent'
    );

    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_new.company_id, 'invite_resent', 'invite', v_new.id::text, 'success', null, v_before, v_after, 'rpc');
  else
    update public.invites
       set delivery_status = 'failed',
           delivery_attempted_at = now(),
           email_sent_at = null,
           last_delivery_error_code = p_error_code
     where id = v_new.id;

    v_after := jsonb_build_object(
      'previous_invite_id', v_old.id,
      'new_invite_id', v_new.id,
      'delivery_status', 'failed',
      'error_code', p_error_code
    );

    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (p_actor_profile_id, v_new.company_id, 'invite_resent', 'invite', v_new.id::text, 'failure', p_error_code, v_before, v_after, 'rpc');
  end if;

  -- success=true aqui significa "a finalização em si foi aplicada
  -- corretamente" — não confundir com p_success (o resultado do envio
  -- que está sendo registrado). Um envio que falhou (p_success=false)
  -- ainda assim é uma finalização bem-sucedida: o estado failed foi
  -- corretamente persistido e auditado, permitindo reenvio futuro.
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.complete_invite_resend_delivery(uuid, uuid, uuid, boolean, text) from public;
revoke all on function public.complete_invite_resend_delivery(uuid, uuid, uuid, boolean, text) from anon;
revoke all on function public.complete_invite_resend_delivery(uuid, uuid, uuid, boolean, text) from authenticated;
grant execute on function public.complete_invite_resend_delivery(uuid, uuid, uuid, boolean, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- public.invite_rate_limit_events — fundação de rate limit
-- ═══════════════════════════════════════════════════════════════════════
-- Tabela interna fechada, mesmo padrão de audit_log (S4-A1): RLS
-- habilitada, ZERO policy, ZERO grant para PUBLIC/anon/authenticated —
-- só acessível através de reserve_invite_rate_limit() (SECURITY DEFINER,
-- service_role), nunca por leitura/escrita direta, nem pelo frontend.
-- FKs com ON DELETE SET NULL (nunca CASCADE) — mesmo motivo de
-- audit_log: preservar o histórico de reservas mesmo que o profile ou a
-- empresa referenciados deixem de existir; esta tabela é ainda mais
-- efêmera que audit_log (eventos antigos podem ser podados no futuro,
-- otimização não implementada aqui), então RESTRICT (como invites.
-- company_id) não se justifica — nada aqui precisa da garantia "nunca
-- apagado" que motivou aquela exceção específica.

create table public.invite_rate_limit_events (
  id                uuid primary key default gen_random_uuid(),
  actor_profile_id  uuid references public.profiles(id) on delete set null,
  company_id        uuid references public.companies(id) on delete set null,
  email_normalized  text not null,
  operation         text not null,
  occurred_at       timestamptz not null default now(),

  constraint invite_rate_limit_events_email_not_blank_ck check (btrim(email_normalized) <> ''),
  constraint invite_rate_limit_events_operation_ck check (operation in ('create', 'resend'))
);

create index invite_rate_limit_events_actor_occurred_idx
  on public.invite_rate_limit_events (actor_profile_id, occurred_at);
create index invite_rate_limit_events_email_scope_occurred_idx
  on public.invite_rate_limit_events (email_normalized, company_id, occurred_at);

alter table public.invite_rate_limit_events enable row level security;

revoke all on public.invite_rate_limit_events from public;
revoke all on public.invite_rate_limit_events from anon;
revoke all on public.invite_rate_limit_events from authenticated;
-- Nenhum GRANT para service_role na TABELA — o acesso é exclusivamente
-- através da função abaixo (SECURITY DEFINER, dona postgres), que já
-- bypassa RLS/grants de tabela como owner. service_role não precisa
-- (e não deve) ler/escrever esta tabela diretamente.

-- ═══════════════════════════════════════════════════════════════════════
-- reserve_invite_rate_limit()
-- ═══════════════════════════════════════════════════════════════════════
-- Server-only. Reserva atômica: conta as duas janelas (ator/15min,
-- e-mail+escopo/24h) e só insere o evento se AMBAS permitirem — tudo na
-- MESMA transação da chamada, com dois advisory locks transacionais
-- (pg_advisory_xact_lock, liberados automaticamente no fim da transação,
-- sem necessidade de unlock manual) que serializam tentativas
-- concorrentes pelo MESMO ator e pelo MESMO e-mail+escopo.
--
-- ORDEM DOS LOCKS (sempre a mesma, em toda chamada, sem exceção): 1º
-- lock do ator, 2º lock do e-mail+escopo. Como a ordem é fixa e nunca
-- invertida por nenhum caminho de código desta função, duas chamadas
-- concorrentes NUNCA podem formar um ciclo de espera (pré-requisito de
-- deadlock) — deadlock em locks exigiria que alguma chamada adquirisse
-- os mesmos dois recursos em ordem invertida, o que esta função nunca
-- faz.
--
-- CHAVES DOS LOCKS: hashtextextended(texto, 0) — bigint de 64 bits,
-- prefixado por 'rate_limit_actor:'/'rate_limit_email:' para nunca
-- colidir estruturalmente um tipo de lock com o outro. Uma colisão de
-- hash ENTRE duas chaves do mesmo tipo (ex.: dois atores diferentes
-- mapeando para o mesmo bigint) é teoricamente possível mas
-- astronomicamente improvável (64 bits) — e mesmo que ocorresse, o pior
-- efeito seria serialização desnecessária entre dois atores/e-mails não
-- relacionados (perda de paralelismo), NUNCA uma contagem incorreta: a
-- contagem real sempre vem de um SELECT COUNT(*) genuíno na tabela,
-- nunca do lock em si.
--
-- GARANTIA ESTRUTURAL vs. TESTE REAL: os testes pgTAP abaixo (arquivo 24)
-- só conseguem provar o comportamento SEQUENCIALMENTE (uma única conexão
-- — pgTAP não abre duas transações simultâneas). A atomicidade sob
-- concorrência REAL (duas conexões/duas transações verdadeiramente
-- simultâneas) é garantida pelo mecanismo em si (advisory lock
-- transacional + contagem e inserção na mesma transação), não por um
-- teste que a exercite de fato — mesma limitação já documentada e aceita
-- em resend_invite()/cancel_invite() (S4-A2A) para SELECT ... FOR UPDATE.

create function public.reserve_invite_rate_limit(
  p_actor_profile_id uuid,
  p_company_id       uuid,
  p_email            text,
  p_operation        text
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
  v_email_normalized   text;
  v_actor_count        int;
  v_email_count        int;
  v_oldest_actor       timestamptz;
  v_oldest_email       timestamptz;
begin
  -- ── 1. ator precisa existir e estar ativo (mesma checagem de
  --      capacidade mínima das outras RPCs server-only) ────────────────
  select p.* into v_actor
    from public.profiles p
   where p.id = p_actor_profile_id
     and p.is_active;

  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- ── 2. validação de entrada (domínio, não autorização) ──────────────
  if p_operation is null or p_operation not in ('create', 'resend') then
    return query select false, 'invalid_operation'::text, null::integer;
    return;
  end if;

  v_email_normalized := lower(btrim(coalesce(p_email, '')));
  if v_email_normalized = '' then
    return query select false, 'invalid_input'::text, null::integer;
    return;
  end if;

  -- ── 3. locks transacionais — sempre ator primeiro, e-mail+escopo
  --      depois, nesta ordem fixa (ver comentário acima sobre deadlock) ─
  perform pg_advisory_xact_lock(hashtextextended('rate_limit_actor:' || p_actor_profile_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('rate_limit_email:' || coalesce(p_company_id::text, 'platform') || ':' || v_email_normalized, 0));

  -- ── 4. janela do ator: create + resend contam juntos, 20 em 15 min ──
  select count(*), min(occurred_at)
    into v_actor_count, v_oldest_actor
    from public.invite_rate_limit_events e
   where e.actor_profile_id = p_actor_profile_id
     and e.occurred_at > now() - interval '15 minutes';

  if v_actor_count >= 20 then
    return query select
      false,
      'actor_rate_limited'::text,
      greatest(1, ceil(extract(epoch from (v_oldest_actor + interval '15 minutes' - now()))))::integer;
    return;
  end if;

  -- ── 5. janela de e-mail+escopo: 3 em 24h — company_id null é o
  --      escopo de plataforma, isolado do escopo de qualquer empresa
  --      real (IS NOT DISTINCT FROM trata NULL corretamente) ──────────
  select count(*), min(occurred_at)
    into v_email_count, v_oldest_email
    from public.invite_rate_limit_events e
   where e.email_normalized = v_email_normalized
     and e.company_id is not distinct from p_company_id
     and e.occurred_at > now() - interval '24 hours';

  if v_email_count >= 3 then
    return query select
      false,
      'email_scope_rate_limited'::text,
      greatest(1, ceil(extract(epoch from (v_oldest_email + interval '24 hours' - now()))))::integer;
    return;
  end if;

  -- ── 6. permitido — só agora o evento é inserido ─────────────────────
  insert into public.invite_rate_limit_events (actor_profile_id, company_id, email_normalized, operation)
  values (p_actor_profile_id, p_company_id, v_email_normalized, p_operation);

  return query select true, 'ok'::text, 0;
end;
$$;

revoke all on function public.reserve_invite_rate_limit(uuid, uuid, text, text) from public;
revoke all on function public.reserve_invite_rate_limit(uuid, uuid, text, text) from anon;
revoke all on function public.reserve_invite_rate_limit(uuid, uuid, text, text) from authenticated;
grant execute on function public.reserve_invite_rate_limit(uuid, uuid, text, text) to service_role;

commit;
