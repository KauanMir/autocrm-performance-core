// lib/managementReport/types.ts — modelo de domínio (camelCase) do
// relatório gerencial. A RPC public.get_company_management_report devolve
// JSON snake_case; o adapter (lib/managementReport/adapter.ts) é o ÚNICO
// ponto que traduz snake_case -> este shape. Nenhum componente/hook toca
// no JSON cru (KPI-REPORTS-B2-EXEC-FRONTEND §5).
//
// Autoridade da assinatura da RPC: lib/supabase/database.types.ts
// (get_company_management_report -> Returns: Json). O contrato de conteúdo
// do Json é KPI_REPORTS_A2_DESIGN + AUTHORITATIVE CONTRACT ADDENDUM,
// implementado e provado por supabase/migrations/20260827100000_*.sql +
// supabase/tests/69_*.sql.

// Granularidade do trend. O backend V1 sempre devolve 'day' (ADDENDUM §14/
// §20) — union de um elemento só, mas explícito para o dia em que o
// contrato crescer.
export type ManagementReportTrendGranularity = 'day';

export interface ManagementReportPeriod {
  // Eco dos timestamptz absolutos enviados (ISO 8601 com offset).
  start: string;
  end: string;
  // companies.timezone da empresa resolvida — autoridade para interpretar
  // as datas civis do trend (nunca o timezone do navegador).
  timezone: string;
  trendGranularity: ManagementReportTrendGranularity;
}

export interface ManagementReportConversion {
  cohortDealsCount: number;
  convertedDealsCount: number;
  // null quando cohortDealsCount === 0 (ADDENDUM §5) — NUNCA 0/NaN/Infinity.
  ratePercent: number | null;
}

export interface ManagementReportSummary {
  leadsReceived: number;
  salesCount: number;
  revenueCents: number;
  // null quando salesCount === 0 (ADDENDUM §4) — a UI mostra "Sem vendas",
  // nunca "R$ 0,00".
  averageTicketCents: number | null;
  visitsCompleted: number;
  tasksCompleted: number;
  dealToSaleConversion: ManagementReportConversion;
}

export interface ManagementReportSellerRow {
  // null representa o bucket único "Sem vendedor" (ADDENDUM §8). O
  // sellerName já vem resolvido do backend ('Sem vendedor' nesse caso).
  sellerId: string | null;
  sellerName: string;
  tasksCompleted: number;
  visitsCompleted: number;
  dealsCreated: number;
  salesCount: number;
  revenueCents: number;
}

export interface ManagementReportSourceRow {
  // Chave normalizada pelo backend (lower/trim; '__not_informed__' para
  // origem ausente). Usada só como React key, nunca re-normalizada.
  sourceKey: string;
  // Label humana já decidida pelo backend (initcap; 'Não informado').
  sourceLabel: string;
  leadsReceived: number;
  salesCount: number;
}

export interface ManagementReportTrendPoint {
  // Data civil 'YYYY-MM-DD' no timezone da empresa. Formatada para exibição
  // SEM new Date() (KPI-REPORTS-B2-EXEC-FRONTEND §30 — sem reinterpretar
  // timezone).
  date: string;
  leadsReceived: number;
  salesCount: number;
}

export interface ManagementReport {
  period: ManagementReportPeriod;
  summary: ManagementReportSummary;
  // Ordem determinística já garantida pelo backend (ADDENDUM §9) — a UI
  // NUNCA re-ordena.
  sellerBreakdown: ManagementReportSellerRow[];
  // Ordem determinística já garantida pelo backend (ADDENDUM §13).
  sourceBreakdown: ManagementReportSourceRow[];
  // Série diária já com zero-fill dos dias sem atividade (ADDENDUM §17) —
  // a UI NUNCA reconstrói buckets.
  trend: ManagementReportTrendPoint[];
}
