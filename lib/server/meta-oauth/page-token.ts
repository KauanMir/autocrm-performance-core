// lib/server/meta-oauth/page-token.ts — deriva o Page Access Token de UMA
// Page específica a partir do token (User Access Token OU Business
// Integration System User Access Token / SUAT) obtido no OAuth. SERVER-ONLY,
// só chamado pelo callback no ambiente de teste controlado (ver route.ts).
//
// POR QUE ESTE PASSO EXISTE: nenhuma documentação oficial atual da Meta
// confirma o uso direto do token devolvido pelo "Facebook Login for
// Business" em edges Page-scoped como /subscribed_apps. O mecanismo
// oficial documentado para obter um token utilizável numa Page específica
// é consultar `/me/accounts`, que devolve — por Page — o `id`, `name`,
// `access_token` (o Page Access Token) e `tasks`:
//   - https://developers.facebook.com/docs/pages/overview
//     ("Query the /me/accounts endpoint to get the ID and Page Access
//     Token of the Page." + tabela de `tasks`, incluindo `ADVERTISE`)
//   - https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/
//     ("A Page access token requested from a person who can perform the
//     ADVERTISE task on the Page being queried")
//
// SEGURANÇA: tanto o token de entrada (SUAT/user) quanto o `access_token`
// de cada Page devolvido pela Meta são EXTREMAMENTE sensíveis. Nunca
// logados, nunca devolvidos, nunca em Error/exceção, nunca persistidos. A
// resposta bruta da Meta (que pode listar Pages sem relação com o teste)
// NUNCA é logada — só o resultado já reduzido à Page alvo.
const DEFAULT_TIMEOUT_MS = 8000;

export type PageTokenLookupFailureReason =
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'network_error'
  | 'invalid_json';

export type PageTokenLookupResult =
  // Page alvo encontrada em /me/accounts. `pageAccessToken` pode vir vazio
  // se a Meta devolver a entrada sem `access_token` (caller deve tratar).
  | { ok: true; found: true; httpStatus: number; pageAccessToken: string; tasks: string[] }
  // Página alvo NÃO está na lista devolvida.
  | { ok: true; found: false; httpStatus: number }
  // Falha de rede/HTTP/parse — nunca o corpo bruto da Meta.
  | { ok: false; reason: PageTokenLookupFailureReason; httpStatus?: number };

export interface FetchPageAccessTokenInput {
  // SUAT ou User Access Token do OAuth — usado SÓ em memória, nesta
  // chamada; nunca persistido pelo caller.
  accessToken: string;
  targetPageId: string;
  graphApiVersion: string;
  timeoutMs?: number;
  // Injeção para teste; default: fetch global.
  fetchImpl?: typeof fetch;
}

function meAccountsEndpoint(version: string): string {
  return `https://graph.facebook.com/${version}/me/accounts`;
}

export async function fetchPageAccessToken(input: FetchPageAccessTokenInput): Promise<PageTokenLookupResult> {
  // URL só em memória — carrega o access_token na query (mecanismo oficial
  // de autenticação server-to-server da Graph API); nunca logada, nunca em
  // Error/exceção.
  const url = new URL(meAccountsEndpoint(input.graphApiVersion));
  url.searchParams.set('fields', 'id,name,access_token,tasks');
  url.searchParams.set('access_token', input.accessToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      // Nunca seguir um redirect para outro host com o token na query.
      redirect: 'error',
    });
  } catch (err) {
    // NUNCA propaga `err` (pode carregar a URL/token). Só classifica.
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }

  const httpStatus = response.status;
  if (!response.ok) {
    // NÃO lê o corpo de erro da Meta (pode conter detalhe sensível).
    return { ok: false, reason: httpStatus >= 500 ? 'http_5xx' : 'http_4xx', httpStatus };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: 'invalid_json', httpStatus };
  }

  const dataField =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).data
      : undefined;
  if (!Array.isArray(dataField)) {
    return { ok: true, found: false, httpStatus };
  }

  // Varre a lista SÓ para localizar o `id` exato — nunca guarda/loga as
  // demais Pages devolvidas.
  for (const entry of dataField) {
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    if (obj.id !== input.targetPageId) continue;

    const accessToken = typeof obj.access_token === 'string' ? obj.access_token : '';
    const tasks = Array.isArray(obj.tasks) ? obj.tasks.filter((t): t is string => typeof t === 'string') : [];
    return { ok: true, found: true, httpStatus, pageAccessToken: accessToken, tasks };
  }

  return { ok: true, found: false, httpStatus };
}
