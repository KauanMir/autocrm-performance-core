// lib/deals/adapter.ts — adapter de Deals remotas
// (COMMERCIAL-REMOTE-DEALS-B2-A). Puro e determinístico: sem rede, sem
// React, sem store, sem feature flag, sem window/localStorage, sem dados
// globais. Converte RemoteDealRow (Supabase, derivado de Database —
// regenerado contra o banco LOCAL, migration #53) no modelo de apresentação
// remoto. Mesmo padrão exato de lib/visits/adapter.ts/lib/tasks/taskAdapter.ts.
//
// Diferente de Visits/Tasks: NENHUM contexto externo (leadsById) é
// necessário aqui. client_name_snapshot já é persistido pelo backend no
// momento de create_deal (B1-A-PRECHECK §8) — a lista nunca precisa
// resolver o Lead completo, então não há N+1 nem dependência de
// useRemoteLeadsScreenState nesta camada (B2-A-PRECHECK §10/§21).
import type { Database } from '@/lib/supabase/database.types';

export type RemoteDealRow = Database['public']['Tables']['deals']['Row'];

// ── Modelo de apresentação remoto ────────────────────────────────────────
// assignedSellerId: raw id, nunca resolvido para nome aqui — mesma decisão
// de RemoteVisitModel.assignedSellerId/RemoteTaskModel.assignedTo
// (B2-A-PRECHECK §9): nenhuma tela deste lote consome o adapter, e quando
// uma tela futura precisar do nome do Seller, resolve via o catálogo
// remoto já existente na camada de apresentação — nunca uma dependência
// nova aqui. valueCents/downPaymentCents permanecem em centavos — a
// conversão para string R$ é responsabilidade de lib/deals/money.ts,
// chamada pela camada de apresentação, nunca aqui (o modelo remoto é dado,
// não string formatada).
export interface RemoteDealModel {
  id: string;
  leadId: string;
  clientName: string;
  assignedSellerId: string;
  vehicle: string;
  valueCents: number;
  discountPercent: number;
  paymentMethod: RemoteDealRow['payment_method'];
  downPaymentCents: number | null;
  installments: string | null;
  note: string;
  status: RemoteDealRow['status'];
  lostBy: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ── Resultado discriminado (mesmo padrão do adapter de Visits/Tasks) ────

export type DealAdapterErrorCode =
  | 'invalid_status'
  | 'invalid_payment_method'
  | 'invalid_vehicle'
  | 'invalid_value'
  | 'invalid_discount'
  | 'invalid_client_name'
  | 'invalid_version';

export interface DealAdapterError {
  ok: false;
  reason: 'invalid_deal_configuration';
  code: DealAdapterErrorCode;
  dealId: string;
  rowIndex: number | null;
}

export type AdaptDealRowResult = { ok: true; deal: RemoteDealModel } | DealAdapterError;
export type AdaptDealRowsResult = { ok: true; deals: RemoteDealModel[] } | DealAdapterError;

export function isDealAdapterError(
  result: AdaptDealRowResult | AdaptDealRowsResult,
): result is DealAdapterError {
  return result.ok === false;
}

const VALID_STATUSES = new Set(['open', 'lost', 'sold']);
const VALID_PAYMENT_METHODS = new Set([
  'a_vista',
  'financiamento_100',
  'entrada_financiamento',
  'troca',
]);

// ── Adaptação unitária ───────────────────────────────────────────────────

export function adaptRemoteDealRow(row: RemoteDealRow): AdaptDealRowResult {
  return adaptOne(row, null);
}

function adaptOne(row: RemoteDealRow, rowIndex: number | null): AdaptDealRowResult {
  // Runtime guards: os tipos gerados já restringem em compile-time, mas o
  // dado real vem de um transporte externo (PostgREST/JSON) — nunca
  // confiar cegamente num cast. Mesmo padrão de adaptOne
  // (visits/adapter.ts, tasks/taskAdapter.ts).
  if (!VALID_STATUSES.has(row.status)) {
    return { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_status', dealId: row.id, rowIndex };
  }
  if (!VALID_PAYMENT_METHODS.has(row.payment_method)) {
    return { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_payment_method', dealId: row.id, rowIndex };
  }
  if (typeof row.vehicle !== 'string' || row.vehicle.trim() === '') {
    return { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_vehicle', dealId: row.id, rowIndex };
  }
  if (!Number.isFinite(row.value_cents) || row.value_cents <= 0) {
    return { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_value', dealId: row.id, rowIndex };
  }
  if (!Number.isInteger(row.discount_percent) || row.discount_percent < 0 || row.discount_percent > 10) {
    return { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_discount', dealId: row.id, rowIndex };
  }
  if (typeof row.client_name_snapshot !== 'string' || row.client_name_snapshot.trim() === '') {
    return { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_client_name', dealId: row.id, rowIndex };
  }
  if (!Number.isInteger(row.version) || row.version < 1) {
    return { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_version', dealId: row.id, rowIndex };
  }

  const deal: RemoteDealModel = {
    id: row.id,
    leadId: row.lead_id,
    clientName: row.client_name_snapshot,
    assignedSellerId: row.assigned_seller_id,
    vehicle: row.vehicle,
    valueCents: row.value_cents,
    discountPercent: row.discount_percent,
    paymentMethod: row.payment_method,
    downPaymentCents: row.down_payment_cents,
    installments: row.installments,
    note: row.note,
    status: row.status,
    lostBy: row.lost_by,
    lostAt: row.lost_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };

  return { ok: true, deal };
}

// ── Adaptação de lista ───────────────────────────────────────────────────
// Preserva a ordem recebida; falha determinística no PRIMEIRO registro
// inválido (mesmo padrão de adaptRemoteVisitRows/adaptRemoteTaskRows) —
// nunca produz uma lista parcial silenciosa.

export function adaptRemoteDealRows(rows: readonly RemoteDealRow[]): AdaptDealRowsResult {
  const deals: RemoteDealModel[] = [];
  for (let i = 0; i < rows.length; i++) {
    const result = adaptOne(rows[i], i);
    if (isDealAdapterError(result)) return result;
    deals.push(result.deal);
  }
  return { ok: true, deals };
}
