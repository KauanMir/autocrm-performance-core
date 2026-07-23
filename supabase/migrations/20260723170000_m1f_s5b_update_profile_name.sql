-- M1-F S5-B — RPC estreita de edição de nome (§22.6/§22.9 do design,
-- docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md). Contrato fechado:
-- altera somente public.profiles.name. Nunca reutiliza profiles_update_admin
-- (removida em S5-A1) nem concede SELECT/UPDATE direto ao navegador — RPC
-- SECURITY DEFINER estreita, mesmo padrão de list_company_users (S5-A2).
--
-- Regras por ator (§22.2, refinadas aqui para esta RPC específica):
--   self (qualquer ator ativo, inclusive Super Admin sem membership):
--     sempre autorizado a editar o próprio nome.
--   Super Admin (não-self): pode editar qualquer profile com membership
--     ativa (qualquer papel, qualquer empresa não cancelada) — nunca lê
--     profiles.platform_role do alvo para decidir (mesma filosofia de
--     list_company_users: membership é a única autoridade operacional).
--   Manager (não-self): só edita Seller ativo da própria empresa — nunca
--     outro Manager, nunca outra empresa.
--   Seller (não-self): sempre forbidden — Seller não tem nenhuma
--     capacidade de editar terceiros.
--
-- Catálogo de erros e anti-enumeração — decisão de design registrada:
--   unauthenticated (28000) — auth.uid() nulo.
--   forbidden (42501) — ator sem profile/inativo; OU ator sem capacidade
--     alguma de editar terceiros (Seller); OU Manager tentando editar um
--     alvo que ele já teria visibilidade legítima de leitura (outro
--     Manager da própria empresa, via list_company_users) mas que a
--     política de escrita proíbe — não é "not found" porque o Manager já
--     sabe que essa pessoa existe.
--   profile_not_found (P0002) — alvo fora de qualquer escopo de
--     visibilidade legítima do ator: Manager mirando outra empresa (ou
--     perfil inexistente), ou Super Admin mirando um profile que nunca
--     teve nenhuma company_membership (não pode revelar se o profile_id é
--     só desconhecido ou de fato não elegível — mesmo código para ambos).
--   user_inactive (P0001) — alvo cuja EXISTÊNCIA o ator já tem base legítima
--     para conhecer (Super Admin: visibilidade global, qualquer membership
--     já resolvida; Manager: seller já visível na própria empresa), mas que
--     está inativo (profile ou membership) ou cuja empresa foi cancelada —
--     distinguir aqui não vaza nada além do que o ator já enxergaria via
--     list_company_users/conhecimento prévio do próprio escopo.
--   invalid_name (22023) — nome vazio após trim ou acima de 120 caracteres.
--
-- Nunca retorna erro bruto do Postgres (toda falha passa por uma destas
-- 5 mensagens de domínio).
begin;

create function public.update_profile_name(
  p_target_profile_id uuid,
  p_name text
) returns table (
  profile_id uuid,
  name text,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor              public.profiles;
  v_is_super_admin     boolean;
  v_is_self            boolean;
  v_manager_company_id uuid;
  v_target             public.profiles;
  v_target_membership  public.company_memberships;
  v_name_normalized    text;
  v_audit_company_id   uuid;
  v_before             jsonb;
  v_after              jsonb;
  v_updated_at         timestamptz;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  select p.* into v_actor from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_actor.id is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_is_super_admin := coalesce(v_actor.platform_role = 'super_admin', false);
  v_is_self := coalesce(p_target_profile_id = v_actor.id, false);

  -- capacidade do ator de sequer tentar editar UM TERCEIRO (antes de
  -- resolver o alvo em si) — Seller nunca passa daqui.
  if not v_is_self and not v_is_super_admin then
    v_manager_company_id := public.current_membership_company_id();
    if v_manager_company_id is null
       or public.current_membership_role() is distinct from 'manager'::public.company_role
       or not public.can_access_company(v_manager_company_id) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  -- trava a linha-alvo antes de ler o valor anterior (before/after da
  -- auditoria livre de corrida) — lock de linha, nunca de tabela inteira.
  select p.* into v_target from public.profiles p where p.id = p_target_profile_id for update;
  if v_target.id is null then
    raise no_data_found using message = 'profile_not_found';
  end if;

  if v_is_self then
    -- membership propria, se houver, so para preencher a empresa da
    -- auditoria — autorizacao em si nunca depende disso (§22.2: "a si
    -- proprio, mesmo sem membership").
    select cm.* into v_target_membership
      from public.company_memberships cm
     where cm.profile_id = v_actor.id and cm.is_active;
    v_audit_company_id := v_target_membership.company_id; -- NULL se nao houver

  elsif v_is_super_admin then
    -- visibilidade global: procura QUALQUER membership do alvo (ativa
    -- preferencialmente) em qualquer empresa — nunca le platform_role do
    -- alvo para autorizar.
    select cm.* into v_target_membership
      from public.company_memberships cm
     where cm.profile_id = p_target_profile_id
     order by cm.is_active desc
     limit 1;

    if v_target_membership.id is null then
      raise no_data_found using message = 'profile_not_found';
    end if;

    if not v_target.is_active
       or not v_target_membership.is_active
       or not public.can_access_company(v_target_membership.company_id) then
      raise using message = 'user_inactive';
    end if;

    v_audit_company_id := v_target_membership.company_id;

  else
    -- Manager: alvo precisa ter membership NA MESMA empresa do manager —
    -- nunca em outra (cross-tenant fica indistinguivel de "nao existe").
    select cm.* into v_target_membership
      from public.company_memberships cm
     where cm.profile_id = p_target_profile_id
       and cm.company_id = v_manager_company_id;

    if v_target_membership.id is null then
      raise no_data_found using message = 'profile_not_found';
    end if;

    -- outro Manager da mesma empresa: o ator ja tem visibilidade legitima
    -- dessa pessoa (list_company_users, leitura), entao "forbidden" (nao
    -- "not found") — nao ha vazamento, a existencia ja era conhecida.
    if v_target_membership.role is distinct from 'seller'::public.company_role then
      raise insufficient_privilege using message = 'forbidden';
    end if;

    if not v_target.is_active or not v_target_membership.is_active then
      raise using message = 'user_inactive';
    end if;

    v_audit_company_id := v_target_membership.company_id;
  end if;

  v_name_normalized := btrim(p_name);
  if v_name_normalized is null or v_name_normalized = '' or length(v_name_normalized) > 120 then
    raise invalid_parameter_value using message = 'invalid_name';
  end if;

  -- idempotencia: mesmo nome normalizado -> sucesso sem escrita, sem
  -- auditoria nova, updated_at inalterado.
  if v_target.name = v_name_normalized then
    return query select v_target.id, v_target.name, v_target.updated_at;
    return;
  end if;

  v_before := jsonb_build_object('name', v_target.name);
  v_after := jsonb_build_object('name', v_name_normalized);

  update public.profiles
     set name = v_name_normalized
   where id = v_target.id
  returning public.profiles.updated_at into v_updated_at;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_audit_company_id, 'user_profile_updated', 'profile', v_target.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select v_target.id, v_name_normalized, v_updated_at;
end;
$$;

revoke all on function public.update_profile_name(uuid, text) from public;
revoke all on function public.update_profile_name(uuid, text) from anon;
grant execute on function public.update_profile_name(uuid, text) to authenticated;

commit;
