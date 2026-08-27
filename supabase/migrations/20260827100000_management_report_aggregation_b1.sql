-- KPI-REPORTS-B1-EXEC-BACKEND — Management Report V1 (aggregation only).
-- Fonte: KPI_REPORTS_A2_DESIGN + AUTHORITATIVE CONTRACT ADDENDUM (freeze
-- de produto e matemática) + KPI_REPORTS_B1_EXEC_BACKEND. Precheck A1 e
-- design A2 já concluídos — esta migration NÃO reinterpreta KPI.
--
-- Escopo desta migration (UMA migration coesa, EXEC §3):
--   1. índice  public.leads(company_id, created_at) — NÃO parcial
--   2. RPC     public.get_company_management_report(...) returns jsonb
--   3. pgTAP   supabase/tests/69_management_report_aggregation_b1.sql
--
-- NÃO cria tabela nova (kpi_snapshots/daily_kpis/report_cache/etc — EXEC
-- §4). NÃO altera RLS. NÃO altera frontend. NÃO implementa comparação de
-- período, drilldown, first-contact, Lead→Venda, Visita→Venda, motivos de
-- perda (EXEC §24/§40/§41/§42, ADDENDUM §24).
--
-- ─────────────────────────────────────────────────────────────────────
-- ÍNDICE (EXEC §5 / ADDENDUM §22)
-- ─────────────────────────────────────────────────────────────────────
-- "Leads recebidos" histórico inclui arquivados (archived_at IS NOT NULL).
-- O índice parcial existente leads_company_active_idx (... WHERE
-- archived_at IS NULL, migration 20260719202005) NÃO cobre essa consulta.
-- Criamos o índice completo (company_id, created_at) — usado pelo KPI 1,
-- pelo source_breakdown.leads_received e pela série de Leads do trend.
-- Naming coerente com o padrão leads_company_*_idx do repo. Nenhum outro
-- índice "por garantia" (EXEC §5).
--
-- ─────────────────────────────────────────────────────────────────────
-- RPC public.get_company_management_report (EXEC §6 / ADDENDUM §1)
-- ─────────────────────────────────────────────────────────────────────
-- Assinatura congelada:
--   get_company_management_report(
--     p_period_start timestamptz,
--     p_period_end   timestamptz,
--     p_company_id   uuid DEFAULT NULL
--   ) RETURNS jsonb
-- Sem overload. SECURITY DEFINER, search_path = '' (padrão do repo).
--
-- PERÍODO (EXEC §7-§8 / ADDENDUM §2):
--   [p_period_start, p_period_end) — start inclusive, end exclusive.
--   Ambos NOT NULL e start < end, senão erro estável sanitizado
--   (invalid_parameter_value). Sem fallback "todos os tempos". Todos os
--   KPIs de ATIVIDADE usam EXATAMENTE o mesmo intervalo absoluto.
--
-- AUTORIZAÇÃO (EXEC §9-§12 / ADDENDUM §21):
--   Reutiliza _resolve_commercial_read_company (migration 20260825160000)
--   — mesma autoridade única já validada (is_platform_super_admin /
--   can_access_company / current_membership_company_id), sem novo
--   resolver. Como esse resolver TAMBÉM resolve a empresa de um Seller,
--   adicionamos um gate explícito de relatório gerencial LOGO APÓS a
--   resolução: só Manager (própria empresa) e Super Admin contextual
--   (empresa explícita e autorizada) passam. Seller: deny (42501), mesmo
--   conseguindo resolver a própria empresa. Super Admin global sem
--   company: deny (22023, via resolver). Sem sessão: deny (28000, via
--   resolver). Company suspensa: Super Admin contextual lê (can_access_
--   company já permite) — RPC é read-only, nenhuma mutation existe.
--   Isolamento: Manager passando outra company continua limitado à
--   própria; Company A nunca retorna dado de B.
--
-- RESPOSTA (ADDENDUM §3): contrato jsonb EXATO —
--   { period{start,end,timezone,trend_granularity},
--     summary{leads_received, sales_count, revenue_cents,
--             average_ticket_cents, visits_completed, tasks_completed,
--             deal_to_sale_conversion{cohort_deals_count,
--             converted_deals_count, rate_percent}},
--     seller_breakdown[{seller_id, seller_name, tasks_completed,
--             visits_completed, deals_created, sales_count, revenue_cents}],
--     source_breakdown[{source_key, source_label, leads_received,
--             sales_count}],
--     trend[{date, leads_received, sales_count}] }
--   Nenhum campo extra "porque pode ser útil depois" (EXEC §13).
--
-- KPIs (EXEC §14-§21 / ADDENDUM §4-§6):
--   1 leads_received      = count(leads) por leads.created_at no período.
--                           archived_at NÃO filtrado (arquivados contam).
--                           Leads importados contam no created_at do import.
--   2 sales_count         = count(sales) por sales.sold_at no período
--                           (append-only; Deal.status nunca é autoridade).
--   3 revenue_cents       = sum(sales.sold_value_cents) do mesmo conjunto.
--                           bigint >= 0; sem Sales -> 0. Nunca deals.*/leads.*
--   4 average_ticket_cents= revenue_cents / sales_count, arredondado ao
--                           centavo via numeric. sales_count = 0 -> NULL
--                           (nunca 0 como média de conjunto vazio).
--   5 visits_completed    = count(visits) status='completed' por closed_at
--                           no período (nunca created_at/scheduled_at/
--                           status='confirmed').
--   6 tasks_completed     = count(tasks) status='completed' por completed_at
--                           no período (nunca created_at/due_at; sem
--                           snapshot de atrasadas).
--   7 deal_to_sale_conversion — COHORT (nunca "Sales do período / Deals do
--     período"): denominator = Deals com created_at no período;
--     numerator  = dessas, quantas têm Sale vinculada via sales.deal_id
--     avaliada ATÉ AGORA (a Sale pode ter sold_at > p_period_end e ainda
--     conta). rate_percent = 100 * numerator/denominator, 2 casas; cohort
--     = 0 -> NULL (nunca NaN/Infinity/0% fingido). cohort/converted sempre
--     retornados como contagem (EXEC §21).
--
-- SELLER BREAKDOWN (EXEC §27-§30 / ADDENDUM §7-§9): 5 métricas históricas
--   por Seller, atribuídas SEMPRE pelo seller persistido na própria
--   linha/evento (tasks/visits/deals/sales.assigned_seller_id) — NUNCA
--   Lead assignment (não há histórico de Lead assignment; Lead
--   reatribuído não muda nada aqui). Sellers offboarded com atividade no
--   período aparecem com o nome histórico real (join sem filtro de
--   is_active; roster ativo do Pódio NÃO é usado — semânticas diferentes).
--   assigned_seller_id NULL (só possível em tasks) -> bucket único
--   { seller_id: null, seller_name: 'Sem vendedor' }, nunca descartado,
--   nunca id falso. Ordem determinística (não é ranking competitivo):
--   sales_count desc, revenue_cents desc, seller_name asc, seller_id asc
--   nulls last.
--
-- SOURCE BREAKDOWN (EXEC §31-§34 / ADDENDUM §10-§13): normalização
--   source_key = lower(btrim(leads.source)); NULL/blank/só-espaços ->
--   '__not_informed__'. NUNCA altera public.leads.source. source_label =
--   initcap(source_key) para V1 (siglas humanizadas por initcap é aceito
--   pelo A2), '__not_informed__' -> 'Não informado'. leads_received =
--   coorte de Leads recebidos no período por leads.created_at (arquivados
--   contam). sales_count = Sales com sold_at no período, atribuídas via
--   sales.lead_id -> leads.source (source real do Lead, nunca inferido por
--   Seller). Sem conversion/revenue por source na V1. Ordem: leads_received
--   desc, sales_count desc, source_label asc.
--
-- TREND (EXEC §35-§37 / ADDENDUM §14-§19): SOMENTE Leads x Vendas.
--   Granularidade DAY fixa (sem week/month/auto). Cada bucket = um DIA
--   CIVIL no timezone da empresa (companies.timezone — nunca UTC puro,
--   nunca fuso do servidor/sessão/navegador). Authorities: leads.created_at
--   e sales.sold_at, mesmo [p_period_start, p_period_end). Zero-fill: todos
--   os dias civis TOCADOS por [start, end) existem com 0/0 (gráfico
--   contínuo sem reconstrução client-side). date = 'YYYY-MM-DD' civil.
--
-- PERFORMANCE (EXEC §39): agregação 100% server-side; payload só agregado;
--   nenhuma linha crua de Leads/Tasks/Visits/Deals/Sales sai da RPC.
--
-- MONEY (EXEC §44 / ADDENDUM §4): centavos como bigint na autoridade;
--   média calculada em numeric e arredondada ao centavo antes do inteiro;
--   sem float para dinheiro.

begin;

-- ── 1. índice ────────────────────────────────────────────────────────────
create index leads_company_created_at_idx
  on public.leads (company_id, created_at);

-- ── 2. RPC ───────────────────────────────────────────────────────────────
create function public.get_company_management_report(
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_company_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_tz         text;
  v_result     jsonb;
begin
  -- ── período (EXEC §7): validação de input, estável e sanitizada ────────
  if p_period_start is null or p_period_end is null then
    raise invalid_parameter_value using message = 'period_required';
  end if;
  if p_period_start >= p_period_end then
    raise invalid_parameter_value using message = 'period_invalid';
  end if;

  -- ── autorização ───────────────────────────────────────────────────────
  -- Resolver compartilhado: unauthenticated -> 28000; Super Admin sem
  -- company -> 22023; Super Admin + company não autorizada/inexistente/
  -- cancelada -> 42501; Manager/Seller -> SEMPRE a própria empresa
  -- (p_company_id ignorado para eles).
  v_company_id := public._resolve_commercial_read_company(p_company_id);

  -- Gate explícito de RELATÓRIO GERENCIAL (EXEC §10): o resolver acima
  -- também resolve a empresa de um Seller — negamos Seller aqui mesmo
  -- assim. Só Manager e Super Admin contextual passam.
  if not public.is_platform_super_admin()
     and public.current_membership_role() is distinct from 'manager'::public.company_role then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- timezone civil oficial da empresa (autoridade dos buckets do trend)
  select c.timezone into v_tz
    from public.companies c
   where c.id = v_company_id;

  -- ── agregação (100% server-side, uma única query) ─────────────────────
  with
  -- ===== SUMMARY =====
  s_leads as (
    select count(*)::bigint as leads_received
      from public.leads
     where company_id = v_company_id
       and created_at >= p_period_start
       and created_at <  p_period_end
  ),
  s_sales as (
    select count(*)::bigint                             as sales_count,
           coalesce(sum(sold_value_cents), 0)::bigint   as revenue_cents
      from public.sales
     where company_id = v_company_id
       and sold_at >= p_period_start
       and sold_at <  p_period_end
  ),
  s_visits as (
    select count(*)::bigint as visits_completed
      from public.visits
     where company_id = v_company_id
       and status = 'completed'
       and closed_at >= p_period_start
       and closed_at <  p_period_end
  ),
  s_tasks as (
    select count(*)::bigint as tasks_completed
      from public.tasks
     where company_id = v_company_id
       and status = 'completed'
       and completed_at >= p_period_start
       and completed_at <  p_period_end
  ),
  s_cohort as (
    select
      count(*)::bigint as cohort_deals_count,
      count(*) filter (
        where exists (select 1 from public.sales sx where sx.deal_id = d.id)
      )::bigint as converted_deals_count
      from public.deals d
     where d.company_id = v_company_id
       and d.created_at >= p_period_start
       and d.created_at <  p_period_end
  ),
  -- ===== SELLER BREAKDOWN =====
  sb_tasks as (
    select assigned_seller_id as sid, count(*)::bigint as tasks_completed
      from public.tasks
     where company_id = v_company_id and status = 'completed'
       and completed_at >= p_period_start and completed_at < p_period_end
     group by assigned_seller_id
  ),
  sb_visits as (
    select assigned_seller_id as sid, count(*)::bigint as visits_completed
      from public.visits
     where company_id = v_company_id and status = 'completed'
       and closed_at >= p_period_start and closed_at < p_period_end
     group by assigned_seller_id
  ),
  sb_deals as (
    select assigned_seller_id as sid, count(*)::bigint as deals_created
      from public.deals
     where company_id = v_company_id
       and created_at >= p_period_start and created_at < p_period_end
     group by assigned_seller_id
  ),
  sb_sales as (
    select assigned_seller_id as sid,
           count(*)::bigint as sales_count,
           coalesce(sum(sold_value_cents), 0)::bigint as revenue_cents
      from public.sales
     where company_id = v_company_id
       and sold_at >= p_period_start and sold_at < p_period_end
     group by assigned_seller_id
  ),
  sb_ids as (
    select sid from sb_tasks
    union select sid from sb_visits
    union select sid from sb_deals
    union select sid from sb_sales
  ),
  sb_rows as (
    select
      i.sid,
      case when i.sid is null then 'Sem vendedor'
           else coalesce(sel.name, 'Sem vendedor') end as seller_name,
      coalesce(t.tasks_completed,  0) as tasks_completed,
      coalesce(v.visits_completed, 0) as visits_completed,
      coalesce(d.deals_created,    0) as deals_created,
      coalesce(sa.sales_count,     0) as sales_count,
      coalesce(sa.revenue_cents,   0) as revenue_cents
      from sb_ids i
      left join public.sellers sel
        on sel.id = i.sid and sel.company_id = v_company_id
      left join sb_tasks  t  on t.sid  is not distinct from i.sid
      left join sb_visits v  on v.sid  is not distinct from i.sid
      left join sb_deals  d  on d.sid  is not distinct from i.sid
      left join sb_sales  sa on sa.sid is not distinct from i.sid
  ),
  sb_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'seller_id',        sid,
          'seller_name',      seller_name,
          'tasks_completed',  tasks_completed,
          'visits_completed', visits_completed,
          'deals_created',    deals_created,
          'sales_count',      sales_count,
          'revenue_cents',    revenue_cents
        )
        order by sales_count desc, revenue_cents desc, seller_name asc, sid asc nulls last
      ),
      '[]'::jsonb
    ) as data
    from sb_rows
  ),
  -- ===== SOURCE BREAKDOWN =====
  src_leads as (
    select
      case when btrim(coalesce(source, '')) = '' then '__not_informed__'
           else lower(btrim(source)) end as source_key,
      count(*)::bigint as leads_received
      from public.leads
     where company_id = v_company_id
       and created_at >= p_period_start and created_at < p_period_end
     group by 1
  ),
  src_sales as (
    select
      case when btrim(coalesce(l.source, '')) = '' then '__not_informed__'
           else lower(btrim(l.source)) end as source_key,
      count(*)::bigint as sales_count
      from public.sales s
      join public.leads l
        on l.id = s.lead_id and l.company_id = v_company_id
     where s.company_id = v_company_id
       and s.sold_at >= p_period_start and s.sold_at < p_period_end
     group by 1
  ),
  src_keys as (
    select source_key from src_leads
    union
    select source_key from src_sales
  ),
  src_rows as (
    select
      k.source_key,
      case when k.source_key = '__not_informed__' then 'Não informado'
           else initcap(k.source_key) end as source_label,
      coalesce(sl.leads_received, 0) as leads_received,
      coalesce(ss.sales_count,    0) as sales_count
      from src_keys k
      left join src_leads sl on sl.source_key = k.source_key
      left join src_sales ss on ss.source_key = k.source_key
  ),
  src_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source_key',     source_key,
          'source_label',   source_label,
          'leads_received', leads_received,
          'sales_count',    sales_count
        )
        order by leads_received desc, sales_count desc, source_label asc
      ),
      '[]'::jsonb
    ) as data
    from src_rows
  ),
  -- ===== TREND (dia civil no timezone da empresa) =====
  tr_days as (
    select gd::date as bucket_date
      from generate_series(
        (p_period_start at time zone v_tz)::date,
        ((p_period_end at time zone v_tz) - interval '1 microsecond')::date,
        interval '1 day'
      ) as gd
  ),
  tr_leads as (
    select (created_at at time zone v_tz)::date as bucket_date,
           count(*)::bigint as leads_received
      from public.leads
     where company_id = v_company_id
       and created_at >= p_period_start and created_at < p_period_end
     group by 1
  ),
  tr_sales as (
    select (sold_at at time zone v_tz)::date as bucket_date,
           count(*)::bigint as sales_count
      from public.sales
     where company_id = v_company_id
       and sold_at >= p_period_start and sold_at < p_period_end
     group by 1
  ),
  tr_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date',           to_char(dd.bucket_date, 'YYYY-MM-DD'),
          'leads_received', coalesce(tl.leads_received, 0),
          'sales_count',    coalesce(tsx.sales_count, 0)
        )
        order by dd.bucket_date
      ),
      '[]'::jsonb
    ) as data
    from tr_days dd
    left join tr_leads tl  on tl.bucket_date  = dd.bucket_date
    left join tr_sales tsx on tsx.bucket_date = dd.bucket_date
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'start',             to_jsonb(p_period_start),
      'end',               to_jsonb(p_period_end),
      'timezone',          v_tz,
      'trend_granularity', 'day'
    ),
    'summary', jsonb_build_object(
      'leads_received', sl.leads_received,
      'sales_count',    ss.sales_count,
      'revenue_cents',  ss.revenue_cents,
      'average_ticket_cents',
        case when ss.sales_count = 0 then null
             else round(ss.revenue_cents::numeric / ss.sales_count)::bigint end,
      'visits_completed', sv.visits_completed,
      'tasks_completed',  st.tasks_completed,
      'deal_to_sale_conversion', jsonb_build_object(
        'cohort_deals_count',    sc.cohort_deals_count,
        'converted_deals_count', sc.converted_deals_count,
        'rate_percent',
          case when sc.cohort_deals_count = 0 then null
               else round(100.0 * sc.converted_deals_count / sc.cohort_deals_count, 2) end
      )
    ),
    'seller_breakdown', sbj.data,
    'source_breakdown', srcj.data,
    'trend',            trj.data
  )
  into v_result
  from s_leads sl, s_sales ss, s_visits sv, s_tasks st, s_cohort sc,
       sb_json sbj, src_json srcj, tr_json trj;

  return v_result;
end;
$$;

revoke all on function public.get_company_management_report(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_company_management_report(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.get_company_management_report(timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.get_company_management_report(timestamptz, timestamptz, uuid) to authenticated;

commit;
