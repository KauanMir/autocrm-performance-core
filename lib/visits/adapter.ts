// lib/visits/adapter.ts — adapter de Visits remotas
// (COMMERCIAL-REMOTE-VISITS-B2-A). Puro e determinístico: sem rede, sem
// React, sem store, sem feature flag, sem window/localStorage, sem dados
// globais. Converte RemoteVisitRow (Supabase, derivado de Database —
// regenerado nesta etapa contra o banco LOCAL, migration #52) no modelo de
// apresentação remoto. Mesmo padrão exato de lib/tasks/taskAdapter.ts.
import type { Database } from '@/lib/supabase/database.types';

export type RemoteVisitRow = Database['public']['Tables']['visits']['Row'];

// ── Modelo de apresentação remoto ────────────────────────────────────────
// Preserva todos os campos com consumidor real já identificado pelo B1/B2
// design freeze: scheduledAt e version são consumidos pelas mutations
// remotas futuras (B2-B) como p_scheduled_at/p_expected_version — mesmo
// raciocínio de RemoteTaskModel.dueAt/version. Nenhum campo é omitido aqui
// (diferente de Tasks, que descartou companyId/completedAt/updatedAt por
// falta de consumidor) porque a UI atual de Visitas já exibe cada um destes
// campos (client/car/vehicles/status/note) — cortar algum agora só para
// reintroduzir no cutover (B3+) seria trabalho duplicado sem ganho.
export interface RemoteVisitModel {
  id: string;
  clientName: string;
  leadId: string | null;
  // Raw id, nunca resolvido para nome aqui — mesma decisão de
  // RemoteTaskModel.assignedTo (B2-PRECHECK §20/§22): nenhuma tela deste
  // lote consome o adapter, e quando uma tela futura precisar do nome do
  // Seller, resolve via o catálogo remoto já existente na camada de
  // apresentação — nunca uma dependência nova aqui.
  assignedSellerId: string;
  vehicles: readonly string[];
  scheduledAt: string; // ISO instant cru — nunca reformatado.
  status: RemoteVisitRow['status'];
  outcome: RemoteVisitRow['outcome'];
  note: string;
  resultNote: string | null;
  version: number;
  createdAt: string;
}

// ── Contexto explícito ───────────────────────────────────────────────────

export interface VisitLeadRef {
  id: string;
  name: string;
}

// Mesma limitação estrutural documentada em TaskAdapterContext: um Lead
// pode ter sido arquivado DEPOIS da Visit ser criada (VISITS-B1-PRECHECK
// §9 — lead_archived só bloqueia CRIAÇÃO, nunca invalida uma Visit já
// existente) — o snapshot de Leads ativos (useRemoteLeadsScreenState) só
// carrega Leads não-arquivados, então esse Lead nunca aparecerá em
// leadsById. O adapter não distingue esse caso de "cache ainda não
// carregou" — os dois produzem a mesma ausência, e os dois recebem o MESMO
// placeholder neutro (nunca "arquivado", nunca um erro da Visit).
export interface VisitAdapterContext {
  leadsById: Readonly<Record<string, VisitLeadRef>>;
}

export const VISIT_LEAD_UNAVAILABLE_DISPLAY_VALUE = 'Cliente indisponível';

// ── Resultado discriminado (mesmo padrão do adapter de Tasks/Leads) ─────

export type VisitAdapterErrorCode =
  | 'invalid_scheduled_at'
  | 'invalid_status'
  | 'invalid_outcome'
  | 'invalid_vehicles'
  | 'invalid_version';

export interface VisitAdapterError {
  ok: false;
  reason: 'invalid_visit_configuration';
  code: VisitAdapterErrorCode;
  visitId: string;
  rowIndex: number | null;
}

export type AdaptVisitRowResult = { ok: true; visit: RemoteVisitModel } | VisitAdapterError;
export type AdaptVisitRowsResult = { ok: true; visits: RemoteVisitModel[] } | VisitAdapterError;

export function isVisitAdapterError(
  result: AdaptVisitRowResult | AdaptVisitRowsResult,
): result is VisitAdapterError {
  return result.ok === false;
}

const VALID_STATUSES = new Set(['scheduled', 'confirmed', 'canceled', 'completed']);
const VALID_OUTCOMES = new Set(['sold', 'negotiating', 'thinking', 'no_interest']);

// ── Adaptação unitária ───────────────────────────────────────────────────

export function adaptRemoteVisitRow(
  row: RemoteVisitRow,
  context: VisitAdapterContext,
): AdaptVisitRowResult {
  return adaptOne(row, context, null);
}

function adaptOne(
  row: RemoteVisitRow,
  context: VisitAdapterContext,
  rowIndex: number | null,
): AdaptVisitRowResult {
  // Runtime guards: os tipos gerados já restringem em compile-time, mas o
  // dado real vem de um transporte externo (PostgREST/JSON) — nunca
  // confiar cegamente num cast. Mesmo padrão de adaptOne (taskAdapter.ts).
  if (!VALID_STATUSES.has(row.status)) {
    return { ok: false, reason: 'invalid_visit_configuration', code: 'invalid_status', visitId: row.id, rowIndex };
  }
  if (row.outcome !== null && !VALID_OUTCOMES.has(row.outcome)) {
    return { ok: false, reason: 'invalid_visit_configuration', code: 'invalid_outcome', visitId: row.id, rowIndex };
  }
  if (!Array.isArray(row.vehicles) || row.vehicles.length === 0) {
    return { ok: false, reason: 'invalid_visit_configuration', code: 'invalid_vehicles', visitId: row.id, rowIndex };
  }
  if (!Number.isInteger(row.version) || row.version < 1) {
    return { ok: false, reason: 'invalid_visit_configuration', code: 'invalid_version', visitId: row.id, rowIndex };
  }

  const scheduledAtDate = new Date(row.scheduled_at);
  if (Number.isNaN(scheduledAtDate.getTime())) {
    return { ok: false, reason: 'invalid_visit_configuration', code: 'invalid_scheduled_at', visitId: row.id, rowIndex };
  }

  // Client: lead_id presente-e-resolvido = nome real do Lead ativo;
  // presente-e-ausente = placeholder neutro; ausente = client_name da
  // própria row (Visit "avulsa", sem Lead — visits_client_identity_ck já
  // garante que client_name não é vazio nesse caso).
  let clientName: string;
  if (row.lead_id !== null) {
    const lead = context.leadsById[row.lead_id];
    clientName = lead ? lead.name : VISIT_LEAD_UNAVAILABLE_DISPLAY_VALUE;
  } else {
    clientName = row.client_name ?? '';
  }

  const visit: RemoteVisitModel = {
    id: row.id,
    clientName,
    leadId: row.lead_id,
    assignedSellerId: row.assigned_seller_id,
    vehicles: row.vehicles,
    scheduledAt: row.scheduled_at,
    status: row.status,
    outcome: row.outcome,
    note: row.note,
    resultNote: row.result_note,
    version: row.version,
    createdAt: row.created_at,
  };

  return { ok: true, visit };
}

// ── Adaptação de lista ───────────────────────────────────────────────────
// Preserva a ordem recebida; falha determinística no PRIMEIRO registro
// inválido (mesmo padrão de adaptRemoteTaskRows/adaptLeadRows) — nunca
// produz uma lista parcial silenciosa.

export function adaptRemoteVisitRows(
  rows: readonly RemoteVisitRow[],
  context: VisitAdapterContext,
): AdaptVisitRowsResult {
  const visits: RemoteVisitModel[] = [];
  for (let i = 0; i < rows.length; i++) {
    const result = adaptOne(rows[i], context, i);
    if (isVisitAdapterError(result)) return result;
    visits.push(result.visit);
  }
  return { ok: true, visits };
}
