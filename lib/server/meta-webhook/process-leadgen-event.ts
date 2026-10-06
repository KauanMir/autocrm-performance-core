// Processor de UM evento leadgen: claim → lookup → decrypt → Graph → normalize →
// complete, com fail(código) em erro processável. SERVER-ONLY. Sem rota HTTP,
// sem logging, sem cache. Token plaintext existe só numa variável local.
import { resolveGraphApiVersion } from '@/lib/server/meta-oauth/config';
import { decryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { getMetaTokenKeyForVersion } from '@/lib/server/meta-oauth/token-key';
import type { MetaLeadErrorCode } from './error-codes';
import { fetchMetaLead, type GraphLeadResult } from './graph-lead';
import { normalizeLeadgenFieldData, type NormalizeLeadgenResult } from './normalize-lead-fields';
import { createProcessingRpc, type ClaimedEvent, type ProcessingIntegration, type ProcessingRpc } from './processing-rpc';

export type MetaLeadProcessorResult =
  | { outcome: 'not_claimed' }
  | { outcome: 'created' }
  | { outcome: 'linked_existing' }
  | { outcome: 'lease_lost' }
  | { outcome: 'infrastructure_error' }
  | { outcome: 'failed'; errorCode: MetaLeadErrorCode };

export type DecryptResult = { ok: true; token: string } | { ok: false };

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
  normalizeLead: (fieldData: unknown) => NormalizeLeadgenResult;
}

const INFRA: MetaLeadProcessorResult = { outcome: 'infrastructure_error' };

function integrationMatchesEvent(event: ClaimedEvent, integration: ProcessingIntegration): boolean {
  return (
    integration.integrationId === event.integrationId &&
    integration.companyId === event.companyId &&
    integration.pageId === event.pageId
  );
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

export async function processMetaLeadgenEvent(
  eventId: string,
  deps: MetaLeadProcessorDeps,
): Promise<MetaLeadProcessorResult> {
  const claimed = await deps.rpc.claimEvent(eventId);
  if (!claimed.ok) return INFRA;
  if (claimed.value === null) return { outcome: 'not_claimed' };
  const event = claimed.value;

  const lookup = await deps.rpc.lookupIntegration(event.integrationId);
  if (!lookup.ok) return INFRA;
  const integration = lookup.value;
  if (integration === null || integration.status === 'disconnected' || !integrationMatchesEvent(event, integration)) {
    return failEvent(deps, event, 'integration_not_found');
  }
  if (integration.status === 'error') return failEvent(deps, event, 'token_invalid');
  if (integration.status !== 'connected') return INFRA;
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
  if ('code' in graph) return failEvent(deps, event, graph.code);

  const normalized = deps.normalizeLead(graph.value.fieldData);
  if ('code' in normalized) return failEvent(deps, event, normalized.code);

  const completed = await deps.rpc.completeLead({
    eventId: event.eventId,
    leaseToken: event.leaseToken,
    name: normalized.value.name,
    phone: normalized.value.phone,
    car: normalized.value.car,
  });
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
