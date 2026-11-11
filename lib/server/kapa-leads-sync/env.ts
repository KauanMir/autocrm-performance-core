// lib/server/kapa-leads-sync/env.ts — configuração da sincronização KAPA Leads → CRM. SERVER-ONLY.
// DESLIGADA por padrão. Nunca prefixar NEXT_PUBLIC_; erros e logs só com o NOME do problema.
//
//   KAPA_LEADS_SYNC_ENABLED   "true" liga o worker (qualquer outro valor = desligado)
//   KAPA_LEADS_API_URL        origem do KAPA Leads (https; http só em loopback fora da Vercel)
//   KAPA_LEADS_SYNC_SECRET    segredo HMAC compartilhado (mín. 32 caracteres)
//
// Desligar a flag não perde nada: o cursor fica parado e os leads continuam no KAPA Leads.

export const MIN_SECRET_LENGTH = 32;

export type KapaLeadsSyncConfig = { baseUrl: string; secret: string };

export type KapaLeadsSyncConfigResult =
  | { ok: true; config: KapaLeadsSyncConfig }
  | { ok: false; reason: 'disabled' | 'api_url_missing' | 'api_url_invalid' | 'secret_missing' | 'secret_too_short' };

export function isKapaLeadsSyncEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.KAPA_LEADS_SYNC_ENABLED === 'true';
}

function normalizeBaseUrl(raw: string, env: Record<string, string | undefined>): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol === 'https:') return url.origin;
  // http só para o teste local ponta a ponta, nunca num deploy da Vercel.
  if (url.protocol === 'http:' && loopback && !env.VERCEL_ENV) return url.origin;
  return null;
}

export function readKapaLeadsSyncConfig(env: Record<string, string | undefined> = process.env): KapaLeadsSyncConfigResult {
  if (!isKapaLeadsSyncEnabled(env)) return { ok: false, reason: 'disabled' };
  const rawUrl = env.KAPA_LEADS_API_URL?.trim() ?? '';
  if (!rawUrl) return { ok: false, reason: 'api_url_missing' };
  const baseUrl = normalizeBaseUrl(rawUrl, env);
  if (!baseUrl) return { ok: false, reason: 'api_url_invalid' };
  const secret = env.KAPA_LEADS_SYNC_SECRET?.trim() ?? '';
  if (!secret) return { ok: false, reason: 'secret_missing' };
  if (secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'secret_too_short' };
  return { ok: true, config: { baseUrl, secret } };
}
