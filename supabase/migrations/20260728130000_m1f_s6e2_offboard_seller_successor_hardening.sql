-- M1-F S6-E2 — hardening do contrato de sucessor de offboard_seller.
-- Decisão humana explícita (autorizada nesta etapa, superset do que S6-C
-- publicou): a interface do S6-F (pausada) precisava resolver Sellers
-- sucessores com segurança, mas offboard_seller exigia sellers.id (text)
-- como parâmetro — nenhuma fonte remota segura devolve esse id (list_
-- company_users/list_inactive_company_users só têm profile_id/
-- membership_id; a RLS de sellers usa helpers legados do M1-B/M1-C,
-- incompatíveis com Super Admin sob M1-F). Em vez de criar uma RPC de
-- listagem nova (fora do escopo autorizado), o contrato de offboard_seller
-- é alterado para aceitar p_successor_membership_id (uuid) — o mesmo tipo
-- que list_company_users já expõe com segurança — e resolver sellers.id
-- internamente, no banco, nunca no cliente.
--
-- Assinatura nova:
--   offboard_seller(p_seller_membership_id uuid, p_successor_membership_id
--                    uuid, p_note text)
-- Assinatura antiga (offboard_seller(uuid, text, text), S6-C,
-- 20260728100000_m1f_s6c_membership_offboarding.sql) é removida por DROP
-- explícito nesta migration — a migration antiga NÃO é editada, só este
-- arquivo novo e aditivo. offboard_manager (mesmo arquivo antigo) não é
-- tocado: seu parâmetro de sucessor já era p_successor_profile_id uuid,
-- sem o mesmo problema.
--
-- ── Mudança de regra: sucessor deixa de ser sempre opcional ────────────
-- Antes (S6-C): sucessor nunca obrigatório para offboard_seller ("Vendedor
-- sem substituto: permitido"). Agora (decisão desta etapa): sucessor só
-- pode ficar NULL quando o Seller alvo NÃO possui leads abertos
-- (archived_at is null) no momento da chamada — havendo pelo menos um lead
-- aberto, p_successor_membership_id NULL levanta successor_required. Sem
-- leads abertos, o comportamento permanece idêntico ao S6-C (successor
-- opcional, desligamento segue sem reatribuição).
--
-- ── Resolução do sucessor ───────────────────────────────────────────────
-- p_successor_membership_id aponta para uma company_memberships — a mesma
-- entidade que list_company_users já devolve como membership_id, então o
-- frontend nunca precisa enxergar sellers.id. Dentro da RPC,
-- v_successor_seller é resolvido via `sellers.membership_id =
-- v_successor_membership.id` (mesma consulta que offboard_manager já usa
-- para o profile sucessor) — sellers.id nunca sai do banco pela entrada,
-- só pela SAÍDA (successor_seller_id, já existia assim desde S6-C, é
-- informativo, não autorização).
--
-- ── Locks ────────────────────────────────────────────────────────────────
-- Idêntico a S6-C: origem e sucessor (quando informado) travados numa
-- única consulta ORDER BY id FOR UPDATE, evitando o deadlock cruzado já
-- documentado ali. A diferença é que p_successor_membership_id já É o id a
-- travar — não existe mais o passo de "peek sem lock" que antes convertia
-- sellers.id em membership_id (esse passo só existia por causa do
-- parâmetro antigo ser text).
--
-- ── Validação do sucessor (idêntica a S6-C, apenas resolvida a partir de
--    membership_id em vez de seller_id) ─────────────────────────────────
-- role='seller'; mesma empresa da origem (garantido pela própria consulta
-- de lock, que já filtra company_id = v_company.id — uma membership de
-- outra empresa nunca é encontrada, cai em successor_invalid por
-- v_successor_membership.id ser null); diferente do alvo; membership ativa
-- e lifecycle_status='active'; profile ativo; sellers.is_active=true;
-- sellers.profile_id = membership.profile_id (consistência estrutural,
-- mesma checagem de S6-C).
--
-- offboard_manager, autorização, motivo, idempotência, auditoria,
-- atomicidade, leads_updated_by_fk (nunca escrito) — tudo preservado sem
-- nenhuma mudança de comportamento além do descrito acima.
begin;

drop function public.offboard_seller(uuid, text, text);

create function public.offboard_seller(
  p_seller_membership_id uuid,
  p_successor_membership_id uuid,
  p_note text
) returns table (
  membership_id         uuid,
  profile_id             uuid,
  company_id             uuid,
  company_role           public.company_role,
  lifecycle_status       public.membership_lifecycle_status,
  is_active              boolean,
  seller_id              text,
  seller_active          boolean,
  successor_seller_id    text,
  leads_reassigned       integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id_peek       uuid;
  v_company                public.companies;
  v_membership              public.company_memberships;
  v_target_profile          public.profiles;
  v_seller                  public.sellers;
  v_successor_membership    public.company_memberships;
  v_successor_profile       public.profiles;
  v_successor_seller        public.sellers;
  v_row                     public.company_memberships;
  v_note                    text;
  v_leads_count             int;
  v_open_leads_count        int;
  v_before                  jsonb;
  v_after                   jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_seller_membership_id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select cm.company_id into v_company_id_peek
    from public.company_memberships cm
   where cm.id = p_seller_membership_id;
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

  -- trava alvo e (quando aplicável) sucessor numa única consulta ordenada
  -- por id — nunca na ordem em que os parâmetros chegaram. Sucessor = o
  -- próprio alvo cai deliberadamente no ramo "else" (v_successor_membership
  -- nunca é populada), o que resulta em successor_invalid mais abaixo.
  if p_successor_membership_id is not null and p_successor_membership_id <> p_seller_membership_id then
    for v_row in
      select cm.* from public.company_memberships cm
       where cm.id in (p_seller_membership_id, p_successor_membership_id)
         and cm.company_id = v_company.id
       order by cm.id
       for update
    loop
      if v_row.id = p_seller_membership_id then
        v_membership := v_row;
      else
        v_successor_membership := v_row;
      end if;
    end loop;
  else
    select cm.* into v_membership
      from public.company_memberships cm
     where cm.id = p_seller_membership_id and cm.company_id = v_company.id
     for update;
  end if;

  if v_membership.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select p.* into v_target_profile from public.profiles p where p.id = v_membership.profile_id for update;
  if v_target_profile.id is null or not v_target_profile.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_membership.role <> 'seller'::public.company_role then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if not public.is_manager_or_platform(v_company.id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_target_profile.id = auth.uid() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if coalesce(v_target_profile.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_note := btrim(p_note);
  if v_note is null or v_note = '' or length(v_note) < 3 or length(v_note) > 500 or v_note ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_note';
  end if;

  select s.* into v_seller from public.sellers s where s.membership_id = v_membership.id for update;
  if v_seller.id is null
     or v_seller.company_id <> v_membership.company_id
     or v_seller.profile_id <> v_membership.profile_id then
    raise using message = 'seller_state_conflict';
  end if;

  if v_membership.lifecycle_status = 'offboarded'::public.membership_lifecycle_status then
    return query select
      v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
      v_membership.lifecycle_status, v_membership.is_active,
      v_seller.id, v_seller.is_active,
      null::text, 0;
    return;
  end if;

  -- NOVO (S6-E2): leads abertos do alvo tornam o sucessor obrigatório.
  select count(*)::int into v_open_leads_count
    from public.leads l
   where l.company_id = v_company.id
     and l.seller_id = v_seller.id
     and l.archived_at is null;

  if p_successor_membership_id is not null then
    if v_successor_membership.id is null then
      raise using message = 'successor_invalid';
    end if;

    select p.* into v_successor_profile from public.profiles p where p.id = v_successor_membership.profile_id for update;
    select s.* into v_successor_seller from public.sellers s where s.membership_id = v_successor_membership.id for update;

    if v_successor_membership.id = v_membership.id
       or v_successor_membership.role <> 'seller'::public.company_role
       or not v_successor_membership.is_active
       or v_successor_membership.lifecycle_status <> 'active'::public.membership_lifecycle_status
       or v_successor_profile.id is null or not v_successor_profile.is_active
       or v_successor_seller.id is null or not v_successor_seller.is_active
       or v_successor_seller.company_id <> v_company.id
       or v_successor_seller.profile_id <> v_successor_membership.profile_id then
      raise using message = 'successor_invalid';
    end if;
  elsif v_open_leads_count > 0 then
    raise using message = 'successor_required';
  end if;

  v_before := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active
  );

  update public.company_memberships
     set lifecycle_status = 'offboarded', is_active = false
   where id = v_membership.id
  returning * into v_membership;

  update public.sellers set is_active = false where id = v_seller.id
  returning * into v_seller;

  -- reatribuição operacional (só leads). updated_by_profile_id NUNCA é
  -- gravado (mesmo motivo documentado em S6-C: leads_updated_by_fk é uma FK
  -- composta contra profiles.company_id, sempre NULL para Super Admin).
  update public.leads l
     set seller_id = v_successor_seller.id
   where l.company_id = v_company.id
     and l.seller_id = v_seller.id
     and l.archived_at is null;
  get diagnostics v_leads_count = row_count;

  v_after := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active,
    'successor_seller_id', v_successor_seller.id,
    'leads_reassigned', v_leads_count,
    'note', v_note
  );

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'seller_offboarded', 'membership', v_membership.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select
    v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
    v_membership.lifecycle_status, v_membership.is_active,
    v_seller.id, v_seller.is_active,
    v_successor_seller.id, v_leads_count;
end;
$$;

revoke all on function public.offboard_seller(uuid, uuid, text) from public;
revoke all on function public.offboard_seller(uuid, uuid, text) from anon;
grant execute on function public.offboard_seller(uuid, uuid, text) to authenticated;

commit;
