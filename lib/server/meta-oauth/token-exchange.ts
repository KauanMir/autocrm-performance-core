// lib/server/meta-oauth/token-exchange.ts — troca SERVER-ONLY do
// authorization code por access token na Meta (Facebook Login for
// Business). Módulo isolado: importado só pelo Route Handler do callback.
//
// MÉTODO: GET, EXATAMENTE como a documentação oficial atual da Meta:
//   - "Manually Build a Login Flow" — "make an HTTP GET request to the
//     following OAuth endpoint":
//     GET https://graph.facebook.com/<version>/oauth/access_token
//        ?client_id=...&redirect_uri=...&client_secret=...&code=...
//     https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
//   - "Facebook Login for Business" — mesmo endpoint e método GET:
//     https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
//   Nenhuma doc oficial da Meta documenta POST / x-www-form-urlencoded
//   para este endpoint — por isso NÃO usamos POST.
//
// `redirect_uri` é enviada (obrigatória no fluxo de token de usuário;
// inofensiva no System User Access Token) e deve ser IDÊNTICA à do /start
// (derivada de APP_URL + CALLBACK_PATH). O MESMO endpoint devolve token de
// usuário OU SUAT conforme a Configuration — sem passo extra.
//
// SEGURANÇA (GET carrega client_secret + code na query da request
// server-to-server):
//   - a URL é construída SÓ em memória server-side e passada ao fetch;
//   - NUNCA é logada (o módulo não tem logger e não faz console.*);
//   - NUNCA entra em Error/exceção — o `catch` do fetch só classifica
//     (timeout / network_error), nunca lê `err.message`/`err.cause`/a URL;
//   - `!response.ok` -> só a faixa do status; o corpo de erro da Meta NÃO
//     é lido;
//   - o access_token existe só num `const` local e é descartado no
//     return; o módulo devolve apenas metadados não sensíveis.
//   - `redirect: 'error'` — nunca segue um 3xx (levaria a query com o
//     segredo para outro host).
import { CALLBACK_PATH } from '@/lib/server/meta-oauth/config';

const DEFAULT_TIMEOUT_MS = 8000;

export type TokenExchangeFailureReason =
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'network_error'
  | 'invalid_json'
  | 'no_access_token';

export type TokenExchangeResult =
  // Sucesso: SÓ metadados não sensíveis. Nunca o token.
  | { ok: true; tokenType?: string; expiresInSeconds?: number; httpStatus: number }
  // Falha: `reason` sanitizado + status HTTP da Meta (não sensível), quando houve.
  | { ok: false; reason: TokenExchangeFailureReason; httpStatus?: number };

export interface ExchangeCodeInput {
  code: string;
  appId: string;
  appSecret: string;
  // APP_URL.origin — usado para derivar a MESMA redirect_uri do /start.
  appOrigin: string;
  graphApiVersion: string;
  timeoutMs?: number;
  // Injeção para teste; default: fetch global.
  fetchImpl?: typeof fetch;
}

function graphTokenEndpoint(version: string): string {
  return `https://graph.facebook.com/${version}/oauth/access_token`;
}

export async function exchangeCodeForToken(input: ExchangeCodeInput): Promise<TokenExchangeResult> {
  const redirectUri = new URL(CALLBACK_PATH, input.appOrigin).toString();

  // URL só em memória — nunca logada, nunca em Error, nunca na resposta.
  const url = new URL(graphTokenEndpoint(input.graphApiVersion));
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('client_secret', input.appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', input.code);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      // Nunca seguir um redirect para um host inesperado com a query
      // (client_secret + code). Um 3xx vira erro classificado.
      redirect: 'error',
    });
  } catch (err) {
    // NUNCA propaga `err` (pode carregar a URL/inputs). Só classifica.
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }

  const httpStatus = response.status;

  if (!response.ok) {
    // NÃO lê o corpo de erro da Meta (pode conter detalhe/credencial).
    // Só a faixa do status.
    return { ok: false, reason: httpStatus >= 500 ? 'http_5xx' : 'http_4xx', httpStatus };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: 'invalid_json', httpStatus };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'no_access_token', httpStatus };
  }
  const obj = parsed as Record<string, unknown>;

  // O access_token existe SÓ neste escopo local e é descartado no return —
  // nunca atribuído a escopo externo, nunca logado, nunca devolvido.
  const accessToken = obj.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { ok: false, reason: 'no_access_token', httpStatus };
  }

  return {
    ok: true,
    httpStatus,
    tokenType: typeof obj.token_type === 'string' ? obj.token_type : undefined,
    expiresInSeconds:
      typeof obj.expires_in === 'number' && Number.isFinite(obj.expires_in)
        ? obj.expires_in
        : undefined,
  };
}
