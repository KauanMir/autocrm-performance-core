// app/api/integrations/meta/oauth/review-status/route.ts — META-OAUTH-
// REVIEW-UI. Único propósito: deixar a aba Ajustes > Integrações mostrar
// "Autorização Meta validada" logo após o redirect do callback OAuth, SEM
// nenhuma persistência (sem migration, sem tabela, sem coluna).
//
// GET autenticado (Authorization: Bearer <jwt Supabase>, revalidado via
// requireAuthenticatedActor — mesmo mecanismo do resto do projeto) + exige
// Super Admin de plataforma (is_platform_super_admin(), mesma RPC de
// app/api/admin/users/[profileId]/email/route.ts). Recebe `?token=` — o
// token EFÊMERO e assinado emitido pelo callback
// (lib/server/meta-oauth/review-result.ts) — e só devolve as flags de
// exibição quando a assinatura, o TTL curto e a company (EXATAMENTE
// META_TEST_COMPANY_ID) conferem. Nenhuma chamada à Graph API, nenhuma
// escrita no banco, nenhum segredo devolvido.
//
// ISOLAMENTO: importado por nada além da UI de Integrações. Nenhum piloto
// alcança este caminho (o token só é válido para a company de teste).
import { randomUUID } from 'node:crypto';
import { requireAuthenticatedActor } from '@/lib/server/invites/http';
import {
  getMetaOAuthStateSecret,
  InvalidMetaOAuthStateSecretError,
} from '@/lib/server/meta-oauth/env';
import { verifyReviewResultToken } from '@/lib/server/meta-oauth/review-result';
import { META_TEST_COMPANY_ID, LEADGEN_SUBSCRIBED_FIELD } from '@/lib/server/meta-oauth/config';
import { logMetaOAuthEvent, logMetaOAuthError } from '@/lib/server/meta-oauth/logger';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReviewStatusErrorCode =
  | 'server_misconfigured'
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_request'
  | 'token_invalid';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errorResponse(status: number, code: ReviewStatusErrorCode): Response {
  return jsonResponse(status, { ok: false, error: code });
}

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  if (!isMetaIntegrationsReviewEnabled()) {
    return errorResponse(403, 'forbidden');
  }

  let secret: Buffer;
  try {
    secret = getMetaOAuthStateSecret();
  } catch (error) {
    if (error instanceof InvalidMetaOAuthStateSecretError) {
      logMetaOAuthError('state_secret_env_missing', { requestId });
      return errorResponse(500, 'server_misconfigured');
    }
    throw error;
  }

  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_review_status',
      result: 'unauthenticated',
      authenticatedUserPresent: false,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(401, 'unauthenticated');
  }
  const { client: userClient } = actorResult;

  // is_platform_super_admin() já verifica profile ativo internamente (mesmo
  // helper usado por app/api/admin/users/[profileId]/email/route.ts) —
  // nunca profiles.role/company_id.
  const { data: isSuperAdmin, error: superAdminError } = await userClient.rpc('is_platform_super_admin');
  if (superAdminError) {
    logMetaOAuthError('permission_check_failed', { requestId });
    return errorResponse(500, 'server_misconfigured');
  }
  if (isSuperAdmin !== true) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_review_status',
      result: 'forbidden',
      authenticatedUserPresent: true,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(403, 'forbidden');
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return errorResponse(400, 'invalid_request');
  }

  const verified = verifyReviewResultToken(token, { secret, expectedCompanyId: META_TEST_COMPANY_ID });
  if (!verified.ok) {
    // `in` em vez de narrowing pelo discriminante: o tsconfig do projeto
    // roda com strict:false (mesmo padrão do callback).
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_review_status',
      result: 'token_invalid',
      reason: 'reason' in verified ? verified.reason : 'unknown',
      authenticatedUserPresent: true,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, 'token_invalid');
  }

  logMetaOAuthEvent({
    requestId,
    operation: 'oauth_review_status',
    result: 'verified',
    authenticatedUserPresent: true,
    durationMs: Date.now() - startedAt,
  });

  // Falha de persistência: só o código fechado, sem nenhuma métrica de Page.
  if (verified.payload.outcome === 'failure') {
    return jsonResponse(200, {
      ok: true,
      stage: verified.payload.stage,
      outcome: 'failure',
      persisted: false,
      failureCode: verified.payload.failureCode,
    });
  }

  // Sucesso: mesmo shape de antes, sem dado sensível e sem chamada de rede.
  return jsonResponse(200, {
    ok: true,
    stage: verified.payload.stage,
    outcome: 'success',
    persisted: verified.payload.persisted,
    page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
    pageSubscription: { verified: true, field: LEADGEN_SUBSCRIBED_FIELD },
  });
}
