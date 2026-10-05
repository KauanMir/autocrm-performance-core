// lib/server/meta-oauth/connection-persistence.ts — camada server-only que
// persiste a conexão Meta. NÃO é chamada pelo callback nesta etapa (P4A).
//
// Recebe dados JÁ validados pelo fluxo OAuth. O Page Access Token (plaintext)
// é cifrado aqui dentro e só o ciphertext atravessa a fronteira da RPC. Nada
// retorna ciphertext, token, chave ou erro SQL bruto.
//
// A camada depende de uma porta (MetaConnectionRpcPort) para falar com o banco.
// O adaptador Supabase service_role é o único ponto que tocaria o client tipado;
// ele será ligado na P4B, após database.types.ts ser resolvido.
import { isMetaConnectionPersistenceEnabled } from './env';
import { REQUIRED_LEAD_ADS_PERMISSIONS } from './user-permissions';
import { encryptMetaPageToken } from './token-crypto';
import { getMetaTokenKeyForVersion, META_TOKEN_KEY_VERSION } from './token-key';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_ID_PATTERN = /^[0-9]{1,30}$/;
const PAGE_NAME_MAX = 200;
const MAX_ATTEMPTS = 2;

export type MetaPersistenceErrorCode =
  | 'persistence_disabled'
  | 'invalid_persistence_input'
  | 'token_encryption_failed'
  | 'page_already_connected'
  | 'persistence_unavailable'
  | 'connection_persist_failed';

export type MetaPersistenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: MetaPersistenceErrorCode };

export interface RpcFailure {
  code?: string;
  message?: string;
}

export interface UpsertRpcArgs {
  p_company_id: string;
  p_page_id: string;
  p_page_name: string;
  p_access_token_ciphertext: string;
  p_token_key_version: number;
  p_granted_scopes: string[];
  p_connected_at: string;
  p_connected_by: string;
  p_leadgen_subscribed_at: string;
}

export interface UpsertRpcRow {
  id: string;
  company_id: string;
  page_id: string;
  page_name: string | null;
  status: string;
  connected_at: string | null;
  leadgen_subscribed_at: string | null;
}

export interface OwnerRpcRow {
  integration_id: string;
  company_id: string;
  page_id: string;
  status: string;
}

// Porta mínima: o adaptador real (service_role) implementa estes dois métodos.
// Uma exceção lançada = falha de transporte (transitória). Um `error` retornado
// = falha semântica/SQL do banco.
export interface MetaConnectionRpcPort {
  upsert(args: UpsertRpcArgs): Promise<{ data: UpsertRpcRow[] | null; error: RpcFailure | null }>;
  ownerByPage(pageId: string): Promise<{ data: OwnerRpcRow[] | null; error: RpcFailure | null }>;
}

export interface PersistenceDeps {
  rpc: MetaConnectionRpcPort;
  isEnabled?: () => boolean;
}

export interface PersistMetaPageConnectionInput {
  companyId: string;
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  grantedScopes: readonly string[];
  connectedAt: Date;
  connectedBy: string;
  leadgenSubscribedAt: Date;
}

export interface MetaConnectionMetadata {
  id: string;
  companyId: string;
  pageId: string;
  pageName: string | null;
  status: string;
  connectedAt: string | null;
  leadgenSubscribedAt: string | null;
}

export interface MetaConnectionOwner {
  integrationId: string;
  companyId: string;
  pageId: string;
  status: string;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function scopesAreExactlyRequired(scopes: readonly string[]): boolean {
  if (scopes.length !== REQUIRED_LEAD_ADS_PERMISSIONS.length) return false;
  return REQUIRED_LEAD_ADS_PERMISSIONS.every((required) => scopes.includes(required));
}

// Uma exceção lançada pela porta é falha de transporte (transitória). Até
// MAX_ATTEMPTS tentativas; erros semânticos retornados pelo banco nunca são
// repetidos, pois chegam como resposta e não como exceção.
async function callWithOneRetry<T extends { error: RpcFailure | null }>(
  call: () => Promise<T>,
): Promise<{ kind: 'response'; response: T } | { kind: 'transport' }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return { kind: 'response', response: await call() };
    } catch {
      // falha de transporte; retry só se ainda houver tentativa
    }
  }
  return { kind: 'transport' };
}

function mapUpsertRpcError(error: RpcFailure): MetaPersistenceErrorCode {
  if (error.message === 'page_already_connected') return 'page_already_connected';
  if (error.message === 'invalid_input') return 'invalid_persistence_input';
  if (error.code === 'PGRST202') return 'persistence_unavailable';
  return 'connection_persist_failed';
}

function toMetadata(row: UpsertRpcRow): MetaConnectionMetadata {
  return {
    id: row.id,
    companyId: row.company_id,
    pageId: row.page_id,
    pageName: row.page_name,
    status: row.status,
    connectedAt: row.connected_at,
    leadgenSubscribedAt: row.leadgen_subscribed_at,
  };
}

export async function findMetaConnectionOwnerByPage(
  deps: PersistenceDeps,
  pageId: string,
): Promise<MetaPersistenceResult<MetaConnectionOwner | null>> {
  const enabled = deps.isEnabled ?? isMetaConnectionPersistenceEnabled;
  if (!enabled()) return { ok: false, code: 'persistence_disabled' };
  if (typeof pageId !== 'string' || !PAGE_ID_PATTERN.test(pageId)) {
    return { ok: false, code: 'invalid_persistence_input' };
  }

  const outcome = await callWithOneRetry(() => deps.rpc.ownerByPage(pageId));
  if (outcome.kind === 'transport') return { ok: false, code: 'persistence_unavailable' };

  const { data, error } = outcome.response;
  if (error) {
    return { ok: false, code: error.code === 'PGRST202' ? 'persistence_unavailable' : 'connection_persist_failed' };
  }
  const row = data?.[0];
  if (!row) return { ok: true, value: null };
  return {
    ok: true,
    value: { integrationId: row.integration_id, companyId: row.company_id, pageId: row.page_id, status: row.status },
  };
}

export async function persistMetaPageConnection(
  deps: PersistenceDeps,
  input: PersistMetaPageConnectionInput,
): Promise<MetaPersistenceResult<MetaConnectionMetadata>> {
  const enabled = deps.isEnabled ?? isMetaConnectionPersistenceEnabled;
  if (!enabled()) return { ok: false, code: 'persistence_disabled' };

  if (
    typeof input.companyId !== 'string' || !UUID_PATTERN.test(input.companyId) ||
    typeof input.pageId !== 'string' || !PAGE_ID_PATTERN.test(input.pageId) ||
    typeof input.pageName !== 'string' || input.pageName.length === 0 || input.pageName.length > PAGE_NAME_MAX ||
    typeof input.pageAccessToken !== 'string' || input.pageAccessToken.length === 0 ||
    !scopesAreExactlyRequired(input.grantedScopes) ||
    !isValidDate(input.connectedAt) ||
    typeof input.connectedBy !== 'string' || !UUID_PATTERN.test(input.connectedBy) ||
    !isValidDate(input.leadgenSubscribedAt)
  ) {
    return { ok: false, code: 'invalid_persistence_input' };
  }

  let ciphertext: string;
  try {
    ciphertext = encryptMetaPageToken({
      plaintextToken: input.pageAccessToken,
      companyId: input.companyId,
      pageId: input.pageId,
      key: getMetaTokenKeyForVersion(META_TOKEN_KEY_VERSION),
    });
  } catch {
    return { ok: false, code: 'token_encryption_failed' };
  }

  const args: UpsertRpcArgs = {
    p_company_id: input.companyId,
    p_page_id: input.pageId,
    p_page_name: input.pageName,
    p_access_token_ciphertext: ciphertext,
    p_token_key_version: META_TOKEN_KEY_VERSION,
    p_granted_scopes: [...REQUIRED_LEAD_ADS_PERMISSIONS],
    p_connected_at: input.connectedAt.toISOString(),
    p_connected_by: input.connectedBy,
    p_leadgen_subscribed_at: input.leadgenSubscribedAt.toISOString(),
  };

  const outcome = await callWithOneRetry(() => deps.rpc.upsert(args));
  if (outcome.kind === 'transport') return { ok: false, code: 'persistence_unavailable' };

  const { data, error } = outcome.response;
  if (error) return { ok: false, code: mapUpsertRpcError(error) };
  const row = data?.[0];
  if (!row) return { ok: false, code: 'connection_persist_failed' };
  return { ok: true, value: toMetadata(row) };
}
