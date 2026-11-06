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
  // form_id do webhook (pode faltar); a Graph pode confirmar depois.
  formId: string | null;
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
  // Validade verificada no OAuth (debug_token). null = sem expiração informada
  // ou conexão antiga ainda não verificada.
  tokenExpiresAt: string | null;
  tokenDataAccessExpiresAt: string | null;
  // META-MVP2: autorização de Lead Ads da empresa (desligada por padrão).
  // Ausente na resposta = false (fail closed).
  leadAdsEnabled: boolean;
}

export interface CompleteLeadInput {
  eventId: string;
  leaseToken: string;
  name: string;
  phone: string;
  email: string | null;
  vehicle: string | null;
  answers: { key: string; values: string[] }[];
  formId: string | null;
  adId: string | null;
  submittedAt: string | null;
}

export interface FailEventInput {
  eventId: string;
  leaseToken: string;
  errorCode: MetaLeadErrorCode;
}

export type IntegrationErrorCode = 'token_invalid' | 'token_expired' | 'permission_missing';

export interface FormMappingRow {
  target: string;
  fieldKey: string;
}

export interface ProcessingRpc {
  claimEvent(eventId: string): Promise<ProcessingRpcResult<ClaimedEvent | null>>;
  claimBatch(limit: number, leaseSeconds: number): Promise<ProcessingRpcResult<ClaimedEvent[]>>;
  lookupIntegration(integrationId: string): Promise<ProcessingRpcResult<ProcessingIntegration | null>>;
  loadFormMappings(companyId: string, formId: string | null): Promise<ProcessingRpcResult<FormMappingRow[]>>;
  completeLead(input: CompleteLeadInput): Promise<ProcessingRpcResult<{ outcome: string }>>;
  failEvent(input: FailEventInput): Promise<ProcessingRpcResult<{ outcome: string }>>;
  markIntegrationError(integrationId: string, code: IntegrationErrorCode): Promise<ProcessingRpcResult<{ outcome: string }>>;
  // META-MVP2: expurgo de seleções vencidas e eventos retidos além da retenção.
  // Opcional na porta: quem não implementa só não expurga.
  purgeExpired?(): Promise<void>;
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
  const {
    out_event_id,
    out_integration_id,
    out_company_id,
    out_page_id,
    out_leadgen_id,
    out_form_id,
    out_attempts,
    out_lease_token,
  } = row;
  if (
    typeof out_event_id !== 'string' ||
    typeof out_integration_id !== 'string' ||
    typeof out_company_id !== 'string' ||
    typeof out_page_id !== 'string' ||
    typeof out_leadgen_id !== 'string' ||
    (out_form_id !== null && out_form_id !== undefined && typeof out_form_id !== 'string') ||
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
    formId: typeof out_form_id === 'string' ? out_form_id : null,
    attempts: out_attempts,
    leaseToken: out_lease_token,
  };
}

function readIntegration(row: Record<string, unknown>): ProcessingIntegration | null {
  const {
    out_integration_id,
    out_company_id,
    out_page_id,
    out_status,
    out_access_token_ciphertext,
    out_token_key_version,
    out_token_expires_at,
    out_token_data_access_expires_at,
    out_lead_ads_enabled,
  } = row;
  if (
    typeof out_integration_id !== 'string' ||
    typeof out_company_id !== 'string' ||
    typeof out_page_id !== 'string' ||
    typeof out_status !== 'string' ||
    (out_access_token_ciphertext !== null && typeof out_access_token_ciphertext !== 'string') ||
    typeof out_token_key_version !== 'number' ||
    !isOptionalString(out_token_expires_at) ||
    !isOptionalString(out_token_data_access_expires_at)
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
    tokenExpiresAt: typeof out_token_expires_at === 'string' ? out_token_expires_at : null,
    tokenDataAccessExpiresAt:
      typeof out_token_data_access_expires_at === 'string' ? out_token_data_access_expires_at : null,
    leadAdsEnabled: out_lead_ads_enabled === true,
  };
}

function isOptionalString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string';
}

function readMapping(row: Record<string, unknown>): FormMappingRow | null {
  const { out_target, out_field_key } = row;
  if (typeof out_target !== 'string' || typeof out_field_key !== 'string') return null;
  return { target: out_target, fieldKey: out_field_key };
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

    async purgeExpired() {
      await safeRpc(() => client.rpc('meta_leadads_purge_expired'));
    },

    async claimBatch(limit, leaseSeconds) {
      const reply = await safeRpc(() =>
        client.rpc('meta_leadgen_event_claim_batch', {
          p_event_id: undefined,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        }),
      );
      const rows = asRows(reply);
      if (!rows || rows.length > limit) return INFRA;
      const claimed: ClaimedEvent[] = [];
      for (const row of rows) {
        const event = readClaim(row);
        if (!event) return INFRA;
        claimed.push(event);
      }
      return { ok: true, value: claimed };
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

    async loadFormMappings(companyId, formId) {
      if (formId === null) return { ok: true, value: [] };
      const reply = await safeRpc(() =>
        client.rpc('meta_form_mapping_for_processing', { p_company_id: companyId, p_form_id: formId }),
      );
      const rows = asRows(reply);
      if (!rows) return INFRA;
      const mappings: FormMappingRow[] = [];
      for (const row of rows) {
        const mapping = readMapping(row);
        if (!mapping) return INFRA;
        mappings.push(mapping);
      }
      return { ok: true, value: mappings };
    },
    async completeLead(input) {
      // Respostas, contato e evento gravados na MESMA transação (RPC v2).
      const reply = await safeRpc(() =>
        client.rpc('meta_leadgen_event_complete_v2', {
          p_event_id: input.eventId,
          p_lease_token: input.leaseToken,
          p_name: input.name,
          p_phone: input.phone,
          p_email: input.email ?? undefined,
          p_vehicle: input.vehicle ?? undefined,
          p_answers: input.answers,
          p_form_id: input.formId ?? undefined,
          p_ad_id: input.adId ?? undefined,
          p_submitted_at: input.submittedAt ?? undefined,
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
    async markIntegrationError(integrationId, code) {
      const reply = await safeRpc(() =>
        client.rpc('meta_connection_mark_error', { p_integration_id: integrationId, p_error_code: code }),
      );
      const rows = asRows(reply);
      if (!rows || rows.length !== 1) return INFRA;
      const value = readOutcome(rows[0]);
      return value ? { ok: true, value } : INFRA;
    },
  };
}
