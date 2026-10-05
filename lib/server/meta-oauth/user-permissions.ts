// lib/server/meta-oauth/user-permissions.ts — leitura das permissões
// CONCEDIDAS ao usuário que autorizou o OAuth (SUAT/user access token), via
// GET /{version}/me/permissions, com paginação por cursor. SERVER-ONLY, só
// chamado pelo callback no ramo de teste controlado, antes de qualquer
// operação sobre a Page.
//
// Endpoint oficial: https://developers.facebook.com/docs/graph-api/reference/user/permissions/
//   — `GET /{user-id}/permissions`, aceita user access token; cada item de
//   `data` traz `permission` e `status` (granted | declined | expired).
//   Usamos `me` como user-id. Só `status === "granted"` conta como concedida.
//
// PAGINAÇÃO: a próxima página é pedida reconstruindo o MESMO endpoint oficial
// com `after=<paging.cursors.after>`. `paging.next` é usado SOMENTE como
// indicador de que há outra página — nunca como URL a seguir. Limite de
// MAX_PERMISSION_PAGES páginas; excedido = falha fechada
// (pagination_limit_exceeded), nunca missing_required_permission, porque nesse
// caso não sabemos se a permissão está ausente.
//
// SEGURANÇA: o SUAT, a URL completa, `paging.next` e a resposta bruta nunca
// são logados, devolvidos ou colocados em Error. Só nomes de permissão de um
// conjunto conhecido saem deste módulo.
export const REQUIRED_LEAD_ADS_PERMISSIONS = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'leads_retrieval',
] as const;

export type RequiredLeadAdsPermission = (typeof REQUIRED_LEAD_ADS_PERMISSIONS)[number];

export const MAX_PERMISSION_PAGES = 5;
const PAGE_LIMIT = '100';
const DEFAULT_TIMEOUT_MS = 8000;

export type UserPermissionsFailureReason =
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'pagination_limit_exceeded';

export type UserPermissionsResult =
  | { ok: true; grantedPermissions: string[] }
  | { ok: false; reason: UserPermissionsFailureReason; httpStatus?: number };

export interface FetchGrantedUserPermissionsInput {
  // SUAT/user access token — NUNCA o Page Access Token.
  userAccessToken: string;
  graphApiVersion: string;
  timeoutMs?: number;
  // Injeção para teste; default: fetch global.
  fetchImpl?: typeof fetch;
}

type PageResult =
  | { ok: true; httpStatus: number; data: unknown[]; hasNext: boolean; after: string | null }
  | { ok: false; reason: UserPermissionsFailureReason; httpStatus?: number };

function permissionsEndpoint(version: string): string {
  return `https://graph.facebook.com/${version}/me/permissions`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function requestPermissionsPage(
  input: FetchGrantedUserPermissionsInput,
  after: string | null,
): Promise<PageResult> {
  const url = new URL(permissionsEndpoint(input.graphApiVersion));
  url.searchParams.set('limit', PAGE_LIMIT);
  if (after !== null) url.searchParams.set('after', after);
  url.searchParams.set('access_token', input.userAccessToken);

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
  const body = parsed as Record<string, unknown>;
  if (!Array.isArray(body.data)) {
    return { ok: false, reason: 'invalid_response', httpStatus };
  }

  const paging = typeof body.paging === 'object' && body.paging !== null ? (body.paging as Record<string, unknown>) : {};
  const cursors = typeof paging.cursors === 'object' && paging.cursors !== null ? (paging.cursors as Record<string, unknown>) : {};

  return {
    ok: true,
    httpStatus,
    data: body.data,
    hasNext: isNonEmptyString(paging.next),
    after: isNonEmptyString(cursors.after) ? cursors.after : null,
  };
}

export async function fetchGrantedUserPermissions(
  input: FetchGrantedUserPermissionsInput,
): Promise<UserPermissionsResult> {
  const grantedPermissions: string[] = [];
  let after: string | null = null;

  for (let page = 1; page <= MAX_PERMISSION_PAGES; page += 1) {
    const result = await requestPermissionsPage(input, after);
    if ('reason' in result) {
      return { ok: false, reason: result.reason, httpStatus: result.httpStatus };
    }

    for (const item of result.data) {
      if (typeof item !== 'object' || item === null) continue;
      const { permission, status } = item as Record<string, unknown>;
      if (typeof permission === 'string' && status === 'granted') {
        grantedPermissions.push(permission);
      }
    }

    if (!result.hasNext) {
      return { ok: true, grantedPermissions };
    }
    if (result.after === null) {
      return { ok: false, reason: 'invalid_response', httpStatus: result.httpStatus };
    }
    after = result.after;
  }

  return { ok: false, reason: 'pagination_limit_exceeded' };
}

// Primeira permissão obrigatória ausente, na ordem fixa da lista; null se
// as quatro estiverem concedidas. Permissões extras são irrelevantes.
export function findMissingRequiredPermission(
  grantedPermissions: readonly string[],
): RequiredLeadAdsPermission | null {
  for (const required of REQUIRED_LEAD_ADS_PERMISSIONS) {
    if (!grantedPermissions.includes(required)) return required;
  }
  return null;
}
