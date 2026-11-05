// lib/server/whatsapp-webhook/capture-rpc.ts — W2B-5: adaptador service_role das
// RPCs de captura. SERVER-ONLY. Recebe só hashes e ciphertext, nunca dado pessoal
// em claro. Erros viram códigos internos, sem texto do banco.
import { createAdminClient } from '@/lib/server/supabase/admin';

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : null;
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : null;
}

export interface WhatsAppCaptureContext {
  connectionId: string;
  companyId: string;
  wabaId: string;
  captureAllowed: boolean;
}

export type WhatsAppCaptureContextResult =
  | { ok: true; value: WhatsAppCaptureContext | null }
  | { ok: false };

export async function loadWhatsAppCaptureContext(phoneNumberId: string): Promise<WhatsAppCaptureContextResult> {
  try {
    const { data, error } = await createAdminClient().rpc('whatsapp_connection_capture_context', {
      p_phone_number_id: phoneNumberId,
    });
    if (error) return { ok: false };
    const row = firstRow(data);
    if (row === null) return { ok: true, value: null };
    if (
      typeof row.out_connection_id !== 'string' ||
      typeof row.out_company_id !== 'string' ||
      typeof row.out_waba_id !== 'string'
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      value: {
        connectionId: row.out_connection_id,
        companyId: row.out_company_id,
        wabaId: row.out_waba_id,
        captureAllowed: row.out_capture_allowed === true,
      },
    };
  } catch {
    return { ok: false };
  }
}

export interface CaptureInboundMessageInput {
  connectionId: string;
  companyId: string;
  phoneNumberId: string;
  wabaId: string;
  messageIdHash: string;
  messageType: string;
  occurredAt: Date | null;
  receivedAt: Date;
  requestId: string;
  bsuidHmac: string | null;
  phoneHmac: string | null;
  piiCiphertext: string;
  piiRef: string;
  piiHasPhone: boolean;
  contentCiphertext: string;
  keyVersion: number;
}

export type WhatsAppCaptureOutcome =
  | 'captured'
  | 'duplicate'
  | 'capture_disabled'
  | 'waba_mismatch'
  | 'connection_not_connected'
  | 'event_company_mismatch';

const CAPTURE_OUTCOMES: readonly string[] = [
  'captured',
  'duplicate',
  'capture_disabled',
  'waba_mismatch',
  'connection_not_connected',
  'event_company_mismatch',
];

export type CaptureInboundMessageResult = { ok: true; outcome: WhatsAppCaptureOutcome } | { ok: false };

export async function captureInboundMessage(input: CaptureInboundMessageInput): Promise<CaptureInboundMessageResult> {
  try {
    const { data, error } = await createAdminClient().rpc('whatsapp_inbound_message_capture', {
      p_connection_id: input.connectionId,
      p_expected_company_id: input.companyId,
      p_phone_number_id: input.phoneNumberId,
      p_waba_id: input.wabaId,
      p_message_id_hash: input.messageIdHash,
      p_message_type: input.messageType,
      p_occurred_at: input.occurredAt?.toISOString() ?? null,
      p_received_at: input.receivedAt.toISOString(),
      p_request_id: input.requestId,
      p_bsuid_hmac: input.bsuidHmac,
      p_phone_hmac: input.phoneHmac,
      p_hmac_key_version: input.keyVersion,
      p_pii_ciphertext: input.piiCiphertext,
      p_pii_ref: input.piiRef,
      p_pii_key_version: input.keyVersion,
      p_pii_has_phone: input.piiHasPhone,
      p_content_ciphertext: input.contentCiphertext,
      p_content_key_version: input.keyVersion,
    });
    if (error) return { ok: false };
    const outcome = firstRow(data)?.out_outcome;
    // Resultado fora do catálogo nunca vira 200.
    return typeof outcome === 'string' && CAPTURE_OUTCOMES.includes(outcome)
      ? { ok: true, outcome: outcome as WhatsAppCaptureOutcome }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface WhatsAppDiagnosticsSummary {
  eventsTotal: number;
  eventsReceived: number;
  eventsFailed: number;
  eventsWabaMismatch: number;
  eventsContactUnresolved: number;
  eventsGroupMessage: number;
  lastEventAt: string | null;
  messagesTotal: number;
  captureEnabledConnections: number;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Só contagens e data. `null` também cobre a RPC ainda não aplicada no banco.
export async function fetchWhatsAppDiagnosticsSummary(companyId: string): Promise<WhatsAppDiagnosticsSummary | null> {
  const { data, error } = await createAdminClient().rpc('whatsapp_diagnostics_summary', { p_company_id: companyId });
  if (error) return null;
  const row = firstRow(data);
  if (row === null) return null;

  const eventsTotal = count(row.out_events_total);
  const eventsReceived = count(row.out_events_received);
  const eventsFailed = count(row.out_events_failed);
  const eventsWabaMismatch = count(row.out_events_waba_mismatch);
  const eventsContactUnresolved = count(row.out_events_contact_unresolved);
  const eventsGroupMessage = count(row.out_events_group_message);
  const messagesTotal = count(row.out_messages_total);
  const captureEnabledConnections = count(row.out_capture_enabled_connections);
  if (
    eventsTotal === null ||
    eventsReceived === null ||
    eventsFailed === null ||
    eventsWabaMismatch === null ||
    eventsContactUnresolved === null ||
    eventsGroupMessage === null ||
    messagesTotal === null ||
    captureEnabledConnections === null
  ) {
    return null;
  }
  return {
    eventsTotal,
    eventsReceived,
    eventsFailed,
    eventsWabaMismatch,
    eventsContactUnresolved,
    eventsGroupMessage,
    lastEventAt: typeof row.out_last_event_at === 'string' ? row.out_last_event_at : null,
    messagesTotal,
    captureEnabledConnections,
  };
}

export type InboundEventFailureCode = 'contact_unresolved' | 'group_message' | 'waba_mismatch';

export interface MarkInboundEventFailedInput {
  connectionId: string;
  companyId: string;
  phoneNumberId: string;
  wabaId: string;
  messageIdHash: string;
  messageType: string;
  errorCode: InboundEventFailureCode;
  occurredAt: Date | null;
  receivedAt: Date;
  requestId: string;
}

export async function markInboundEventFailed(input: MarkInboundEventFailedInput): Promise<{ ok: boolean }> {
  try {
    const { data, error } = await createAdminClient().rpc('whatsapp_inbound_event_mark_failed', {
      p_connection_id: input.connectionId,
      p_expected_company_id: input.companyId,
      p_phone_number_id: input.phoneNumberId,
      p_waba_id: input.wabaId,
      p_message_id_hash: input.messageIdHash,
      p_message_type: input.messageType,
      p_error_code: input.errorCode,
      p_occurred_at: input.occurredAt?.toISOString() ?? null,
      p_received_at: input.receivedAt.toISOString(),
      p_request_id: input.requestId,
    });
    return { ok: !error && firstRow(data) !== null };
  } catch {
    return { ok: false };
  }
}
