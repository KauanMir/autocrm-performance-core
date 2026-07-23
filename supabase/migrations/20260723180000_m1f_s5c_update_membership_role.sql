-- M1-F S5-C — RPC estreita de alteração de papel empresarial (§22.3/§22.4/
-- §22.6 do design, docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md).
-- Contrato fechado: altera company_memberships.role, a ponte temporária
-- profiles.role (mapeamento manager→manager, seller→seller, nunca admin —
-- removida no S8) e, quando necessário, o vínculo operacional em
-- public.sellers exigido pelos triggers já existentes do S1. Exclusiva de
-- Super Admin — Manager nunca altera papel (§22.2).
--
-- Alvo Super Admin bloqueado, autoalteração bloqueada, guarda do último
-- Manager, locks em ordem fixa empresa→membership→profile — tudo já
-- documentado na versão anterior desta migration (auditoria M1-F S5-C0).
--
-- ── Ciclo seller ↔ manager em public.sellers (decisão congelada, M1-F
--    S5-C0/S5-C) ───────────────────────────────────────────────────────
-- Auditoria prévia (M1-F S5-C0) provou que `company_memberships_check_
-- mutation` (S1) bloqueia qualquer troca de role que afaste uma membership
-- de 'seller' enquanto uma linha de `sellers` ainda tiver `membership_id`
-- apontando para ela — o caso normal de todo Seller real (criado via
-- accept_invite). A solução (Opção A da auditoria) nunca apaga a linha de
-- sellers — apenas desvincula/inativa na promoção e religa/reativa na
-- volta, preservando sellers.id e todo histórico de leads/tarefas/deals/
-- vendas (que referenciam sellers.id diretamente, nunca membership_id).
--
--   SELLER → MANAGER: se existir uma linha de sellers para
--   (company_id, profile_id), ela é desvinculada (membership_id = null) e
--   inativada (is_active = false) ANTES do UPDATE de company_memberships —
--   ordem exigida pelo trigger do S1, que só permite a membership deixar
--   de ser 'seller' quando nenhum sellers.membership_id mais a referencia.
--
--   MANAGER → SELLER: o UPDATE de company_memberships para 'seller'
--   acontece PRIMEIRO; só depois a linha histórica é religada
--   (membership_id = <nova membership>) e reativada — ordem exigida pelo
--   outro trigger (sellers_check_membership_consistency), que só aceita
--   religar quando a membership referenciada já é 'seller'. Se não existir
--   nenhuma linha histórica, uma nova é criada no mesmo padrão de
--   accept_invite() (id default, name/first_name a partir do profile
--   atual, is_active=true) — nunca quando já existe uma linha reutilizável.
--
-- Resolução SEMPRE por (company_id, profile_id) — nunca por
-- profiles.seller_id (campo legado, nunca populado pelo fluxo de convite
-- atual, portanto não confiável como fonte de verdade). Mais de uma linha
-- para o mesmo (company_id, profile_id), ou uma linha vinculada a uma
-- membership diferente da esperada, falha com seller_state_conflict —
-- nunca escolhe arbitrariamente, nunca sequestra linha de outra empresa/
-- membership.
--
-- Nenhuma alteração de schema ou trigger foi necessária — membership_id
-- nullable e is_active já existiam desde o S1, exatamente para este ciclo.
begin;

create function public.update_membership_role(
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
  v_expected_profile_role   public.user_role;
  v_other_manager_count     int;
  v_seller_count            int;
  v_seller                  public.sellers;
  v_needs_membership_update boolean;
  v_needs_profile_update    boolean;
  v_needs_seller_update     boolean;
  v_before                  jsonb;
  v_after                   jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  -- somente Super Admin ativo — nunca profiles.role/company_id do ator,
  -- nunca membership própria do ator como limitação.
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

  -- ordem fixa de locks: empresa -> membership -> profile.
  select c.* into v_company from public.companies c where c.id = p_company_id for update;
  if v_company.id is null or v_company.status = 'cancelada' then
    raise no_data_found using message = 'membership_not_found';
  end if;

  -- p_company_id e' confirmacao explicita do alvo, nunca autorizacao: a
  -- linha so e' encontrada se company_id bater EXATAMENTE com a
  -- membership real — divergencia (inclusive cross-tenant) fica
  -- indistinguivel de "nao existe".
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

  -- guarda do ultimo Manager: só se aplica a uma downgrade REAL
  -- (membership hoje 'manager', pedido 'seller') — contagem acontece
  -- depois do lock da empresa, exclui a propria linha-alvo, exige
  -- membership ativa E profile ativo do candidato a "outro Manager".
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

  -- resolve o(s) seller(s) historico(s) do alvo, sempre por
  -- (company_id, profile_id) — nunca profiles.seller_id. Trava a linha
  -- encontrada antes de decidir qualquer coisa.
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

    -- linha ligada a uma membership diferente da esperada (nunca deveria
    -- acontecer estruturalmente — 1 membership ativa por profile — mas
    -- falha em profundidade em vez de presumir/sequestrar).
    if v_seller.membership_id is not null and v_seller.membership_id <> v_membership.id then
      raise using message = 'seller_state_conflict';
    end if;
  end if;

  -- ponte temporaria: mapeamento fechado, nunca produz 'admin'.
  v_expected_profile_role := p_role::text::public.user_role;

  v_needs_membership_update := (v_membership.role is distinct from p_role);
  v_needs_profile_update    := (v_target_profile.role is distinct from v_expected_profile_role);

  if p_role = 'manager'::public.company_role then
    -- destino manager: nenhum seller pode continuar vinculado/ativo.
    v_needs_seller_update := v_seller_count = 1
      and (v_seller.membership_id is not null or v_seller.is_active);
  else
    -- destino seller: precisa existir exatamente um seller, vinculado a
    -- ESTA membership e ativo.
    v_needs_seller_update := v_seller_count = 0
      or v_seller.membership_id is distinct from v_membership.id
      or not v_seller.is_active;
  end if;

  if not v_needs_membership_update and not v_needs_profile_update and not v_needs_seller_update then
    -- idempotente: tudo ja correto, nenhuma escrita, nenhuma auditoria.
    return query select v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role;
    return;
  end if;

  v_before := jsonb_build_object(
    'company_role', v_membership.role,
    'profile_role', v_target_profile.role,
    'seller_id', case when v_seller_count = 1 then v_seller.id else null end,
    'seller_active', case when v_seller_count = 1 then v_seller.is_active else null end,
    'seller_linked', case when v_seller_count = 1 then (v_seller.membership_id is not null) else false end
  );

  if p_role = 'manager'::public.company_role then
    -- ── SELLER -> MANAGER: desvincular/inativar o seller ANTES da
    -- membership deixar de ser 'seller' (company_memberships_check_
    -- mutation, S1, exige isso) ──────────────────────────────────────────
    if v_needs_seller_update then
      update public.sellers
         set membership_id = null,
             is_active = false
       where id = v_seller.id;
    end if;

    if v_needs_membership_update then
      update public.company_memberships set role = p_role where id = v_membership.id;
    end if;

    if v_needs_profile_update then
      update public.profiles set role = v_expected_profile_role where id = v_target_profile.id;
    end if;
  else
    -- ── MANAGER -> SELLER: a membership precisa virar 'seller' ANTES de
    -- religar o seller (sellers_check_membership_consistency, S1, exige
    -- role='seller' na membership referenciada) ─────────────────────────
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

    if v_needs_profile_update then
      update public.profiles set role = v_expected_profile_role where id = v_target_profile.id;
    end if;
  end if;

  v_after := jsonb_build_object(
    'company_role', p_role,
    'profile_role', v_expected_profile_role,
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
