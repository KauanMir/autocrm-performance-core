// lib/integrations/metaDiagnosticsRequest.ts — camada HTTP client-safe do
// diagnóstico Meta (P2.6A). Mesmo molde de metaReviewStatusRequest.ts: roda
// no browser, nunca importa lib/server/*, nunca chama a Graph, nunca lança
// exceção com token/Authorization. Único caminho: GET
// /api/integrations/meta/diagnostics?company_id=<id>, com o JWT em header.
//
// A resposta é reduzida a um view-model de valores FECHADOS (enums, booleans,
// números, versão por regex): qualquer string fora do catálogo é descartada,
// então nada bruto da API chega ao DOM.
export type DiagnosticStatus = 'ok' | 'failed' | 'skipped';

export type DiagnosticGraphFailure = {
  kind: 'http' | 'timeout' | 'network' | 'malformed';
  httpStatus?: number;
  graphCode?: number;
  graphSubcode?: number;
  graphType?: string;
};

export type MetaDiagnosticsReport = {
  connection: DiagnosticStatus;
  connectionFailure: string | null;
  tokenDecrypt: DiagnosticStatus;
  pageIdentity: DiagnosticStatus;
  appSubscribed: boolean | null;
  leadgenSubscribed: boolean | null;
  leadgenFormsAccessible: boolean | null;
  formsCount: number | null;
  formsCountTruncated: boolean | null;
  smokeFormAccessible: boolean | null;
  smokeFormActive: boolean | null;
  graphErrors: Partial<Record<'pageIdentity' | 'subscribedApps' | 'leadgenForms', DiagnosticGraphFailure>>;
  graphVersion: string;
};

export type MetaDiagnosticsResult =
  | { outcome: 'ok'; report: MetaDiagnosticsReport }
  | { outcome: 'domain_error'; code: string }
  | { outcome: 'error' };

const STATUS_VALUES: readonly string[] = ['ok', 'failed', 'skipped'];
const FAILURE_KINDS: readonly string[] = ['http', 'timeout', 'network', 'malformed'];
const SNAKE_CODE = /^[a-z][a-z0-9_]{0,39}$/;
const GRAPH_VERSION = /^v\d{1,3}\.\d{1,3}$/;
const GRAPH_TYPE = /^[A-Za-z]{1,40}$/;
const GRAPH_ERROR_KEYS = ['pageIdentity', 'subscribedApps', 'leadgenForms'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonSafely(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function status(value: unknown): DiagnosticStatus | null {
  return typeof value === 'string' && STATUS_VALUES.includes(value) ? (value as DiagnosticStatus) : null;
}

function boolOrNull(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  return typeof value === 'boolean' ? value : undefined;
}

function safeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000 ? value : undefined;
}

function parseFailure(value: unknown): DiagnosticGraphFailure | null {
  if (!isPlainObject(value) || typeof value.kind !== 'string' || !FAILURE_KINDS.includes(value.kind)) return null;
  const out: DiagnosticGraphFailure = { kind: value.kind as DiagnosticGraphFailure['kind'] };
  const httpStatus = safeInt(value.httpStatus);
  const graphCode = safeInt(value.graphCode);
  const graphSubcode = safeInt(value.graphSubcode);
  if (httpStatus !== undefined) out.httpStatus = httpStatus;
  if (graphCode !== undefined) out.graphCode = graphCode;
  if (graphSubcode !== undefined) out.graphSubcode = graphSubcode;
  if (typeof value.graphType === 'string' && GRAPH_TYPE.test(value.graphType)) out.graphType = value.graphType;
  return out;
}

function parseReport(body: Record<string, unknown>): MetaDiagnosticsReport | null {
  const connection = status(body.connection);
  const tokenDecrypt = status(body.tokenDecrypt);
  const pageIdentity = status(body.pageIdentity);
  const appSubscribed = boolOrNull(body.appSubscribed);
  const leadgenSubscribed = boolOrNull(body.leadgenSubscribed);
  const leadgenFormsAccessible = boolOrNull(body.leadgenFormsAccessible);
  const formsCountTruncated = boolOrNull(body.formsCountTruncated);
  const smokeFormAccessible = boolOrNull(body.smokeFormAccessible);
  const smokeFormActive = boolOrNull(body.smokeFormActive);
  if (
    !connection || !tokenDecrypt || !pageIdentity ||
    appSubscribed === undefined || leadgenSubscribed === undefined || leadgenFormsAccessible === undefined ||
    formsCountTruncated === undefined || smokeFormAccessible === undefined || smokeFormActive === undefined ||
    typeof body.graphVersion !== 'string' || !GRAPH_VERSION.test(body.graphVersion)
  ) {
    return null;
  }

  const graphErrors: MetaDiagnosticsReport['graphErrors'] = {};
  if (isPlainObject(body.graphErrors)) {
    for (const key of GRAPH_ERROR_KEYS) {
      const failure = parseFailure(body.graphErrors[key]);
      if (failure) graphErrors[key] = failure;
    }
  }

  return {
    connection,
    connectionFailure:
      typeof body.connectionFailure === 'string' && SNAKE_CODE.test(body.connectionFailure)
        ? body.connectionFailure
        : null,
    tokenDecrypt,
    pageIdentity,
    appSubscribed,
    leadgenSubscribed,
    leadgenFormsAccessible,
    formsCount: body.formsCount === null || body.formsCount === undefined ? null : safeInt(body.formsCount) ?? null,
    formsCountTruncated,
    smokeFormAccessible,
    smokeFormActive,
    graphErrors,
    graphVersion: body.graphVersion,
  };
}

export async function fetchMetaDiagnosticsRequest(
  companyId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<MetaDiagnosticsResult> {
  let response: Response;
  try {
    response = await fetch(`/api/integrations/meta/diagnostics?company_id=${encodeURIComponent(companyId)}`, {
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
