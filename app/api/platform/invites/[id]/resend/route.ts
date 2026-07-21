// app/api/platform/invites/[id]/resend/route.ts — Route Handler de
// reenvio de convites (M1-F S4-A2B, design §17). O convite acessível pelo
// ator vem de uma consulta que respeita a RLS existente (mesma fronteira
// de autorização já aplicada por resend_invite() no banco) — nunca revela
// se o id existe em outra empresa/pertence a outro convidador.
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createAnonServerClient } from '@/lib/server/supabase/user-token-client';
import { requireAuthenticatedActor, readJsonObjectBody, isOriginAllowed, errorResponse, jsonResponse, isValidUuid } from '@/lib/server/invites/http';
import { generateInviteToken, buildInviteRedirectUrl } from '@/lib/server/invites/token';
import { sendInviteEmail, type DeliveryErrorCode } from '@/lib/server/invites/auth-email';
import { finalizeResendDelivery } from '@/lib/server/invites/delivery';
import { isKnownDomainCode } from '@/lib/server/invites/errors';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import { logInviteEvent, logInviteError } from '@/lib/server/invites/logger';

const MAX_TOKEN_ATTEMPTS = 3;

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
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

  const bodyResult = await readJsonObjectBody(request, [] as const);
  if (bodyResult.ok === false) {
    return errorResponse(bodyResult.error);
  }

  if (!isValidUuid(params.id)) {
    return errorResponse('invalid_input');
  }
  const inviteId = params.id;

  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    return errorResponse('unauthenticated');
  }
  const { actor, client: userClient } = actorResult;

  const { data: rows } = await userClient
    .from('invites')
    .select('id, company_id, email, status')
    .eq('id', inviteId)
    .limit(1);

  const invite = rows?.[0];
  if (!invite) {
    return errorResponse('invite_not_found');
  }

  const admin = createAdminClient();
  const anon = createAnonServerClient();

  // reserve_resend_invite_rate_limit() revalida autorização e
  // elegibilidade INTEIRAMENTE (mesma lógica de resend_invite(), defesa em
  // profundidade — M1-F S4-A2B.1) ANTES de reservar o rate limit, derivando
  // company_id/email/status do PRÓPRIO convite — nunca aceita esses dados
  // do Route Handler (só p_invite_id). Nunca a função genérica
  // reserve_invite_rate_limit(), que não valida autorização.
  const { data: rlData, error: rlError } = await admin.rpc('reserve_resend_invite_rate_limit', {
    p_actor_profile_id: actor.profileId,
    p_invite_id: inviteId,
  });

  if (rlError) {
    return errorResponse('forbidden');
  }

  const rl = rlData?.[0];
  if (!rl) {
    logInviteError('reserve_resend_invite_rate_limit_empty_response', { requestId });
    return errorResponse('internal_error');
  }

  if (!rl.allowed) {
    if (rl.code === 'actor_rate_limited' || rl.code === 'email_scope_rate_limited') {
      return errorResponse('rate_limited', { retryAfterSeconds: rl.retry_after_seconds ?? 60 });
    }
    if (isKnownDomainCode(rl.code)) {
      return errorResponse(rl.code);
    }
    logInviteError('reserve_resend_invite_rate_limit_unknown_code', { requestId, code: rl.code });
    return errorResponse('internal_error');
  }

  // service_role é uma fronteira administrativa confiável: nunca chamar
  // resend_invite() sem antes reservar via reserve_resend_invite_rate_limit()
  // (acima) — janela TOCTOU pequena e aceita entre as duas RPCs, sempre
  // revalidada por resend_invite() (M1-F S4-A2B.1).
  let resent: { invite_id: string; previous_invite_id: string; expires_at: string } | null = null;
  let rawToken = '';

  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const token = generateInviteToken();
    rawToken = token.rawToken;

    const { data, error } = await admin.rpc('resend_invite', {
      p_actor_profile_id: actor.profileId,
      p_invite_id: inviteId,
      p_token_hash: token.tokenHash,
    });

    if (error) {
      return errorResponse('forbidden');
    }

    const row = data?.[0];
    if (!row) {
      logInviteError('resend_invite_empty_response', { requestId });
      return errorResponse('internal_error');
    }

    if (row.success && row.invite_id && row.previous_invite_id && row.expires_at) {
      resent = {
        invite_id: row.invite_id,
        previous_invite_id: row.previous_invite_id,
        expires_at: row.expires_at,
      };
      break;
    }

    if (row.code !== 'token_conflict') {
      if (isKnownDomainCode(row.code)) {
        return errorResponse(row.code);
      }
      logInviteError('resend_invite_unknown_code', { requestId, code: row.code });
      return errorResponse('internal_error');
    }
  }

  if (!resent) {
    return errorResponse('token_conflict');
  }

  const redirectTo = buildInviteRedirectUrl(appUrl, rawToken);

  const sendResult = await sendInviteEmail({
    admin,
    anon,
    email: invite.email,
    redirectTo,
  });

  let deliveryErrorCode: DeliveryErrorCode | undefined;
  if (sendResult.ok === false) {
    deliveryErrorCode = sendResult.errorCode;
  }

  const finalizeOutcome = await finalizeResendDelivery({
    admin,
    actorProfileId: actor.profileId,
    inviteId: resent.invite_id,
    previousInviteId: resent.previous_invite_id,
    success: sendResult.ok,
    errorCode: deliveryErrorCode,
  });

  const sendOutcomeLabel = sendResult.ok === true ? 'sent' : 'failed';

  logInviteEvent({
    requestId,
    operation: 'resend',
    result: finalizeOutcome === 'finalized' ? sendOutcomeLabel : 'finalize_failed',
    actorProfileId: actor.profileId,
    companyId: invite.company_id,
    inviteId: resent.invite_id,
    durationMs: Date.now() - startedAt,
  });

  if (finalizeOutcome === 'finalize_failed') {
    return jsonResponse(503, {
      success: false,
      code: 'delivery_finalize_failed',
      invite_id: resent.invite_id,
      previous_invite_id: resent.previous_invite_id,
    });
  }

  if (sendResult.ok === false) {
    const code = sendResult.errorCode === 'auth_unavailable' ? 'auth_unavailable' : 'delivery_failed';
    return jsonResponse(code === 'auth_unavailable' ? 503 : 502, {
      success: false,
      code,
      invite_id: resent.invite_id,
      previous_invite_id: resent.previous_invite_id,
      delivery_status: 'failed',
    });
  }

  return jsonResponse(200, {
    success: true,
    code: 'ok',
    invite_id: resent.invite_id,
    previous_invite_id: resent.previous_invite_id,
    status: 'pending',
    delivery_status: 'sent',
    expires_at: resent.expires_at,
  });
}
