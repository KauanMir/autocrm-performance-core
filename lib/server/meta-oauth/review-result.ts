// lib/server/meta-oauth/review-result.ts — token EFÊMERO e assinado por
// HMAC que prova, por um intervalo curto, que o callback do fluxo
// "review_ui" (App Review) chegou a `test_page_permissions_verified` para a
// company de teste. Existe só para permitir que a tela de Integrações
// mostre "Autorização Meta validada" logo após o redirect do OAuth, SEM
// nenhuma persistência (nenhuma migration/tabela/coluna) — ao expirar (ou
// ao recarregar a página depois do TTL), a tela volta a "Conectar Meta".
//
// Mesmo formato/estilo de lib/server/meta-oauth/state.ts:
//   <base64url(payloadJSON)>.<base64url(HMAC_SHA256(secret, body))>
// payload = { v, p, n, iat, exp, cid, stage } — nenhum token/segredo/PII.
// Módulo PURO: sem I/O, sem banco, sem rede.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 1;
const PURPOSE = 'meta_oauth_review_result';
const NONCE_BYTES = 12;

// Curto de propósito: só precisa sobreviver ao redirect + primeiro render
// da tela de Integrações — nunca um mecanismo de persistência.
export const REVIEW_RESULT_TTL_SECONDS = 180; // 3 min

// Único valor aceito nesta etapa — catálogo fechado, não uma string livre.
export const REVIEW_RESULT_STAGE_VERIFIED = 'test_page_permissions_verified' as const;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_RAW_TOKEN_LENGTH = 2048;

// Catálogo fechado de falhas de persistência exibíveis na review UI. Nunca
// mensagem SQL, Graph, ciphertext, token, chave ou stack.
export const REVIEW_RESULT_FAILURE_CODES = [
  'page_already_connected',
  'persistence_unavailable',
  'connection_persist_failed',
  'token_encryption_failed',
  'invalid_persistence_input',
] as const;

export type ReviewResultFailureCode = (typeof REVIEW_RESULT_FAILURE_CODES)[number];
export type ReviewResultOutcome = 'success' | 'failure';

export interface MetaOAuthReviewResultPayload {
  v: number;
  p: string;
  n: string;
  iat: number;
  exp: number;
  cid: string;
  stage: typeof REVIEW_RESULT_STAGE_VERIFIED;
  outcome: ReviewResultOutcome;
  persisted: boolean;
  failureCode: ReviewResultFailureCode | null;
}

function sign(body: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export interface CreateReviewResultTokenOptions {
  secret: Buffer;
  companyId: string;
  nowMs?: number;
  outcome?: ReviewResultOutcome;
  persisted?: boolean;
  failureCode?: ReviewResultFailureCode | null;
}

export function createReviewResultToken(opts: CreateReviewResultTokenOptions): string {
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const outcome: ReviewResultOutcome = opts.outcome ?? 'success';
  const failureCode = outcome === 'failure' ? (opts.failureCode ?? 'connection_persist_failed') : null;
  const payload: MetaOAuthReviewResultPayload = {
    v: VERSION,
    p: PURPOSE,
    n: randomBytes(NONCE_BYTES).toString('base64url'),
    iat: nowSec,
    exp: nowSec + REVIEW_RESULT_TTL_SECONDS,
    cid: opts.companyId,
    stage: REVIEW_RESULT_STAGE_VERIFIED,
    outcome,
    persisted: outcome === 'success' && opts.persisted === true,
    failureCode,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, opts.secret)}`;
}

export type VerifyReviewResultTokenResult =
  | { ok: true; payload: MetaOAuthReviewResultPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'context_mismatch' };

export interface VerifyReviewResultTokenOptions {
  secret: Buffer;
  expectedCompanyId: string;
  nowMs?: number;
}

export function verifyReviewResultToken(
  raw: unknown,
  opts: VerifyReviewResultTokenOptions,
): VerifyReviewResultTokenResult {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > MAX_RAW_TOKEN_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }

  const dot = raw.indexOf('.');
  if (dot <= 0 || dot !== raw.lastIndexOf('.')) {
    return { ok: false, reason: 'malformed' };
  }

  const body = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);
  if (!BASE64URL.test(body) || !BASE64URL.test(providedSig)) {
    return { ok: false, reason: 'malformed' };
  }

  const expectedSig = sign(body, opts.secret);
  if (!timingSafeStringEqual(providedSig, expectedSig)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'malformed' };
  }

  const payload = parsed as Record<string, unknown>;
  if (
    payload.v !== VERSION ||
    payload.p !== PURPOSE ||
    typeof payload.n !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    typeof payload.cid !== 'string' ||
    !UUID_PATTERN.test(payload.cid) ||
    payload.stage !== REVIEW_RESULT_STAGE_VERIFIED ||
    !isOutcomeShapeValid(payload)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp - payload.iat <= 0 || payload.exp - payload.iat > REVIEW_RESULT_TTL_SECONDS) {
    return { ok: false, reason: 'malformed' };
  }

  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (nowSec >= (payload.exp as number)) {
    return { ok: false, reason: 'expired' };
  }

  if (payload.cid !== opts.expectedCompanyId) {
    return { ok: false, reason: 'context_mismatch' };
  }

  return {
    ok: true,
    payload: {
      v: payload.v as number,
      p: payload.p as string,
      n: payload.n as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      cid: payload.cid as string,
      stage: payload.stage as typeof REVIEW_RESULT_STAGE_VERIFIED,
      outcome: payload.outcome as ReviewResultOutcome,
      persisted: payload.persisted as boolean,
      failureCode: payload.failureCode as ReviewResultFailureCode | null,
    },
  };
}

function isOutcomeShapeValid(payload: Record<string, unknown>): boolean {
  if (payload.outcome === 'success') {
    return typeof payload.persisted === 'boolean' && payload.failureCode === null;
  }
  if (payload.outcome === 'failure') {
    return (
      payload.persisted === false &&
      typeof payload.failureCode === 'string' &&
      (REVIEW_RESULT_FAILURE_CODES as readonly string[]).includes(payload.failureCode)
    );
  }
  return false;
}
