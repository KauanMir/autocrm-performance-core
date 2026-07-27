-- M1-F S5-E1-A — backend seguro de alteração administrativa de e-mail
-- (design §22.7, decisões congeladas do S5-E0). Três funções SECURITY
-- DEFINER estreitas, cada uma com uma única responsabilidade:
--
--   get_auth_email_update_state(p_target_user_id, p_new_email):
--     leitura estreita de auth.users, EXCLUSIVA de service_role. Existe
--     porque a auditoria S5-E0 provou empiricamente (Supabase Auth/auth-js
--     2.110.1 local) que updateUserById() NÃO classifica de forma
--     confiável um conflito de e-mail (retorna AuthRetryableFetchError/500
--     genérico, indistinguível de falha de rede real) e que listUsers()
--     não tem filtro seguro por e-mail — a única forma segura de saber
--     "este e-mail já pertence a outro usuário do Auth?" é uma leitura
--     direta e estreita, nunca listagem, nunca revela QUEM é o dono.
--
--   get_profile_email_update_state(p_target_profile_id, p_new_email):
--     leitura estreita de profiles/company_memberships/companies,
--     EXCLUSIVA de service_role. Existe porque service_role, neste projeto,
--     NUNCA tem GRANT direto de SELECT/INSERT/UPDATE/DELETE em profiles/
--     companies/company_memberships (confirmado empiricamente durante a
--     implementação: só REFERENCES/TRIGGER/TRUNCATE por privilégio padrão
--     do Supabase — todo acesso, inclusive por service_role, passa por
--     função SECURITY DEFINER) — um SELECT direto do Route Handler via
--     createAdminClient() falharia com permission denied. Devolve
--     exatamente o necessário para a pré-validação do Route Handler ANTES
--     de tocar o Auth (existência/estado do alvo, e-mail atual em
--     profiles, empresa/membership, conflito de e-mail em profiles) —
--     nunca lista, nunca expõe outros profiles além do boolean de conflito.
--
--   commit_profile_email_update(p_target_profile_id, p_expected_email,
--   p_new_email):
--     escreve EXCLUSIVAMENTE profiles.email, chamada pelo Route Handler
--     como o ATOR real (auth.uid()), DEPOIS que auth.users já foi
--     atualizado com sucesso via createAdminClient().auth.admin.
--     updateUserById() (nunca aqui, nunca por SQL direto). Revalida toda a
--     autorização do zero (mesmo padrão de "reservar depois revalidar" já
--     usado por reserve_create_invite_rate_limit()/create_invite()) —
--     aceita uma pequena janela TOCTOU entre a pré-validação do Route
--     Handler e esta chamada, mas nunca confia nela sozinha.
--
-- Decisões congeladas (S5-E0, aprovadas explicitamente pelo usuário):
-- só Super Admin ativo altera e-mail de terceiros; nunca o próprio;
-- nunca outro Super Admin; divergência pré-existente entre profiles.email
-- e auth.users.email falha com user_email_state_conflict, nunca reconcilia
-- silenciosamente; nenhum e-mail completo em audit_log (before/after só
-- carregam {"changed": false/true}); nenhuma revogação de sessão (fora de
-- escopo, pertence ao S6); email_confirm=true é decisão do Route Handler
-- (chamada externa ao Auth), não desta migration.
begin;

-- ── 1. get_auth_email_update_state ───────────────────────────────────────
-- Leitura pura de auth.users — nunca escreve, nunca lista, nunca revela a
-- identidade do usuário que já possui o e-mail em conflito (só um boolean).
-- SECURITY DEFINER (owner postgres) é o único jeito de ler auth.users a
-- partir de uma chamada via PostgREST — mesmo mecanismo já usado por
-- accept_invite() (m1f_s4c1) para ler auth.users.email do ator.
create function public.get_auth_email_update_state(
  p_target_user_id uuid,
  p_new_email text
) returns table (
  current_email text,
  new_email_in_use boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current_email  text;
  v_new_normalized text;
  v_conflict       boolean;
begin
  if p_target_user_id is null then
    return query select null::text, false;
    return;
  end if;

  select u.email into v_current_email from auth.users u where u.id = p_target_user_id;

  v_new_normalized := lower(btrim(coalesce(p_new_email, '')));

  v_conflict := coalesce(
    (
      select true
        from auth.users u
       where u.id <> p_target_user_id
         and lower(u.email) = v_new_normalized
       limit 1
    ),
    false
  );

  return query select v_current_email, v_conflict;
end;
$$;

revoke all on function public.get_auth_email_update_state(uuid, text) from public;
revoke all on function public.get_auth_email_update_state(uuid, text) from anon;
revoke all on function public.get_auth_email_update_state(uuid, text) from authenticated;
grant execute on function public.get_auth_email_update_state(uuid, text) to service_role;

-- ── 2. get_profile_email_update_state ────────────────────────────────────
-- Leitura pura de profiles/company_memberships/companies. `new_email_in_use`
-- nunca revela QUEM já usa o e-mail — só o boolean. `profile_exists=false`
-- colapsa toda checagem de estado em falso/NULL (o Route Handler trata
-- isso como user_not_found, sem distinguir "nunca existiu" de "não tem
-- membership" — mesmo anti-enumeração já usado por update_profile_name).
create function public.get_profile_email_update_state(
  p_target_profile_id uuid,
  p_new_email text
) returns table (
  profile_exists boolean,
  profile_is_active boolean,
  platform_role public.platform_role,
  current_email text,
  company_id uuid,
  membership_is_active boolean,
  company_status public.company_status,
  new_email_in_use boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target          public.profiles;
  v_membership      public.company_memberships;
  v_company_status  public.company_status;
  v_new_normalized  text;
begin
  if p_target_profile_id is null then
    return query select false, null::boolean, null::public.platform_role, null::text, null::uuid, null::boolean, null::public.company_status, false;
    return;
  end if;

  select p.* into v_target from public.profiles p where p.id = p_target_profile_id;
  if v_target.id is null then
    return query select false, null::boolean, null::public.platform_role, null::text, null::uuid, null::boolean, null::public.company_status, false;
    return;
  end if;

  -- linha ativa é preferida; se não houver nenhuma ativa, cai na mais
  -- recente (mesma tolerância de update_profile_name, ramo Super Admin) —
  -- o Route Handler decide "user_inactive" a partir de membership_is_active,
  -- nunca a partir da ausência desta linha.
  select cm.* into v_membership
    from public.company_memberships cm
   where cm.profile_id = p_target_profile_id
   order by cm.is_active desc
   limit 1;

  if v_membership.id is not null then
    select c.status into v_company_status from public.companies c where c.id = v_membership.company_id;
  end if;

  v_new_normalized := lower(btrim(coalesce(p_new_email, '')));

  return query select
    true,
    v_target.is_active,
    v_target.platform_role,
    v_target.email,
    v_membership.company_id,
    v_membership.is_active,
    v_company_status,
    coalesce(
      (
        select true from public.profiles p2
         where p2.id <> p_target_profile_id and lower(p2.email) = v_new_normalized
         limit 1
      ),
      false
    );
end;
$$;

revoke all on function public.get_profile_email_update_state(uuid, text) from public;
revoke all on function public.get_profile_email_update_state(uuid, text) from anon;
revoke all on function public.get_profile_email_update_state(uuid, text) from authenticated;
grant execute on function public.get_profile_email_update_state(uuid, text) to service_role;

-- ── 3. commit_profile_email_update ───────────────────────────────────────
-- Altera EXCLUSIVAMENTE profiles.email. Compare-and-set explícito contra
-- p_expected_email (o valor que o Route Handler leu ANTES de chamar o
-- Auth) — nenhuma escrita silenciosa se o valor mudou entre a leitura e
-- esta chamada. Mesmo padrão de autorização de update_profile_name/
-- update_membership_role: tudo revalidado a partir de auth.uid(), nunca de
-- um parâmetro do cliente.
create function public.commit_profile_email_update(
  p_target_profile_id uuid,
  p_expected_email text,
  p_new_email text
) returns table (
  profile_id uuid,
  email text,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor               public.profiles;
  v_target              public.profiles;
  v_target_membership   public.company_memberships;
  v_expected_normalized text;
  v_new_normalized      text;
  v_before              jsonb;
  v_after               jsonb;
  v_updated_at          timestamptz;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  -- somente Super Admin ativo — nunca profiles.role/company_id do ator,
  -- nunca membership própria do ator como limitação (mesmo padrão de
  -- update_membership_role).
  select p.* into v_actor from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_actor.id is null or not coalesce(v_actor.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if p_target_profile_id is null then
    raise no_data_found using message = 'user_not_found';
  end if;

  -- decisão congelada S5-E0 #2: Super Admin nunca altera o próprio e-mail
  -- por este fluxo — bloqueio de autorização, não "não encontrado" (o
  -- ator já sabe que é ele mesmo, sem risco de enumeração).
  if p_target_profile_id = v_actor.id then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  select p.* into v_target from public.profiles p where p.id = p_target_profile_id for update;
  if v_target.id is null then
    raise no_data_found using message = 'user_not_found';
  end if;

  -- decisão congelada #: outro Super Admin nunca é alvo por este fluxo.
  if coalesce(v_target.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  select cm.* into v_target_membership
    from public.company_memberships cm
   where cm.profile_id = p_target_profile_id
   order by cm.is_active desc
   limit 1;

  if v_target_membership.id is null then
    raise no_data_found using message = 'user_not_found';
  end if;

  if not v_target.is_active
     or not v_target_membership.is_active
     or not public.can_access_company(v_target_membership.company_id) then
    raise using message = 'user_inactive';
  end if;

  v_expected_normalized := lower(btrim(coalesce(p_expected_email, '')));
  v_new_normalized := lower(btrim(coalesce(p_new_email, '')));

  if v_expected_normalized = '' or v_new_normalized = '' then
    raise invalid_parameter_value using message = 'invalid_email';
  end if;

  -- idempotência: o valor ATUAL (sob lock) já é o valor final desejado —
  -- sucesso sem escrita, sem auditoria, updated_at inalterado.
  if lower(v_target.email) = v_new_normalized then
    return query select v_target.id, v_target.email, v_target.updated_at;
    return;
  end if;

  -- compare-and-set: o valor atual (sob lock) precisa bater EXATAMENTE
  -- com o que o Route Handler leu antes de chamar o Auth — divergência
  -- aqui significa que outra operação alterou profiles.email no meio do
  -- caminho (ou que já havia divergência pré-existente entre profiles e
  -- Auth, que o Route Handler deveria ter barrado antes de chegar aqui;
  -- decisão congelada #7: nunca reconciliar, sempre falhar fechado).
  if lower(v_target.email) <> v_expected_normalized then
    raise using message = 'user_email_state_conflict';
  end if;

  -- defesa em profundidade: conflito de e-mail em profiles (o Route
  -- Handler já deveria ter barrado isso antes de tocar o Auth) — nunca
  -- confia cegamente, nunca deixa o unique index (profiles_email_idx)
  -- vazar um 23505 bruto.
  if exists (
    select 1 from public.profiles p
     where p.id <> p_target_profile_id and lower(p.email) = v_new_normalized
  ) then
    raise using message = 'email_already_in_use';
  end if;

  v_before := jsonb_build_object('changed', false);
  v_after := jsonb_build_object('changed', true);

  update public.profiles
     set email = p_new_email
   where id = v_target.id
  returning public.profiles.updated_at into v_updated_at;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_target_membership.company_id, 'user_email_updated', 'profile', v_target.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select v_target.id, p_new_email, v_updated_at;
end;
$$;

revoke all on function public.commit_profile_email_update(uuid, text, text) from public;
revoke all on function public.commit_profile_email_update(uuid, text, text) from anon;
grant execute on function public.commit_profile_email_update(uuid, text, text) to authenticated;

commit;
