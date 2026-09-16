// lib/server/meta-oauth/page-read-engagement.ts — leitura mínima e
// read-only de conteúdo publicado pela própria Page
// (GET /{page-id}/posts?fields=id&limit=1) usando o PAGE ACCESS TOKEN, para
// gerar uma chamada de API bem-sucedida que use `pages_read_engagement`
// (exigência da Meta para liberar o botão de Advanced Access). SERVER-ONLY,
// só chamado pelo callback no ambiente de teste controlado (ver route.ts).
//
// Documentação oficial confirmada:
//   https://developers.facebook.com/docs/permissions/reference/pages_read_engagement
//   — a permissão cobre explicitamente "ler conteúdo (publicações, fotos,
//   vídeos e eventos) publicado pela Página". O edge `/{page-id}/posts` é o
//   mecanismo padrão documentado para listar publicações da Página (ver
//   https://developers.facebook.com/docs/graph-api/reference/page/#edges e
//   https://developers.facebook.com/docs/graph-api/reference/page/feed/).
//   `fields=id` e `limit=1` são os únicos parâmetros enviados — SÓ o `id`
//   de NO MÁXIMO um post é lido: nenhum `message`, comentário, reaction,
//   dado de usuário ou insight é solicitado.
//
// SUCESSO = a Graph API respondeu HTTP 2xx com um corpo cujo campo `data`
// é um array (mesmo vazio — a Page pode não ter posts; isso NÃO é erro).
//
// SEGURANÇA: o Page Access Token é EXTREMAMENTE sensível. Nunca logado,
// nunca devolvido, nunca em Error/exceção, nunca persistido. O conteúdo da
// resposta da Meta (ids de post, mesmo não sensíveis) NUNCA é logado nem
// devolvido ao cliente — só o resultado booleano reduzido.
const DEFAULT_TIMEOUT_MS = 8000;

export type PageReadEngagementFailureReason =
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'network_error'
  | 'invalid_response';

export type PageReadEngagementResult =
  | { ok: true; httpStatus: number }
  | { ok: false; reason: PageReadEngagementFailureReason; httpStatus?: number };

export interface FetchPageReadEngagementInput {
  pageId: string;
  // Page Access Token — NUNCA o SUAT/user token do OAuth.
  pageAccessToken: string;
  graphApiVersion: string;
  timeoutMs?: number;
  // Injeção para teste; default: fetch global.
  fetchImpl?: typeof fetch;
}

function pagePostsEndpoint(version: string, pageId: string): string {
  return `https://graph.facebook.com/${version}/${pageId}/posts`;
}

export async function fetchPageReadEngagement(input: FetchPageReadEngagementInput): Promise<PageReadEngagementResult> {
  // URL só em memória — carrega o Page Access Token na query (mesmo
  // mecanismo documentado pela Meta); nunca logada, nunca em Error/exceção.
  const url = new URL(pagePostsEndpoint(input.graphApiVersion, input.pageId));
  url.searchParams.set('fields', 'id');
  url.searchParams.set('limit', '1');
  url.searchParams.set('access_token', input.pageAccessToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
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
    return { ok: false, reason: 'invalid_response', httpStatus };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_response', httpStatus };
  }
  // `data` precisa ser um array — vazio conta como sucesso (a Page pode
  // não ter posts). Não inspeciona conteúdo dos itens (só a forma).
  const data = (parsed as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    return { ok: false, reason: 'invalid_response', httpStatus };
  }

  return { ok: true, httpStatus };
}
