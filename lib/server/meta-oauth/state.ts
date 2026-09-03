// lib/server/meta-oauth/state.ts — parâmetro OAuth `state` do "Login do
// Facebook para Empresas", 100% stateless e assinado.
//
// FORMATO:  <base64url(payloadJSON)>.<base64url(HMAC_SHA256(secret, body))>
//
// payload = { v, p, n, iat, exp, b? }
//   v   versão do formato (1)
//   p   propósito fixo ("meta_oauth") — coerência de contexto
//   n   nonce aleatório (18 bytes) — imprevisibilidade / anti-replay futuro
//   iat epoch (segundos) de emissão
//   exp epoch (segundos) de expiração — validade curta (default 10 min)
//   b   OPCIONAL: sha256 hex de um "binding" (ex.: nonce de cookie
//       HttpOnly setado no futuro endpoint de "start OAuth", double-submit
//       anti-CSRF). Nesta fase não é emitido nem exigido; o gancho já
//       existe para a próxima fase.
//
// Propriedades de segurança:
//   - imprevisível: nonce de CSPRNG (randomBytes);
//   - não manipulável pelo cliente: qualquer alteração no corpo quebra o
//     HMAC (comparado em tempo constante);
//   - validade curta: exp obrigatório, com teto rígido;
//   - sem segredo exposto: o corpo carrega só metadados não sensíveis;
//   - anti-CSRF: state forjado não tem assinatura válida -> rejeitado.
//
// Este módulo é PURO: sem I/O, sem banco, sem rede.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_VERSION = 1;
const PURPOSE = 'meta_oauth';
const NONCE_BYTES = 18;

export const DEFAULT_TTL_SECONDS = 600; // 10 min
export const MAX_TTL_SECONDS = 900; // teto rígido: 15 min
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_RAW_STATE_LENGTH = 4096;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface OAuthStatePayload {
  v: number;
  p: string;
  n: string;
  iat: number;
  exp: number;
  b?: string;
}

// ── helpers ───────────────────────────────────────────────────────────
function sign(body: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function encodePayload(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

// Comparação de strings em tempo constante (evita distinguir "assinatura
// quase certa" por timing). Diferença de comprimento -> compara consigo
// mesmo por custo ~constante e devolve false.
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function clampTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(ttlSeconds), MAX_TTL_SECONDS);
}

// ── criação ───────────────────────────────────────────────────────────
export interface CreateOAuthStateOptions {
  secret: Buffer;
  // epoch em MILISSEGUNDOS (default Date.now()). Parametrizável p/ teste.
  nowMs?: number;
  ttlSeconds?: number;
  // Futuro (fase "start OAuth"): valor bruto do cookie anti-CSRF. Guardado
  // como sha256 hex, nunca em claro.
  binding?: string;
}

export function createOAuthState(opts: CreateOAuthStateOptions): string {
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const ttl = clampTtl(opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);

  const payload: OAuthStatePayload = {
    v: STATE_VERSION,
    p: PURPOSE,
    n: randomBytes(NONCE_BYTES).toString('base64url'),
    iat: nowSec,
    exp: nowSec + ttl,
  };
  if (opts.binding) {
    payload.b = sha256Hex(opts.binding);
  }

  const body = encodePayload(payload);
  return `${body}.${sign(body, opts.secret)}`;
}

// ── verificação ───────────────────────────────────────────────────────
export type VerifyOAuthStateResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'context_mismatch' };

export interface VerifyOAuthStateOptions {
  secret: Buffer;
  nowMs?: number;
  // Futuro: valor bruto do cookie anti-CSRF a conferir contra payload.b.
  expectedBinding?: string;
}

export function verifyOAuthState(raw: unknown, opts: VerifyOAuthStateOptions): VerifyOAuthStateResult {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > MAX_RAW_STATE_LENGTH) {
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

  // Assinatura ANTES de tocar no conteúdo — nunca confia no corpo sem
  // provar a origem primeiro.
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

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const payload = parsed as Record<string, unknown>;
  if (
    payload.v !== STATE_VERSION ||
    typeof payload.n !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    (payload.b !== undefined && typeof payload.b !== 'string')
  ) {
    return { ok: false, reason: 'malformed' };
  }

  // Coerência de contexto: propósito tem que ser exatamente o desta fase.
  if (payload.p !== PURPOSE) {
    return { ok: false, reason: 'context_mismatch' };
  }

  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);

  // TTL declarado dentro do teto rígido (impede um corpo forjado — que
  // aqui já teria assinatura válida, mas defesa em profundidade — de
  // pedir validade longa).
  if (payload.exp - payload.iat <= 0 || payload.exp - payload.iat > MAX_TTL_SECONDS) {
    return { ok: false, reason: 'malformed' };
  }
  // iat absurdamente no futuro -> relógio/forja.
  if (payload.iat - nowSec > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'malformed' };
  }
  if (nowSec >= payload.exp) {
    return { ok: false, reason: 'expired' };
  }

  // Binding anti-CSRF (fase futura): se qualquer lado exigir, os dois têm
  // que existir e bater.
  const hasBinding = typeof payload.b === 'string';
  const expectsBinding = typeof opts.expectedBinding === 'string' && opts.expectedBinding !== '';
  if (hasBinding || expectsBinding) {
    if (
      !hasBinding ||
      !expectsBinding ||
      !timingSafeStringEqual(payload.b as string, sha256Hex(opts.expectedBinding as string))
    ) {
      return { ok: false, reason: 'context_mismatch' };
    }
  }

  return {
    ok: true,
    payload: {
      v: payload.v as number,
      p: payload.p as string,
      n: payload.n as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      ...(hasBinding ? { b: payload.b as string } : {}),
    },
  };
}
