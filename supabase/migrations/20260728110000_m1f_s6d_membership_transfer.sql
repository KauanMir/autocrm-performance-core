-- M1-F S6-D — transferência empresarial atômica (transfer_membership).
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §24.7 — nenhuma
-- decisão congelada é reinterpretada aqui. Assinatura exata:
--   transfer_membership(p_source_membership_id, p_target_company_id,
--                        p_target_role, p_successor_id|null, p_note)
-- Todos os cinco parâmetros são obrigatórios em SQL (mesmo motivo já
-- documentado em suspend_membership/offboard_seller: Postgres exige que
-- todo parâmetro após um com DEFAULT também tenha DEFAULT — "sucessor
-- ausente" é NULL explícito, nunca omissão do argumento).
--
-- ── p_successor_id: reconciliação de tipo (não ambígua, decisão
--    registrada) ───────────────────────────────────────────────────────
-- §24.7 diz "mesmo parâmetro de offboard_seller/offboard_manager,
-- reaproveitado" — mas offboard_seller usa p_successor_seller_id (text,
-- sellers.id) e offboard_manager usa p_successor_profile_id (uuid,
-- profiles.id): tipos diferentes. "Reaproveitado" só pode significar o
-- CONCEITO (sucessor para reatribuição na origem), não o tipo SQL literal
-- de uma RPC específica — transfer_membership não sabe a priori se a
-- origem é seller ou manager antes de ler a própria linha, então um único
-- parâmetro só pode funcionar para os dois casos se for profile_id
-- (uuid) — exatamente o tipo que offboard_manager já usa, resolvido para
-- seller_id via a membership ativa do sucessor na empresa de origem
-- quando a origem for seller. Nome do parâmetro (p_successor_id, sem
-- sufixo _seller_/_profile_) reforça essa leitura: é deliberadamente
-- genérico.
--
-- ── Estados de origem/destino confirmados em §24.7 ──────────────────────
-- Origem: active OU suspended -> offboarded (nunca outra origem; já
-- offboarded é o caminho idempotente). Destino: cria nova membership
-- active OU reaproveita uma linha offboarded existente para o mesmo
-- (company_id, profile_id) — nunca reativa uma linha suspensa
-- silenciosamente (não autorizado por §24.7, que só menciona reuso de
-- offboarded; tratado como transfer_state_conflict) e nunca aceita uma
-- linha já active (active_membership_conflict — estruturalmente só
-- alcançável se a origem informada não for a membership realmente ativa
-- do profile, já que o índice único de membership ativa impede duas
-- linhas is_active=true para o mesmo profile simultaneamente).
--
-- ── Locks: por que a origem e o eventual sucessor são travados juntos ──
-- A origem (p_source_membership_id) é conhecida de imediato, mas o
-- sucessor só é identificável depois de ler o ROLE da origem (peek sem
-- lock, abaixo). Travar a origem sozinha e só depois travar o sucessor,
-- em consultas separadas, reabriria exatamente o deadlock cruzado que
-- offboard_seller/offboard_manager (S6-C) evitam: uma chamada concorrente
-- que trate "meu sucessor" como seu próprio alvo, e "meu alvo" como seu
-- próprio sucessor, travaria as mesmas duas linhas em ordem oposta. Por
-- isso a origem e o sucessor (quando informado) são travados numa única
-- consulta ORDER BY id FOR UPDATE, exatamente como offboard_seller/
-- offboard_manager já fazem para o mesmo problema dentro de uma única
-- empresa.
begin;

create function public.transfer_membership(
  p_source_membership_id uuid,
  p_target_company_id uuid,
  p_target_role public.company_role,
  p_successor_id uuid,
  p_note text
) returns table (
  profile_id                 uuid,
  source_membership_id       uuid,
  destination_membership_id  uuid,
  source_company_id          uuid,
  destination_company_id     uuid,
  destination_role           public.company_role,
  source_seller_id           text,
  destination_seller_id      text,
  leads_reassigned           integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source_company_id_peek      uuid;
  v_source_role_peek             public.company_role;
  v_source_company                public.companies;
  v_target_company                 public.companies;
  v_company_row                     public.companies;
  v_source_membership                public.company_memberships;
  v_target_profile                    public.profiles;
  v_dest_membership_id_peek            uuid;
  v_dest_membership                     public.company_memberships;
  v_dest_membership_reused               boolean := false;
  v_source_seller                         public.sellers;
  v_dest_seller                            public.sellers;
  v_dest_seller_count                       int;
  v_successor_membership_peek                uuid;
  v_successor_membership                      public.company_memberships;
  v_successor_profile                          public.profiles;
  v_successor_seller                            public.sellers;
  v_membership_row                               public.company_memberships;
  v_note                                          text;
  v_leads_count                                    int;
  v_other_manager_count                             int;
  v_before                                           jsonb;
  v_after                                             jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_source_membership_id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if p_target_company_id is null then
    raise using message = 'target_company_unavailable';
  end if;

  if p_target_role is null then
    -- mesmo codigo ja usado por update_membership_role (S5-C) para
    -- p_role nulo — reaproveitado, nao redundante (nao ha codigo
    -- equivalente no catalogo desta etapa).
    raise invalid_parameter_value using message = 'invalid_role';
  end if;

  -- peek completo da origem (sem lock): company_id e role. Nenhum dos
  -- dois é recebido como parâmetro do cliente.
  select cm.company_id, cm.role into v_source_company_id_peek, v_source_role_peek
    from public.company_memberships cm
   where cm.id = p_source_membership_id;
  if v_source_company_id_peek is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_source_company_id_peek = p_target_company_id then
    raise using message = 'same_company_transfer_forbidden';
  end if;

  -- trava as duas empresas em ordem deterministica por UUID — nunca na
  -- ordem "origem depois destino" (§13 desta etapa / §24.7).
  for v_company_row in
    select c.* from public.companies c
     where c.id in (v_source_company_id_peek, p_target_company_id)
     order by c.id
     for update
  loop
    if v_company_row.id = v_source_company_id_peek then
      v_source_company := v_company_row;
    else
      v_target_company := v_company_row;
    end if;
  end loop;

  if v_source_company.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;
  if v_target_company.id is null then
    raise using message = 'target_company_unavailable';
  end if;

  if v_source_company.status not in ('implantacao', 'ativa') then
    raise using message = 'company_not_operational';
  end if;
  if v_target_company.status not in ('implantacao', 'ativa') then
    raise using message = 'target_company_unavailable';
  end if;

  -- peek do sucessor (sem lock): resolve a membership ativa do sucessor
  -- NA EMPRESA DE ORIGEM, com o role que corresponde ao role da origem
  -- (peek acima) — seller sucede seller, manager sucede manager.
  if p_successor_id is not null then
    select cm.id into v_successor_membership_peek
      from public.company_memberships cm
     where cm.profile_id = p_successor_id
       and cm.company_id = v_source_company.id
       and cm.role = v_source_role_peek
       and cm.is_active
       and cm.lifecycle_status = 'active'::public.membership_lifecycle_status;
  end if;

  -- trava a membership de origem e a do sucessor (quando aplicável) numa
  -- única consulta ordenada por id — nunca em consultas separadas (ver
  -- nota de topo sobre deadlock cruzado).
  if v_successor_membership_peek is not null and v_successor_membership_peek <> p_source_membership_id then
    for v_membership_row in
      select cm.* from public.company_memberships cm
       where cm.id in (p_source_membership_id, v_successor_membership_peek)
         and cm.company_id = v_source_company.id
       order by cm.id
       for update
    loop
      if v_membership_row.id = p_source_membership_id then
        v_source_membership := v_membership_row;
      else
        v_successor_membership := v_membership_row;
      end if;
    end loop;
  else
    select cm.* into v_source_membership
      from public.company_memberships cm
     where cm.id = p_source_membership_id and cm.company_id = v_source_company.id
     for update;
  end if;

  if v_source_membership.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select p.* into v_target_profile from public.profiles p where p.id = v_source_membership.profile_id for update;
  if v_target_profile.id is null or not v_target_profile.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  -- autorização: somente Super Admin — nunca Manager, nunca Seller.
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if v_target_profile.id = auth.uid() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if coalesce(v_target_profile.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- motivo obrigatório.
  v_note := btrim(p_note);
  if v_note is null or v_note = '' or length(v_note) < 3 or length(v_note) > 500 or v_note ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_note';
  end if;

  -- trava a eventual membership histórica do destino (mesmo profile,
  -- empresa destino) — peek sem lock primeiro, para decidir se há algo a
  -- travar. Empresa distinta da origem/sucessor (já travada em ordem
  -- determinística acima) — nenhum risco adicional de deadlock aqui.
  select cm.id into v_dest_membership_id_peek
    from public.company_memberships cm
   where cm.company_id = v_target_company.id and cm.profile_id = v_target_profile.id;
  if v_dest_membership_id_peek is not null then
    select cm.* into v_dest_membership
      from public.company_memberships cm
     where cm.id = v_dest_membership_id_peek
     for update;
  end if;

  -- idempotência: origem já offboarded. Só é idempotente se o destino já
  -- refletir EXATAMENTE a transferência esperada (nunca presume que
  -- qualquer offboard antigo seja esta transferência).
  if v_source_membership.lifecycle_status = 'offboarded'::public.membership_lifecycle_status then
    if v_dest_membership.id is not null
       and v_dest_membership.lifecycle_status = 'active'::public.membership_lifecycle_status
       and v_dest_membership.role = p_target_role
    then
      if p_target_role = 'seller'::public.company_role then
        select s.* into v_dest_seller from public.sellers s where s.membership_id = v_dest_membership.id;
        if v_dest_seller.id is null or not v_dest_seller.is_active then
          raise using message = 'transfer_state_conflict';
        end if;
      end if;

      select s.* into v_source_seller from public.sellers s where s.membership_id = v_source_membership.id;

      return query select
        v_target_profile.id, v_source_membership.id, v_dest_membership.id,
        v_source_membership.company_id, v_dest_membership.company_id, v_dest_membership.role,
        v_source_seller.id, v_dest_seller.id, 0;
      return;
    else
      raise using message = 'transfer_state_conflict';
    end if;
  end if;

  -- daqui em diante: origem active ou suspended (nunca offboarded) — via
  -- de transferência real.

  -- resolve o Seller da origem, sempre que role='seller' (checagem
  -- estrutural, mesmo padrão de suspend_membership/offboard_seller).
  if v_source_membership.role = 'seller'::public.company_role then
    select s.* into v_source_seller from public.sellers s where s.membership_id = v_source_membership.id for update;
    if v_source_seller.id is null
       or v_source_seller.company_id <> v_source_membership.company_id
       or v_source_seller.profile_id <> v_source_membership.profile_id then
      raise using message = 'seller_state_conflict';
    end if;
  end if;

  -- estado da membership histórica do destino (cenários A-D, §8 desta etapa).
  if v_dest_membership.id is not null then
    if v_dest_membership.lifecycle_status = 'active'::public.membership_lifecycle_status then
      raise using message = 'active_membership_conflict';
    elsif v_dest_membership.lifecycle_status = 'suspended'::public.membership_lifecycle_status then
      -- §24.7 só autoriza reaproveitar linha OFFBOARDED — reativar uma
      -- suspensa silenciosamente via transferência não está autorizado.
      raise using message = 'transfer_state_conflict';
    else
      -- offboarded: reaproveitável.
      v_dest_membership_reused := true;
    end if;
  end if;

  -- validação do sucessor já travado (se algum peek resolveu um id) —
  -- revalida sob lock: papel correto, ativo, diferente da origem, mesma
  -- empresa, profile ativo, nunca outro Super Admin.
  if p_successor_id is not null then
    if v_successor_membership.id is null then
      raise using message = 'successor_invalid';
    end if;

    select p.* into v_successor_profile from public.profiles p where p.id = v_successor_membership.profile_id for update;

    if v_successor_membership.id = v_source_membership.id
       or v_successor_membership.role <> v_source_membership.role
       or not v_successor_membership.is_active
       or v_successor_membership.lifecycle_status <> 'active'::public.membership_lifecycle_status
       or v_successor_profile.id is null or not v_successor_profile.is_active
       or coalesce(v_successor_profile.platform_role = 'super_admin', false) then
      raise using message = 'successor_invalid';
    end if;

    if v_source_membership.role = 'seller'::public.company_role then
      select s.* into v_successor_seller from public.sellers s where s.membership_id = v_successor_membership.id for update;
      if v_successor_seller.id is null
         or not v_successor_seller.is_active
         or v_successor_seller.company_id <> v_source_company.id
         or v_successor_seller.profile_id <> v_successor_membership.profile_id then
        raise using message = 'successor_invalid';
      end if;
    end if;
  end if;

  -- guarda do último Manager na origem (role='manager') — mesma
  -- definição de S5-C/S6-B/S6-C.
  if v_source_membership.role = 'manager'::public.company_role then
    select count(*)::int into v_other_manager_count
      from public.company_memberships cm
      join public.profiles p on p.id = cm.profile_id
     where cm.company_id = v_source_company.id
       and cm.role = 'manager'::public.company_role
       and cm.is_active
       and cm.lifecycle_status = 'active'::public.membership_lifecycle_status
       and p.is_active
       and cm.id <> v_source_membership.id;

    if v_other_manager_count = 0 and v_successor_membership.id is null then
      raise using message = 'last_manager_requires_successor';
    end if;
  end if;

  -- sucessor de leads na origem (role='seller') — nunca obrigatório salvo
  -- quando existem leads abertos (§10 desta etapa).
  if v_source_membership.role = 'seller'::public.company_role then
    select count(*)::int into v_leads_count
      from public.leads l
     where l.company_id = v_source_company.id
       and l.seller_id = v_source_seller.id
       and l.archived_at is null;

    if v_leads_count > 0 and v_successor_seller.id is null then
      raise using message = 'successor_required';
    end if;
  end if;

  -- ── ponto de nao-retorno: todas as validacoes passaram, comeca a
  --    escrita atomica ────────────────────────────────────────────────
  v_before := jsonb_build_object(
    'source_membership_id', v_source_membership.id,
    'source_company_id', v_source_membership.company_id,
    'source_role', v_source_membership.role,
    'source_lifecycle_status', v_source_membership.lifecycle_status
  );

  -- 1. origem -> offboarded (nunca DELETE, nunca muda company_id).
  update public.company_memberships
     set lifecycle_status = 'offboarded', is_active = false
   where id = v_source_membership.id
  returning * into v_source_membership;

  -- 2. Seller da origem -> inativo (preserva id/profile_id/membership_id).
  if v_source_seller.id is not null then
    update public.sellers set is_active = false where id = v_source_seller.id
    returning * into v_source_seller;
  end if;

  -- 3. destino: cria nova membership OU reaproveita a offboarded
  -- existente. Quando reaproveitada e a troca de role atravessa o limite
  -- seller<->manager, segue a MESMA ordem de company_memberships_check_
  -- mutation/sellers_check_membership_consistency já usada pelo ciclo
  -- seller<->manager de update_membership_role (S5-C): desvincular/
  -- inativar o seller ANTES de a membership deixar de ser 'seller';
  -- religar/criar o seller SÓ DEPOIS de a membership já ser 'seller'.
  if v_dest_membership_reused then
    if v_dest_membership.role = 'seller'::public.company_role and p_target_role <> 'seller'::public.company_role then
      select s.* into v_dest_seller from public.sellers s where s.membership_id = v_dest_membership.id for update;
      if v_dest_seller.id is not null then
        update public.sellers set membership_id = null, is_active = false where id = v_dest_seller.id;
      end if;
    end if;

    update public.company_memberships
       set role = p_target_role, lifecycle_status = 'active', is_active = true
     where id = v_dest_membership.id
    returning * into v_dest_membership;
  else
    insert into public.company_memberships (company_id, profile_id, role, lifecycle_status, is_active)
    values (v_target_company.id, v_target_profile.id, p_target_role, 'active', true)
    returning * into v_dest_membership;
  end if;

  -- 4. Seller no destino, somente quando o papel final é 'seller'.
  if p_target_role = 'seller'::public.company_role then
    select count(*)::int into v_dest_seller_count
      from public.sellers s
     where s.company_id = v_target_company.id and s.profile_id = v_target_profile.id;

    if v_dest_seller_count > 1 then
      raise using message = 'seller_state_conflict';
    end if;

    if v_dest_seller_count = 1 then
      select s.* into v_dest_seller
        from public.sellers s
       where s.company_id = v_target_company.id and s.profile_id = v_target_profile.id
       for update;

      if v_dest_seller.membership_id is not null and v_dest_seller.membership_id <> v_dest_membership.id then
        raise using message = 'seller_state_conflict';
      end if;

      update public.sellers
         set membership_id = v_dest_membership.id, is_active = true
       where id = v_dest_seller.id
      returning * into v_dest_seller;
    else
      insert into public.sellers (company_id, membership_id, profile_id, name, first_name, is_active)
      values (v_target_company.id, v_dest_membership.id, v_target_profile.id, v_target_profile.name, split_part(v_target_profile.name, ' ', 1), true)
      returning * into v_dest_seller;
    end if;
  end if;

  -- 5. leads abertos da origem — só quando a origem era 'seller'. Somente
  -- seller_id é escrito (mesma decisão do S6-C: updated_by_profile_id
  -- nunca é gravado por estas RPCs — leads_updated_by_fk é uma FK
  -- composta contra profiles.company_id, sempre NULL para Super Admin).
  v_leads_count := 0;
  if v_source_membership.role = 'seller'::public.company_role then
    update public.leads l
       set seller_id = v_successor_seller.id
     where l.company_id = v_source_company.id
       and l.seller_id = v_source_seller.id
       and l.archived_at is null;
    get diagnostics v_leads_count = row_count;
  end if;

  v_after := jsonb_build_object(
    'destination_membership_id', v_dest_membership.id,
    'destination_company_id', v_dest_membership.company_id,
    'destination_role', v_dest_membership.role,
    'destination_membership_reused', v_dest_membership_reused,
    'source_seller_id', v_source_seller.id,
    'destination_seller_id', v_dest_seller.id,
    'source_successor_seller_id', v_successor_seller.id,
    'leads_reassigned', v_leads_count,
    'note', v_note
  );

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_source_membership.company_id, 'membership_transferred', 'membership', v_source_membership.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select
    v_target_profile.id, v_source_membership.id, v_dest_membership.id,
    v_source_membership.company_id, v_dest_membership.company_id, v_dest_membership.role,
    v_source_seller.id, v_dest_seller.id, v_leads_count;
end;
$$;

revoke all on function public.transfer_membership(uuid, uuid, public.company_role, uuid, text) from public;
revoke all on function public.transfer_membership(uuid, uuid, public.company_role, uuid, text) from anon;
grant execute on function public.transfer_membership(uuid, uuid, public.company_role, uuid, text) to authenticated;

commit;
