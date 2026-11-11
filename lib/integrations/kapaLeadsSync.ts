// lib/integrations/kapaLeadsSync.ts — camada client-safe da sincronização KAPA Leads → CRM.
// Só RPCs SECURITY DEFINER que autorizam pelo auth.uid(): vínculo e ativação só Super Admin;
// saúde, revisão e nova tentativa: Manager da empresa ou Super Admin. Nada aqui traz PII.
import { supabase } from '@/lib/supabase/client';

export type KapaLeadsSyncErrorCode =
  | 'forbidden' | 'not_found' | 'invalid_input' | 'company_not_active' | 'store_linked_to_other_company' | 'unavailable';

export class KapaLeadsSyncError extends Error {
  constructor(public readonly code: KapaLeadsSyncErrorCode) {
    super(code);
    this.name = 'KapaLeadsSyncError';
  }
}

function toError(error: { message?: string } | null): KapaLeadsSyncError {
  const message = error?.message ?? '';
  if (message === 'forbidden' || message === 'unauthenticated') return new KapaLeadsSyncError('forbidden');
  if (message === 'link_not_found' || message === 'company_not_found') return new KapaLeadsSyncError('not_found');
  if (message === 'invalid_input') return new KapaLeadsSyncError('invalid_input');
  if (message === 'company_not_active') return new KapaLeadsSyncError('company_not_active');
  if (message === 'store_linked_to_other_company') return new KapaLeadsSyncError('store_linked_to_other_company');
  return new KapaLeadsSyncError('unavailable');
}

export interface KapaLeadsSyncHealth {
  linkId: string;
  kapaStoreId: string;
  storeLabel: string;
  vehicleFormKey: string | null;
  enabled: boolean;
  activatedAt: string | null;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  pendingCount: number;
  failedCount: number;
  processed7d: number;
  oldestPendingAt: string | null;
  lastProcessedAt: string | null;
}

export interface KapaLeadsReviewItem {
  eventId: string;
  status: 'pending' | 'failed';
  campaignName: string;
  sourceCreatedAt: string;
  receivedAt: string;
  attempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
}

export type KapaLeadsDismissResolution = 'handled_manually' | 'duplicate' | 'test_event' | 'not_recoverable';

const rows = (data: unknown): Record<string, unknown>[] =>
  Array.isArray(data) ? (data.filter((r) => typeof r === 'object' && r !== null) as Record<string, unknown>[]) : [];
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : 0);

export async function fetchKapaLeadsSyncHealth(companyId: string): Promise<KapaLeadsSyncHealth[]> {
  const { data, error } = await supabase.rpc('kapa_leads_sync_health', { p_company_id: companyId });
  if (error) throw toError(error);
  return rows(data).map((r) => ({
    linkId: String(r.link_id),
    kapaStoreId: String(r.kapa_store_id),
    storeLabel: String(r.store_label),
    vehicleFormKey: str(r.vehicle_form_key),
    enabled: r.enabled === true,
    activatedAt: str(r.activated_at),
    lastPolledAt: str(r.last_polled_at),
    lastSuccessAt: str(r.last_success_at),
    lastErrorCode: str(r.last_error_code),
    consecutiveFailures: num(r.consecutive_failures),
    pendingCount: num(r.pending_count),
    failedCount: num(r.failed_count),
    processed7d: num(r.processed_7d),
    oldestPendingAt: str(r.oldest_pending_at),
    lastProcessedAt: str(r.last_processed_at),
  }));
}

export async function fetchKapaLeadsReview(companyId: string): Promise<KapaLeadsReviewItem[]> {
  const { data, error } = await supabase.rpc('kapa_leads_review_list', { p_company_id: companyId, p_limit: 50 });
  if (error) throw toError(error);
  return rows(data).map((r) => ({
    eventId: String(r.event_id),
    status: r.status === 'failed' ? 'failed' : 'pending',
    campaignName: String(r.source_campaign_name),
    sourceCreatedAt: String(r.source_created_at),
    receivedAt: String(r.received_at),
    attempts: num(r.attempts),
    lastErrorCode: str(r.last_error_code),
    nextAttemptAt: str(r.next_attempt_at),
  }));
}

export async function upsertKapaLeadsLink(input: {
  companyId: string; kapaStoreId: string; storeLabel: string; vehicleFormKey: string | null;
}): Promise<{ linkId: string; enabled: boolean }> {
  const { data, error } = await supabase.rpc('kapa_leads_link_upsert', {
    p_company_id: input.companyId,
    p_kapa_store_id: input.kapaStoreId,
    p_store_label: input.storeLabel,
    p_vehicle_form_key: input.vehicleFormKey ?? undefined,
  });
  if (error) throw toError(error);
  const row = rows(data)[0];
  if (!row) throw new KapaLeadsSyncError('unavailable');
  return { linkId: String(row.link_id), enabled: row.enabled === true };
}

export async function setKapaLeadsLinkEnabled(companyId: string, linkId: string, enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('kapa_leads_link_set_enabled', { p_company_id: companyId, p_link_id: linkId, p_enabled: enabled });
  if (error) throw toError(error);
  return rows(data)[0]?.enabled === true;
}

export async function requeueKapaLeadsEvent(companyId: string, eventId: string): Promise<string> {
  const { data, error } = await supabase.rpc('kapa_leads_event_requeue', { p_company_id: companyId, p_event_id: eventId });
  if (error) throw toError(error);
  return String(rows(data)[0]?.out_outcome ?? 'unavailable');
}

export async function dismissKapaLeadsEvent(companyId: string, eventId: string, resolution: KapaLeadsDismissResolution): Promise<string> {
  const { data, error } = await supabase.rpc('kapa_leads_event_dismiss', { p_company_id: companyId, p_event_id: eventId, p_resolution: resolution });
  if (error) throw toError(error);
  return String(rows(data)[0]?.out_outcome ?? 'unavailable');
}

// Textos dos códigos técnicos (nunca mostram dados do cliente).
const ERROR_COPY: Record<string, string> = {
  duplicate_phone_ambiguous: 'Há mais de um lead ativo com este telefone. Una ou arquive os duplicados e tente de novo.',
  invalid_payload: 'Os dados recebidos não estão no formato esperado (ex.: telefone inválido).',
  initial_stage_missing: 'A empresa não tem a etapa inicial do funil. Nova tentativa automática.',
  link_disabled: 'Sincronização pausada. O lead entra quando ela for religada.',
  max_attempts: 'Esgotou as tentativas automáticas.',
  source_network: 'Sem conexão com o KAPA Leads.',
  source_timeout: 'O KAPA Leads demorou para responder.',
  source_unauthorized: 'Assinatura recusada: confira o segredo nas duas plataformas.',
  source_store_not_allowed: 'A loja não está liberada na exportação do KAPA Leads.',
  source_export_disabled: 'A exportação está desligada no KAPA Leads.',
  source_rate_limited: 'Limite de consultas do KAPA Leads atingido.',
  source_server_error: 'O KAPA Leads respondeu com erro.',
  source_invalid_body: 'Resposta do KAPA Leads fora do contrato.',
  source_invalid_item: 'Um lead do KAPA Leads veio fora do contrato.',
  source_store_mismatch: 'O KAPA Leads devolveu lead de outra loja (página recusada).',
};

export function describeKapaLeadsErrorCode(code: string | null): string {
  if (!code) return '';
  if (code.startsWith('unexpected_')) return 'Erro inesperado no processamento. Nova tentativa automática.';
  if (code.startsWith('ingest_')) return 'Falha ao gravar a página na fila. Nova tentativa no próximo ciclo.';
  return ERROR_COPY[code] ?? 'Falha técnica. Nova tentativa automática.';
}
