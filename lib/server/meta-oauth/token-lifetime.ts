// lib/server/meta-oauth/token-lifetime.ts — META-MVP1. SERVER-ONLY.
//
// Por que existe: segundo a doc oficial da Meta ("Long-Lived Access Tokens"),
// "Default User and Page access tokens are short-lived, expiring in hours" e
// "Long-lived Page access token do not have an expiration date". O callback
// derivava o token de Página direto do token devolvido pela troca do `code`,
// sem garantir longa duração e sem verificar a validade: uma conexão podia
// morrer poucas horas depois, e cada lead falharia em silêncio.
//
// Este módulo faz duas coisas, ambas por GET server-to-server:
//   1. troca o token de usuário por um de longa duração
//      (GET /oauth/access_token?grant_type=fb_exchange_token, método da doc);
//   2. inspeciona o token de Página com GET /debug_token (token de app no
//      header Authorization) para saber tipo, validade, expiração e expiração
//      do acesso a dados — a fonte de verdade da validade.
//
// SEGURANÇA (mesmas regras de token-exchange.ts): URLs só em memória, nunca
// logadas nem em Error; corpo de erro da Meta nunca lido; `redirect: 'error'`;
// timeout explícito, sem retries; tokens nunca devolvidos além do necessário.

const DEFAULT_TIMEOUT_MS = 8000;
const VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/;
// Abaixo disso o token de Página não é aceito como conexão durável.
export const MIN_PAGE_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type GraphCallFailureReason = 'http_4xx' | 'http_5xx' | 'timeout' | 'network_error' | 'invalid_json' | 'invalid_body';

interface GraphCallInput {
  graphApiVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function getJson(
  url: URL,
  headers: Record<string, string>,
  input: GraphCallInput,
): Promise<{ ok: true; body: Record<string, unknown>; httpStatus: number } | { ok: false; reason: GraphCallFailureReason; httpStatus?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
  const httpStatus = response.status;
  if (!response.ok) return { ok: false, reason: httpStatus >= 500 ? 'http_5xx' : 'http_4xx', httpStatus };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: 'invalid_json', httpStatus };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_body', httpStatus };
  }
  return { ok: true, body: parsed as Record<string, unknown>, httpStatus };
}

export type LongLivedExchangeResult =
  | { ok: true; accessToken: string; expiresInSeconds?: number; httpStatus: number }
  | { ok: false; reason: GraphCallFailureReason; httpStatus?: number };

export async function exchangeForLongLivedUserToken(
  input: GraphCallInput & { userAccessToken: string; appId: string; appSecret: string },
): Promise<LongLivedExchangeResult> {
  if (!VERSION_PATTERN.test(input.graphApiVersion)) return { ok: false, reason: 'invalid_body' };
  const url = new URL(`https://graph.facebook.com/${input.graphApiVersion}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('client_secret', input.appSecret);
  url.searchParams.set('fb_exchange_token', input.userAccessToken);
  const result = await getJson(url, {}, input);
  // `in` em vez de narrowing pelo discriminante: tsconfig com strict:false.
  if (!('body' in result)) return { ok: false, reason: result.reason, httpStatus: result.httpStatus };
  const accessToken = result.body.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { ok: false, reason: 'invalid_body', httpStatus: result.httpStatus };
  }
  const expiresIn = result.body.expires_in;
  return {
    ok: true,
    accessToken,
    expiresInSeconds: typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn : undefined,
    httpStatus: result.httpStatus,
  };
}

export interface TokenInspection {
  isValid: boolean;
  type: string | null;
  appIdMatches: boolean;
  // Para token de Página, a doc chama de "o ID da página que o token contém".
  profileId: string | null;
  // unixtime em segundos; 0 ou ausente = a Meta não informou expiração.
  expiresAt: number | null;
  dataAccessExpiresAt: number | null;
}

export type TokenInspectionResult =
  | { ok: true; inspection: TokenInspection; httpStatus: number }
  | { ok: false; reason: GraphCallFailureReason; httpStatus?: number };

function unixOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export async function inspectAccessToken(
  input: GraphCallInput & { inputToken: string; appId: string; appSecret: string },
): Promise<TokenInspectionResult> {
  if (!VERSION_PATTERN.test(input.graphApiVersion)) return { ok: false, reason: 'invalid_body' };
  const url = new URL(`https://graph.facebook.com/${input.graphApiVersion}/debug_token`);
  url.searchParams.set('input_token', input.inputToken);
  // Token de app ("app_id|app_secret") no header, nunca na URL.
  const result = await getJson(url, { Authorization: `Bearer ${input.appId}|${input.appSecret}` }, input);
  if (!('body' in result)) return { ok: false, reason: result.reason, httpStatus: result.httpStatus };
  const data = result.body.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'invalid_body', httpStatus: result.httpStatus };
  }
  const record = data as Record<string, unknown>;
  return {
    ok: true,
    httpStatus: result.httpStatus,
    inspection: {
      isValid: record.is_valid === true,
      type: typeof record.type === 'string' ? record.type : null,
      appIdMatches: typeof record.app_id === 'string' && record.app_id === input.appId,
      profileId: typeof record.profile_id === 'string' ? record.profile_id : null,
      expiresAt: unixOrNull(record.expires_at),
      dataAccessExpiresAt: unixOrNull(record.data_access_expires_at),
    },
  };
}

export type PageTokenVerdict =
  | { ok: true; expiresAt: Date | null; dataAccessExpiresAt: Date | null }
  | { ok: false; reason: 'page_token_invalid' | 'page_token_short_lived' };

// Decide se o token de Página pode virar conexão durável. Regras pensadas para
// NÃO rejeitar token válido:
//   - expires_at 0/ausente = sem expiração informada → aceito;
//   - `type` não consta na referência oficial do debug_token: ausente é aceito
//     (o token veio da entrada da própria Página em /me/accounts); presente e
//     diferente de PAGE (ex.: USER) é recusado;
//   - `profile_id`, quando presente, precisa ser a Página escolhida.
// Recusa: inválido, de outro app, tipo errado, Página errada, vence em < 7 dias
// ou acesso a dados já vencido.
export function evaluatePageToken(inspection: TokenInspection, now: Date, expectedPageId: string): PageTokenVerdict {
  if (!inspection.isValid || !inspection.appIdMatches) return { ok: false, reason: 'page_token_invalid' };
  if (inspection.type !== null && inspection.type !== 'PAGE') return { ok: false, reason: 'page_token_invalid' };
  if (inspection.profileId !== null && inspection.profileId !== expectedPageId) {
    return { ok: false, reason: 'page_token_invalid' };
  }
  const expiresAt = inspection.expiresAt === null ? null : new Date(inspection.expiresAt * 1000);
  const dataAccessExpiresAt =
    inspection.dataAccessExpiresAt === null ? null : new Date(inspection.dataAccessExpiresAt * 1000);
  if (expiresAt && expiresAt.getTime() - now.getTime() < MIN_PAGE_TOKEN_LIFETIME_MS) {
    return { ok: false, reason: 'page_token_short_lived' };
  }
  if (dataAccessExpiresAt && dataAccessExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'page_token_invalid' };
  }
  return { ok: true, expiresAt, dataAccessExpiresAt };
}
