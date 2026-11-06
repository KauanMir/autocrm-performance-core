// lib/server/whatsapp-connection/diagnostics.ts — W2B-2: diagnóstico READ-ONLY
// da integração WhatsApp da TEST COMPANY. SERVER-ONLY.
//
// Sem Graph, sem decifrar token, sem escrita em banco. O resultado contém só
// enums, booleans, data da conexão, código de erro validado e SHA do deployment:
// nunca token, ciphertext, chave, IDs da Meta, número ou valor de variável.
//
// `wabaSubscription` é fixo em 'not_confirmed': esta fase não consulta a Graph,
// e a inscrição só é confirmada por verificação manual. `integrationStatus`
// nunca informa sucesso enquanto essa confirmação não existir.
//
// `events` vem da RPC whatsapp_diagnostics_summary (W2B-4). Se ela ainda não
// existir no banco ou falhar, fica indisponível: devolver 0 seria enganoso.
import { getWhatsAppAppSecret, getWhatsAppWebhookVerifyToken, isWhatsAppIngestionEnabled } from '@/lib/server/whatsapp-webhook/env';
import type { WhatsAppDiagnosticsSummary } from '@/lib/server/whatsapp-webhook/capture-rpc';
import type { WhatsAppConnectionHealthRow } from './connection-rpc';
import {
  getWhatsAppContactHmacKeyV1,
  getWhatsAppContentEncryptionKeyV1,
  getWhatsAppTokenEncryptionKeyV1,
} from './env';

export type WhatsAppIntegrationStatus =
  | 'awaiting_waba_confirmation'
  | 'connection_not_ready'
  | 'misconfigured'
  | 'unavailable';

export type WhatsAppConnectionState = 'connected' | 'disconnected' | 'error' | 'absent' | 'multiple' | 'unavailable';

export interface WhatsAppDiagnosticsReport {
  integrationStatus: WhatsAppIntegrationStatus;
  ingestion: 'enabled' | 'disabled';
  config: {
    webhookVerifyToken: boolean;
    appSecret: boolean;
    tokenEncryptionKey: boolean;
  };
  connection: {
    state: WhatsAppConnectionState;
    count: number | null;
    connectedAt: string | null;
    lastErrorCode: string | null;
  };
  capture: {
    enabledConnections: number | null;
    contentEncryptionKey: boolean;
    contactHmacKey: boolean;
  };
  events:
    | { availability: 'unavailable'; count: null }
    | {
        availability: 'available';
        count: number;
        pending: number;
        failed: number;
        messages: number;
        lastEventAt: string | null;
        refused: { wabaMismatch: number; contactUnresolved: number; groupMessage: number };
      };
  wabaSubscription: 'not_confirmed';
  deployment: {
    environment: 'production' | 'preview' | 'development' | null;
    commitSha: string | null;
  };
  warnings: ('ingestion_enabled' | 'capture_keys_invalid' | 'messages_refused')[];
}

export interface WhatsAppDiagnosticsDeps {
  testCompanyId: string;
  loadConnectionHealth(companyId: string): Promise<{ ok: true; rows: WhatsAppConnectionHealthRow[] } | { ok: false }>;
  loadSummary(companyId: string): Promise<WhatsAppDiagnosticsSummary | null>;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function canRead(read: () => unknown): boolean {
  try {
    read();
    return true;
  } catch {
    return false;
  }
}

function isKeyValid(read: () => Buffer): boolean {
  try {
    read().fill(0);
    return true;
  } catch {
    return false;
  }
}

function readDeployment(): WhatsAppDiagnosticsReport['deployment'] {
  const environment = process.env.VERCEL_ENV;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    environment:
      environment === 'production' || environment === 'preview' || environment === 'development' ? environment : null,
    commitSha: typeof sha === 'string' && COMMIT_SHA_PATTERN.test(sha) ? sha.slice(0, 7) : null,
  };
}

function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeConnection(rows: WhatsAppConnectionHealthRow[]): WhatsAppDiagnosticsReport['connection'] {
  if (rows.length === 0) return { state: 'absent', count: 0, connectedAt: null, lastErrorCode: null };
  if (rows.length > 1) return { state: 'multiple', count: rows.length, connectedAt: null, lastErrorCode: null };

  const row = rows[0];
  const state: WhatsAppConnectionState =
    row.status === 'connected' || row.status === 'disconnected' || row.status === 'error' ? row.status : 'unavailable';
  return {
    state,
    count: 1,
    connectedAt: toIsoDate(row.connected_at),
    lastErrorCode:
      typeof row.last_error_code === 'string' && ERROR_CODE_PATTERN.test(row.last_error_code)
        ? row.last_error_code
        : null,
  };
}

async function loadConnection(deps: WhatsAppDiagnosticsDeps): Promise<WhatsAppDiagnosticsReport['connection']> {
  const unavailable = { state: 'unavailable', count: null, connectedAt: null, lastErrorCode: null } as const;
  try {
    const result = await deps.loadConnectionHealth(deps.testCompanyId);
    return 'rows' in result ? summarizeConnection(result.rows) : unavailable;
  } catch {
    return unavailable;
  }
}

async function loadSummary(deps: WhatsAppDiagnosticsDeps): Promise<WhatsAppDiagnosticsSummary | null> {
  try {
    return await deps.loadSummary(deps.testCompanyId);
  } catch {
    return null;
  }
}

function toEventsReport(summary: WhatsAppDiagnosticsSummary | null): WhatsAppDiagnosticsReport['events'] {
  if (summary === null) return { availability: 'unavailable', count: null };
  return {
    availability: 'available',
    count: summary.eventsTotal,
    pending: summary.eventsReceived,
    failed: summary.eventsFailed,
    messages: summary.messagesTotal,
    lastEventAt: toIsoDate(summary.lastEventAt),
    refused: {
      wabaMismatch: summary.eventsWabaMismatch,
      contactUnresolved: summary.eventsContactUnresolved,
      groupMessage: summary.eventsGroupMessage,
    },
  };
}

function resolveIntegrationStatus(
  config: WhatsAppDiagnosticsReport['config'],
  connection: WhatsAppDiagnosticsReport['connection'],
): WhatsAppIntegrationStatus {
  if (!config.webhookVerifyToken || !config.appSecret || !config.tokenEncryptionKey) return 'misconfigured';
  if (connection.state === 'unavailable') return 'unavailable';
  if (connection.state !== 'connected') return 'connection_not_ready';
  return 'awaiting_waba_confirmation';
}

export async function runWhatsAppDiagnostics(deps: WhatsAppDiagnosticsDeps): Promise<WhatsAppDiagnosticsReport> {
  const ingestion = isWhatsAppIngestionEnabled() ? 'enabled' : 'disabled';
  const config = {
    webhookVerifyToken: canRead(getWhatsAppWebhookVerifyToken),
    appSecret: canRead(getWhatsAppAppSecret),
    tokenEncryptionKey: isKeyValid(getWhatsAppTokenEncryptionKeyV1),
  };
  const contentEncryptionKey = isKeyValid(getWhatsAppContentEncryptionKeyV1);
  const contactHmacKey = isKeyValid(getWhatsAppContactHmacKeyV1);
  const connection = await loadConnection(deps);
  const summary = await loadSummary(deps);
  const enabledConnections = summary?.captureEnabledConnections ?? null;
  const captureKeysInvalid = (enabledConnections ?? 0) > 0 && (!contentEncryptionKey || !contactHmacKey);
  const messagesRefused =
    summary !== null &&
    summary.eventsWabaMismatch + summary.eventsContactUnresolved + summary.eventsGroupMessage > 0;

  return {
    integrationStatus: resolveIntegrationStatus(config, connection),
    ingestion,
    config,
    connection,
    capture: { enabledConnections, contentEncryptionKey, contactHmacKey },
    events: toEventsReport(summary),
    wabaSubscription: 'not_confirmed',
    deployment: readDeployment(),
    warnings: [
      ...(ingestion === 'enabled' ? (['ingestion_enabled'] as const) : []),
      ...(captureKeysInvalid ? (['capture_keys_invalid'] as const) : []),
      ...(messagesRefused ? (['messages_refused'] as const) : []),
    ],
  };
}

// Log por allowlist: só requestId, resultado fixo e duração.
export function logWhatsAppDiagnostics(fields: { requestId: string; result: string; durationMs: number }): void {
  // eslint-disable-next-line no-console
  console.log(
    '[whatsapp-diagnostics]',
    JSON.stringify({
      operation: 'whatsapp_diagnostics',
      requestId: fields.requestId,
      result: fields.result,
      durationMs: fields.durationMs,
    }),
  );
}
