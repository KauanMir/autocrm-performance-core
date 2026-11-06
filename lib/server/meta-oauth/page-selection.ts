// lib/server/meta-oauth/page-selection.ts — META-MVP2. SERVER-ONLY.
//
// Seleção da Página depois do OAuth, para qualquer empresa autorizada:
//   1. callback lista as Páginas elegíveis (/me/accounts com a task ADVERTISE),
//      cifra o token de cada uma (AAD company+page) e grava uma seleção de uso
//      único com TTL curto (meta_oauth_page_selections, service_role);
//   2. o navegador recebe só um token ASSINADO com o id da seleção, num cookie
//      HttpOnly restrito à rota da seleção;
//   3. o usuário escolhe uma Página; o servidor consome a seleção (uso único),
//      decifra SÓ o token escolhido, verifica com debug_token, inscreve o
//      webhook leadgen e persiste a conexão.
// Nenhum token em claro sai do servidor nem fica em repouso sem cifra.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { REQUIRED_LEADGEN_PAGE_TASK, LEADGEN_SUBSCRIBED_FIELD } from './config';
import { encryptMetaPageToken, decryptMetaPageToken } from './token-crypto';
import { getMetaTokenKeyForVersion, META_TOKEN_KEY_VERSION } from './token-key';
import { evaluatePageToken, inspectAccessToken } from './token-lifetime';
import { fetchPageReadEngagement } from './page-read-engagement';
import { subscribePageToWebhookField } from './page-subscription';
import {
  persistMetaPageConnection,
  type MetaConnectionRpcPort,
  type TokenOrigin,
} from './connection-persistence';
import { REQUIRED_LEAD_ADS_PERMISSIONS } from './user-permissions';

const DEFAULT_TIMEOUT_MS = 8000;
const PAGE_ID_PATTERN = /^[0-9]{1,30}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SELECTABLE_PAGES = 25;
export const PAGE_SELECTION_TTL_SECONDS = 600;
const PAGE_NAME_MAX = 200;

// ── 1. Páginas elegíveis ───────────────────────────────────────────────

export interface EligiblePage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
}

export type EligiblePagesResult =
  | { ok: true; pages: EligiblePage[]; ineligibleCount: number; truncated: boolean; httpStatus: number }
  | { ok: false; reason: 'http_4xx' | 'http_5xx' | 'timeout' | 'network_error' | 'invalid_json'; httpStatus?: number };

export async function fetchEligiblePages(input: {
  accessToken: string;
  graphApiVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<EligiblePagesResult> {
  const url = new URL(`https://graph.facebook.com/${input.graphApiVersion}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token,tasks');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', input.accessToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
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
  if (!response.ok) return { ok: false, reason: httpStatus >= 500 ? 'http_5xx' : 'http_4xx', httpStatus };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: 'invalid_json', httpStatus };
  }
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const paging = typeof record.paging === 'object' && record.paging !== null ? (record.paging as Record<string, unknown>) : {};

  const pages: EligiblePage[] = [];
  let ineligibleCount = 0;
  for (const entry of data) {
    const obj = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const pageId = typeof obj.id === 'string' ? obj.id : '';
    const token = typeof obj.access_token === 'string' ? obj.access_token : '';
    const tasks = Array.isArray(obj.tasks) ? obj.tasks.filter((t): t is string => typeof t === 'string') : [];
    const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!PAGE_ID_PATTERN.test(pageId) || token === '' || !tasks.includes(REQUIRED_LEADGEN_PAGE_TASK)) {
      ineligibleCount += 1;
      continue;
    }
    if (pages.some((page) => page.pageId === pageId)) continue;
    pages.push({ pageId, pageName: (rawName || `Página ${pageId}`).slice(0, PAGE_NAME_MAX), pageAccessToken: token });
  }
  const truncated = pages.length > MAX_SELECTABLE_PAGES || typeof paging.next === 'string';
  return { ok: true, pages: pages.slice(0, MAX_SELECTABLE_PAGES), ineligibleCount, truncated, httpStatus };
}

// ── 2. token assinado da seleção ──────────────────────────────────────

const TOKEN_PURPOSE = 'meta_page_selection';

interface SelectionTokenPayload {
  v: 1;
  p: typeof TOKEN_PURPOSE;
  n: string;
  sid: string;
  cid: string;
  uid: string;
  iat: number;
  exp: number;
}

function sign(body: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
}

export function createPageSelectionToken(input: {
  secret: Buffer;
  selectionId: string;
  companyId: string;
  userId: string;
  ttlSeconds?: number;
  nowMs?: number;
}): string {
  const iat = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const payload: SelectionTokenPayload = {
    v: 1,
    p: TOKEN_PURPOSE,
    n: randomBytes(9).toString('base64url'),
    sid: input.selectionId,
    cid: input.companyId,
    uid: input.userId,
    iat,
    exp: iat + Math.min(input.ttlSeconds ?? PAGE_SELECTION_TTL_SECONDS, PAGE_SELECTION_TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, input.secret)}`;
}

export type SelectionTokenResult =
  | { ok: true; selectionId: string; companyId: string; userId: string }
  | { ok: false; reason: 'malformed' | 'invalid' | 'expired' };

export function verifyPageSelectionToken(token: unknown, input: { secret: Buffer; nowMs?: number }): SelectionTokenResult {
  if (typeof token !== 'string' || token.length > 1024) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = Buffer.from(sign(parts[0], input.secret), 'utf8');
  const received = Buffer.from(parts[1], 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: 'invalid' };
  let payload: Partial<SelectionTokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    payload.v !== 1 || payload.p !== TOKEN_PURPOSE ||
    typeof payload.sid !== 'string' || !UUID_PATTERN.test(payload.sid) ||
    typeof payload.cid !== 'string' || !UUID_PATTERN.test(payload.cid) ||
    typeof payload.uid !== 'string' || !UUID_PATTERN.test(payload.uid) ||
    typeof payload.exp !== 'number'
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (payload.exp <= Math.floor((input.nowMs ?? Date.now()) / 1000)) return { ok: false, reason: 'expired' };
  return { ok: true, selectionId: payload.sid, companyId: payload.cid, userId: payload.uid };
}

// ── 3. porta das RPCs (service_role) ──────────────────────────────────

export interface PageSelectionRpc {
  leadAdsEnabled(companyId: string): Promise<boolean | null>;
  create(input: { companyId: string; profileId: string; pages: { page_id: string; page_name: string; ciphertext: string }[]; tokenOrigin: TokenOrigin }): Promise<string | null>;
  list(input: { selectionId: string; companyId: string; profileId: string }): Promise<{ pageId: string; pageName: string }[] | null>;
  consume(input: { selectionId: string; companyId: string; profileId: string; pageId: string }): Promise<
    | { outcome: 'consumed'; pageName: string; ciphertext: string; tokenOrigin: TokenOrigin }
    | { outcome: 'not_found' | 'already_consumed' | 'expired' | 'page_not_offered' }
    | null
  >;
}

export function createPageSelectionRpc(): PageSelectionRpc {
  const admin = createAdminClient();
  return {
    async leadAdsEnabled(companyId) {
      try {
        const { data, error } = await admin.rpc('meta_lead_ads_enabled_for', { p_company_id: companyId });
        return error || typeof data !== 'boolean' ? null : data;
      } catch {
        return null;
      }
    },
    async create(input) {
      try {
        const { data, error } = await admin.rpc('meta_page_selection_create', {
          p_company_id: input.companyId,
          p_profile_id: input.profileId,
          p_pages: input.pages,
          p_token_origin: input.tokenOrigin,
          p_ttl_seconds: PAGE_SELECTION_TTL_SECONDS,
        });
        const row = Array.isArray(data) ? (data[0] as { out_selection_id?: unknown } | undefined) : undefined;
        return error || typeof row?.out_selection_id !== 'string' ? null : row.out_selection_id;
      } catch {
        return null;
      }
    },
    async list(input) {
      try {
        const { data, error } = await admin.rpc('meta_page_selection_list', {
          p_selection_id: input.selectionId,
          p_company_id: input.companyId,
          p_profile_id: input.profileId,
        });
        if (error || !Array.isArray(data)) return null;
        return (data as { out_page_id?: unknown; out_page_name?: unknown }[])
          .filter((row) => typeof row.out_page_id === 'string' && typeof row.out_page_name === 'string')
          .map((row) => ({ pageId: row.out_page_id as string, pageName: row.out_page_name as string }));
      } catch {
        return null;
      }
    },
    async consume(input) {
      try {
        const { data, error } = await admin.rpc('meta_page_selection_consume', {
          p_selection_id: input.selectionId,
          p_company_id: input.companyId,
          p_profile_id: input.profileId,
          p_page_id: input.pageId,
        });
        const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
        if (error || !row || typeof row.out_outcome !== 'string') return null;
        if (row.out_outcome === 'consumed') {
          const origin = row.out_token_origin;
          if (typeof row.out_ciphertext !== 'string' || typeof row.out_page_name !== 'string'
            || (origin !== 'exchanged_long_lived' && origin !== 'original_token')) return null;
          return { outcome: 'consumed', pageName: row.out_page_name, ciphertext: row.out_ciphertext, tokenOrigin: origin };
        }
        if (['not_found', 'already_consumed', 'expired', 'page_not_offered'].includes(row.out_outcome)) {
          return { outcome: row.out_outcome as 'not_found' | 'already_consumed' | 'expired' | 'page_not_offered' };
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

// ── 4. cifrar as Páginas da seleção ───────────────────────────────────

export function encryptSelectionPages(companyId: string, pages: readonly EligiblePage[]) {
  const key = getMetaTokenKeyForVersion(META_TOKEN_KEY_VERSION);
  return pages.map((page) => ({
    page_id: page.pageId,
    page_name: page.pageName,
    ciphertext: encryptMetaPageToken({ plaintextToken: page.pageAccessToken, companyId, pageId: page.pageId, key }),
  }));
}

// ── 5. conectar a Página escolhida ────────────────────────────────────

export type ConnectSelectedPageError =
  | 'selection_unavailable'
  | 'selection_expired'
  | 'selection_already_used'
  | 'page_not_offered'
  | 'page_already_connected'
  | 'company_access_disabled'
  | 'token_decrypt_failed'
  | 'page_token_inspection_failed'
  | 'page_token_invalid'
  | 'page_token_short_lived'
  | 'page_read_engagement_failed'
  | 'page_subscription_failed'
  | 'connection_lookup_failed'
  | 'connection_persist_failed';

export type ConnectSelectedPageResult =
  | { ok: true; pageId: string; pageName: string }
  // subscribedWithoutConnection: a Meta aceitou a inscrição e a conexão não foi
  // gravada. Os eventos da Página ficam retidos até uma nova conexão.
  | { ok: false; error: ConnectSelectedPageError; subscribedWithoutConnection?: boolean };

export interface ConnectSelectedPageDeps {
  selection: PageSelectionRpc;
  connection: MetaConnectionRpcPort;
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export async function connectSelectedPage(
  deps: ConnectSelectedPageDeps,
  input: { selectionId: string; companyId: string; userId: string; pageId: string },
): Promise<ConnectSelectedPageResult> {
  if (!PAGE_ID_PATTERN.test(input.pageId)) return { ok: false, error: 'page_not_offered' };
  const now = (deps.now ?? (() => new Date()))();

  if ((await deps.selection.leadAdsEnabled(input.companyId)) !== true) return { ok: false, error: 'company_access_disabled' };

  // Só Página oferecida nesta seleção segue adiante. Vem antes da checagem de
  // dono: quem tem uma seleção não pode sondar se uma Página qualquer já está
  // conectada. Seleção vencida ou usada lista vazio e o consumo dá o motivo.
  const offered = await deps.selection.list({ selectionId: input.selectionId, companyId: input.companyId, profileId: input.userId });
  if (offered && offered.length > 0 && !offered.some((page) => page.pageId === input.pageId)) {
    return { ok: false, error: 'page_not_offered' };
  }

  // Página de OUTRA empresa, conectada OU em erro aguardando reconexão: recusa
  // ANTES de consumir a seleção, para o usuário poder escolher outra. Aceitar a
  // conexão em erro desviaria os leads da dona para quem conectou por último.
  let owners: Awaited<ReturnType<MetaConnectionRpcPort['ownerForIngestion']>>;
  try {
    owners = await deps.connection.ownerForIngestion(input.pageId);
  } catch {
    return { ok: false, error: 'connection_lookup_failed' };
  }
  if (owners.error) return { ok: false, error: 'connection_lookup_failed' };
  if ((owners.data ?? []).some((row) => row.company_id !== input.companyId)) return { ok: false, error: 'page_already_connected' };

  const consumed = await deps.selection.consume({
    selectionId: input.selectionId,
    companyId: input.companyId,
    profileId: input.userId,
    pageId: input.pageId,
  });
  if (consumed === null) return { ok: false, error: 'selection_unavailable' };
  if (consumed.outcome !== 'consumed') {
    const map = {
      not_found: 'selection_unavailable',
      already_consumed: 'selection_already_used',
      expired: 'selection_expired',
      page_not_offered: 'page_not_offered',
    } as const;
    return { ok: false, error: map[consumed.outcome] };
  }

  let pageAccessToken: string;
  try {
    pageAccessToken = decryptMetaPageToken({
      ciphertext: consumed.ciphertext,
      companyId: input.companyId,
      pageId: input.pageId,
      key: getMetaTokenKeyForVersion(META_TOKEN_KEY_VERSION),
    });
  } catch {
    return { ok: false, error: 'token_decrypt_failed' };
  }

  const inspection = await inspectAccessToken({
    inputToken: pageAccessToken,
    appId: deps.appId,
    appSecret: deps.appSecret,
    graphApiVersion: deps.graphApiVersion,
    fetchImpl: deps.fetchImpl,
  });
  if (!('inspection' in inspection)) return { ok: false, error: 'page_token_inspection_failed' };
  const verdict = evaluatePageToken(inspection.inspection, now, input.pageId);
  if (!('expiresAt' in verdict)) return { ok: false, error: verdict.reason };

  const readEngagement = await fetchPageReadEngagement({
    pageId: input.pageId,
    pageAccessToken,
    graphApiVersion: deps.graphApiVersion,
    fetchImpl: deps.fetchImpl,
  });
  if (!readEngagement.ok) return { ok: false, error: 'page_read_engagement_failed' };

  const subscription = await subscribePageToWebhookField({
    pageId: input.pageId,
    pageAccessToken,
    subscribedField: LEADGEN_SUBSCRIBED_FIELD,
    graphApiVersion: deps.graphApiVersion,
    fetchImpl: deps.fetchImpl,
  });
  if (!subscription.ok) return { ok: false, error: 'page_subscription_failed' };

  const persisted = await persistMetaPageConnection(
    { rpc: deps.connection },
    {
      companyId: input.companyId,
      pageId: input.pageId,
      pageName: consumed.pageName,
      pageAccessToken,
      grantedScopes: [...REQUIRED_LEAD_ADS_PERMISSIONS],
      connectedAt: now,
      connectedBy: input.userId,
      leadgenSubscribedAt: now,
      tokenHealth: {
        origin: consumed.tokenOrigin,
        expiresAt: verdict.expiresAt,
        dataAccessExpiresAt: verdict.dataAccessExpiresAt,
        checkedAt: now,
      },
    },
  );
  if (!persisted.ok) {
    return {
      ok: false,
      error: 'code' in persisted && persisted.code === 'page_already_connected' ? 'page_already_connected' : 'connection_persist_failed',
      subscribedWithoutConnection: true,
    };
  }
  return { ok: true, pageId: input.pageId, pageName: consumed.pageName };
}
