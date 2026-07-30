-- M1-E E4-A1 — pré-requisitos de backend para Seller picker e duplicidade
-- na edição (docs/M1-E-DESIGN.md §15.3, decisão humana registrada após a
-- auditoria E4-A0). Migration puramente aditiva: nenhuma tabela, coluna,
-- policy, grant de tabela, RLS, create_lead, update_lead,
-- list_current_company_seller_labels ou list_platform_sellers_for_company é
-- alterada aqui.
--
-- Dois bloqueios reais confirmados pela auditoria E4-A0:
--   1. nenhuma RPC segura devolvia ao Manager uma lista de Sellers
--      OPERACIONAIS da própria empresa para escolher na criação de um Lead
--      — list_current_company_seller_labels (E3-A1) é deliberadamente o
--      catálogo HISTÓRICO (inclui inativos/desvinculados, para resolver
--      nomes de Leads antigos) e list_platform_sellers_for_company (M1-F)
--      é exclusiva de Super Admin.
--   2. check_lead_phone_duplicate não tinha como excluir o próprio Lead da
--      busca durante a edição — filtrar só no frontend esconderia qualquer
--      OUTRO Lead duplicado sempre que a RPC devolvesse primeiro a linha do
--      próprio registro em edição.

begin;

-- ── 1. list_current_company_assignable_sellers() ────────────────────────
-- Mesmo par de helpers de list_current_company_seller_labels
-- (current_membership_company_id()/current_membership_role(), gate de
-- companies.status = 'ativa') — nunca reimplementado. Diferença
-- deliberada: aquela é o catálogo de EXIBIÇÃO (nomeia Sellers de Leads
-- existentes, inclusive históricos); esta é o catálogo de ATRIBUIÇÃO (só
-- quem pode legitimamente receber um Lead novo). As duas convivem; nenhuma
-- substitui a outra.
create function public.list_current_company_assignable_sellers()
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
  -- Mesmo par de helpers que resolve_lead_mutation_context/
  -- list_current_company_seller_labels usam para Manager/Seller — Super
  -- Admin nunca tem membership ativa, cai no mesmo forbidden de "sem
  -- membership", sem código especial e sem aceitar company_id.
  v_company_id := public.current_membership_company_id();
  v_role := public.current_membership_role();
  if v_company_id is null or v_role is null then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- Mesmo gate de status usado por leads_select (RLS de public.leads) e
  -- por list_current_company_seller_labels: só 'ativa' concede leitura
  -- operacional.
  select c.status into v_status from public.companies c where c.id = v_company_id;
  if v_status is distinct from 'ativa' then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_role = 'manager'::public.company_role then
    -- Manager: Sellers OPERACIONAIS da própria empresa — todas as condições
    -- abaixo precisam valer simultaneamente. Mesmo filtro defensivo já usado
    -- por list_platform_sellers_for_company (S8-C2-C2-SELLERS-B1): nunca
    -- confiança cega numa única coluna, mesmo com sellers.is_active mantido
    -- em sincronia pelo ciclo de vida de membership (suspend/reactivate/
    -- offboard/transfer). profiles.role/profiles.seller_id legados nunca são
    -- lidos (colunas removidas em m1f_s8e2b).
    return query
      select s.id, s.name
        from public.sellers s
        join public.company_memberships cm on cm.id = s.membership_id
        join public.profiles p on p.id = cm.profile_id
        where s.company_id = v_company_id
          and s.is_active
          and cm.company_id = v_company_id
          and cm.role = 'seller'
          and cm.is_active
          and cm.lifecycle_status = 'active'
          and p.is_active
        order by s.name, s.id;
    return;
  end if;

  -- Seller: somente a própria linha OPERACIONAL atual (nunca o catálogo da
  -- empresa, nunca colegas). current_profile_seller_id_for_company já
  -- resolve com segurança (falha fechado para null em qualquer ambiguidade,
  -- inclusive Seller inativo/sem membership válida) — reaproveitado, nunca
  -- reimplementado. Se null, a query abaixo não casa nenhuma linha e o
  -- conjunto retornado é vazio (nunca um erro).
  v_seller_id := public.current_profile_seller_id_for_company(v_company_id);
  return query
    select s.id, s.name
      from public.sellers s
      where s.id = v_seller_id
        and s.company_id = v_company_id;
end;
$$;

revoke all on function public.list_current_company_assignable_sellers() from public;
revoke all on function public.list_current_company_assignable_sellers() from anon;
revoke all on function public.list_current_company_assignable_sellers() from authenticated;
grant execute on function public.list_current_company_assignable_sellers() to authenticated;

-- ── 2. check_lead_phone_duplicate — extensão aditiva (p_exclude_lead_id) ─
-- A função muda de IDENTIDADE (ganha um parâmetro uuid no final) — mesmo
-- raciocínio já registrado em 20260729110000_m1f_s8c2c1_lead_create_update_
-- duplicate_commercial.sql: Postgres trata isso como assinatura NOVA, não
-- CREATE OR REPLACE da mesma função. DROP da assinatura antiga + CREATE da
-- nova na MESMA transação — nunca existe janela em que as duas coexistem
-- no resultado final da migration. Sem CASCADE, sem IF EXISTS: a assinatura
-- antiga (text, uuid) é conhecida e única (confirmada por auditoria antes
-- desta migration — nenhum outro overload existe).
--
-- create_lead/update_lead NÃO são tocadas nesta migration — permanecem
-- exatamente como publicadas em 20260729110000.
drop function public.check_lead_phone_duplicate(text, uuid);

create function public.check_lead_phone_duplicate(
  p_phone           text,
  p_company_id      uuid default null,
  p_exclude_lead_id uuid default null
)
returns table (
  status        public.lead_duplicate_status,
  lead_id       uuid,
  lead_name     text,
  lead_archived boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx              record;
  v_digits           text;
  v_has_restricted   boolean;
  v_found_accessible boolean := false;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id, true);

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits = '' then
    raise exception 'invalid_phone';
  end if;

  if v_ctx.actor_kind in ('manager', 'super_admin') then
    return query
      select 'accessible'::public.lead_duplicate_status,
             l.id, l.name, (l.archived_at is not null)
        from public.leads l
        where l.company_id = v_ctx.resolved_company_id
          and l.phone_digits = v_digits
          -- p_exclude_lead_id NUNCA é autoridade — só remove essa linha da
          -- busca já escopada pela empresa resolvida; um ID de outra
          -- empresa não amplia acesso (o filtro por company_id já exclui
          -- qualquer lead de outra empresa antes desta condição rodar); um
          -- ID inexistente não altera o resultado (nunca casa nenhuma
          -- linha).
          and l.id is distinct from p_exclude_lead_id
        order by (l.archived_at is not null), l.created_at desc, l.id;
    if not found then
      return query
        select 'none'::public.lead_duplicate_status,
               null::uuid, null::text, null::boolean;
    end if;
    return;
  end if;

  -- Seller: dados somente de leads próprios e ativos, da empresa resolvida
  -- (sempre a da própria membership). Mesma exclusão do Lead informado.
  return query
    select 'accessible'::public.lead_duplicate_status,
           l.id, l.name, false
      from public.leads l
      where l.company_id = v_ctx.resolved_company_id
        and l.phone_digits = v_digits
        and l.seller_id = v_ctx.actor_seller_id
        and l.archived_at is null
        and l.id is distinct from p_exclude_lead_id
      order by l.created_at desc, l.id;
  v_found_accessible := found;

  select exists (
    select 1 from public.leads l
      where l.company_id = v_ctx.resolved_company_id
        and l.phone_digits = v_digits
        and (l.seller_id is distinct from v_ctx.actor_seller_id
             or l.archived_at is not null)
        and l.id is distinct from p_exclude_lead_id
  ) into v_has_restricted;

  if v_has_restricted then
    return query
      select 'restricted'::public.lead_duplicate_status,
             null::uuid, null::text, null::boolean;
  elsif not v_found_accessible then
    return query
      select 'none'::public.lead_duplicate_status,
             null::uuid, null::text, null::boolean;
  end if;
  return;
end;
$$;

revoke all on function public.check_lead_phone_duplicate(text, uuid, uuid) from public;
revoke all on function public.check_lead_phone_duplicate(text, uuid, uuid) from anon;
revoke all on function public.check_lead_phone_duplicate(text, uuid, uuid) from authenticated;
grant execute on function public.check_lead_phone_duplicate(text, uuid, uuid) to authenticated;

commit;
