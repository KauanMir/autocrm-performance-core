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
