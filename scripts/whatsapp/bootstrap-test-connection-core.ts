// scripts/whatsapp/bootstrap-test-connection-core.ts — lógica do bootstrap
// one-shot (W2A) da PRIMEIRA conexão WhatsApp: número de TESTE da Meta na
// TEST COMPANY. Execução manual/local apenas; a entrada é
// scripts/whatsapp/bootstrap-test-connection.ts (launcher:
// bootstrap-test-connection.ps1). Nada em app/, lib/ ou components/ importa
// scripts/ (há teste garantindo).
//
// Ordem — qualquer falha aborta ANTES da escrita:
//   1. validação local das variáveis da sessão (sem rede);
//   2. preflight Supabase somente leitura;
//   3. validação Graph somente leitura (token no header, nunca na URL);
//   4. (write) UMA escrita funcional: whatsapp_connection_upsert via
//      persistWhatsAppConnection — mesma cifragem/AAD do runtime, sem crypto
//      duplicada aqui. A RPC grava internamente o audit_log;
//   5. (write) ida e volta: lookup_for_processing + decifragem em memória.
//
// Saída = resumo higienizado. Nunca token, chave, service role, ciphertext,
// AAD, WABA ID, phone_number_id, número exibido, respostas brutas da Graph ou
// do Supabase, nem mensagens de erro.
//
// Limite conhecido: strings JS (token, service role) são imutáveis e não
// podem ser zeradas com garantia — ficam no heap até o GC. Mitigação: processo
// curto, de uso único, em janela dedicada que é fechada no fim. O único buffer
// mutável (chave) é zerado no finally.
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import {
  persistWhatsAppConnection,
  type PersistWhatsAppConnectionErrorCode,
} from '@/lib/server/whatsapp-connection/connection-persistence';
import type { RpcFailure, WhatsAppConnectionRpcPort } from '@/lib/server/whatsapp-connection/connection-rpc';
import {
  decryptWhatsAppAccessToken,
  WHATSAPP_TOKEN_KEY_VERSION,
} from '@/lib/server/whatsapp-connection/token-crypto';

// Fixos de propósito: não vêm da sessão.
export const PRODUCTION_PROJECT_REF = 'qglirrsyhdfbgkmchwcw';
export const PRODUCTION_SUPABASE_URL = 'https://qglirrsyhdfbgkmchwcw.supabase.co';
export const TEST_COMPANY_ID = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'; // [SMOKE-SA-S1] Empresa Teste
export const CONFIRM_PHRASE = 'TEST_COMPANY_ONLY';
export const GRAPH_API_VERSION = 'v26.0';
export const GRAPH_TIMEOUT_MS = 8000;

export const BOOTSTRAP_ENV_NAMES = [
  'WA_BOOTSTRAP_ACCESS_TOKEN',
  'WA_BOOTSTRAP_SERVICE_ROLE_KEY',
  'WA_BOOTSTRAP_ENCRYPTION_KEY',
  'WA_BOOTSTRAP_WABA_ID',
  'WA_BOOTSTRAP_PHONE_NUMBER_ID',
  'WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER',
  'WA_BOOTSTRAP_CONNECTED_BY',
  'WA_BOOTSTRAP_CONFIRM',
  'WA_BOOTSTRAP_MODE',
] as const;

export type BootstrapEnv = Partial<Record<(typeof BOOTSTRAP_ENV_NAMES)[number], string>>;

const KEY_PATTERN = /^[0-9a-f]{64}$/;
const ACCESS_TOKEN_PATTERN = /^\S{20,2048}$/;
const META_ID_PATTERN = /^[0-9]{1,30}$/;
const DISPLAY_PHONE_PATTERN = /^[0-9 +()-]{1,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SB_SECRET_PATTERN = /^sb_secret_[A-Za-z0-9_-]{20,}$/;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENVELOPE_V1_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;
const CONNECTION_STATUSES = ['connected', 'disconnected', 'error'] as const;

export type BootstrapMode = 'dry-run' | 'write';
type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export interface BootstrapInput {
  mode: BootstrapMode;
  accessToken: string;
  serviceRoleKey: string;
  encryptionKey: Buffer;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  connectedBy: string | null;
}

export type BootstrapInputErrorCode =
  | 'unexpected_arguments'
  | 'confirm_invalid'
  | 'mode_invalid'
  | 'encryption_key_invalid'
  | 'access_token_invalid'
  | 'service_role_key_invalid'
  | 'waba_id_invalid'
  | 'phone_number_id_invalid'
  | 'waba_id_equals_phone_number_id'
  | 'display_phone_number_invalid'
  | 'connected_by_invalid'
  | 'supabase_url_unexpected';

export type BootstrapFailureCode =
  | BootstrapInputErrorCode
  | 'test_company_check_failed'
  | 'test_company_not_found'
  | 'connected_by_check_failed'
  | 'connected_by_not_found'
  | 'owner_lookup_failed'
  | 'phone_number_connected_to_other_company'
  | 'events_table_check_failed'
  | 'graph_token_invalid'
  | 'graph_phone_number_unreadable'
  | 'graph_phone_number_not_found'
  | 'graph_waba_unreadable'
  | 'graph_phone_number_not_in_waba'
  | 'graph_display_mismatch'
  | `persist_${PersistWhatsAppConnectionErrorCode}`
  | 'persist_company_mismatch'
  | 'verify_lookup_failed'
  | 'verify_row_mismatch'
  | 'verify_round_trip_failed'
  | 'unexpected_error';

export type BootstrapStep = 'input' | 'preflight' | 'graph' | 'persist' | 'verify' | 'unexpected';

// Único formato impresso. Booleanos, códigos fixos e números — nada vindo
// cru da Graph ou do Supabase.
export interface BootstrapSummary {
  success: boolean;
  mode: BootstrapMode | null;
  company: 'TEST_COMPANY';
  failedStep: BootstrapStep | null;
  code: BootstrapFailureCode | null;
  alreadyConnected: boolean | null;
  connectionStatus: ConnectionStatus | null;
  graphTokenValid: boolean | null;
  graphWabaAccessible: boolean | null;
  graphPhoneFound: boolean | null;
  graphPhoneMatchesWaba: boolean | null;
  graphDisplayMatches: boolean | null;
  graphHttpStatus: number | null;
  graphCode: number | null;
  roundTripOk: boolean | null;
  keyVersion: number | null;
  // null = desconhecido (erro inesperado): conferir com o SQL do runbook.
  createdOrUpdated: boolean | null;
  durationMs: number | null;
}

export function emptySummary(mode: BootstrapMode | null): BootstrapSummary {
  return {
    success: false,
    mode,
    company: 'TEST_COMPANY',
    failedStep: null,
    code: null,
    alreadyConnected: null,
    connectionStatus: null,
    graphTokenValid: null,
    graphWabaAccessible: null,
    graphPhoneFound: null,
    graphPhoneMatchesWaba: null,
    graphDisplayMatches: null,
    graphHttpStatus: null,
    graphCode: null,
    roundTripOk: null,
    keyVersion: null,
    createdOrUpdated: false,
    durationMs: null,
  };
}

export function inputFailureSummary(code: BootstrapInputErrorCode): BootstrapSummary {
  return { ...emptySummary(null), failedStep: 'input', code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toConnectionStatus(value: unknown): ConnectionStatus | null {
  return (CONNECTION_STATUSES as readonly unknown[]).includes(value) ? (value as ConnectionStatus) : null;
}

// Aceita só a service role DESTE projeto: chave legada (JWT com
// role=service_role e ref de produção — o payload é só decodificado, a
// assinatura quem valida é o Supabase) ou chave nova sb_secret_ (sem ref
// embutido; uma chave de outro projeto falha no primeiro SELECT).
function isProductionServiceRoleKey(value: string): boolean {
  if (SB_SECRET_PATTERN.test(value)) return true;
  const parts = value.split('.');
  if (parts.length !== 3 || !parts.every((part) => JWT_SEGMENT_PATTERN.test(part))) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return isRecord(payload) && payload.role === 'service_role' && payload.ref === PRODUCTION_PROJECT_REF;
  } catch {
    return false;
  }
}

function isExpectedSupabaseUrl(): boolean {
  try {
    const url = new URL(PRODUCTION_SUPABASE_URL);
    return url.protocol === 'https:' && url.host === `${PRODUCTION_PROJECT_REF}.supabase.co` && url.pathname === '/';
  } catch {
    return false;
  }
}

export type ParseBootstrapEnvResult =
  | { ok: true; input: BootstrapInput }
  | { ok: false; code: BootstrapInputErrorCode };

// Validação 100% local, sem rede. Nunca devolve nem ecoa os valores.
export function parseBootstrapEnv(env: BootstrapEnv): ParseBootstrapEnvResult {
  if (env.WA_BOOTSTRAP_CONFIRM !== CONFIRM_PHRASE) return { ok: false, code: 'confirm_invalid' };

  // Ausente/vazio/dry-run → nunca grava; write → grava após TODOS os
  // preflights; qualquer outro valor → aborta.
  const rawMode = env.WA_BOOTSTRAP_MODE;
  let mode: BootstrapMode;
  if (rawMode === undefined || rawMode === '' || rawMode === 'dry-run') mode = 'dry-run';
  else if (rawMode === 'write') mode = 'write';
  else return { ok: false, code: 'mode_invalid' };

  if (!isExpectedSupabaseUrl()) return { ok: false, code: 'supabase_url_unexpected' };

  const rawKey = env.WA_BOOTSTRAP_ENCRYPTION_KEY ?? '';
  if (!KEY_PATTERN.test(rawKey)) return { ok: false, code: 'encryption_key_invalid' };

  const accessToken = env.WA_BOOTSTRAP_ACCESS_TOKEN ?? '';
  if (!ACCESS_TOKEN_PATTERN.test(accessToken)) return { ok: false, code: 'access_token_invalid' };

  const serviceRoleKey = env.WA_BOOTSTRAP_SERVICE_ROLE_KEY ?? '';
  if (!isProductionServiceRoleKey(serviceRoleKey)) return { ok: false, code: 'service_role_key_invalid' };

  const wabaId = env.WA_BOOTSTRAP_WABA_ID ?? '';
  if (!META_ID_PATTERN.test(wabaId)) return { ok: false, code: 'waba_id_invalid' };

  const phoneNumberId = env.WA_BOOTSTRAP_PHONE_NUMBER_ID ?? '';
  if (!META_ID_PATTERN.test(phoneNumberId)) return { ok: false, code: 'phone_number_id_invalid' };
  if (wabaId === phoneNumberId) return { ok: false, code: 'waba_id_equals_phone_number_id' };

  const rawDisplay = (env.WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER ?? '').trim();
  const displayPhoneNumber = rawDisplay === '' ? null : rawDisplay;
  if (displayPhoneNumber !== null && !DISPLAY_PHONE_PATTERN.test(displayPhoneNumber)) {
    return { ok: false, code: 'display_phone_number_invalid' };
  }

  const rawConnectedBy = (env.WA_BOOTSTRAP_CONNECTED_BY ?? '').trim().toLowerCase();
  const connectedBy = rawConnectedBy === '' ? null : rawConnectedBy;
  if (connectedBy !== null && !UUID_PATTERN.test(connectedBy)) return { ok: false, code: 'connected_by_invalid' };

  return {
    ok: true,
    input: {
      mode,
      accessToken,
      serviceRoleKey,
      encryptionKey: Buffer.from(rawKey, 'hex'),
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      connectedBy,
    },
  };
}

// ── portas (injetáveis nos testes) ──────────────────────────────────────

export interface WhatsAppLookupRow {
  connection_id: string;
  company_id: string;
  waba_id: string;
  phone_number_id: string;
  status: string;
  access_token_ciphertext: string;
  token_key_version: number;
}

// Superfície COMPLETA de Supabase do bootstrap. A única escrita é upsert
// (whatsapp_connection_upsert); não existe método que toque o ledger
// whatsapp_webhook_events além da sonda de leitura.
export interface BootstrapSupabasePort extends WhatsAppConnectionRpcPort {
  // null = a consulta falhou (o motivo não é exposto).
  companyExists(companyId: string): Promise<boolean | null>;
  profileExists(profileId: string): Promise<boolean | null>;
  // 'protected' = a tabela existe e o acesso direto é negado (42501), como a
  // migration W2A define. Nenhuma escrita.
  eventsTableProbe(): Promise<'protected' | 'unexpected'>;
  lookupForProcessing(phoneNumberId: string): Promise<{ data: WhatsAppLookupRow[] | null; error: RpcFailure | null }>;
}

export type GraphGetResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; httpStatus: number | null; graphCode: number | null };

export interface BootstrapGraphPort {
  get(path: string, query: Record<string, string>, accessToken: string): Promise<GraphGetResult>;
}

export interface BootstrapDeps {
  supabase: BootstrapSupabasePort;
  graph: BootstrapGraphPort;
  now?: () => Date;
  clock?: () => number;
}

export function createBootstrapSupabasePort(serviceRoleKey: string): BootstrapSupabasePort {
  const admin = createClient<Database>(PRODUCTION_SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const toRpcFailure = (error: { code?: string; message?: string } | null): RpcFailure | null =>
    error ? { code: error.code, message: error.message } : null;
  return {
    async upsert(args) {
      const { data, error } = await admin.rpc('whatsapp_connection_upsert', args);
      return { data: data ?? null, error: toRpcFailure(error) };
    },
    async ownerByPhoneNumber(phoneNumberId) {
      const { data, error } = await admin.rpc('whatsapp_connection_owner_by_phone_number', {
        p_phone_number_id: phoneNumberId,
      });
      return { data: data ?? null, error: toRpcFailure(error) };
    },
    async lookupForProcessing(phoneNumberId) {
      const { data, error } = await admin.rpc('whatsapp_connection_lookup_for_processing', {
        p_phone_number_id: phoneNumberId,
      });
      return { data: data ?? null, error: toRpcFailure(error) };
    },
    async companyExists(companyId) {
      const { data, error } = await admin.from('companies').select('id').eq('id', companyId).maybeSingle();
      if (error) return null;
      return data?.id === companyId;
    },
    async profileExists(profileId) {
      const { data, error } = await admin.from('profiles').select('id').eq('id', profileId).maybeSingle();
      if (error) return null;
      return data?.id === profileId;
    },
    async eventsTableProbe() {
      const { error } = await admin.from('whatsapp_webhook_events').select('id').limit(1);
      return error?.code === '42501' ? 'protected' : 'unexpected';
    },
  };
}

// Token SÓ no header Authorization; redirect: 'error' (um 3xx vira falha, o
// header nunca é reenviado a outro host). Só status + código numérico saem.
export function createBootstrapGraphPort(fetchImpl: typeof fetch = fetch): BootstrapGraphPort {
  return {
    async get(path, query, accessToken) {
      const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
          redirect: 'error',
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        if (!response.ok || !isRecord(body)) {
          const error = isRecord(body) && isRecord(body.error) ? body.error : null;
          const graphCode = error && typeof error.code === 'number' && Number.isInteger(error.code) ? error.code : null;
          return { ok: false, httpStatus: response.status, graphCode };
        }
        return { ok: true, body };
      } catch {
        return { ok: false, httpStatus: null, graphCode: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── fluxo ───────────────────────────────────────────────────────────────

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

// 190 = token inválido/expirado; 401 sem corpo legível também é token.
function isTokenRejection(result: { httpStatus: number | null; graphCode: number | null }): boolean {
  return result.graphCode === 190 || result.httpStatus === 401;
}

export async function runWhatsAppTestConnectionBootstrap(
  input: BootstrapInput,
  deps: BootstrapDeps,
): Promise<BootstrapSummary> {
  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  const summary = emptySummary(input.mode);
  const done = (patch: Partial<BootstrapSummary>): BootstrapSummary => ({
    ...summary,
    ...patch,
    durationMs: Math.max(0, Math.round(clock() - startedAt)),
  });
  const fail = (failedStep: BootstrapStep, code: BootstrapFailureCode): BootstrapSummary =>
    done({ success: false, failedStep, code });

  // 2. preflight Supabase — somente leitura.
  const companyExists = await deps.supabase.companyExists(TEST_COMPANY_ID);
  if (companyExists === null) return fail('preflight', 'test_company_check_failed');
  if (!companyExists) return fail('preflight', 'test_company_not_found');

  if (input.connectedBy !== null) {
    const profileExists = await deps.supabase.profileExists(input.connectedBy);
    if (profileExists === null) return fail('preflight', 'connected_by_check_failed');
    if (!profileExists) return fail('preflight', 'connected_by_not_found');
  }

  const owner = await deps.supabase.ownerByPhoneNumber(input.phoneNumberId);
  if (owner.error || !Array.isArray(owner.data)) return fail('preflight', 'owner_lookup_failed');
  if (owner.data.some((row) => row.company_id !== TEST_COMPANY_ID)) {
    return fail('preflight', 'phone_number_connected_to_other_company');
  }
  summary.alreadyConnected = owner.data.length > 0;
  if (summary.alreadyConnected) summary.connectionStatus = 'connected';

  if ((await deps.supabase.eventsTableProbe()) !== 'protected') return fail('preflight', 'events_table_check_failed');

  // 3. Graph — somente leitura, obrigatória antes de qualquer escrita.
  const phone = await deps.graph.get(input.phoneNumberId, { fields: 'id,display_phone_number' }, input.accessToken);
  if (phone.ok === false) {
    summary.graphHttpStatus = phone.httpStatus;
    summary.graphCode = phone.graphCode;
    if (isTokenRejection(phone)) {
      summary.graphTokenValid = false;
      return fail('graph', 'graph_token_invalid');
    }
    summary.graphPhoneFound = false;
    return fail('graph', 'graph_phone_number_unreadable');
  }
  summary.graphTokenValid = true;
  summary.graphPhoneFound = phone.body.id === input.phoneNumberId;
  if (!summary.graphPhoneFound) return fail('graph', 'graph_phone_number_not_found');

  const waba = await deps.graph.get(`${input.wabaId}/phone_numbers`, { fields: 'id', limit: '100' }, input.accessToken);
  if (waba.ok === false) {
    summary.graphHttpStatus = waba.httpStatus;
    summary.graphCode = waba.graphCode;
    summary.graphWabaAccessible = false;
    return fail('graph', 'graph_waba_unreadable');
  }
  summary.graphWabaAccessible = true;
  const numbers = Array.isArray(waba.body.data) ? waba.body.data : [];
  summary.graphPhoneMatchesWaba = numbers.some((entry) => isRecord(entry) && entry.id === input.phoneNumberId);
  if (!summary.graphPhoneMatchesWaba) return fail('graph', 'graph_phone_number_not_in_waba');

  if (input.displayPhoneNumber !== null) {
    const graphDisplay = phone.body.display_phone_number;
    summary.graphDisplayMatches =
      typeof graphDisplay === 'string' && digitsOnly(graphDisplay) === digitsOnly(input.displayPhoneNumber);
    if (!summary.graphDisplayMatches) return fail('graph', 'graph_display_mismatch');
  }

  if (input.mode === 'dry-run') return done({ success: true, createdOrUpdated: false });

  // 4. ÚNICA escrita funcional. Crypto/AAD são as da W2A
  // (whatsapp-access-token:v1:<company_id>:<phone_number_id>), via
  // persistWhatsAppConnection — a chave da sessão só entra por getKey.
  const persisted = await persistWhatsAppConnection(
    {
      companyId: TEST_COMPANY_ID,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: input.displayPhoneNumber,
      accessToken: input.accessToken,
      connectedBy: input.connectedBy,
      connectedAt: deps.now?.(),
    },
    {
      rpc: () => deps.supabase,
      getKey: (keyVersion) => {
        if (keyVersion !== WHATSAPP_TOKEN_KEY_VERSION) throw new Error('whatsapp_token_key_version_unknown');
        return input.encryptionKey;
      },
    },
  );
  if (persisted.ok === false) return fail('persist', `persist_${persisted.code}`);
  summary.createdOrUpdated = true;
  summary.connectionStatus = toConnectionStatus(persisted.value.status);
  if (persisted.value.companyId !== TEST_COMPANY_ID) return fail('persist', 'persist_company_mismatch');

  // 5. ida e volta — ciphertext e plaintext decifrado nunca saem deste bloco.
  // Falha aqui NÃO dispara segundo upsert nem correção automática.
  const lookup = await deps.supabase.lookupForProcessing(input.phoneNumberId);
  if (lookup.error || !Array.isArray(lookup.data)) return fail('verify', 'verify_lookup_failed');
  const row = lookup.data.length === 1 ? lookup.data[0] : null;
  if (
    !row ||
    row.connection_id !== persisted.value.connectionId ||
    row.company_id !== TEST_COMPANY_ID ||
    row.status !== 'connected' ||
    row.token_key_version !== WHATSAPP_TOKEN_KEY_VERSION
  ) {
    return fail('verify', 'verify_row_mismatch');
  }
  summary.keyVersion = row.token_key_version;

  let roundTripOk = false;
  try {
    if (typeof row.access_token_ciphertext === 'string' && ENVELOPE_V1_PATTERN.test(row.access_token_ciphertext)) {
      const decrypted = decryptWhatsAppAccessToken({
        companyId: TEST_COMPANY_ID,
        phoneNumberId: input.phoneNumberId,
        keyVersion: row.token_key_version,
        ciphertext: row.access_token_ciphertext,
        key: input.encryptionKey,
      });
      roundTripOk = sameSecret(decrypted, input.accessToken);
    }
  } catch {
    roundTripOk = false;
  }
  summary.roundTripOk = roundTripOk;
  if (!roundTripOk) return fail('verify', 'verify_round_trip_failed');

  return done({ success: true });
}

// ── CLI (orquestração testável; a entrada só injeta process/console) ────

export interface BootstrapCliDeps {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  print: (summary: BootstrapSummary) => void;
  createSupabase: (serviceRoleKey: string) => BootstrapSupabasePort;
  createGraph: () => BootstrapGraphPort;
  run?: typeof runWhatsAppTestConnectionBootstrap;
}

// Exit codes: 0 sucesso; 1 falha de preflight/Graph/escrita/verificação ou
// erro inesperado; 2 entrada inválida (nenhuma rede foi tocada).
export async function runBootstrapCli(deps: BootstrapCliDeps): Promise<number> {
  const snapshot: BootstrapEnv = {};
  for (const name of BOOTSTRAP_ENV_NAMES) {
    snapshot[name] = deps.env[name];
    delete deps.env[name];
  }

  let input: BootstrapInput | null = null;
  let reachedNetwork = false;
  try {
    if (deps.argv.length > 2) {
      deps.print(inputFailureSummary('unexpected_arguments'));
      return 2;
    }
    const parsed = parseBootstrapEnv(snapshot);
    if (parsed.ok === false) {
      deps.print(inputFailureSummary(parsed.code));
      return 2;
    }
    input = parsed.input;
    reachedNetwork = true;
    const summary = await (deps.run ?? runWhatsAppTestConnectionBootstrap)(input, {
      supabase: deps.createSupabase(input.serviceRoleKey),
      graph: deps.createGraph(),
    });
    deps.print(summary);
    return summary.success ? 0 : 1;
  } catch {
    // Sem detalhe: o erro pode carregar valores. Escrita incerta em write.
    deps.print({
      ...emptySummary(input?.mode ?? null),
      failedStep: 'unexpected',
      code: 'unexpected_error',
      createdOrUpdated: reachedNetwork && input?.mode === 'write' ? null : false,
    });
    return 1;
  } finally {
    for (const name of BOOTSTRAP_ENV_NAMES) {
      delete snapshot[name];
      delete deps.env[name];
    }
    input?.encryptionKey.fill(0);
    input = null;
  }
}
