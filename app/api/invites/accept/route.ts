// app/api/invites/accept/route.ts — Route Handler AUTENTICADO de aceite
// de convite (M1-F S4-C2A, freeze S4-C2 E0). O ator pode ser um usuário
// Auth recém-criado, ainda sem public.profiles — accept_invite() no banco
// decide tudo isso via auth.uid(), nunca um parâmetro vindo daqui. Sempre
// chama a RPC com o cliente escopado pelo JWT do próprio chamador, nunca
// com o cliente admin/service_role (que não tem EXECUTE concedido nela).
import { randomUUID } from 'node:crypto';
import { isOriginAllowed, readJsonObjectBody, jsonResponse } from '@/lib/server/invites/http';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import { isValidRawInviteToken, hashInviteToken } from '@/lib/server/invites/token';
import { requireAuthenticatedUser, acceptInvite } from '@/lib/server/invites/activation';
import { logInviteEvent, logInviteError } from '@/lib/server/invites/logger';
import type { Database } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

const ALLOWED_BODY_KEYS = ['invite_token'] as const;

type RoleKind = Database['public']['Enums']['invite_role_kind'];

interface AcceptResponseBody {
  success: boolean;
  code: string;
  role_kind: RoleKind | null;
}

function closedResponse(status: number, body: AcceptResponseBody, headers?: Record<string, string>): Response {
  return jsonResponse(status, body, headers);
}

function isJsonContentType(request: Request): boolean {
  const value = request.headers.get('content-type');
  return typeof value === 'string' && value.toLowerCase().startsWith('application/json');
}

// Mapeamento fechado código de domínio → status HTTP (§9). Qualquer código
// fora deste catálogo (ou ausência de correspondência) cai no default
// seguro 503 — nunca propaga o texto/SQLSTATE bruto da RPC.
const CODE_STATUS: Readonly<Record<string, number>> = {
  invalid_token_hash: 400,
  forbidden: 401,
  invite_not_found: 404,
  invite_expired: 409,
  invite_already_used: 409,
  invite_not_actionable: 409,
  email_mismatch: 403,
  identity_conflict: 409,
  company_not_operational: 409,
  already_member: 409,
  membership_conflict: 409,
  invalid_relationship: 409,
  provisioning_failed: 503,
  rate_limited: 429,
};

const DEFAULT_ERROR_STATUS = 503;

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  let appUrl: URL;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    if (error instanceof InvalidAppUrlError) {
      logInviteError('app_url_invalid', { requestId });
      return closedResponse(503, { success: false, code: 'internal_error', role_kind: null });
    }
    throw error;
  }

  if (!isOriginAllowed(request, appUrl)) {
    return closedResponse(403, { success: false, code: 'invalid_origin', role_kind: null });
  }

  if (!isJsonContentType(request)) {
    return closedResponse(400, { success: false, code: 'invalid_body', role_kind: null });
  }

  const bodyResult = await readJsonObjectBody(request, ALLOWED_BODY_KEYS);
  if (bodyResult.ok === false) {
    return closedResponse(bodyResult.error === 'body_too_large' ? 413 : 400, {
      success: false,
      code: bodyResult.error,
      role_kind: null,
    });
  }

  const rawToken = bodyResult.value.invite_token;
  if (typeof rawToken !== 'string' || !isValidRawInviteToken(rawToken)) {
    return closedResponse(400, { success: false, code: 'invalid_body', role_kind: null });
  }

  const authResult = await requireAuthenticatedUser(request);
  if (authResult.ok === false) {
    return closedResponse(401, { success: false, code: 'unauthenticated', role_kind: null });
  }
  const { client: userClient } = authResult;

  const tokenHash = hashInviteToken(rawToken);

  const result = await acceptInvite({ userClient, tokenHash });

  if (result.outcome === 'error') {
    logInviteError('accept_invite_unexpected', { requestId });
    return closedResponse(503, { success: false, code: 'internal_error', role_kind: null });
  }

  logInviteEvent({
    requestId,
    operation: 'accept',
    result: result.success ? 'accepted' : 'rejected',
    code: result.code,
  });

  if (result.code === 'rate_limited') {
    return closedResponse(
      429,
      { success: false, code: 'rate_limited', role_kind: null },
      { 'Retry-After': String(result.retryAfterSeconds ?? 60) },
    );
  }

  if (result.success) {
    return closedResponse(200, { success: true, code: result.code, role_kind: result.roleKind });
  }

  const status = CODE_STATUS[result.code] ?? DEFAULT_ERROR_STATUS;
  return closedResponse(status, { success: false, code: result.code, role_kind: null });
}
