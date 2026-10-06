// Adapter service_role das RPCs de processamento leadgen. SERVER-ONLY: usa
// createAdminClient(). Nunca importar de componente client-side. Falhas de
// transporte, RPC ou formato inesperado viram infrastructure_error, sem
// mensagem bruta do PostgREST.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/server/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import type { MetaLeadErrorCode } from './error-codes';

export type ProcessingRpcResult<T> = { ok: true; value: T } | { ok: false; code: 'infrastructure_error' };

export interface ClaimedEvent {
  eventId: string;
  integrationId: string;
  companyId: string;
  pageId: string;
  leadgenId: string;
  attempts: number;
  leaseToken: string;
}

export interface ProcessingIntegration {
  integrationId: string;
  companyId: string;
  pageId: string;
  status: string;
  // Presente só quando status = connected (regra da RPC).
  ciphertext: string | null;
  tokenKeyVersion: number;
}

export interface CompleteLeadInput {
  eventId: string;
  leaseToken: string;
  name: string;
  phone: string;
  car: string;
}

export interface FailEventInput {
  eventId: string;
  leaseToken: string;
  errorCode: MetaLeadErrorCode;
}

export interface ProcessingRpc {
  claimEvent(eventId: string): Promise<ProcessingRpcResult<ClaimedEvent | null>>;
  lookupIntegration(integrationId: string): Promise<ProcessingRpcResult<ProcessingIntegration | null>>;
  completeLead(input: CompleteLeadInput): Promise<ProcessingRpcResult<{ outcome: string }>>;
  failEvent(input: FailEventInput): Promise<ProcessingRpcResult<{ outcome: string }>>;
}

const INFRA = { ok: false, code: 'infrastructure_error' } as const;

interface RpcReply {
  data: unknown;
  error: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeRpc(run: () => PromiseLike<RpcReply>): Promise<RpcReply | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

function asRows(reply: RpcReply | null): Record<string, unknown>[] | null {
  if (!reply || reply.error || !Array.isArray(reply.data)) return null;
  if (!reply.data.every(isRecord)) return null;
  return reply.data;
}

function readClaim(row: Record<string, unknown>): ClaimedEvent | null {
  const { out_event_id, out_integration_id, out_company_id, out_page_id, out_leadgen_id, out_attempts, out_lease_token } =
    row;
  if (
    typeof out_event_id !== 'string' ||
    typeof out_integration_id !== 'string' ||
    typeof out_company_id !== 'string' ||
    typeof out_page_id !== 'string' ||
    typeof out_leadgen_id !== 'string' ||
    typeof out_attempts !== 'number' ||
    typeof out_lease_token !== 'string'
  ) {
    return null;
  }
  return {
    eventId: out_event_id,
    integrationId: out_integration_id,
    companyId: out_company_id,
    pageId: out_page_id,
    leadgenId: out_leadgen_id,
    attempts: out_attempts,
    leaseToken: out_lease_token,
  };
}

function readIntegration(row: Record<string, unknown>): ProcessingIntegration | null {
  const { out_integration_id, out_company_id, out_page_id, out_status, out_access_token_ciphertext, out_token_key_version } =
    row;
  if (
    typeof out_integration_id !== 'string' ||
    typeof out_company_id !== 'string' ||
    typeof out_page_id !== 'string' ||
    typeof out_status !== 'string' ||
    (out_access_token_ciphertext !== null && typeof out_access_token_ciphertext !== 'string') ||
    typeof out_token_key_version !== 'number'
  ) {
    return null;
  }
  const ciphertext = typeof out_access_token_ciphertext === 'string' ? out_access_token_ciphertext : null;
  return {
    integrationId: out_integration_id,
    companyId: out_company_id,
    pageId: out_page_id,
    status: out_status,
    ciphertext,
    tokenKeyVersion: out_token_key_version,
  };
}

function readOutcome(row: Record<string, unknown>): { outcome: string } | null {
  const outcome = row.out_outcome;
  return typeof outcome === 'string' ? { outcome } : null;
}

export function createProcessingRpc(client: SupabaseClient<Database> = createAdminClient()): ProcessingRpc {
  return {
    async claimEvent(eventId) {
      const reply = await safeRpc(() =>
        client.rpc('meta_leadgen_event_claim_batch', { p_event_id: eventId, p_limit: 1, p_lease_seconds: 90 }),
      );
      const rows = asRows(reply);
      if (!rows || rows.length > 1) return INFRA;
      if (rows.length === 0) return { ok: true, value: null };
      const claimed = readClaim(rows[0]);
      return claimed ? { ok: true, value: claimed } : INFRA;
    },

    async lookupIntegration(integrationId) {
      const reply = await safeRpc(() =>
        client.rpc('meta_connection_lookup_for_processing', { p_integration_id: integrationId }),
      );
      const rows = asRows(reply);
      if (!rows || rows.length > 1) return INFRA;
      if (rows.length === 0) return { ok: true, value: null };
      const integration = readIntegration(rows[0]);
      return integration ? { ok: true, value: integration } : INFRA;
    },

    async completeLead(input) {
      const reply = await safeRpc(() =>
        client.rpc('meta_leadgen_event_complete', {
          p_event_id: input.eventId,
          p_lease_token: input.leaseToken,
          p_name: input.name,
          p_phone: input.phone,
          p_car: input.car,
        }),
      );
      const rows = asRows(reply);
      if (!rows || rows.length !== 1) return INFRA;
      const value = readOutcome(rows[0]);
      return value ? { ok: true, value } : INFRA;
    },

    async failEvent(input) {
      const reply = await safeRpc(() =>
        client.rpc('meta_leadgen_event_fail', {
          p_event_id: input.eventId,
          p_lease_token: input.leaseToken,
          p_error_code: input.errorCode,
        }),
      );
      const rows = asRows(reply);
      if (!rows || rows.length !== 1) return INFRA;
      const value = readOutcome(rows[0]);
      return value ? { ok: true, value } : INFRA;
    },
  };
}
