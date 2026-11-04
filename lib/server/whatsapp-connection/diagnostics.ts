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
// `events` é sempre indisponível: whatsapp_webhook_events nega acesso direto até
// ao service_role, e nenhuma RPC devolve contagem. Devolver 0 seria enganoso.
import { getWhatsAppAppSecret, getWhatsAppWebhookVerifyToken, isWhatsAppIngestionEnabled } from '@/lib/server/whatsapp-webhook/env';
import type { WhatsAppConnectionHealthRow } from './connection-rpc';
import { getWhatsAppTokenEncryptionKeyV1 } from './env';

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
  events: { availability: 'unavailable'; count: null };
  wabaSubscription: 'not_confirmed';
  deployment: {
    environment: 'production' | 'preview' | 'development' | null;
    commitSha: string | null;
  };
  warnings: 'ingestion_enabled'[];
}

export interface WhatsAppDiagnosticsDeps {
  testCompanyId: string;
  loadConnectionHealth(companyId: string): Promise<{ ok: true; rows: WhatsAppConnectionHealthRow[] } | { ok: false }>;
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

function isTokenEncryptionKeyValid(): boolean {
  try {
    getWhatsAppTokenEncryptionKeyV1().fill(0);
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
    tokenEncryptionKey: isTokenEncryptionKeyValid(),
  };
  const connection = await loadConnection(deps);

  return {
    integrationStatus: resolveIntegrationStatus(config, connection),
    ingestion,
    config,
    connection,
    events: { availability: 'unavailable', count: null },
    wabaSubscription: 'not_confirmed',
    deployment: readDeployment(),
    warnings: ingestion === 'enabled' ? ['ingestion_enabled'] : [],
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
