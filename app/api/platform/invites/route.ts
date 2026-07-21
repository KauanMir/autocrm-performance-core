// app/api/platform/invites/route.ts — Route Handler de criação de
// convites (M1-F S4-A2B, design §15/§16). Cria a conta Auth do convidado
// (via Supabase Auth nativo) só no ENVIO, nunca no aceite — decisão
// congelada desde o E0 do S4. Nenhum aceite, profile ou membership é
// criado aqui.
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createAnonServerClient } from '@/lib/server/supabase/user-token-client';
import { requireAuthenticatedActor, readJsonObjectBody, isOriginAllowed, errorResponse, jsonResponse, isValidUuid } from '@/lib/server/invites/http';
import { generateInviteToken, buildInviteRedirectUrl } from '@/lib/server/invites/token';
import { sendInviteEmail, type DeliveryErrorCode } from '@/lib/server/invites/auth-email';
import { finalizeCreateDelivery } from '@/lib/server/invites/delivery';
import { isKnownDomainCode } from '@/lib/server/invites/errors';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import { logInviteEvent, logInviteError } from '@/lib/server/invites/logger';

const ALLOWED_BODY_KEYS = ['company_id', 'email', 'name', 'role_kind'] as const;
const ROLE_KINDS = new Set(['super_admin', 'manager', 'seller']);
const MAX_TOKEN_ATTEMPTS = 3;

interface CreateInviteBody {
  company_id: string | null;
  email: string;
  name: string;
  role_kind: 'super_admin' | 'manager' | 'seller';
}

function validateCreateBody(value: Record<string, unknown>): CreateInviteBody | null {
  for (const key of ALLOWED_BODY_KEYS) {
    if (!(key in value)) {
      return null;
    }
  }

  const { company_id, email, name, role_kind } = value;

  if (company_id !== null && (typeof company_id !== 'string' || !isValidUuid(company_id))) {
    return null;
  }
  if (typeof email !== 'string' || email.trim() === '') {
    return null;
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return null;
  }
  if (typeof role_kind !== 'string' || !ROLE_KINDS.has(role_kind)) {
    return null;
  }

  return {
    company_id: company_id as string | null,
    email,
    name,
    role_kind: role_kind as CreateInviteBody['role_kind'],
  };
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let appUrl: URL;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    if (error instanceof InvalidAppUrlError) {
      logInviteError('app_url_invalid', { requestId });
      return errorResponse('internal_error');
    }
    throw error;
  }

  if (!isOriginAllowed(request, appUrl)) {
    return errorResponse('invalid_origin');
  }

  const bodyResult = await readJsonObjectBody(request, ALLOWED_BODY_KEYS);
  if (bodyResult.ok === false) {
    return errorResponse(bodyResult.error);
  }

  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    return errorResponse('unauthenticated');
  }
  const { actor } = actorResult;

  const body = validateCreateBody(bodyResult.value);
  if (!body) {
    return errorResponse('invalid_body');
  }

  const admin = createAdminClient();
  const anon = createAnonServerClient();

  // reserve_create_invite_rate_limit() revalida autorização e elegibilidade
  // INTEIRAMENTE (mesma lógica de create_invite(), defesa em profundidade —
  // M1-F S4-A2B.1) ANTES de reservar o rate limit — nunca a função
  // genérica reserve_invite_rate_limit(), que não valida autorização e
  // permitia um ator sem capacidade nenhuma consumir a quota antes de
  // create_invite() rejeitar (vulnerabilidade real corrigida nesta etapa).
  const { data: rlData, error: rlError } = await admin.rpc('reserve_create_invite_rate_limit', {
    p_actor_profile_id: actor.profileId,
    p_company_id: body.company_id,
    p_email: body.email,
    p_role_kind: body.role_kind,
  });

  if (rlError) {
    return errorResponse('forbidden');
  }

  const rl = rlData?.[0];
  if (!rl) {
    logInviteError('reserve_create_invite_rate_limit_empty_response', { requestId });
    return errorResponse('internal_error');
  }

  if (!rl.allowed) {
    if (rl.code === 'actor_rate_limited' || rl.code === 'email_scope_rate_limited') {
      return errorResponse('rate_limited', { retryAfterSeconds: rl.retry_after_seconds ?? 60 });
    }
    if (isKnownDomainCode(rl.code)) {
      return errorResponse(rl.code);
    }
    logInviteError('reserve_create_invite_rate_limit_unknown_code', { requestId, code: rl.code });
    return errorResponse('internal_error');
  }

  // service_role é uma fronteira administrativa confiável: nunca chamar
  // create_invite() sem antes reservar via reserve_create_invite_rate_limit()
  // (acima) — janela TOCTOU pequena e aceita entre as duas RPCs, sempre
  // revalidada por create_invite() (M1-F S4-A2B.1).
  let created: { invite_id: string; expires_at: string } | null = null;
  let rawToken = '';

  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const token = generateInviteToken();
    rawToken = token.rawToken;

    const { data, error } = await admin.rpc('create_invite', {
      p_actor_profile_id: actor.profileId,
      p_company_id: body.company_id,
      p_email: body.email,
      p_name: body.name,
      p_role_kind: body.role_kind,
      p_token_hash: token.tokenHash,
    });

    if (error) {
      return errorResponse('forbidden');
    }

    const row = data?.[0];
    if (!row) {
      logInviteError('create_invite_empty_response', { requestId });
      return errorResponse('internal_error');
    }

    if (row.success && row.invite_id && row.expires_at) {
      created = { invite_id: row.invite_id, expires_at: row.expires_at };
      break;
    }

    if (row.code !== 'token_conflict') {
      if (isKnownDomainCode(row.code)) {
        return errorResponse(row.code);
      }
      logInviteError('create_invite_unknown_code', { requestId, code: row.code });
      return errorResponse('internal_error');
    }
    // token_conflict: tenta novamente com um novo token, sem nova reserva
    // de rate limit (já consumida acima).
  }

  if (!created) {
    return errorResponse('token_conflict');
  }

  const redirectTo = buildInviteRedirectUrl(appUrl, rawToken);

  const sendResult = await sendInviteEmail({
    admin,
    anon,
    email: body.email,
    redirectTo,
    name: body.name,
  });

  let deliveryErrorCode: DeliveryErrorCode | undefined;
  if (sendResult.ok === false) {
    deliveryErrorCode = sendResult.errorCode;
  }

  const finalizeOutcome = await finalizeCreateDelivery({
    admin,
    actorProfileId: actor.profileId,
    inviteId: created.invite_id,
    success: sendResult.ok,
    errorCode: deliveryErrorCode,
  });

  const sendOutcomeLabel = sendResult.ok === true ? 'sent' : 'failed';

  logInviteEvent({
    requestId,
    operation: 'create',
    result: finalizeOutcome === 'finalized' ? sendOutcomeLabel : 'finalize_failed',
    actorProfileId: actor.profileId,
    companyId: body.company_id,
    inviteId: created.invite_id,
    durationMs: Date.now() - startedAt,
  });

  if (finalizeOutcome === 'finalize_failed') {
    return jsonResponse(503, {
      success: false,
      code: 'delivery_finalize_failed',
      invite_id: created.invite_id,
    });
  }

  if (sendResult.ok === false) {
    const code = sendResult.errorCode === 'auth_unavailable' ? 'auth_unavailable' : 'delivery_failed';
    return jsonResponse(code === 'auth_unavailable' ? 503 : 502, {
      success: false,
      code,
      invite_id: created.invite_id,
      delivery_status: 'failed',
    });
  }

  return jsonResponse(201, {
    success: true,
    code: 'ok',
    invite_id: created.invite_id,
    status: 'pending',
    delivery_status: 'sent',
    expires_at: created.expires_at,
  });
}
