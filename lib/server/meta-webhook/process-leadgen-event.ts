// Processor de UM evento leadgen: claim → lookup → validade do token → decrypt
// → Graph → mapeamento do formulário → normalize → complete (lead + respostas
// + evento numa transação), com fail(código) em erro processável.
// SERVER-ONLY. Sem rota HTTP, sem cache. O token plaintext existe só numa
// variável local.
//
// META-MVP1:
//   - token recusado pela Meta (190) ou permissão ausente marca a CONEXÃO como
//     erro (reconexão necessária), além de reagendar o evento. Assim a falha
//     aparece na saúde da conexão em vez de se repetir em silêncio;
//   - validade salva na conexão (debug_token no OAuth) é checada ANTES da Graph;
//   - mapeamento por formulário decide nome/telefone/e-mail/veículo;
//   - cada tentativa gera um log sanitizado com o UUID interno do evento.
import { resolveGraphApiVersion } from '@/lib/server/meta-oauth/config';
import { decryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { getMetaTokenKeyForVersion } from '@/lib/server/meta-oauth/token-key';
import type { MetaLeadErrorCode } from './error-codes';
import { fetchMetaLead, type GraphLeadResult } from './graph-lead';
import { logMetaLeadProcessing, type MetaLeadProcessingLogFields } from './logger';
import {
  normalizeLeadgenFieldData,
  toFormFieldMapping,
  type FormFieldMapping,
  type NormalizeLeadgenResult,
} from './normalize-lead-fields';
import {
  createProcessingRpc,
  type ClaimedEvent,
  type IntegrationErrorCode,
  type ProcessingIntegration,
  type ProcessingRpc,
} from './processing-rpc';

export type MetaLeadProcessorResult =
  | { outcome: 'not_claimed' }
  | { outcome: 'created' }
  | { outcome: 'linked_existing' }
  | { outcome: 'lease_lost' }
  | { outcome: 'infrastructure_error' }
  | { outcome: 'failed'; errorCode: MetaLeadErrorCode };

export type DecryptResult = { ok: true; token: string } | { ok: false };

export type ProcessingTrigger = MetaLeadProcessingLogFields['trigger'];

export interface MetaLeadProcessorDeps {
  rpc: ProcessingRpc;
  graphApiVersion: () => string;
  decryptToken: (input: {
    ciphertext: string;
    companyId: string;
    pageId: string;
    keyVersion: number;
  }) => DecryptResult;
  fetchLead: (input: { graphApiVersion: string; leadgenId: string; pageAccessToken: string }) => Promise<GraphLeadResult>;
  normalizeLead: (fieldData: unknown, mapping?: FormFieldMapping) => NormalizeLeadgenResult;
  now?: () => Date;
  log?: (fields: MetaLeadProcessingLogFields) => void;
}

const INFRA: MetaLeadProcessorResult = { outcome: 'infrastructure_error' };

interface AttemptNotes {
  integrationMarked?: IntegrationErrorCode;
  answersCount?: number;
  answersTruncated?: number;
  sensitiveOmitted?: number;
  mappedTargets?: number;
}

function integrationMatchesEvent(event: ClaimedEvent, integration: ProcessingIntegration): boolean {
  return (
    integration.integrationId === event.integrationId &&
    integration.companyId === event.companyId &&
    integration.pageId === event.pageId
  );
}

function isPast(iso: string | null, now: Date): boolean {
  if (iso === null) return false;
  const time = new Date(iso).getTime();
  return !Number.isNaN(time) && time <= now.getTime();
}

async function failEvent(
  deps: MetaLeadProcessorDeps,
  event: ClaimedEvent,
  errorCode: MetaLeadErrorCode,
): Promise<MetaLeadProcessorResult> {
  const result = await deps.rpc.failEvent({ eventId: event.eventId, leaseToken: event.leaseToken, errorCode });
  if (!result.ok) return INFRA;
  switch (result.value.outcome) {
    case 'lease_lost':
      return { outcome: 'lease_lost' };
    case 'failed_max_attempts':
      return { outcome: 'failed', errorCode: 'max_attempts' };
    case 'retry_scheduled':
    case 'failed_terminal':
      return { outcome: 'failed', errorCode };
    default:
      return INFRA;
  }
}

// Marca a conexão como erro; a falha da marcação não impede reagendar o evento.
async function markIntegration(
  deps: MetaLeadProcessorDeps,
  event: ClaimedEvent,
  code: IntegrationErrorCode,
  notes: AttemptNotes,
): Promise<void> {
  const marked = await deps.rpc.markIntegrationError(event.integrationId, code);
  if (marked.ok) notes.integrationMarked = code;
}

export async function processMetaLeadgenEvent(
  eventId: string,
  deps: MetaLeadProcessorDeps,
  trigger: ProcessingTrigger = 'webhook',
): Promise<MetaLeadProcessorResult> {
  const claimed = await deps.rpc.claimEvent(eventId);
  if (!claimed.ok) return INFRA;
  if (claimed.value === null) return { outcome: 'not_claimed' };
  return processClaimedMetaLeadgenEvent(claimed.value, deps, trigger);
}

// Processa evento que já tem lease vigente. Não faz claim: quem chama é
// responsável por ter adquirido o lease (claimEvent ou claimBatch).
export async function processClaimedMetaLeadgenEvent(
  event: ClaimedEvent,
  deps: MetaLeadProcessorDeps,
  trigger: ProcessingTrigger = 'sweep',
): Promise<MetaLeadProcessorResult> {
  const startedAt = Date.now();
  const notes: AttemptNotes = {};
  let result: MetaLeadProcessorResult;
  try {
    result = await runClaimed(event, deps, notes);
  } catch {
    result = INFRA;
  }
  const log = deps.log ?? logMetaLeadProcessing;
  try {
    log({
      operation: 'leadgen_process',
      trigger,
      eventRef: event.eventId,
      outcome: result.outcome,
      errorCode: result.outcome === 'failed' ? result.errorCode : undefined,
      ...notes,
      durationMs: Date.now() - startedAt,
    });
  } catch {
    // Log nunca derruba o processamento.
  }
  return result;
}

async function runClaimed(
  event: ClaimedEvent,
  deps: MetaLeadProcessorDeps,
  notes: AttemptNotes,
): Promise<MetaLeadProcessorResult> {
  const now = (deps.now ?? (() => new Date()))();

  const lookup = await deps.rpc.lookupIntegration(event.integrationId);
  if (!lookup.ok) return INFRA;
  const integration = lookup.value;
  if (integration === null || integration.status === 'disconnected' || !integrationMatchesEvent(event, integration)) {
    return failEvent(deps, event, 'integration_not_found');
  }
  // Conexão já marcada como erro: aguarda reconexão sem chamar a Graph.
  if (integration.status === 'error') return failEvent(deps, event, 'token_invalid');
  if (integration.status !== 'connected') return INFRA;
  // META-MVP2: empresa sem autorização de Lead Ads nunca recebe lead; o evento
  // espera visível na fila (operacional) em vez de ser descartado.
  if (!integration.leadAdsEnabled) return failEvent(deps, event, 'company_access_disabled');

  if (isPast(integration.tokenExpiresAt, now) || isPast(integration.tokenDataAccessExpiresAt, now)) {
    await markIntegration(deps, event, 'token_expired', notes);
    return failEvent(deps, event, 'token_expired');
  }

  if (!integration.ciphertext) return failEvent(deps, event, 'token_decrypt_failed');

  const decrypted = deps.decryptToken({
    ciphertext: integration.ciphertext,
    companyId: integration.companyId,
    pageId: integration.pageId,
    keyVersion: integration.tokenKeyVersion,
  });
  if (!decrypted.ok) return failEvent(deps, event, 'token_decrypt_failed');

  const graph = await deps.fetchLead({
    graphApiVersion: deps.graphApiVersion(),
    leadgenId: event.leadgenId,
    pageAccessToken: decrypted.token,
  });
  // `in` em vez de narrowing pelo discriminante: tsconfig com strict:false.
  if ('code' in graph) {
    if (graph.code === 'token_invalid') await markIntegration(deps, event, 'token_invalid', notes);
    if (graph.code === 'graph_permission_missing') await markIntegration(deps, event, 'permission_missing', notes);
    return failEvent(deps, event, graph.code);
  }

  const formId = graph.value.formId ?? event.formId;
  const mappings = await deps.rpc.loadFormMappings(event.companyId, formId);
  if (!mappings.ok) return INFRA;
  const mapping = toFormFieldMapping(mappings.value);
  notes.mappedTargets = Object.keys(mapping).length;

  const normalized = deps.normalizeLead(graph.value.fieldData, mapping);
  if ('code' in normalized) return failEvent(deps, event, normalized.code);
  notes.answersCount = normalized.value.answers.length;
  notes.answersTruncated = normalized.value.answersTruncated;
  notes.sensitiveOmitted = normalized.value.sensitiveOmitted;

  const completed = await deps.rpc.completeLead({
    eventId: event.eventId,
    leaseToken: event.leaseToken,
    name: normalized.value.name,
    phone: normalized.value.phone,
    email: normalized.value.email,
    vehicle: normalized.value.vehicle,
    answers: normalized.value.answers,
    formId,
    adId: graph.value.adId ?? null,
    submittedAt: graph.value.createdTime ?? null,
  });
  // Falha da gravação: o evento NÃO vira processed. Continua processing até o
  // lease expirar e volta ao claim (até 5 tentativas → max_attempts, visível).
  if (!completed.ok) return INFRA;
  switch (completed.value.outcome) {
    case 'created':
      return { outcome: 'created' };
    case 'linked_existing':
      return { outcome: 'linked_existing' };
    case 'lease_lost':
      return { outcome: 'lease_lost' };
    case 'integration_not_found':
      return failEvent(deps, event, 'integration_not_found');
    case 'initial_stage_missing':
      return failEvent(deps, event, 'initial_stage_missing');
    case 'duplicate_phone_ambiguous':
      return failEvent(deps, event, 'duplicate_phone_ambiguous');
    case 'company_access_disabled':
      return failEvent(deps, event, 'company_access_disabled');
    default:
      return INFRA;
  }
}

function decryptIntegrationToken(input: {
  ciphertext: string;
  companyId: string;
  pageId: string;
  keyVersion: number;
}): DecryptResult {
  try {
    const key = getMetaTokenKeyForVersion(input.keyVersion);
    return {
      ok: true,
      token: decryptMetaPageToken({
        ciphertext: input.ciphertext,
        companyId: input.companyId,
        pageId: input.pageId,
        key,
      }),
    };
  } catch {
    return { ok: false };
  }
}

export function createMetaLeadgenProcessorDeps(): MetaLeadProcessorDeps {
  return {
    rpc: createProcessingRpc(),
    graphApiVersion: resolveGraphApiVersion,
    decryptToken: decryptIntegrationToken,
    fetchLead: (input) => fetchMetaLead(input),
    normalizeLead: normalizeLeadgenFieldData,
  };
}
