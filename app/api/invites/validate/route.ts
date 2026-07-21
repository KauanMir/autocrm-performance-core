// app/api/invites/validate/route.ts — Route Handler PÚBLICO de validação
// de convite (M1-F S4-C2A, freeze S4-C2 E0). Nunca autentica, nunca
// consome o token Auth, nunca aceita o convite — só confirma se o token
// próprio (hash) ainda é utilizável. Fica fora de /api/platform/invites
// de propósito: o chamador aqui nunca tem capacidade administrativa.
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { isOriginAllowed, readJsonObjectBody, jsonResponse } from '@/lib/server/invites/http';
import {
  getAppUrl,
  getInviteRateLimitPepper,
  InvalidAppUrlError,
  InvalidInviteRateLimitPepperError,
} from '@/lib/server/env';
import { isValidRawInviteToken, hashInviteToken } from '@/lib/server/invites/token';
import { getClientIp, hashIp, UntrustedIpSourceError } from '@/lib/server/invites/ip';
import { validateInvite } from '@/lib/server/invites/activation';
import { logInviteEvent, logInviteError } from '@/lib/server/invites/logger';

export const runtime = 'nodejs';

const ALLOWED_BODY_KEYS = ['invite_token'] as const;

interface ValidateResponseBody {
  valid: boolean;
  code: string;
  masked_email: string | null;
}

function closedResponse(status: number, body: ValidateResponseBody, headers?: Record<string, string>): Response {
  return jsonResponse(status, body, headers);
}

function isJsonContentType(request: Request): boolean {
  const value = request.headers.get('content-type');
  return typeof value === 'string' && value.toLowerCase().startsWith('application/json');
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  let appUrl: URL;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    if (error instanceof InvalidAppUrlError) {
      logInviteError('app_url_invalid', { requestId });
      return closedResponse(500, { valid: false, code: 'internal_error', masked_email: null });
    }
    throw error;
  }

  if (!isOriginAllowed(request, appUrl)) {
    return closedResponse(403, { valid: false, code: 'invalid_origin', masked_email: null });
  }

  if (!isJsonContentType(request)) {
    return closedResponse(400, { valid: false, code: 'invalid_body', masked_email: null });
  }

  const bodyResult = await readJsonObjectBody(request, ALLOWED_BODY_KEYS);
  if (bodyResult.ok === false) {
    return closedResponse(bodyResult.error === 'body_too_large' ? 413 : 400, {
      valid: false,
      code: bodyResult.error,
      masked_email: null,
    });
  }

  const rawToken = bodyResult.value.invite_token;
  if (typeof rawToken !== 'string' || !isValidRawInviteToken(rawToken)) {
    return closedResponse(400, { valid: false, code: 'invalid_body', masked_email: null });
  }

  let ip: string;
  try {
    ip = getClientIp(request);
  } catch (error) {
    if (error instanceof UntrustedIpSourceError) {
      logInviteError('ip_source_untrusted', { requestId });
      return closedResponse(503, { valid: false, code: 'internal_error', masked_email: null });
    }
    throw error;
  }

  let pepper: Buffer;
  try {
    pepper = getInviteRateLimitPepper();
  } catch (error) {
    if (error instanceof InvalidInviteRateLimitPepperError) {
      logInviteError('invite_rate_limit_pepper_invalid', { requestId });
      return closedResponse(500, { valid: false, code: 'internal_error', masked_email: null });
    }
    throw error;
  }

  const ipHash = hashIp(ip, pepper);
  const tokenHash = hashInviteToken(rawToken);

  const admin = createAdminClient();
  const result = await validateInvite({ admin, ipHash, tokenHash });

  if (result.outcome === 'error') {
    logInviteError('validate_invite_unexpected', { requestId });
    return closedResponse(503, { valid: false, code: 'internal_error', masked_email: null });
  }

  if (result.outcome === 'rate_limited') {
    logInviteEvent({ requestId, operation: 'validate', result: 'rate_limited' });
    return closedResponse(
      429,
      { valid: false, code: 'rate_limited', masked_email: null },
      { 'Retry-After': String(result.retryAfterSeconds) },
    );
  }

  logInviteEvent({
    requestId,
    operation: 'validate',
    result: result.valid ? 'valid' : 'invalid',
    code: result.code,
  });

  return closedResponse(200, {
    valid: result.valid,
    code: result.code,
    masked_email: result.maskedEmail,
  });
}
