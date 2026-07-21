// lib/invites/acceptance-client.ts — camada HTTP client-safe para os
// endpoints públicos de convite (M1-F S4-C2B). Roda inteiramente no
// browser, nunca importa lib/server/*. Nunca confia cegamente em
// response.json(): valida shape/tipo antes de expor qualquer campo ao
// chamador. Nenhuma exceção lançada carrega token/Authorization/body.
export type ValidateInviteResult =
  | { outcome: 'ok'; valid: boolean; code: string; maskedEmail: string | null }
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'error' };

export type InviteRoleKind = 'super_admin' | 'manager' | 'seller';

export type AcceptInviteResult =
  | { outcome: 'ok'; success: boolean; code: string; roleKind: InviteRoleKind | null }
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'error' };

const ROLE_KINDS = new Set<string>(['super_admin', 'manager', 'seller']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Nunca response.json() direto — corpo vazio, HTML de erro de proxy, ou
// JSON malformado nunca lançam, só devolvem null (tratado como forma
// inesperada pelo chamador).
async function readJsonSafely(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRetryAfterSeconds(response: Response): number {
  const raw = response.headers.get('Retry-After');
  const parsed = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60;
}

export async function validateInvite(rawToken: string): Promise<ValidateInviteResult> {
  let response: Response;
  try {
    response = await fetch('/api/invites/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ invite_token: rawToken }),
    });
  } catch {
    return { outcome: 'error' };
  }

  if (response.status === 429) {
    return { outcome: 'rate_limited', retryAfterSeconds: parseRetryAfterSeconds(response) };
  }

  const body = await readJsonSafely(response);
  if (!isPlainObject(body)) {
    return { outcome: 'error' };
  }
  if (typeof body.valid !== 'boolean' || typeof body.code !== 'string') {
    return { outcome: 'error' };
  }
  if (body.masked_email !== null && typeof body.masked_email !== 'string') {
    return { outcome: 'error' };
  }

  return {
    outcome: 'ok',
    valid: body.valid,
    code: body.code,
    maskedEmail: body.valid ? (body.masked_email as string | null) : null,
  };
}

export async function acceptInvite(rawToken: string, accessToken: string): Promise<AcceptInviteResult> {
  let response: Response;
  try {
    response = await fetch('/api/invites/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      body: JSON.stringify({ invite_token: rawToken }),
    });
  } catch {
    return { outcome: 'error' };
  }

  if (response.status === 429) {
    return { outcome: 'rate_limited', retryAfterSeconds: parseRetryAfterSeconds(response) };
  }

  const body = await readJsonSafely(response);
  if (!isPlainObject(body)) {
    return { outcome: 'error' };
  }
  if (typeof body.success !== 'boolean' || typeof body.code !== 'string') {
    return { outcome: 'error' };
  }

  const roleKind = body.role_kind;
  if (roleKind !== null && (typeof roleKind !== 'string' || !ROLE_KINDS.has(roleKind))) {
    return { outcome: 'error' };
  }

  return {
    outcome: 'ok',
    success: body.success,
    code: body.code,
    roleKind: body.success ? (roleKind as InviteRoleKind) : null,
  };
}
