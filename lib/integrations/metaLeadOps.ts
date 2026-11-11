// lib/integrations/metaLeadOps.ts — META-MVP1. Camada client-safe da operação
// Lead Ads: saúde da conexão, fila de revisão, mapeamento de campos por
// formulário e respostas preservadas de um lead.
//
// Todas as leituras/escritas são RPCs SECURITY DEFINER que autorizam pelo
// auth.uid() (Manager da company ou Super Admin com acesso). O cliente nunca é
// a prova de autorização. O reprocessamento passa pela rota server-side, que
// também agenda o processamento.
import { supabase } from '@/lib/supabase/client';

export class MetaLeadOpsError extends Error {
  constructor(public readonly code: 'forbidden' | 'not_found' | 'invalid_input' | 'company_not_active' | 'unavailable') {
    super(code);
    this.name = 'MetaLeadOpsError';
  }
}

function toOpsError(error: { message?: string; code?: string } | null): MetaLeadOpsError {
  const message = error?.message ?? '';
  if (message === 'forbidden' || message === 'unauthenticated') return new MetaLeadOpsError('forbidden');
  if (message === 'lead_not_found') return new MetaLeadOpsError('not_found');
  if (message === 'invalid_input' || message === 'company_required') return new MetaLeadOpsError('invalid_input');
  if (message === 'company_not_active') return new MetaLeadOpsError('company_not_active');
  return new MetaLeadOpsError('unavailable');
}

export interface MetaConnectionHealth {
  integrationId: string;
  pageId: string;
  pageName: string | null;
  status: 'connected' | 'error' | 'disconnected' | string;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  connectedAt: string | null;
  leadgenSubscribedAt: string | null;
  tokenOrigin: string | null;
  tokenExpiresAt: string | null;
  tokenDataAccessExpiresAt: string | null;
  tokenCheckedAt: string | null;
}

export type ReviewState = 'failed' | 'retrying' | 'stuck';

export interface MetaLeadReviewItem {
  eventId: string;
  reviewState: ReviewState;
  status: string;
  lastErrorCode: string | null;
  errorKind: 'retryable' | 'operational' | 'terminal' | null;
  attempts: number;
  requeueCount: number;
  receivedAt: string;
  nextAttemptAt: string;
  updatedAt: string;
  formId: string | null;
  leadgenId: string;
  canRequeue: boolean;
  canDismiss: boolean;
}

export interface MetaLeadReviewSummary {
  failedOpen: number;
  retrying: number;
  stuck: number;
  pending: number;
  processedLast7d: number;
  dismissedLast30d: number;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
}

export interface MetaFormMapping {
  formId: string;
  target: 'name' | 'phone' | 'email' | 'vehicle';
  fieldKey: string;
  updatedAt: string;
}

export interface LeadFormSubmission {
  id: string;
  /** 'meta_lead_ads' | 'kapa_leads'; null quando lido pela v1. */
  source: string | null;
  /** Origem legível, ex.: "Fábrica de Aprovação (KAPA Leads)". */
  sourceDetail: string | null;
  outcome: 'created' | 'linked_existing';
  formId: string | null;
  adId: string | null;
  submittedAt: string | null;
  receivedAt: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  vehicleInterest: string | null;
  answers: { key: string; values: string[] }[];
}

export type DismissResolution = 'handled_manually' | 'duplicate' | 'test_event' | 'not_recoverable';

function rowsOf(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data.filter((row) => typeof row === 'object' && row !== null) as Record<string, unknown>[]) : [];
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

export async function fetchMetaConnectionHealth(companyId: string): Promise<MetaConnectionHealth[]> {
  const { data, error } = await supabase.rpc('meta_connection_health', { p_company_id: companyId });
  if (error) throw toOpsError(error);
  return rowsOf(data).map((row) => ({
    integrationId: String(row.integration_id),
    pageId: String(row.page_id),
    pageName: str(row.page_name),
    status: String(row.status),
    lastErrorCode: str(row.last_error_code),
    lastErrorAt: str(row.last_error_at),
    connectedAt: str(row.connected_at),
    leadgenSubscribedAt: str(row.leadgen_subscribed_at),
    tokenOrigin: str(row.token_origin),
    tokenExpiresAt: str(row.token_expires_at),
    tokenDataAccessExpiresAt: str(row.token_data_access_expires_at),
    tokenCheckedAt: str(row.token_checked_at),
  }));
}

export async function fetchMetaLeadReview(
  companyId: string,
): Promise<{ summary: MetaLeadReviewSummary; items: MetaLeadReviewItem[] }> {
  const [summaryReply, listReply] = await Promise.all([
    supabase.rpc('meta_leadgen_review_summary', { p_company_id: companyId }),
    supabase.rpc('meta_leadgen_review_list', { p_company_id: companyId, p_limit: 50 }),
  ]);
  if (summaryReply.error) throw toOpsError(summaryReply.error);
  if (listReply.error) throw toOpsError(listReply.error);
  const s = rowsOf(summaryReply.data)[0] ?? {};
  return {
    summary: {
      failedOpen: num(s.failed_open),
      retrying: num(s.retrying),
      stuck: num(s.stuck),
      pending: num(s.pending),
      processedLast7d: num(s.processed_last_7d),
      dismissedLast30d: num(s.dismissed_last_30d),
      lastReceivedAt: str(s.last_received_at),
      lastProcessedAt: str(s.last_processed_at),
    },
    items: rowsOf(listReply.data).map((row) => ({
      eventId: String(row.event_id),
      reviewState: String(row.review_state) as ReviewState,
      status: String(row.status),
      lastErrorCode: str(row.last_error_code),
      errorKind: str(row.error_kind) as MetaLeadReviewItem['errorKind'],
      attempts: num(row.attempts),
      requeueCount: num(row.requeue_count),
      receivedAt: String(row.received_at),
      nextAttemptAt: String(row.next_attempt_at),
      updatedAt: String(row.updated_at),
      formId: str(row.form_id),
      leadgenId: String(row.leadgen_id),
      canRequeue: row.can_requeue === true,
      canDismiss: row.can_dismiss === true,
    })),
  };
}

export async function dismissMetaLeadEvent(
  companyId: string,
  eventId: string,
  resolution: DismissResolution,
): Promise<'dismissed' | 'not_found' | 'not_dismissable'> {
  const { data, error } = await supabase.rpc('meta_leadgen_event_dismiss', {
    p_company_id: companyId,
    p_event_id: eventId,
    p_resolution: resolution,
  });
  if (error) throw toOpsError(error);
  const outcome = str(rowsOf(data)[0]?.out_outcome);
  if (outcome === 'dismissed' || outcome === 'not_found' || outcome === 'not_dismissable') return outcome;
  throw new MetaLeadOpsError('unavailable');
}

export type RequeueOutcome = 'requeued' | 'not_found' | 'not_requeueable' | 'requeue_limit' | 'too_old';

export async function requeueMetaLeadEventRequest(
  companyId: string,
  eventId: string,
  accessToken: string,
): Promise<{ outcome: RequeueOutcome; processingScheduled: boolean }> {
  let response: Response;
  try {
    response = await fetch('/api/integrations/meta/leadgen-review/requeue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, event_id: eventId }),
      cache: 'no-store',
    });
  } catch {
    throw new MetaLeadOpsError('unavailable');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (record.ok === true && typeof record.outcome === 'string') {
    return { outcome: record.outcome as RequeueOutcome, processingScheduled: record.processingScheduled === true };
  }
  throw new MetaLeadOpsError(response.status === 403 || response.status === 401 ? 'forbidden' : 'unavailable');
}

export async function fetchMetaFormMappings(companyId: string): Promise<MetaFormMapping[]> {
  const { data, error } = await supabase.rpc('meta_form_mapping_list', { p_company_id: companyId });
  if (error) throw toOpsError(error);
  return rowsOf(data).map((row) => ({
    formId: String(row.form_id),
    target: String(row.target) as MetaFormMapping['target'],
    fieldKey: String(row.field_key),
    updatedAt: String(row.updated_at),
  }));
}

export async function setMetaFormMapping(
  companyId: string,
  input: { formId: string; target: MetaFormMapping['target']; fieldKey: string },
): Promise<void> {
  const { error } = await supabase.rpc('meta_form_mapping_set', {
    p_company_id: companyId,
    p_form_id: input.formId,
    p_target: input.target,
    p_field_key: input.fieldKey,
  });
  if (error) throw toOpsError(error);
}

export async function deleteMetaFormMapping(
  companyId: string,
  formId: string,
  target: MetaFormMapping['target'],
): Promise<void> {
  const { error } = await supabase.rpc('meta_form_mapping_delete', {
    p_company_id: companyId,
    p_form_id: formId,
    p_target: target,
  });
  if (error) throw toOpsError(error);
}

// Manager/Seller: companyId null (o banco deriva da membership). Super Admin:
// companyId explícito, validado no banco por can_access_company.
export async function fetchLeadFormSubmissions(leadId: string, companyId: string | null): Promise<LeadFormSubmission[]> {
  const args = { p_lead_id: leadId, p_company_id: companyId ?? undefined };
  // v2 traz a origem; sem a migration no banco (ou num rollback de banco), cai para a v1.
  let result: { data: unknown; error: { message?: string; code?: string } | null } =
    await supabase.rpc('list_lead_form_submissions_v2', args);
  if (result.error?.code === 'PGRST202') result = await supabase.rpc('list_lead_form_submissions', args);
  const { data, error } = result;
  if (error) throw toOpsError(error);
  return rowsOf(data).map((row) => ({
    id: String(row.id),
    source: str(row.source),
    sourceDetail: str(row.source_detail),
    outcome: String(row.outcome) as LeadFormSubmission['outcome'],
    formId: str(row.form_id),
    adId: str(row.ad_id),
    submittedAt: str(row.submitted_at),
    receivedAt: String(row.received_at),
    contactName: String(row.contact_name),
    contactPhone: String(row.contact_phone),
    contactEmail: str(row.contact_email),
    vehicleInterest: str(row.vehicle_interest),
    answers: Array.isArray(row.answers)
      ? (row.answers as unknown[])
          .filter((item): item is { key: string; values: string[] } =>
            typeof item === 'object' && item !== null &&
            typeof (item as { key?: unknown }).key === 'string' &&
            Array.isArray((item as { values?: unknown }).values))
          .map((item) => ({ key: item.key, values: item.values.filter((v) => typeof v === 'string') }))
      : [],
  }));
}

// ── META-MVP2 — autorização da empresa e seleção de Página ────────────

export async function fetchMetaLeadAdsAccess(companyId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('meta_lead_ads_company_access', { p_company_id: companyId });
  if (error) throw toOpsError(error);
  return rowsOf(data)[0]?.enabled === true;
}

// Só Super Admin (o banco recusa qualquer outro papel).
export async function setMetaLeadAdsAccess(companyId: string, enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('meta_lead_ads_set_company_access', { p_company_id: companyId, p_enabled: enabled });
  if (error) throw toOpsError(error);
  return rowsOf(data)[0]?.enabled === true;
}

export interface SelectablePage {
  pageId: string;
  pageName: string;
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class MetaPageSelectionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'MetaPageSelectionError';
  }
}

// O token assinado da seleção fica num cookie HttpOnly: o JavaScript não o lê
// e ele nunca entra em URL ou corpo.
export async function fetchSelectablePagesRequest(accessToken: string): Promise<SelectablePage[]> {
  let response: Response;
  try {
    response = await fetch('/api/integrations/meta/oauth/page-selection', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new MetaPageSelectionError('unavailable');
  }
  const body = await readBody(response);
  if (body.ok === true && Array.isArray(body.pages)) {
    return (body.pages as unknown[])
      .filter((p): p is SelectablePage =>
        typeof p === 'object' && p !== null &&
        typeof (p as SelectablePage).pageId === 'string' && typeof (p as SelectablePage).pageName === 'string')
      .map((p) => ({ pageId: p.pageId, pageName: p.pageName }));
  }
  throw new MetaPageSelectionError(typeof body.error === 'string' ? body.error : 'unavailable');
}

export async function selectPageRequest(pageId: string, accessToken: string): Promise<SelectablePage> {
  let response: Response;
  try {
    response = await fetch('/api/integrations/meta/oauth/page-selection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id: pageId }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new MetaPageSelectionError('unavailable');
  }
  const body = await readBody(response);
  const page = body.page as { id?: unknown; name?: unknown } | undefined;
  if (body.ok === true && typeof page?.id === 'string' && typeof page?.name === 'string') {
    return { pageId: page.id, pageName: page.name };
  }
  throw new MetaPageSelectionError(typeof body.error === 'string' ? body.error : 'unavailable');
}

// ── META-MVP2 — eventos retidos sem empresa (só Super Admin) ──────────

export type UnroutedReason = 'no_connection' | 'company_disabled' | 'ambiguous_owner';

export interface MetaUnroutedGroup {
  pageId: string;
  reason: UnroutedReason;
  pending: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  canAdopt: boolean;
}

export async function fetchMetaUnroutedEvents(companyId: string): Promise<MetaUnroutedGroup[]> {
  const { data, error } = await supabase.rpc('meta_leadgen_unrouted_list', { p_company_id: companyId });
  if (error) throw toOpsError(error);
  return rowsOf(data).map((row) => ({
    pageId: typeof row.page_id === 'string' ? row.page_id : '',
    reason: row.reason as UnroutedReason,
    pending: typeof row.pending === 'number' ? row.pending : 0,
    firstReceivedAt: typeof row.first_received_at === 'string' ? row.first_received_at : null,
    lastReceivedAt: typeof row.last_received_at === 'string' ? row.last_received_at : null,
    canAdopt: row.can_adopt === true,
  }));
}

export type AdoptUnroutedOutcome = 'adopted' | 'nothing_pending' | 'not_connected' | 'company_disabled' | 'owner_conflict';

export async function adoptMetaUnroutedRequest(
  companyId: string,
  pageId: string,
  accessToken: string,
): Promise<{ outcome: AdoptUnroutedOutcome; adopted: number; processingScheduled: boolean }> {
  let response: Response;
  try {
    response = await fetch('/api/integrations/meta/leadgen-review/unrouted-adopt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, page_id: pageId }),
      cache: 'no-store',
    });
  } catch {
    throw new MetaLeadOpsError('unavailable');
  }
  const body = await readBody(response);
  if (body.ok === true && typeof body.outcome === 'string') {
    return {
      outcome: body.outcome as AdoptUnroutedOutcome,
      adopted: typeof body.adopted === 'number' ? body.adopted : 0,
      processingScheduled: body.processingScheduled === true,
    };
  }
  throw new MetaLeadOpsError(response.status === 403 || response.status === 401 ? 'forbidden' : 'unavailable');
}
