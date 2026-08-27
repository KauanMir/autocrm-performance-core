// lib/managementReport/adapter.ts — KPI-REPORTS-B2-EXEC-FRONTEND §5/§6.
// Traduz o JSON snake_case da RPC get_company_management_report para o
// modelo de domínio camelCase, validando DEFENSIVAMENTE o shape. Qualquer
// desvio do contrato congelado (campo ausente, tipo errado, número não
// finito onde não pode ser null) => ManagementReportError
// ('management_report_contract_invalid'): NUNCA um número fake para
// preencher o buraco, NUNCA NaN/Infinity/undefined vazando para a UI.
//
// Puro: sem React, sem rede. Único ponto de acesso ao JSON cru.
import { ManagementReportError } from '@/lib/managementReport/errors';
import type {
  ManagementReport,
  ManagementReportConversion,
  ManagementReportSellerRow,
  ManagementReportSourceRow,
  ManagementReportSummary,
  ManagementReportTrendPoint,
} from '@/lib/managementReport/types';

function fail(field: string): never {
  throw new ManagementReportError('management_report_contract_invalid', { field });
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(field);
  return value;
}

// Inteiro de contagem: precisa ser um número finito >= 0. Sem coerção de
// string — se o backend mudar o tipo, queremos o erro, não um parse
// silencioso.
function intField(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(key);
  return v;
}

// Valor monetário em centavos: número finito >= 0 (o backend garante isso
// para revenue_cents e para o conjunto de seller_breakdown).
function centsField(obj: Record<string, unknown>, key: string): number {
  return intField(obj, key);
}

// Campo que é number finito OU exatamente null (average_ticket_cents,
// rate_percent). undefined/ausente NÃO conta como null — é violação de
// contrato.
function nullableNumberField(obj: Record<string, unknown>, key: string): number | null {
  if (!(key in obj)) fail(key);
  const v = obj[key];
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(key);
  return v;
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') fail(key);
  return v;
}

function nullableStringField(obj: Record<string, unknown>, key: string): string | null {
  if (!(key in obj)) fail(key);
  const v = obj[key];
  if (v === null) return null;
  if (typeof v !== 'string') fail(key);
  return v;
}

function adaptConversion(raw: unknown): ManagementReportConversion {
  const obj = asRecord(raw, 'summary.deal_to_sale_conversion');
  const cohortDealsCount = intField(obj, 'cohort_deals_count');
  const convertedDealsCount = intField(obj, 'converted_deals_count');
  const ratePercent = nullableNumberField(obj, 'rate_percent');
  // Coerência do contrato: coorte vazia <=> taxa null; converted nunca
  // maior que a coorte (ADDENDUM §5/§6, provado por supabase/tests/69).
  if (cohortDealsCount === 0 && ratePercent !== null) fail('summary.deal_to_sale_conversion.rate_percent');
  if (cohortDealsCount > 0 && ratePercent === null) fail('summary.deal_to_sale_conversion.rate_percent');
  if (convertedDealsCount > cohortDealsCount) fail('summary.deal_to_sale_conversion.converted_deals_count');
  return { cohortDealsCount, convertedDealsCount, ratePercent };
}

function adaptSummary(raw: unknown): ManagementReportSummary {
  const obj = asRecord(raw, 'summary');
  const salesCount = intField(obj, 'sales_count');
  const averageTicketCents = nullableNumberField(obj, 'average_ticket_cents');
  // salesCount 0 <=> ticket null (ADDENDUM §4).
  if (salesCount === 0 && averageTicketCents !== null) fail('summary.average_ticket_cents');
  if (salesCount > 0 && averageTicketCents === null) fail('summary.average_ticket_cents');
  return {
    leadsReceived: intField(obj, 'leads_received'),
    salesCount,
    revenueCents: centsField(obj, 'revenue_cents'),
    averageTicketCents,
    visitsCompleted: intField(obj, 'visits_completed'),
    tasksCompleted: intField(obj, 'tasks_completed'),
    dealToSaleConversion: adaptConversion(obj['deal_to_sale_conversion']),
  };
}

function adaptSellerRow(raw: unknown, index: number): ManagementReportSellerRow {
  const obj = asRecord(raw, `seller_breakdown[${index}]`);
  return {
    sellerId: nullableStringField(obj, 'seller_id'),
    sellerName: stringField(obj, 'seller_name'),
    tasksCompleted: intField(obj, 'tasks_completed'),
    visitsCompleted: intField(obj, 'visits_completed'),
    dealsCreated: intField(obj, 'deals_created'),
    salesCount: intField(obj, 'sales_count'),
    revenueCents: centsField(obj, 'revenue_cents'),
  };
}

function adaptSourceRow(raw: unknown, index: number): ManagementReportSourceRow {
  const obj = asRecord(raw, `source_breakdown[${index}]`);
  const sourceLabel = stringField(obj, 'source_label');
  if (sourceLabel.trim() === '') fail(`source_breakdown[${index}].source_label`);
  return {
    sourceKey: stringField(obj, 'source_key'),
    sourceLabel,
    leadsReceived: intField(obj, 'leads_received'),
    salesCount: intField(obj, 'sales_count'),
  };
}

const TREND_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function adaptTrendPoint(raw: unknown, index: number): ManagementReportTrendPoint {
  const obj = asRecord(raw, `trend[${index}]`);
  const date = stringField(obj, 'date');
  if (!TREND_DATE_RE.test(date)) fail(`trend[${index}].date`);
  return {
    date,
    leadsReceived: intField(obj, 'leads_received'),
    salesCount: intField(obj, 'sales_count'),
  };
}

export function adaptManagementReport(raw: unknown): ManagementReport {
  const root = asRecord(raw, 'report');

  const periodObj = asRecord(root['period'], 'period');
  const timezone = stringField(periodObj, 'timezone');
  if (timezone.trim() === '') fail('period.timezone');
  const trendGranularity = stringField(periodObj, 'trend_granularity');
  if (trendGranularity !== 'day') fail('period.trend_granularity');

  const period = {
    start: stringField(periodObj, 'start'),
    end: stringField(periodObj, 'end'),
    timezone,
    trendGranularity: 'day' as const,
  };

  const summary = adaptSummary(root['summary']);
  const sellerBreakdown = asArray(root['seller_breakdown'], 'seller_breakdown').map(adaptSellerRow);
  const sourceBreakdown = asArray(root['source_breakdown'], 'source_breakdown').map(adaptSourceRow);
  const trend = asArray(root['trend'], 'trend').map(adaptTrendPoint);

  return { period, summary, sellerBreakdown, sourceBreakdown, trend };
}
