// lib/server/meta-oauth/page-subscription.ts — inscreve UMA Page nos
// webhooks do app (ex.: campo `leadgen`) via POST /{page-id}/subscribed_apps,
// usando SEMPRE o PAGE ACCESS TOKEN (nunca o SUAT/user token — ver
// page-token.ts). SERVER-ONLY, só chamado pelo callback no ambiente de
// teste controlado (ver route.ts).
//
// Documentação oficial:
//   https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/
//   ("have your app send a POST request to the Page's subscribed_apps
//   edge using the Page's access token" + exemplo
//   `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen&access_token=...`)
//
// SEGURANÇA: o Page Access Token é EXTREMAMENTE sensível. Nunca logado,
// nunca devolvido, nunca em Error/exceção, nunca persistido.
const DEFAULT_TIMEOUT_MS = 8000;

export type PageSubscriptionFailureReason =
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'network_error'
  | 'invalid_json'
  | 'not_success';

export type PageSubscriptionResult =
  | { ok: true; httpStatus: number }
  | { ok: false; reason: PageSubscriptionFailureReason; httpStatus?: number };

export interface SubscribePageInput {
  pageId: string;
  // Page Access Token — NUNCA o SUAT/user token do OAuth.
  pageAccessToken: string;
  subscribedField: string;
  graphApiVersion: string;
  timeoutMs?: number;
  // Injeção para teste; default: fetch global.
  fetchImpl?: typeof fetch;
}

function subscribedAppsEndpoint(version: string, pageId: string): string {
  return `https://graph.facebook.com/${version}/${pageId}/subscribed_apps`;
}

export async function subscribePageToWebhookField(input: SubscribePageInput): Promise<PageSubscriptionResult> {
  // URL só em memória — carrega o Page Access Token na query (mesmo
  // mecanismo documentado pela Meta); nunca logada, nunca em Error/exceção.
  const url = new URL(subscribedAppsEndpoint(input.graphApiVersion, input.pageId));
  url.searchParams.set('subscribed_fields', input.subscribedField);
  url.searchParams.set('access_token', input.pageAccessToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
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
  if (!response.ok) {
    // NÃO lê o corpo de erro da Meta.
    return { ok: false, reason: httpStatus >= 500 ? 'http_5xx' : 'http_4xx', httpStatus };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: 'invalid_json', httpStatus };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not_success', httpStatus };
  }
  const success = (parsed as Record<string, unknown>).success;
  if (success !== true && success !== 'true') {
    return { ok: false, reason: 'not_success', httpStatus };
  }

  return { ok: true, httpStatus };
}
