-- M1-E E3-A1 — catálogo seguro de seller_id -> name para Manager/Seller
-- (docs/M1-E-DESIGN.md, bloqueio encontrado no E3 e decisão humana
-- registrada nesta etapa). adaptLeadRows (lib/leads/adapter.ts) exige um
-- índice sellersById para resolver o nome exibido de cada lead — nenhuma
-- fonte segura existia para Manager/Seller: public.sellers não tem SELECT
-- para authenticated, list_platform_sellers_for_company é exclusiva de
-- Super Admin, e current_profile_seller_id_for_company só resolve o
-- próprio Seller do ator.
--
-- public.sellers.name/first_name são gravados uma única vez, no momento em
-- que a linha nasce (accept_invite/update_membership_role), a partir do
-- nome do profile NAQUELE momento — nunca ressincronizados depois. Por
-- isso sellers.name já é, por construção, o "nome histórico" correto: não
-- é necessário juntar com profiles para resolver o nome, e o nome exibido
-- para um Lead antigo nunca muda retroativamente se o profile for
-- renomeado depois.
--
-- sellers.company_id nunca muda depois de criado (transferência cria uma
-- linha NOVA na empresa destino — S8-C2-C2-SELLERS-B1 — nunca move a
-- antiga), então toda linha com company_id = <empresa do Manager> sempre
-- foi, e continua sendo, elegível para nomear um Lead histórico daquela
-- empresa, independente de sellers.is_active ou da membership ainda
-- existir ativa.
begin;

create function public.list_current_company_seller_labels()
returns table (
  seller_id text,
  name      text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_role       public.company_role;
  v_status     public.company_status;
  v_seller_id  text;
begin
  -- Mesmo par de helpers que resolve_lead_mutation_context usa para
  -- Manager/Seller (m1f_s2_02) — já exige profile ativo e exatamente uma
  -- membership ativa; Super Admin nunca tem membership ativa, então cai
  -- no mesmo forbidden de "sem membership", sem código especial.
  v_company_id := public.current_membership_company_id();
  v_role := public.current_membership_role();
  if v_company_id is null or v_role is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- Mesmo gate de status usado por leads_select (RLS de public.leads) e
  -- por resolve_lead_mutation_context para Manager/Seller: só 'ativa'
  -- concede leitura operacional — mais restrito que can_access_company()
  -- de propósito (§31.5 do design M1-F).
  select c.status into v_status from public.companies c where c.id = v_company_id;
  if v_status is distinct from 'ativa' then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_role = 'manager'::public.company_role then
    -- Manager: catálogo completo da própria empresa, incluindo Sellers
    -- históricos/inativos/desvinculados — um Lead antigo pode continuar
    -- referenciando um seller_id que não é mais operacional; filtrar por
    -- is_active aqui recriaria o próprio bloqueio (seller_not_found no
    -- adapter) que esta RPC existe para evitar. Nunca outra empresa.
    return query
      select s.id, s.name
        from public.sellers s
        where s.company_id = v_company_id
        order by s.name, s.id;
    return;
  end if;

  -- Seller: somente a própria linha ATUAL (nunca o catálogo da empresa).
  -- current_profile_seller_id_for_company já resolve com segurança (falha
  -- fechado para null em qualquer ambiguidade) — reaproveitado, nunca
  -- reimplementado.
  v_seller_id := public.current_profile_seller_id_for_company(v_company_id);
  return query
    select s.id, s.name
      from public.sellers s
      where s.id = v_seller_id
        and s.company_id = v_company_id;
end;
$$;

revoke all on function public.list_current_company_seller_labels() from public;
revoke all on function public.list_current_company_seller_labels() from anon;
revoke all on function public.list_current_company_seller_labels() from authenticated;
grant execute on function public.list_current_company_seller_labels() to authenticated;

commit;
