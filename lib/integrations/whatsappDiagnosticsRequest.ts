// lib/integrations/whatsappDiagnosticsRequest.ts — camada HTTP client-safe do
// diagnóstico WhatsApp (W2B-2). Mesmo molde de metaDiagnosticsRequest.ts: roda
// no browser, nunca importa lib/server/*, nunca lança exceção com token ou
// Authorization. Único caminho: GET /api/integrations/whatsapp/diagnostics.
//
// A resposta é reduzida a um view-model de valores FECHADOS: qualquer valor fora
// do catálogo invalida o relatório, então nada bruto da API chega ao DOM.
export type WhatsAppIntegrationStatus =
  | 'awaiting_waba_confirmation'
  | 'connection_not_ready'
  | 'misconfigured'
  | 'unavailable';

export type WhatsAppConnectionState = 'connected' | 'disconnected' | 'error' | 'absent' | 'multiple' | 'unavailable';

export type WhatsAppDiagnosticsReport = {
  integrationStatus: WhatsAppIntegrationStatus;
  ingestion: 'enabled' | 'disabled';
  config: { webhookVerifyToken: boolean; appSecret: boolean; tokenEncryptionKey: boolean };
  connection: {
    state: WhatsAppConnectionState;
    count: number | null;
    connectedAt: string | null;
    lastErrorCode: string | null;
  };
  capture: { enabledConnections: number | null; contentEncryptionKey: boolean; contactHmacKey: boolean };
  // null = indisponível. Nunca 0 por falta de dado.
  events: {
    count: number;
    pending: number;
    failed: number;
    messages: number;
    lastEventAt: string | null;
    refused: { wabaMismatch: number; contactUnresolved: number; groupMessage: number };
  } | null;
  // Sempre não confirmada nesta fase, mesmo que a API devolva outro valor.
  wabaSubscription: 'not_confirmed';
  deployment: { environment: 'production' | 'preview' | 'development' | null; commitSha: string | null };
  ingestionWarning: boolean;
  captureKeysWarning: boolean;
  refusedWarning: boolean;
};

export type WhatsAppDiagnosticsResult =
  | { outcome: 'ok'; report: WhatsAppDiagnosticsReport }
  | { outcome: 'domain_error'; code: string }
  | { outcome: 'error' };

const INTEGRATION_STATUSES: readonly string[] = [
  'awaiting_waba_confirmation',
  'connection_not_ready',
  'misconfigured',
  'unavailable',
];
const CONNECTION_STATES: readonly string[] = ['connected', 'disconnected', 'error', 'absent', 'multiple', 'unavailable'];
const ENVIRONMENTS: readonly string[] = ['production', 'preview', 'development'];
const SNAKE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SHORT_SHA = /^[0-9a-f]{7}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseEvents(value: unknown): WhatsAppDiagnosticsReport['events'] {
  if (!isPlainObject(value) || value.availability !== 'available') return null;
  const count = safeCount(value.count);
  const pending = safeCount(value.pending);
  const failed = safeCount(value.failed);
  const messages = safeCount(value.messages);
  if (count === null || pending === null || failed === null || messages === null) return null;

  const refused = isPlainObject(value.refused) ? value.refused : null;
  const wabaMismatch = refused ? safeCount(refused.wabaMismatch) : null;
  const contactUnresolved = refused ? safeCount(refused.contactUnresolved) : null;
  const groupMessage = refused ? safeCount(refused.groupMessage) : null;
  if (wabaMismatch === null || contactUnresolved === null || groupMessage === null) return null;

  return {
    count,
    pending,
    failed,
    messages,
    lastEventAt: typeof value.lastEventAt === 'string' && ISO_DATE.test(value.lastEventAt) ? value.lastEventAt : null,
    refused: { wabaMismatch, contactUnresolved, groupMessage },
  };
}

function parseReport(body: Record<string, unknown>): WhatsAppDiagnosticsReport | null {
  const { capture, config, connection, deployment, integrationStatus, ingestion, warnings } = body;
  if (
    typeof integrationStatus !== 'string' ||
    !INTEGRATION_STATUSES.includes(integrationStatus) ||
    (ingestion !== 'enabled' && ingestion !== 'disabled') ||
    !isPlainObject(config) ||
    !isPlainObject(capture) ||
    typeof capture.contentEncryptionKey !== 'boolean' ||
    typeof capture.contactHmacKey !== 'boolean' ||
    !isPlainObject(connection) ||
    !isPlainObject(deployment) ||
    typeof config.webhookVerifyToken !== 'boolean' ||
    typeof config.appSecret !== 'boolean' ||
    typeof config.tokenEncryptionKey !== 'boolean' ||
    typeof connection.state !== 'string' ||
    !CONNECTION_STATES.includes(connection.state)
  ) {
    return null;
  }

  const environment = deployment.environment;
  return {
    integrationStatus: integrationStatus as WhatsAppIntegrationStatus,
    ingestion,
    config: {
      webhookVerifyToken: config.webhookVerifyToken,
      appSecret: config.appSecret,
      tokenEncryptionKey: config.tokenEncryptionKey,
    },
    connection: {
      state: connection.state as WhatsAppConnectionState,
      count: typeof connection.count === 'number' && Number.isInteger(connection.count) ? connection.count : null,
      connectedAt:
        typeof connection.connectedAt === 'string' && ISO_DATE.test(connection.connectedAt)
          ? connection.connectedAt
          : null,
      lastErrorCode:
        typeof connection.lastErrorCode === 'string' && SNAKE_CODE.test(connection.lastErrorCode)
          ? connection.lastErrorCode
          : null,
    },
    capture: {
      enabledConnections: safeCount(capture.enabledConnections),
      contentEncryptionKey: capture.contentEncryptionKey,
      contactHmacKey: capture.contactHmacKey,
    },
    events: parseEvents(body.events),
    wabaSubscription: 'not_confirmed',
    deployment: {
      environment:
        typeof environment === 'string' && ENVIRONMENTS.includes(environment)
          ? (environment as WhatsAppDiagnosticsReport['deployment']['environment'])
          : null,
      commitSha:
        typeof deployment.commitSha === 'string' && SHORT_SHA.test(deployment.commitSha) ? deployment.commitSha : null,
    },
    ingestionWarning: Array.isArray(warnings) && warnings.includes('ingestion_enabled'),
    captureKeysWarning: Array.isArray(warnings) && warnings.includes('capture_keys_invalid'),
    refusedWarning: Array.isArray(warnings) && warnings.includes('messages_refused'),
  };
}

export async function fetchWhatsAppDiagnosticsRequest(
  companyId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<WhatsAppDiagnosticsResult> {
  let response: Response;
  try {
    response = await fetch(`/api/integrations/whatsapp/diagnostics?company_id=${encodeURIComponent(companyId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal,
    });
  } catch {
    return { outcome: 'error' };
  }

  const body = await readJsonSafely(response);
  if (!isPlainObject(body)) return { outcome: 'error' };

  if (body.ok === false) {
    if (typeof body.error !== 'string' || !SNAKE_CODE.test(body.error)) return { outcome: 'error' };
    return { outcome: 'domain_error', code: body.error };
  }

  if (!response.ok) return { outcome: 'error' };
  const report = parseReport(body);
  return report ? { outcome: 'ok', report } : { outcome: 'error' };
}
