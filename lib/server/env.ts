// lib/server/env.ts — leitura/validação de variáveis server-only (M1-F
// S4-A2B). Nunca importado por código client-side; nunca expõe valores em
// erro/log (só o nome da variável ausente/inválida).

export class InvalidAppUrlError extends Error {
  constructor() {
    super('app_url_invalid');
    this.name = 'InvalidAppUrlError';
  }
}

// APP_URL: origem confiável controlada pelo deploy — nunca derivada de
// Host/Origin recebido na requisição. Precisa ser http/https absoluta, sem
// credenciais embutidas, sem path/query/hash (§7). Normalizada sem barra
// final via `new URL(origin)`.
export function getAppUrl(): URL {
  const raw = process.env.APP_URL;
  if (!raw) {
    throw new InvalidAppUrlError();
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidAppUrlError();
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidAppUrlError();
  }
  if (parsed.username || parsed.password) {
    throw new InvalidAppUrlError();
  }
  if (parsed.search || parsed.hash) {
    throw new InvalidAppUrlError();
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new InvalidAppUrlError();
  }

  return new URL(parsed.origin);
}

export class InvalidInviteRateLimitPepperError extends Error {
  constructor() {
    super('invite_rate_limit_pepper_invalid');
    this.name = 'InvalidInviteRateLimitPepperError';
  }
}

const PEPPER_PATTERN = /^[0-9a-f]{64}$/;

// INVITE_RATE_LIMIT_PEPPER: chave HMAC server-only para hash de IP (M1-F
// S4-C2A) — nunca a service_role key, a anon key, APP_URL ou o token do
// convite (nenhuma delas tem o formato/propósito de uma chave HMAC
// dedicada). Exatamente 32 bytes hex minúsculos (64 caracteres). Mensagem
// de erro contém só o nome da variável, nunca o valor recebido.
export function getInviteRateLimitPepper(): Buffer {
  const raw = process.env.INVITE_RATE_LIMIT_PEPPER;
  if (!raw || !PEPPER_PATTERN.test(raw)) {
    throw new InvalidInviteRateLimitPepperError();
  }
  return Buffer.from(raw, 'hex');
}
