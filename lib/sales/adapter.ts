// lib/sales/adapter.ts — adapter de Sales remotas (COMMERCIAL-REMOTE-
// SALES-A2). Puro e determinístico: sem rede, sem React, sem store, sem
// feature flag, sem window/localStorage, sem dados globais. Converte
// RemoteSaleRow (Supabase, derivado de Database — regenerado contra o
// banco LOCAL, migration #54) no modelo de apresentação remoto. Mesmo
// padrão exato de lib/deals/adapter.ts.
//
// Sem `status`: Sale nasce final e imutável (migration #54) — não existe
// sale_status neste V1, então o adapter nunca precisa validar/expor um
// campo que não existe na row.
import type { Database } from '@/lib/supabase/database.types';

export type RemoteSaleRow = Database['public']['Tables']['sales']['Row'];

// ── Modelo de apresentação remoto ────────────────────────────────────────
// assignedSellerId: raw id, nunca resolvido para nome aqui — mesma decisão
// de RemoteDealModel.assignedSellerId (SALES-A1-PRECHECK §7): a tela
// resolve o nome via o catálogo remoto já existente (useCurrentCompany
// SellerLabels), nunca uma dependência nova aqui. soldValueCents permanece
// em centavos — a conversão para string R$ é responsabilidade de
// lib/deals/money.ts (reaproveitado, nenhum formatter novo).
export interface RemoteSaleModel {
  id: string;
  companyId: string;
  dealId: string;
  leadId: string;
  assignedSellerId: string;
  soldValueCents: number;
  paymentMethod: RemoteSaleRow['payment_method'];
  soldBy: string;
  soldAt: string;
  createdAt: string;
}

// ── Resultado discriminado (mesmo padrão do adapter de Deals/Visits/Tasks) ─

export type SaleAdapterErrorCode =
  | 'invalid_payment_method'
  | 'invalid_sold_value'
  | 'invalid_deal_id'
  | 'invalid_lead_id'
  | 'invalid_seller_id'
  | 'invalid_sold_by';

export interface SaleAdapterError {
  ok: false;
  reason: 'invalid_sale_configuration';
  code: SaleAdapterErrorCode;
  saleId: string;
  rowIndex: number | null;
}

export type AdaptSaleRowResult = { ok: true; sale: RemoteSaleModel } | SaleAdapterError;
export type AdaptSaleRowsResult = { ok: true; sales: RemoteSaleModel[] } | SaleAdapterError;

export function isSaleAdapterError(
  result: AdaptSaleRowResult | AdaptSaleRowsResult,
): result is SaleAdapterError {
  return result.ok === false;
}

// Mesmos 4 valores do enum deal_payment_method (reaproveitado sem
// duplicação — Sale nunca inventa um enum próprio, SALES-A1-PRECHECK §9).
const VALID_PAYMENT_METHODS = new Set([
  'a_vista',
  'financiamento_100',
  'entrada_financiamento',
  'troca',
]);

// ── Adaptação unitária ───────────────────────────────────────────────────

export function adaptRemoteSaleRow(row: RemoteSaleRow): AdaptSaleRowResult {
  return adaptOne(row, null);
}

function adaptOne(row: RemoteSaleRow, rowIndex: number | null): AdaptSaleRowResult {
  // Runtime guards: os tipos gerados já restringem em compile-time, mas o
  // dado real vem de um transporte externo (PostgREST/JSON) — nunca
  // confiar cegamente num cast. Mesmo padrão de adaptOne (deals/adapter.ts).
  if (!VALID_PAYMENT_METHODS.has(row.payment_method)) {
    return { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_payment_method', saleId: row.id, rowIndex };
  }
  if (!Number.isFinite(row.sold_value_cents) || row.sold_value_cents <= 0) {
    return { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_sold_value', saleId: row.id, rowIndex };
  }
  if (typeof row.deal_id !== 'string' || row.deal_id.trim() === '') {
    return { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_deal_id', saleId: row.id, rowIndex };
  }
  if (typeof row.lead_id !== 'string' || row.lead_id.trim() === '') {
    return { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_lead_id', saleId: row.id, rowIndex };
  }
  if (typeof row.assigned_seller_id !== 'string' || row.assigned_seller_id.trim() === '') {
    return { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_seller_id', saleId: row.id, rowIndex };
  }
  if (typeof row.sold_by !== 'string' || row.sold_by.trim() === '') {
    return { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_sold_by', saleId: row.id, rowIndex };
  }

  const sale: RemoteSaleModel = {
    id: row.id,
    companyId: row.company_id,
    dealId: row.deal_id,
    leadId: row.lead_id,
    assignedSellerId: row.assigned_seller_id,
    soldValueCents: row.sold_value_cents,
    paymentMethod: row.payment_method,
    soldBy: row.sold_by,
    soldAt: row.sold_at,
    createdAt: row.created_at,
  };

  return { ok: true, sale };
}

// ── Adaptação de lista ───────────────────────────────────────────────────
// Preserva a ordem recebida; falha determinística no PRIMEIRO registro
// inválido (mesmo padrão de adaptRemoteDealRows) — nunca produz uma lista
// parcial silenciosa.

export function adaptRemoteSaleRows(rows: readonly RemoteSaleRow[]): AdaptSaleRowsResult {
  const sales: RemoteSaleModel[] = [];
  for (let i = 0; i < rows.length; i++) {
    const result = adaptOne(rows[i], i);
    if (isSaleAdapterError(result)) return result;
    sales.push(result.sale);
  }
  return { ok: true, sales };
}
