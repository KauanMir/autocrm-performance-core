-- PODIUM-COMPETITION-R1-EXEC — leaderboard company-wide agregado, único
-- objeto novo desta etapa: nenhuma tabela nova, nenhuma alteração de RLS em
-- sales/visits/sellers (§5/§9 do EXEC). A RPC agrega server-side e nunca
-- devolve linhas brutas de Sale/Visit/Deal/Lead — Seller continua
-- exatamente com a mesma visibilidade de sempre nas tabelas base
-- (sales_select/visits_select intocadas), só ganha um AGREGADO da empresa
-- inteira, calculado com privilégio do dono da função (SECURITY DEFINER),
-- nunca lido diretamente pelo cliente.
--
-- Autorização (§3/§4 do EXEC), mesmo espírito de update_company_settings/
-- update_company_logo:
--   A. Manager OU Seller com membership ATIVA — empresa SEMPRE derivada de
--      current_membership_company_id() (nunca de p_company_id fornecido
--      pelo client). Ambos os papéis recebem o MESMO leaderboard (nenhuma
--      ampliação de RLS: a agregação roda dentro da própria função, o
--      cliente nunca lê sales/visits diretamente).
--   B. Platform Super Admin — para uma p_company_id EXPLÍCITA, validada via
--      can_access_company(). Nenhuma UI usa este ramo ainda (future-proof
--      para o modo "Super Admin escolhe empresa", mesmo motivo já
--      documentado em update_company_settings/update_company_logo).
--   Sem sessão: nunca autorizado.
--
-- Status (mesmo gate de leads_select/list_current_company_seller_labels):
-- só 'ativa' concede leitura operacional — mais restrito que
-- can_access_company() de propósito, para QUALQUER ator (Super Admin
-- incluso).
--
-- Roster (§6/§7 do EXEC): TODOS os sellers.is_active=true da empresa —
-- LEFT JOIN dos agregados sobre o roster ativo, nunca o inverso (nunca
-- parte de quem tem Sale). Seller inativo/offboarded nunca aparece na
-- competição atual — histórico de Sales dele continua intacto em
-- Resultados/relatórios, esta RPC simplesmente não o inclui no roster.
--
-- Período (§8/§9): boundaries absolutos (timestamptz) já resolvidos pelo
-- client via companyPeriod.ts/companies.timezone — a RPC nunca decide
-- timezone, só filtra sales.sold_at/visits.closed_at dentro do range
-- recebido. "Visita realizada" = visits.status='completed' (nunca
-- scheduled/confirmed/canceled) — closed_at (não scheduled_at) é o
-- timestamp usado para o filtro de período, porque é o instante real em
-- que a visita foi concluída (scheduled_at é só a intenção original,
-- constraint visits_outcome_consistency_ck/visits_closed_consistency_ck do
-- B1 garantem closed_at not null exatamente quando completed).
--
-- Tie-break (§12/§13/§14 do EXEC), congelado nesta ordem:
--   1. sale_count DESC
--   2. completed_visit_count DESC
--   3. MAX(sold_at) dentro do período ASC (quem atingiu o total atual
--      primeiro fica acima — menor timestamp = chegou antes); NULL (zero
--      Sales no período) fica atrás por construção (só empata entre si)
--   4. seller_label ASC, seller_id ASC — fallback determinístico final
-- row_number() sobre essa ordenação completa garante posição SEMPRE única
-- (1,2,3,4... nunca 1,1,3) — nunca rank()/dense_rank() (§15).
begin;

create function public.list_company_seller_leaderboard(
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_company_id   uuid default null
)
returns table (
  seller_id              text,
  seller_label           text,
  sale_count             integer,
  completed_visit_count  integer,
  rank                   integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_status     public.company_status;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_company_id is not null then
    -- Ramo Super Admin (§3 do EXEC): só company EXPLÍCITA e autorizada via
    -- can_access_company() — nunca aceita cru sem checagem. Nenhuma UI usa
    -- este ramo hoje.
    if not (public.is_platform_super_admin() and public.can_access_company(p_company_id)) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
    v_company_id := p_company_id;
  else
    -- Ramo Manager/Seller: empresa SEMPRE derivada da identidade real do
    -- ator (nunca de um parâmetro do client). current_membership_company_id()
    -- só retorna não-nulo quando existe exatamente 1 membership ativa
    -- (Manager OU Seller) — role não precisa ser checado separadamente.
    v_company_id := public.current_membership_company_id();
    if v_company_id is null then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise invalid_parameter_value using message = 'invalid_period';
  end if;

  select c.status into v_status from public.companies c where c.id = v_company_id;
  if v_status is distinct from 'ativa' then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  return query
  with roster as (
    select s.id, s.name
      from public.sellers s
     where s.company_id = v_company_id
       and s.is_active
  ),
  sales_agg as (
    select sa.assigned_seller_id as id,
           count(*)::int as sale_count,
           max(sa.sold_at) as last_sale_at
      from public.sales sa
     where sa.company_id = v_company_id
       and sa.sold_at >= p_period_start
       and sa.sold_at <= p_period_end
     group by sa.assigned_seller_id
  ),
  visits_agg as (
    select v.assigned_seller_id as id,
           count(*)::int as completed_visit_count
      from public.visits v
     where v.company_id = v_company_id
       and v.status = 'completed'
       and v.closed_at >= p_period_start
       and v.closed_at <= p_period_end
     group by v.assigned_seller_id
  )
  select
    r.id   as seller_id,
    r.name as seller_label,
    coalesce(sa.sale_count, 0)::int as sale_count,
    coalesce(va.completed_visit_count, 0)::int as completed_visit_count,
    (row_number() over (
       order by
         coalesce(sa.sale_count, 0) desc,
         coalesce(va.completed_visit_count, 0) desc,
         sa.last_sale_at asc nulls last,
         r.name asc,
         r.id asc
     ))::int as rank
    from roster r
    left join sales_agg sa on sa.id = r.id
    left join visits_agg va on va.id = r.id
    -- ORDER BY explícito na query final: row_number() calcula o rank
    -- corretamente em qualquer ordem de entrega, mas sem este ORDER BY o
    -- Postgres não garante que as linhas CHEGAM ao cliente na ordem do
    -- rank — o frontend depende da ordem do array (Top 3 = 3 primeiras
    -- linhas) para nunca precisar reordenar por conta própria.
    order by rank;
end;
$$;

revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from public;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.list_company_seller_leaderboard(timestamptz, timestamptz, uuid) to authenticated;

commit;
