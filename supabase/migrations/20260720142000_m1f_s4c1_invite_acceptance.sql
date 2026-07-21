-- M1-F / Módulo 1 — m1f_s4c1: validação não destrutiva e aceite de
-- convites (banco apenas)
-- Fonte: levantamento M1-F S4-C E0 + correções arquiteturais congeladas
-- pelo usuário antes da implementação (token bruto NUNCA entra no banco;
-- validate_invite_token()/accept_invite() recebem só o hash SHA-256, já
-- calculado pelo futuro Route Handler; validate_invite_token() é
-- server-only, nunca pública para anon/authenticated — o futuro endpoint
-- HTTP é a única superfície suportada e aplica rate limit ANTES de
-- validar).
--
-- ESCOPO ESTRITO (S4-C1, banco apenas): tabela de rate limit de
-- ativação (validate/accept), reserve_invite_validation_rate_limit(),
-- validate_invite_token(), accept_invite(). Fora de escopo,
-- propositalmente: Route Handler, página /convite/aceitar, verifyOtp,
-- definição de senha, qualquer chamada a auth.admin, qualquer alteração
-- em create_invite()/resend_invite()/cancel_invite()/complete_invite_
-- delivery()/complete_invite_resend_delivery()/reserve_invite_rate_limit()/
-- reserve_create_invite_rate_limit()/reserve_resend_invite_rate_limit()
-- (todas intocadas nesta migration).
--
-- Depende de m1b, m1c_01, m1e_01/02/03, m1f_s1_01/02, m1f_s2_01/015/02,
-- m1f_s11, m1f_s3a, m1f_s4a1, m1f_s4a2a, m1f_s4a2a1, m1f_s4a2b1.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- public.invite_activation_rate_limit_events
-- ═══════════════════════════════════════════════════════════════════════
-- Tabela interna fechada, mesmo padrão de invite_rate_limit_events
-- (S4-A2A.1): RLS habilitada, ZERO policy, ZERO grant para PUBLIC/anon/
-- authenticated/service_role — só acessível através das duas funções
-- abaixo (SECURITY DEFINER, dona postgres, que bypassam RLS/grants de
-- tabela como owner).
--
-- `key_hash` é a chave de bucket usada pelas 2 dimensões que NÃO têm um
-- identificador natural em outra tabela (`validate_ip`: hash do IP
-- calculado pelo futuro Route Handler, NUNCA o IP bruto; `validate_token`:
-- o próprio token_hash já recebido). `invite_id`/`actor_profile_id` são
-- preenchidos ADICIONALMENTE (nunca em vez de `key_hash`, que continua
-- sendo a chave de contagem para as 4 dimensões, inclusive
-- `accept_actor`/`accept_invite` — key_hash = actor_profile_id::text /
-- invite_id::text nesses dois casos) só para permitir referência/join
-- direto sem re-parsear texto, com FKs ON DELETE SET NULL (mesmo motivo
-- de audit_log/invite_rate_limit_events: preservar o histórico de
-- reservas mesmo que o profile/convite referenciado deixe de existir).
--
-- `actor_profile_id` referencia auth.users(id), NUNCA public.profiles(id)
-- (achado real durante a validação empírica desta migration): a reserva
-- de rate limit do aceite acontece ANTES do provisionamento (§9 do
-- congelamento arquitetural) — um convidado NOVO, no exato momento da
-- primeira reserva, ainda não tem nenhuma linha em public.profiles (é
-- precisamente o que accept_invite() está prestes a criar). Uma FK para
-- public.profiles(id) rejeitaria a inserção do evento de rate limit
-- exatamente no caminho mais comum (usuário novo aceitando o próprio
-- convite pela primeira vez) — comprovado com um erro de FK real durante
-- o smoke test manual desta etapa. auth.uid() sempre corresponde a uma
-- linha real de auth.users (é a garantia da própria sessão autenticada),
-- então essa é a única referência que nunca falha estruturalmente aqui.
create table public.invite_activation_rate_limit_events (
  id                uuid primary key default gen_random_uuid(),
  dimension         text not null,
  key_hash          text not null,
  invite_id         uuid references public.invites(id) on delete set null,
  actor_profile_id  uuid references auth.users(id) on delete set null,
  occurred_at       timestamptz not null default now(),

  constraint invite_activation_rate_limit_events_dimension_ck check (
    dimension in ('validate_ip', 'validate_token', 'accept_actor', 'accept_invite')
  ),
  constraint invite_activation_rate_limit_events_key_hash_not_blank_ck check (btrim(key_hash) <> '')
);

create index invite_activation_rate_limit_events_dimension_key_occurred_idx
  on public.invite_activation_rate_limit_events (dimension, key_hash, occurred_at);
create index invite_activation_rate_limit_events_invite_id_idx
  on public.invite_activation_rate_limit_events (invite_id)
  where invite_id is not null;
create index invite_activation_rate_limit_events_actor_profile_id_idx
  on public.invite_activation_rate_limit_events (actor_profile_id)
  where actor_profile_id is not null;

alter table public.invite_activation_rate_limit_events enable row level security;

revoke all on public.invite_activation_rate_limit_events from public;
revoke all on public.invite_activation_rate_limit_events from anon;
revoke all on public.invite_activation_rate_limit_events from authenticated;
-- Nenhum GRANT para service_role na TABELA — mesmo padrão de
-- invite_rate_limit_events: o acesso é exclusivamente através das funções
-- abaixo (SECURITY DEFINER, dona postgres); service_role não precisa (e
-- não deve) ler/escrever esta tabela diretamente.

-- ═══════════════════════════════════════════════════════════════════════
-- reserve_invite_validation_rate_limit()
-- ═══════════════════════════════════════════════════════════════════════
-- Server-only. O futuro Route Handler chama esta função ANTES de
-- validate_invite_token() — validate_invite_token() não aplica rate
-- limit sozinha (comentário próximo a ela, abaixo, documenta essa
-- fronteira). Nunca recebe IP bruto: p_ip_hash já é um hash calculado
-- pelo Route Handler (mesmo algoritmo/formato de token_hash — hex
-- minúsculo de 64 caracteres — para reaproveitar a mesma validação de
-- formato e o mesmo espaço de chaves de lock).
--
-- Locks em ordem fixa (1º IP, 2º token) — mesmo raciocínio anti-deadlock
-- de reserve_invite_rate_limit() (S4-A2A.1): como a ordem nunca se
-- inverte, duas chamadas concorrentes nunca formam um ciclo de espera.
create function public.reserve_invite_validation_rate_limit(
  p_ip_hash     text,
  p_token_hash  text
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
  v_ip_count      int;
  v_token_count   int;
  v_oldest_ip     timestamptz;
  v_oldest_token  timestamptz;
begin
  -- ── 1. validação de formato (domínio, não autorização — não há ator
  --      autenticado nesta etapa) ─────────────────────────────────────
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 'invalid_input'::text, null::integer;
    return;
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 'invalid_input'::text, null::integer;
    return;
  end if;

  -- ── 2. locks transacionais — sempre IP primeiro, token depois ───────
  perform pg_advisory_xact_lock(hashtextextended('invite_validate_ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('invite_validate_token:' || p_token_hash, 0));

  -- ── 3. janela por IP: 30 em 15 min ───────────────────────────────────
  select count(*), min(occurred_at)
    into v_ip_count, v_oldest_ip
    from public.invite_activation_rate_limit_events e
   where e.dimension = 'validate_ip'
     and e.key_hash = p_ip_hash
     and e.occurred_at > now() - interval '15 minutes';

  if v_ip_count >= 30 then
    return query select
      false,
      'ip_rate_limited'::text,
      greatest(1, ceil(extract(epoch from (v_oldest_ip + interval '15 minutes' - now()))))::integer;
    return;
  end if;

  -- ── 4. janela por token_hash: 5 em 15 min ───────────────────────────
  select count(*), min(occurred_at)
    into v_token_count, v_oldest_token
    from public.invite_activation_rate_limit_events e
   where e.dimension = 'validate_token'
     and e.key_hash = p_token_hash
     and e.occurred_at > now() - interval '15 minutes';

  if v_token_count >= 5 then
    return query select
      false,
      'token_rate_limited'::text,
      greatest(1, ceil(extract(epoch from (v_oldest_token + interval '15 minutes' - now()))))::integer;
    return;
  end if;

  -- ── 5. permitido — só agora os eventos são inseridos ────────────────
  insert into public.invite_activation_rate_limit_events (dimension, key_hash)
  values ('validate_ip', p_ip_hash);
  insert into public.invite_activation_rate_limit_events (dimension, key_hash)
  values ('validate_token', p_token_hash);

  return query select true, 'ok'::text, 0;
end;
$$;

revoke all on function public.reserve_invite_validation_rate_limit(text, text) from public;
revoke all on function public.reserve_invite_validation_rate_limit(text, text) from anon;
revoke all on function public.reserve_invite_validation_rate_limit(text, text) from authenticated;
grant execute on function public.reserve_invite_validation_rate_limit(text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- validate_invite_token()
-- ═══════════════════════════════════════════════════════════════════════
-- FRONTEIRA CONGELADA: esta função NÃO aplica rate limit sozinha — o
-- futuro Route Handler é OBRIGADO a chamar
-- reserve_invite_validation_rate_limit() antes de chamar esta função.
-- Nunca faz UPDATE (validação puramente de leitura). Nunca recebe token
-- bruto — só o hash SHA-256 já calculado pelo servidor.
create function public.validate_invite_token(
  p_token_hash text
) returns table (
  valid         boolean,
  code          text,
  masked_email  text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite       public.invites;
  v_company      public.companies;
  v_masked_email text;
  v_at_pos       int;
begin
  -- ── 1. formato do hash ───────────────────────────────────────────────
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 'invalid_token_hash'::text, null::text;
    return;
  end if;

  -- ── 2. localizar o convite (SEM lock — validação não destrutiva,
  --      nunca concorre por escrita com create/resend/accept/cancel) ───
  select i.* into v_invite from public.invites i where i.token_hash = p_token_hash;

  if v_invite.id is null then
    return query select false, 'invite_not_found'::text, null::text;
    return;
  end if;

  -- ── 3. status — canceled/superseded/accepted nunca são "válidos para
  --      continuar", mensagem genérica ao usuário final em qualquer caso ─
  if v_invite.status = 'accepted' then
    return query select false, 'invite_already_used'::text, null::text;
    return;
  end if;

  if v_invite.status in ('canceled', 'superseded') then
    return query select false, 'invite_not_actionable'::text, null::text;
    return;
  end if;

  -- ── 4. expiração — leitura pura, NUNCA materializa a transição
  --      preguiçosa (isso continua exclusividade de resend_invite()) ────
  if v_invite.expires_at <= now() then
    return query select false, 'invite_expired'::text, null::text;
    return;
  end if;

  -- ── 5. entrega — só um convite que a Admin API aceitou enviar pode
  --      ser continuado (not_sent/failed nunca são "prontos") ──────────
  if v_invite.delivery_status <> 'sent' then
    return query select false, 'invite_not_actionable'::text, null::text;
    return;
  end if;

  -- ── 6. empresa operacional (convite empresarial) — proveniência
  --      (supersedes_invite_id) não altera validade, de propósito: um
  --      convite de resend válido é tão válido quanto um de create ─────
  if v_invite.company_id is not null then
    select c.* into v_company from public.companies c where c.id = v_invite.company_id;

    if v_company.id is null or v_company.status not in ('implantacao', 'ativa') then
      return query select false, 'company_not_operational'::text, null::text;
      return;
    end if;
  end if;

  -- ── 7. válido — e-mail mascarado SOMENTE aqui (valid=true) ──────────
  v_at_pos := position('@' in v_invite.email_normalized);
  if v_at_pos > 1 then
    v_masked_email := left(v_invite.email_normalized, 1) || '***' || substring(v_invite.email_normalized from v_at_pos);
  else
    -- defesa: invites.email não tem CHECK de formato (só não-branco) —
    -- se algum dia existir uma linha sem '@', nunca vaza o valor cru.
    v_masked_email := '***';
  end if;

  return query select true, 'ok'::text, v_masked_email;
end;
$$;

revoke all on function public.validate_invite_token(text) from public;
revoke all on function public.validate_invite_token(text) from anon;
revoke all on function public.validate_invite_token(text) from authenticated;
grant execute on function public.validate_invite_token(text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- accept_invite()
-- ═══════════════════════════════════════════════════════════════════════
-- Único caminho que efetivamente consome um convite. Ator SEMPRE
-- auth.uid() — nunca parâmetro. GRANT EXECUTE só para `authenticated`
-- (nunca `anon`, nunca `service_role` — diferente de create_invite()/
-- resend_invite(), esta RPC é pública comum, mesmo padrão de
-- cancel_invite()). Recebe SÓ o hash — nunca o token bruto.
--
-- Rate limit embutido NA PRÓPRIA função (diferente do padrão reserve_*
-- separado de create/resend): não há um Route Handler intermediário
-- reservando antes de chamar accept_invite() — é uma única RPC pública
-- chamada direto pelo cliente autenticado, então ela mesma precisa ser a
-- única linha de defesa contra chamada repetida direta.
create function public.accept_invite(
  p_token_hash text
) returns table (
  success              boolean,
  code                 text,
  invite_id            uuid,
  company_id           uuid,
  role_kind            public.invite_role_kind,
  retry_after_seconds  integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id            uuid := auth.uid();
  -- actor_profile_id em audit_log tem FK para public.profiles(id) (S4-A1,
  -- migration publicada, não alterável aqui) — válido para create_invite/
  -- resend_invite/cancel_invite/complete_invite_*() porque o ator dessas
  -- RPCs é sempre um administrador com profile já existente. accept_invite()
  -- quebra essa premissa: o convidado pode ser um usuário NOVO sem
  -- NENHUMA linha em profiles no momento de qualquer falha de domínio —
  -- e mesmo para falhas capturadas DENTRO do bloco de provisionamento
  -- (passo 8), um profile inserido ali é desfeito pelo rollback implícito
  -- do savepoint do BEGIN/EXCEPTION antes do audit_log ser gravado.
  -- Calculado UMA VEZ aqui, ANTES de qualquer tentativa de provisionamento
  -- — por isso reflete corretamente "existia profile para este ator ANTES
  -- desta chamada" em todos os caminhos de falha, inclusive os que
  -- capturam uma exceção depois de um INSERT em profiles já revertido.
  -- Nunca usado no INSERT de sucesso (linha final) — ali o profile já
  -- está garantidamente commitado dentro da mesma transação, então
  -- v_actor_id é usado diretamente. Comprovado empiricamente: sem esta
  -- correção, qualquer falha de domínio para um convidado novo violava
  -- audit_log_actor_profile_id_fkey e derrubava a função inteira com uma
  -- exceção não tratada, em vez de devolver um código de domínio limpo.
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
  -- ── 1. sessão autenticada obrigatória — falha estrutural, ZERO
  --      audit_log (mesmo padrão de "ator inexistente" nas outras RPCs) ─
  if v_actor_id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- calculado uma única vez, antes de qualquer tentativa de
  -- provisionamento — ver comentário completo na declaração da variável.
  select id into v_audit_actor_id from public.profiles where id = v_actor_id;

  -- ── 2. formato do hash (domínio, não estrutural) ────────────────────
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, null, 'invite_accepted', 'invite', v_attempt_id::text, 'failure', 'invalid_token_hash', null, null, 'rpc');
    return query select false, 'invalid_token_hash'::text, null::uuid, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  -- ── 3. localizar o convite (SEM lock ainda — só para derivar
  --      invite_id antes de decidir se reserva o rate limit; "somente
  --      tentativas que possuem convite existente entram na reserva") ──
  select i.* into v_invite_lookup from public.invites i where i.token_hash = p_token_hash;

  if v_invite_lookup.id is null then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_audit_actor_id, null, 'invite_accepted', 'invite', v_attempt_id::text, 'failure', 'invite_not_found', null, null, 'rpc');
    return query select false, 'invite_not_found'::text, null::uuid, null::uuid, null::public.invite_role_kind, null::integer;
    return;
  end if;

  -- ── 4. rate limit embutido — locks em ordem fixa (1º ator, 2º
  --      convite), contagem e inserção na mesma transação, só allowed=true
  --      insere ─────────────────────────────────────────────────────────
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

  -- ── 5. lock real do convite (FOR UPDATE) — estado revalidado do zero
  --      a partir daqui; a leitura do passo 3 nunca é reutilizada como
  --      prova de validade ──────────────────────────────────────────────
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

  -- ── 6. identidade — e-mail autenticado (auth.users, autoritativo)
  --      precisa bater com o e-mail canônico do convite ─────────────────
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

  -- ── 7. identidade de profile — SEM sobrescrever dado existente ──────
  select p.* into v_profile from public.profiles p where p.id = v_actor_id;

  if v_profile.id is null then
    -- e-mail canônico já usado por OUTRO profile (id diferente) — falha
    -- fechado, nunca reassocia/apaga/atualiza o ID (mesma defesa de
    -- e-mail ambíguo já usada em create_invite/resend_invite, aqui
    -- aplicada à direção oposta: procurando conflito, não elegibilidade).
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

  -- ── 7b. RELAÇÃO platform_role × membership (correção pós-auditoria
  --       adversarial — comprovada empiricamente antes desta correção: um
  --       Super Admin conseguia aceitar um convite de manager/seller e
  --       acumular uma company_membership real além do platform_role já
  --       existente). Um profile já Super Admin nunca pode virar
  --       manager/seller por convite — a única forma de sair de
  --       Super Admin é uma ação administrativa separada (fora de
  --       escopo do S4-C1), nunca aceitando um convite operacional. ────
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

  -- ── 8. provisionamento — bloco único: qualquer falha aqui reverte
  --      profile/membership/seller juntos (savepoint implícito do
  --      BEGIN/EXCEPTION) ───────────────────────────────────────────────
  begin
    if v_profile.id is null then
      insert into public.profiles (id, company_id, name, email, role, is_active)
      values (
        v_actor_id,
        case when v_invite.role_kind = 'super_admin' then null else v_invite.company_id end,
        v_invite.name,
        v_auth_email,
        case v_invite.role_kind
          when 'manager' then 'manager'
          when 'seller' then 'seller'
          else 'seller' -- super_admin: coluna legada/deprecated, valor inofensivo (mesmo padrão já usado nas fixtures de teste 23-25)
        end::public.user_role,
        true
      );
    end if;

    if v_invite.role_kind = 'super_admin' then
      if coalesce((select p.platform_role from public.profiles p where p.id = v_actor_id) = 'super_admin', false) then
        raise exception using errcode = 'P0001', message = 'already_member';
      end if;

      -- REGRA CONGELADA (correção pós-auditoria): um usuário não pode
      -- operar simultaneamente como Super Admin global e membro ativo de
      -- empresa — comprovado empiricamente antes desta correção: um
      -- Manager ativo conseguia aceitar um convite de super_admin e
      -- acumular platform_role='super_admin' mantendo a membership
      -- operacional intacta. QUALQUER membership ativa (mesma empresa ou
      -- outra) bloqueia — nunca desativada automaticamente. Membership
      -- HISTÓRICA inativa nunca bloqueia (o histórico é preservado, não é
      -- um vínculo operacional atual).
      if exists (
        select 1 from public.company_memberships cm
         where cm.profile_id = v_actor_id
           and cm.is_active
      ) then
        raise exception using errcode = 'P0002', message = 'membership_conflict';
      end if;

      update public.profiles set platform_role = 'super_admin' where id = v_actor_id;

    else
      -- MANAGER ou SELLER: membership ativa já existente na MESMA
      -- empresa (qualquer papel) -> already_member; membership INATIVA
      -- na mesma empresa -> membership_conflict (nunca reativada
      -- automaticamente); membership ATIVA em OUTRA empresa ->
      -- membership_conflict (nunca desativada/transferida).
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

      -- SELLER: defesa contra linha órfã/histórica em public.sellers —
      -- sellers não tem UNIQUE(company_id, profile_id) e create_invite()
      -- só enxerga company_memberships, nunca sellers, então uma linha
      -- pré-existente não seria bloqueada na criação do convite.
      --
      -- MESMA empresa do convite: qualquer linha pré-existente (com ou
      -- sem membership_id) bloqueia incondicionalmente — nunca há
      -- "histórico válido" dentro da MESMA empresa, porque a checagem de
      -- already_member/membership_conflict acima já teria capturado
      -- qualquer company_membership real nessa empresa; uma linha sellers
      -- sobrevivendo sem membership correspondente na mesma empresa é
      -- sempre inconsistência, nunca histórico legítimo.
      if v_invite.role_kind = 'seller' and exists (
        select 1 from public.sellers s
         where s.profile_id = v_actor_id
           and s.company_id = v_invite.company_id
      ) then
        raise exception using errcode = 'P0003', message = 'provisioning_failed';
      end if;

      -- OUTRA empresa (correção pós-auditoria S4-C1.1 — comprovado
      -- empiricamente antes desta correção: um Seller órfão em OUTRA
      -- empresa, com membership_id NULL e zero company_membership
      -- correspondente, não bloqueava nada — o aceite criava uma SEGUNDA
      -- linha em sellers para o mesmo profile, uma órfã e uma válida).
      -- HISTÓRICO VÁLIDO (nunca bloqueia, nunca reutilizado/atualizado):
      -- só quando a linha aponta para uma company_memberships REAL,
      -- consistente em TODOS os campos (profile_id, company_id da
      -- própria linha sellers, role='seller') e INATIVA. Qualquer desvio
      -- disso — membership_id NULL, membership inexistente, profile_id/
      -- company_id/role divergente, ou membership ainda ATIVA (esse
      -- último caso já deveria ter sido barrado como membership_conflict
      -- mais acima, mas a checagem aqui é defesa em profundidade,
      -- nunca confia cegamente na ordem de execução anterior) — bloqueia
      -- com provisioning_failed, exigindo correção administrativa futura
      -- (fora de escopo desta etapa).
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
      -- Defesa em profundidade contra a corrida real (TOCTOU) entre a
      -- pré-checagem acima e este INSERT: mapeamento EXPLÍCITO e
      -- EXAUSTIVO das únicas constraints únicas relevantes de
      -- company_memberships/sellers. Constraint desconhecida NUNCA é
      -- mascarada como membership_conflict — propaga (RAISE), reverte a
      -- transação inteira e falha alto, mesmo padrão de create_invite()/
      -- resend_invite() (S4-A2A).
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

  -- ── 9. aceite — só agora, depois de todo o provisionamento bem-
  --      sucedido; WHERE defensivo repete a checagem de status (mesmo
  --      padrão de resend_invite()) ────────────────────────────────────
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

commit;
