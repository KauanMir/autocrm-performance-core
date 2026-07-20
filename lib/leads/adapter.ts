// lib/leads/adapter.ts — adapter de leads remotos (M1-E, fase E2).
// Puro e determinístico: sem rede, sem React, sem store, sem feature flag,
// sem window/localStorage, sem dados globais. Converte LeadRow (Supabase) no
// modelo de UI mantendo compatibilidade temporária com o tipo Lead legado
// (lib/data.ts) enquanto os consumidores atuais existirem.
//
// Todo dado auxiliar chega explicitamente pelo context: índices imutáveis de
// stages por id (mesmo shape do byId de usePipelineStages) e de sellers por
// id (o campo legado `seller` é nome de exibição). Nenhum fallback silencioso:
// stage_id ou seller_id fora do índice é erro de configuração explícito —
// nunca "o primeiro da lista".
import type { Lead } from '@/lib/data';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import type { LeadRow } from '@/lib/supabase/types';

// ── Modelo de UI ─────────────────────────────────────────────────────────
// Compatível com o Lead legado (stage/seller como nomes de exibição, value
// string, renames last/alert/pay/origem) + metadados remotos necessários aos
// próximos módulos (E3+). `timeline` permanece ausente de propósito: não vem
// embutida na linha de leads e nunca é inventada aqui.

export interface LeadModel extends Lead {
  stageId: string;
  stageCode: string;
  valueAmount: number | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  createdByUserId: string | null;
  updatedAt: string;
  updatedByProfileId: string | null;
}

// ── Contexto explícito ───────────────────────────────────────────────────

export interface LeadSellerRef {
  id: string;
  name: string;
}

export interface LeadAdapterContext {
  stagesById: Readonly<Record<string, PipelineStage>>;
  sellersById: Readonly<Record<string, LeadSellerRef>>;
}

// ── Resultado discriminado (padrão do adapter de pipeline) ───────────────

export type LeadAdapterErrorCode = 'stage_not_found' | 'seller_not_found';

export interface LeadAdapterError {
  ok: false;
  reason: 'invalid_lead_configuration';
  code: LeadAdapterErrorCode;
  leadId: string;
  stageId: string | null;
  sellerId: string | null;
  // Posição do registro inválido quando o erro vem de adaptLeadRows;
  // null em chamadas unitárias.
  rowIndex: number | null;
}

export type AdaptLeadRowResult = { ok: true; lead: LeadModel } | LeadAdapterError;
export type AdaptLeadRowsResult = { ok: true; leads: LeadModel[] } | LeadAdapterError;

// Type predicate — o narrowing por truthiness do discriminante não é
// confiável com strict:false no tsconfig atual (mesmo padrão de
// usePipelineStages).
function isAdapterError(result: AdaptLeadRowResult): result is LeadAdapterError {
  return result.ok === false;
}

// ── Formatação de compatibilidade ────────────────────────────────────────

// Placeholder já aprovado na interface para valor/vendedor ausentes
// (FlowNovoCliente grava value '—' e seller '—' quando não há vendedor).
export const LEAD_EMPTY_DISPLAY_VALUE = '—';

// Mesma regra do único formatter existente no projeto (fmt local de
// Flows2.tsx: 'R$ ' + n.toLocaleString('pt-BR')) — nenhuma regra nova.
function formatValueAmount(valueAmount: number | null): string {
  if (valueAmount === null || valueAmount === undefined) return LEAD_EMPTY_DISPLAY_VALUE;
  return 'R$ ' + valueAmount.toLocaleString('pt-BR');
}

// ── Adaptação unitária ───────────────────────────────────────────────────

export function adaptLeadRow(row: LeadRow, context: LeadAdapterContext): AdaptLeadRowResult {
  return adaptOne(row, context, null);
}

function adaptOne(
  row: LeadRow,
  context: LeadAdapterContext,
  rowIndex: number | null,
): AdaptLeadRowResult {
  const stage = context.stagesById[row.stage_id];
  if (!stage) {
    return {
      ok: false,
      reason: 'invalid_lead_configuration',
      code: 'stage_not_found',
      leadId: row.id,
      stageId: row.stage_id,
      sellerId: row.seller_id,
      rowIndex,
    };
  }

  let sellerName = LEAD_EMPTY_DISPLAY_VALUE; // seller_id null = sem responsável
  if (row.seller_id !== null && row.seller_id !== undefined) {
    const seller = context.sellersById[row.seller_id];
    if (!seller) {
      return {
        ok: false,
        reason: 'invalid_lead_configuration',
        code: 'seller_not_found',
        leadId: row.id,
        stageId: row.stage_id,
        sellerId: row.seller_id,
        rowIndex,
      };
    }
    sellerName = seller.name;
  }

  // Objeto sempre novo; row e context nunca são mutados. Datas permanecem em
  // ISO (rótulos relativos são responsabilidade da UI em render). Campos
  // nullable do modelo remoto (temperature/source) viram os opcionais do Lead
  // legado; labels legadas não-nulas caem no placeholder aprovado.
  const lead: LeadModel = {
    id: row.id,
    name: row.name,
    phone: row.phone,
    car: row.car,
    stage: stage.name,
    stageId: row.stage_id,
    stageCode: stage.code,
    seller: sellerName,
    sellerId: row.seller_id,
    urgency: row.urgency,
    last: row.last_activity_label ?? LEAD_EMPTY_DISPLAY_VALUE,
    alert: row.alert_label ?? LEAD_EMPTY_DISPLAY_VALUE,
    pay: row.payment_preference ?? LEAD_EMPTY_DISPLAY_VALUE,
    value: formatValueAmount(row.value_amount),
    valueAmount: row.value_amount,
    origem: row.source ?? undefined,
    temperature: row.temperature ?? undefined,
    createdByUserId: row.created_by_profile_id,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    version: row.version,
    updatedAt: row.updated_at,
    updatedByProfileId: row.updated_by_profile_id,
  };

  return { ok: true, lead };
}

// ── Adaptação de lista ───────────────────────────────────────────────────
// Preserva a ordem recebida; falha determinística no PRIMEIRO registro
// inválido. Não ordena, não filtra, não agrupa e não oculta arquivados —
// filtragem pertence à query (E3+).

export function adaptLeadRows(
  rows: readonly LeadRow[],
  context: LeadAdapterContext,
): AdaptLeadRowsResult {
  const leads: LeadModel[] = [];
  for (let i = 0; i < rows.length; i++) {
    const result = adaptOne(rows[i], context, i);
    if (isAdapterError(result)) return result;
    leads.push(result.lead);
  }
  return { ok: true, leads };
}
