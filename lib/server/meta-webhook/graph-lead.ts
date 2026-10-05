// Cliente puro de leitura de um lead Meta: GET /{version}/{leadgen_id}.
// SERVER-ONLY. fetch é injetado; o token vai só no header Authorization, em
// memória, e nunca em URL, log, retorno ou mensagem de erro.
// Mapeamentos marcados como PROVISÓRIO não estão confirmados pela documentação
// consultada e devem ser validados no smoke controlado.
import type { MetaLeadErrorCode } from './error-codes';

export const GRAPH_LEAD_FIELDS = ['id', 'created_time', 'ad_id', 'form_id', 'field_data'] as const;
export const GRAPH_TIMEOUT_MS = 8000;

const VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/;
const LEADGEN_ID_PATTERN = /^\d{1,64}$/;

export type GraphLeadErrorCode = Extract<
  MetaLeadErrorCode,
  | 'token_invalid'
  | 'graph_permission_missing'
  | 'graph_timeout'
  | 'graph_error'
  | 'graph_malformed'
  | 'lead_not_found'
>;

export interface GraphLeadRecord {
  id: string;
  fieldData: unknown[];
}

export type GraphLeadResult =
  | { ok: true; value: GraphLeadRecord }
  | { ok: false; code: GraphLeadErrorCode };

export type LeadFetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchMetaLeadInput {
  graphApiVersion: string;
  leadgenId: string;
  pageAccessToken: string;
  fetcher?: LeadFetcher;
  timeoutMs?: number;
}

export function buildGraphLeadUrl(graphApiVersion: string, leadgenId: string): string | null {
  if (!VERSION_PATTERN.test(graphApiVersion) || !LEADGEN_ID_PATTERN.test(leadgenId)) return null;
  return `https://graph.facebook.com/${graphApiVersion}/${leadgenId}?fields=${GRAPH_LEAD_FIELDS.join(',')}`;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

// 190 = token inválido/expirado/revogado (confirmado). Permissão (10, 200–299)
// e rate limit (4, 17, 429) seguem a fonte oficial de erros.
// PROVISÓRIO: 400/404 com code 100 = objeto inexistente → lead_not_found. O
// mesmo shape pode cobrir parâmetro inválido; a classificação exata será
// validada no smoke real antes de qualquer retry depender dela.
// Qualquer outro erro vira graph_error (retryable), sem inventar código novo.
export function mapGraphErrorResponse(status: number, metaCode: number | undefined): GraphLeadErrorCode {
  if (metaCode === 190) return 'token_invalid';
  if (metaCode === 10 || (metaCode !== undefined && metaCode >= 200 && metaCode <= 299)) {
    return 'graph_permission_missing';
  }
  if (metaCode === 4 || metaCode === 17 || status === 429) return 'graph_error';
  if (status === 403) return 'graph_permission_missing';
  if ((status === 400 || status === 404) && metaCode === 100) return 'lead_not_found';
  return 'graph_error';
}

async function readMetaErrorCode(response: Response): Promise<number | undefined> {
  try {
    const body: unknown = await response.json();
    const error = (body as { error?: { code?: unknown } } | null)?.error;
    return typeof error?.code === 'number' ? error.code : undefined;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
}

async function parseLeadBody(response: Response, leadgenId: string): Promise<GraphLeadResult> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { ok: false, code: 'graph_malformed' };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, code: 'graph_malformed' };
  }
  const record = body as { id?: unknown; field_data?: unknown };
  if (typeof record.id !== 'string' || record.id !== leadgenId) {
    return { ok: false, code: 'graph_malformed' };
  }
  if (!Array.isArray(record.field_data)) {
    return { ok: false, code: 'graph_malformed' };
  }
  return { ok: true, value: { id: record.id, fieldData: record.field_data } };
}

export async function fetchMetaLead(input: FetchMetaLeadInput): Promise<GraphLeadResult> {
  const url = buildGraphLeadUrl(input.graphApiVersion, input.leadgenId);
  if (url === null) return { ok: false, code: 'graph_malformed' };
  if (!input.pageAccessToken) return { ok: false, code: 'token_invalid' };

  const fetcher: LeadFetcher = input.fetcher ?? ((target, init) => fetch(target, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? GRAPH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.pageAccessToken}` },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      const metaCode = await readMetaErrorCode(response);
      return { ok: false, code: mapGraphErrorResponse(response.status, metaCode) };
    }
    return await parseLeadBody(response, input.leadgenId);
  } catch (error) {
    return { ok: false, code: isAbortError(error) ? 'graph_timeout' : 'graph_error' };
  } finally {
    clearTimeout(timer);
  }
}
