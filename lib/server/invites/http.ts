// lib/server/invites/http.ts — proteção HTTP comum aos dois Route
// Handlers de convites (M1-F S4-A2B, design §13/§14). Nenhuma função aqui
// confia em dado vindo do frontend além do que é explicitamente validado:
// Authorization é sempre revalidado via auth.getUser(jwt); Origin, quando
// presente, precisa bater exatamente com APP_URL.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createUserScopedClient } from '@/lib/server/supabase/user-token-client';
import type { InviteErrorCode } from '@/lib/server/invites/errors';
import { statusForCode } from '@/lib/server/invites/errors';

export const MAX_BODY_BYTES = 16 * 1024;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type BodyValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'body_too_large' | 'invalid_body' };

// Lê o corpo como texto, mede o tamanho em bytes (nunca em caracteres —
// UTF-8 multibyte pode divergir), valida JSON de objeto simples (nunca
// array), rejeita chaves de prototype pollution e qualquer chave fora de
// `allowedKeys`. Corpo vazio é tratado como `{}` (usado pelo resend, cujo
// body é sempre vazio/objeto vazio).
export async function readJsonObjectBody(
  request: Request,
  allowedKeys: readonly string[],
): Promise<BodyValidationResult<Record<string, unknown>>> {
  const text = await request.text();
  const byteLength = Buffer.byteLength(text, 'utf8');

  if (byteLength > MAX_BODY_BYTES) {
    return { ok: false, error: 'body_too_large' };
  }

  const trimmed = text.trim();
  const source = trimmed === '' ? '{}' : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, error: 'invalid_body' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid_body' };
  }

  const keys = Object.keys(parsed as Record<string, unknown>);
  const allowedSet = new Set(allowedKeys);

  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key) || !allowedSet.has(key)) {
      return { ok: false, error: 'invalid_body' };
    }
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}

// Origin ausente é aceito (clientes não-browser/testes); Origin presente
// precisa bater exatamente com a origem de APP_URL — nunca refletido,
// nunca CORS amplo.
export function isOriginAllowed(request: Request, appUrl: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) {
    return true;
  }
  return origin === appUrl.origin;
}

export interface AuthenticatedActor {
  profileId: string;
}

export type ActorValidationResult =
  | { ok: true; actor: AuthenticatedActor; client: SupabaseClient<Database>; jwt: string }
  | { ok: false };

const BEARER_PATTERN = /^Bearer (.+)$/;

// Exige `Authorization: Bearer <jwt>`, revalida via auth.getUser(jwt) —
// nunca decodifica o JWT localmente. O client retornado já carrega o
// mesmo Bearer no header Authorization, reutilizável por chamadas .from()
// que precisam respeitar a RLS como este usuário específico (ex.: resend).
export async function requireAuthenticatedActor(request: Request): Promise<ActorValidationResult> {
  const header = request.headers.get('authorization');
  if (!header) {
    return { ok: false };
  }

  const match = BEARER_PATTERN.exec(header);
  if (!match) {
    return { ok: false };
  }

  const jwt = match[1].trim();
  if (!jwt) {
    return { ok: false };
  }

  const client = createUserScopedClient(jwt);
  const { data, error } = await client.auth.getUser(jwt);

  if (error || !data?.user) {
    return { ok: false };
  }

  return { ok: true, actor: { profileId: data.user.id }, client, jwt };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(
  code: InviteErrorCode,
  opts?: { retryAfterSeconds?: number },
): Response {
  const headers: Record<string, string> = {};
  if (opts?.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(opts.retryAfterSeconds);
  }
  return jsonResponse(statusForCode(code), { success: false, code }, headers);
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
