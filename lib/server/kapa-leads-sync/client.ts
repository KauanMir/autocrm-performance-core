// lib/server/kapa-leads-sync/client.ts — leitura da exportação do KAPA Leads. SERVER-ONLY.
// Só GET assinado; nunca escreve no KAPA Leads. Resposta validada campo a campo: qualquer
// formato inesperado vira erro (a página não é gravada e o cursor não anda).
// Nunca registra corpo, URL com cursor ou segredo; só códigos.
import type { KapaLeadsSyncConfig } from './env';
import { signedHeaders } from './signature';

export const EXPORT_PATH = '/api/integrations/crm/leads';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const PAGE_LIMIT = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type Cursor = { createdAt: string; id: string };

export type ExportedLead = {
  id: string;
  storeId: string;
  campaign: { id: string; slug: string; name: string };
  createdAt: string;
  contact: { name: string; phone: string; email: string | null };
  formData: Record<string, string | number | boolean | null>;
  formLabels: Record<string, { label: string; format: string | null }>;
  consent: { version: string; at: string };
  tracking: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    pageUrl: string | null;
    referrer: string | null;
  };
  illustrative: { amountCents: number; presentedAt: string; expiresAt: string } | null;
  cpfCooldownUntil: string | null;
};

export type FetchPageResult =
  | { ok: true; items: ExportedLead[]; nextCursor: Cursor | null; hasMore: boolean }
  | { ok: false; code: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 10_000): v is string => typeof v === 'string' && v.length <= max;
const isNullableStr = (v: unknown, max = 10_000): v is string | null => v === null || isStr(v, max);
const isTs = (v: unknown): v is string => typeof v === 'string' && TIMESTAMP.test(v) && Number.isFinite(Date.parse(v));
const isNullableTs = (v: unknown): v is string | null => v === null || isTs(v);

export function parseExportedLead(value: unknown): ExportedLead | null {
  if (!isObject(value)) return null;
  const { id, storeId, campaign, createdAt, contact, formData, formLabels, consent, tracking, illustrative, cpfCooldownUntil } = value;
  if (!isStr(id) || !UUID.test(id) || !isStr(storeId) || !UUID.test(storeId) || !isTs(createdAt)) return null;
  if (!isObject(campaign) || !isStr(campaign.id) || !UUID.test(campaign.id) || !isStr(campaign.slug, 64) || !SLUG.test(campaign.slug)
    || !isStr(campaign.name, 150) || !campaign.name.trim()) return null;
  if (!isObject(contact) || !isStr(contact.name, 300) || !isStr(contact.phone, 20) || !isNullableStr(contact.email, 254)) return null;
  if (!isObject(formData)) return null;
  const data: ExportedLead['formData'] = {};
  for (const [key, v] of Object.entries(formData)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) return null;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isStr(v, 1000)) data[key] = v as string | number | boolean | null;
    else return null;
  }
  const labels: ExportedLead['formLabels'] = {};
  if (!isObject(formLabels)) return null;
  for (const [key, v] of Object.entries(formLabels)) {
    if (!isObject(v) || !isStr(v.label, 100) || !isNullableStr(v.format, 32)) return null;
    labels[key] = { label: v.label, format: v.format };
  }
  if (!isObject(consent) || !isStr(consent.version, 32) || !isTs(consent.at)) return null;
  if (!isObject(tracking)) return null;
  const t = tracking;
  for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'] as const) if (!isNullableStr(t[key], 255)) return null;
  if (!isNullableStr(t.pageUrl, 2048) || !isNullableStr(t.referrer, 2048)) return null;
  let illus: ExportedLead['illustrative'] = null;
  if (illustrative !== null) {
    if (!isObject(illustrative) || typeof illustrative.amountCents !== 'number' || !Number.isSafeInteger(illustrative.amountCents)
      || !isTs(illustrative.presentedAt) || !isTs(illustrative.expiresAt)) return null;
    illus = { amountCents: illustrative.amountCents, presentedAt: illustrative.presentedAt, expiresAt: illustrative.expiresAt };
  }
  if (!isNullableTs(cpfCooldownUntil)) return null;
  return {
    id,
    storeId,
    campaign: { id: campaign.id, slug: campaign.slug, name: campaign.name },
    createdAt,
    contact: { name: contact.name, phone: contact.phone, email: contact.email },
    formData: data,
    formLabels: labels,
    consent: { version: consent.version, at: consent.at },
    tracking: {
      utmSource: t.utmSource as string | null,
      utmMedium: t.utmMedium as string | null,
      utmCampaign: t.utmCampaign as string | null,
      utmContent: t.utmContent as string | null,
      utmTerm: t.utmTerm as string | null,
      pageUrl: t.pageUrl as string | null,
      referrer: t.referrer as string | null,
    },
    illustrative: illus,
    cpfCooldownUntil,
  };
}

export async function fetchLeadsPage(input: {
  config: KapaLeadsSyncConfig;
  storeId: string;
  cursor: Cursor;
  limit?: number;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  timeoutMs?: number;
}): Promise<FetchPageResult> {
  const { config, storeId, cursor, limit = PAGE_LIMIT, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = input;
  const query = new URLSearchParams({ storeId, afterCreatedAt: cursor.createdAt, afterId: cursor.id, limit: String(limit) });
  const pathAndQuery = `${EXPORT_PATH}?${query.toString()}`;
  const headers = signedHeaders(config.secret, 'GET', pathAndQuery, input.nowMs ?? Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${pathAndQuery}`, {
      method: 'GET',
      headers: { ...headers, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    return { ok: false, code: controller.signal.aborted ? 'source_timeout' : 'source_network' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) return { ok: false, code: 'source_unauthorized' };
  if (response.status === 403) return { ok: false, code: 'source_store_not_allowed' };
  if (response.status === 404) return { ok: false, code: 'source_export_disabled' };
  if (response.status === 429) return { ok: false, code: 'source_rate_limited' };
  if (response.status >= 500) return { ok: false, code: 'source_server_error' };
  if (response.status !== 200) return { ok: false, code: 'source_unexpected_status' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'source_invalid_body' };
  }
  if (!isObject(body) || body.success !== true || !Array.isArray(body.items) || typeof body.hasMore !== 'boolean') {
    return { ok: false, code: 'source_invalid_body' };
  }
  if (body.items.length > limit) return { ok: false, code: 'source_invalid_body' };
  const items: ExportedLead[] = [];
  for (const raw of body.items) {
    const lead = parseExportedLead(raw);
    // Um item fora do contrato invalida a página inteira: nada é gravado pela metade.
    if (!lead) return { ok: false, code: 'source_invalid_item' };
    if (lead.storeId !== storeId) return { ok: false, code: 'source_store_mismatch' };
    items.push(lead);
  }
  let nextCursor: Cursor | null = null;
  if (body.nextCursor !== null) {
    const c = body.nextCursor;
    if (!isObject(c) || !isTs(c.createdAt) || !isStr(c.id) || !UUID.test(c.id)) return { ok: false, code: 'source_invalid_body' };
    nextCursor = { createdAt: c.createdAt, id: c.id };
  }
  if ((items.length === 0) !== (nextCursor === null)) return { ok: false, code: 'source_invalid_body' };
  const last = items.at(-1);
  if (last && nextCursor && (last.id !== nextCursor.id || last.createdAt !== nextCursor.createdAt)) {
    return { ok: false, code: 'source_invalid_body' };
  }
  return { ok: true, items, nextCursor, hasMore: body.hasMore };
}

export const COUNT_PATH = '/api/integrations/crm/leads/count';

/** Contagem de leads da loja no KAPA Leads em (from, to] — sem dados pessoais. */
export async function fetchLeadsCount(input: {
  config: KapaLeadsSyncConfig;
  storeId: string;
  from: string;
  to: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  timeoutMs?: number;
}): Promise<{ ok: true; count: number } | { ok: false; code: string }> {
  const { config, storeId, from, to, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = input;
  const pathAndQuery = `${COUNT_PATH}?${new URLSearchParams({ storeId, from, to }).toString()}`;
  const headers = signedHeaders(config.secret, 'GET', pathAndQuery, input.nowMs ?? Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl}${pathAndQuery}`, {
      method: 'GET', headers: { ...headers, Accept: 'application/json' }, signal: controller.signal, cache: 'no-store', redirect: 'error',
    });
    if (response.status !== 200) return { ok: false, code: 'count_unavailable' };
    const body = await response.json() as unknown;
    if (!isObject(body) || body.success !== true || typeof body.count !== 'number' || !Number.isSafeInteger(body.count) || body.count < 0) {
      return { ok: false, code: 'count_invalid_body' };
    }
    return { ok: true, count: body.count };
  } catch {
    return { ok: false, code: 'count_unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
