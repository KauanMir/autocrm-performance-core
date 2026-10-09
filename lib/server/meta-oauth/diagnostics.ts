// lib/server/meta-oauth/diagnostics.ts — P2.6: diagnóstico READ-ONLY da
// integração Lead Ads da company de teste. SERVER-ONLY.
//
// Só GET na Graph API, token SEMPRE em Authorization: Bearer (nunca na URL),
// Page Access Token decifrado só em memória. Nenhum POST, nenhuma escrita em
// banco, nenhum ledger/processor. O resultado contém apenas enums/booleans/
// contagens: nunca token, ciphertext, IDs, nomes ou corpo bruto da Meta.
import { decryptMetaPageToken } from './token-crypto';
import { META_TOKEN_KEY_VERSION, getMetaTokenKeyForVersion } from './token-key';

export const DIAGNOSTICS_TIMEOUT_MS = 8000;
export const LEADGEN_FORMS_PAGE_LIMIT = 100;

const VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/;
const NUMERIC_ID_PATTERN = /^\d{1,64}$/;
const GRAPH_TYPE_PATTERN = /^[A-Za-z]{1,40}$/;

export type CheckStatus = 'ok' | 'failed' | 'skipped';

export interface SanitizedGraphFailure {
  kind: 'http' | 'timeout' | 'network' | 'malformed';
  httpStatus?: number;
  graphCode?: number;
  graphSubcode?: number;
  graphType?: string;
}

export interface ConnectionLookup {
  integrationId: string;
  companyId: string;
  pageId: string;
  status: string;
  ciphertext: string | null;
  tokenKeyVersion: number;
}

export interface DiagnosticsDeps {
  // Conexão conectada da Page de teste (null = ausente); `error` = infra.
  findConnection(pageId: string): Promise<{ ok: true; value: ConnectionLookup | null } | { ok: false }>;
  decrypt(input: { ciphertext: string; companyId: string; pageId: string; keyVersion: number }): string | null;
  fetchImpl?: typeof fetch;
  graphApiVersion: string;
  appId: string;
  testCompanyId: string;
  testPageId: string;
  testFormId: string;
  timeoutMs?: number;
}

export interface DiagnosticsResult {
  connection: CheckStatus;
  connectionFailure?: 'missing' | 'wrong_company' | 'not_connected' | 'ciphertext_missing' | 'key_version_unsupported' | 'lookup_failed';
  tokenDecrypt: CheckStatus;
  pageIdentity: CheckStatus;
  appSubscribed: boolean | null;
  leadgenSubscribed: boolean | null;
  leadgenFormsAccessible: boolean | null;
  formsCount: number | null;
  formsCountTruncated: boolean | null;
  smokeFormAccessible: boolean | null;
  smokeFormActive: boolean | null;
  graphErrors: {
    pageIdentity?: SanitizedGraphFailure;
    subscribedApps?: SanitizedGraphFailure;
    leadgenForms?: SanitizedGraphFailure;
  };
  graphVersion: string;
  // Não consultável de forma segura pela API: verificação manual.
  appMode: 'verify_manually';
}

type GraphGetResult = { ok: true; body: Record<string, unknown> } | { ok: false; failure: SanitizedGraphFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

async function readGraphError(response: Response): Promise<Pick<SanitizedGraphFailure, 'graphCode' | 'graphSubcode' | 'graphType'>> {
  try {
    const body: unknown = await response.json();
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    if (!error) return {};
    const out: Pick<SanitizedGraphFailure, 'graphCode' | 'graphSubcode' | 'graphType'> = {};
    if (typeof error.code === 'number' && Number.isInteger(error.code)) out.graphCode = error.code;
    if (typeof error.error_subcode === 'number' && Number.isInteger(error.error_subcode)) {
      out.graphSubcode = error.error_subcode;
    }
    if (typeof error.type === 'string' && GRAPH_TYPE_PATTERN.test(error.type)) out.graphType = error.type;
    return out;
  } catch {
    return {};
  }
}

async function graphGet(
  deps: DiagnosticsDeps,
  path: string,
  query: Record<string, string>,
  token: string,
): Promise<GraphGetResult> {
  const url = new URL(`https://graph.facebook.com/${deps.graphApiVersion}/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DIAGNOSTICS_TIMEOUT_MS);
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      const detail = await readGraphError(response);
      return { ok: false, failure: { kind: 'http', httpStatus: response.status, ...detail } };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { ok: false, failure: { kind: 'malformed', httpStatus: response.status } };
    }
    if (!isRecord(parsed)) return { ok: false, failure: { kind: 'malformed', httpStatus: response.status } };
    return { ok: true, body: parsed };
  } catch (error) {
    return { ok: false, failure: { kind: isAbortError(error) ? 'timeout' : 'network' } };
  } finally {
    clearTimeout(timer);
  }
}

function emptyResult(graphVersion: string): DiagnosticsResult {
  return {
    connection: 'failed',
    tokenDecrypt: 'skipped',
    pageIdentity: 'skipped',
    appSubscribed: null,
    leadgenSubscribed: null,
    leadgenFormsAccessible: null,
    formsCount: null,
    formsCountTruncated: null,
    smokeFormAccessible: null,
    smokeFormActive: null,
    graphErrors: {},
    graphVersion,
    appMode: 'verify_manually',
  };
}

export async function runMetaLeadAdsDiagnostics(deps: DiagnosticsDeps): Promise<DiagnosticsResult> {
  const result = emptyResult(deps.graphApiVersion);

  if (!VERSION_PATTERN.test(deps.graphApiVersion) || !NUMERIC_ID_PATTERN.test(deps.testPageId)) {
    result.connectionFailure = 'lookup_failed';
    return result;
  }

  // A. Persistência
  const lookup = await deps.findConnection(deps.testPageId);
  if (!lookup.ok) {
    result.connectionFailure = 'lookup_failed';
    return result;
  }
  const connection = lookup.value;
  if (connection === null) {
    result.connectionFailure = 'missing';
    return result;
  }
  if (connection.companyId.toLowerCase() !== deps.testCompanyId.toLowerCase() || connection.pageId !== deps.testPageId) {
    result.connectionFailure = 'wrong_company';
    return result;
  }
  if (connection.status !== 'connected') {
    result.connectionFailure = 'not_connected';
    return result;
  }
  if (!connection.ciphertext) {
    result.connectionFailure = 'ciphertext_missing';
    return result;
  }
  if (connection.tokenKeyVersion !== META_TOKEN_KEY_VERSION) {
    result.connectionFailure = 'key_version_unsupported';
    return result;
  }
  result.connection = 'ok';

  // B1. Decrypt (só em memória)
  const token = deps.decrypt({
    ciphertext: connection.ciphertext,
    companyId: connection.companyId,
    pageId: connection.pageId,
    keyVersion: connection.tokenKeyVersion,
  });
  if (!token) {
    result.tokenDecrypt = 'failed';
    return result;
  }
  result.tokenDecrypt = 'ok';

  // B2. Identidade: GET /me com Page Token devolve a própria Page.
  const me = await graphGet(deps, 'me', { fields: 'id' }, token);
  if ('failure' in me) {
    result.pageIdentity = 'failed';
    result.graphErrors.pageIdentity = me.failure;
    return result;
  }
  if (me.body.id !== deps.testPageId) {
    result.pageIdentity = 'failed';
    return result;
  }
  result.pageIdentity = 'ok';

  // C. subscribed_apps
  const subs = await graphGet(
    deps,
    `${deps.testPageId}/subscribed_apps`,
    { fields: 'id,name,subscribed_fields' },
    token,
  );
  if ('failure' in subs) {
    result.graphErrors.subscribedApps = subs.failure;
  } else if (!Array.isArray(subs.body.data)) {
    result.graphErrors.subscribedApps = { kind: 'malformed' };
  } else {
    const ours = subs.body.data.find((entry) => isRecord(entry) && entry.id === deps.appId);
    result.appSubscribed = ours !== undefined;
    result.leadgenSubscribed =
      isRecord(ours) && Array.isArray(ours.subscribed_fields) && ours.subscribed_fields.includes('leadgen');
  }

  // D. leadgen_forms (campos mínimos; uma página)
  const forms = await graphGet(
    deps,
    `${deps.testPageId}/leadgen_forms`,
    { fields: 'id,status', limit: String(LEADGEN_FORMS_PAGE_LIMIT) },
    token,
  );
  if ('failure' in forms) {
    result.leadgenFormsAccessible = false;
    result.graphErrors.leadgenForms = forms.failure;
  } else if (!Array.isArray(forms.body.data)) {
    result.leadgenFormsAccessible = false;
    result.graphErrors.leadgenForms = { kind: 'malformed' };
  } else {
    result.leadgenFormsAccessible = true;
    result.formsCount = forms.body.data.length;
    const paging = isRecord(forms.body.paging) ? forms.body.paging : {};
    result.formsCountTruncated = typeof paging.next === 'string' && paging.next.length > 0;
    const smoke = forms.body.data.find((entry) => isRecord(entry) && entry.id === deps.testFormId);
    result.smokeFormAccessible = smoke !== undefined;
    result.smokeFormActive = isRecord(smoke) ? smoke.status === 'ACTIVE' : null;
  }

  return result;
}

export function decryptDiagnosticsToken(input: {
  ciphertext: string;
  companyId: string;
  pageId: string;
  keyVersion: number;
}): string | null {
  try {
    return decryptMetaPageToken({
      ciphertext: input.ciphertext,
      companyId: input.companyId,
      pageId: input.pageId,
      key: getMetaTokenKeyForVersion(input.keyVersion),
    });
  } catch {
    return null;
  }
}
