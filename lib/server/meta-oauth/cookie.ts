// lib/server/meta-oauth/cookie.ts — cookie anti-CSRF ("binding") do fluxo
// OAuth Meta. Funções PURAS de string: serializar o Set-Cookie, ler o
// valor do header Cookie, e montar o Set-Cookie de limpeza. Sem
// next/headers (o projeto não usa) — o Route Handler anexa/lê no Response/
// Request diretamente.
//
// O valor do cookie é o binding BRUTO (aleatório). Só o sha256 dele entra
// no `state` assinado. O cookie é HttpOnly (invisível ao JavaScript).
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const BINDING_COOKIE_NAME = 'kapa_meta_oauth_binding';

// Escopo mínimo: só as rotas do fluxo OAuth Meta (/start e /callback).
export const BINDING_COOKIE_PATH = '/api/integrations/meta/oauth';

// Alinhado ao TTL do state (10 min).
export const BINDING_COOKIE_MAX_AGE_SECONDS = 600;

// 32 bytes -> 43 chars base64url. Imprevisível (CSPRNG).
export function generateBinding(): string {
  return randomBytes(32).toString('base64url');
}

export interface SerializeBindingCookieOptions {
  value: string;
  // Secure em produção (HTTPS). O Route Handler decide (NODE_ENV).
  secure: boolean;
  maxAgeSeconds?: number;
}

export function serializeBindingCookie(opts: SerializeBindingCookieOptions): string {
  const parts = [
    `${BINDING_COOKIE_NAME}=${opts.value}`,
    `Path=${BINDING_COOKIE_PATH}`,
    `Max-Age=${opts.maxAgeSeconds ?? BINDING_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

// Set-Cookie que apaga o cookie (Max-Age=0), com os mesmos atributos de
// escopo — necessário para o browser aceitar a remoção.
export function clearBindingCookie(secure: boolean): string {
  const parts = [
    `${BINDING_COOKIE_NAME}=`,
    `Path=${BINDING_COOKIE_PATH}`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

// Extrai o valor do binding do header `Cookie` bruto. Tolerante a espaços
// e a outros cookies presentes. Devolve null se ausente/vazio.
export function readBindingCookie(cookieHeader: string | null): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader === '') return null;
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (name !== BINDING_COOKIE_NAME) continue;
    const value = pair.slice(eq + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

// Comparação em tempo constante de dois bindings (defesa em profundidade —
// o caminho principal de comparação já é o sha256 timing-safe dentro de
// verifyOAuthState; esta função existe para checagens auxiliares).
export function bindingsEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
