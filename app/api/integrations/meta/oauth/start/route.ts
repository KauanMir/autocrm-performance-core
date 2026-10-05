// app/api/integrations/meta/oauth/start/route.ts — início do fluxo OAuth
// "Login do Facebook para Empresas". SÓ POST (nunca um GET público de
// iniciar OAuth). Exige autenticação real do CRM (Authorization: Bearer
// <jwt Supabase>, revalidado via auth.getUser), resolve a company
// autorizada server-side e exige papel adequado.
//
// O QUE FAZ:
//   1. autentica o usuário (mecanismo real do projeto);
//   2. resolve a company alvo (body opcional -> senão a única membership
//      ativa via RPC current_membership_company_id);
//   3. autoriza: is_manager_or_platform(company) — MANAGER daquela empresa
//      ou SUPER ADMIN da plataforma; SELLER é recusado;
//   4. gera um binding aleatório (CSPRNG) e o grava num cookie HttpOnly
//      curto (kapa_meta_oauth_binding);
//   5. cria um `state` assinado com contexto mínimo (v/p/nonce/iat/exp +
//      uid/cid + hash do binding);
//   6. devolve a URL de autorização da Meta pronta para uso.
//
// O QUE NÃO FAZ: não redireciona (devolve a URL em JSON — simplifica os
// testes); não chama a Graph API; não troca code por token; não grava
// integração no banco; não conecta nenhuma Página/conta.
//
// ISOLAMENTO: importado por nada além do fluxo Meta OAuth. Sem middleware.
// Nenhum tenant existente é afetado — a rota só responde a um POST
// autenticado por Manager/Super Admin.
//
// META-OAUTH-REVIEW-UI: body opcional `flow: "review_ui"` (UI mínima de
// Ajustes > Integrações, só para o vídeo do App Review). Só é aceito
// (vira `f` no state assinado) quando, ALÉM da autorização normal acima,
// o ator é Super Admin (is_platform_super_admin()) E a company resolvida é
// EXATAMENTE a company de teste fixa (META_TEST_COMPANY_ID). Qualquer
// piloto continua exatamente como antes — nunca alcança este ramo.
import { randomUUID } from 'node:crypto';
import {
  requireAuthenticatedActor,
  isOriginAllowed,
  readJsonObjectBody,
  isValidUuid,
} from '@/lib/server/invites/http';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import {
  getMetaOAuthStateSecret,
  InvalidMetaOAuthStateSecretError,
  getMetaAppId,
  MissingMetaAppIdError,
  getMetaLoginConfigId,
  MissingMetaLoginConfigIdError,
} from '@/lib/server/meta-oauth/env';
import { createOAuthState, OAUTH_STATE_FLOW_REVIEW_UI } from '@/lib/server/meta-oauth/state';
import { buildMetaAuthorizationUrl } from '@/lib/server/meta-oauth/authorize-url';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';
import {
  generateBinding,
  serializeBindingCookie,
  BINDING_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/server/meta-oauth/cookie';
import { logMetaOAuthEvent, logMetaOAuthError } from '@/lib/server/meta-oauth/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// META-OAUTH-REVIEW-UI: `flow` opcional, catálogo fechado de UM literal
// ("review_ui") — validado abaixo antes de qualquer efeito. Nunca repassado
// direto ao state sem a checagem extra de Super Admin + company de teste.
const ALLOWED_BODY_KEYS = ['company_id', 'flow'] as const;

type StartErrorCode =
  | 'server_misconfigured'
  | 'invalid_origin'
  | 'invalid_body'
  | 'unauthenticated'
  | 'company_unresolved'
  | 'forbidden';

function isSecureEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

function jsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function errorResponse(status: number, code: StartErrorCode): Response {
  return jsonResponse(status, { ok: false, error: code });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  // ── envs obrigatórias — fail closed ───────────────────────────────
  let stateSecret: Buffer;
  try {
    stateSecret = getMetaOAuthStateSecret();
  } catch (error) {
    if (error instanceof InvalidMetaOAuthStateSecretError) {
      logMetaOAuthError('state_secret_env_missing', { requestId });
      return errorResponse(500, 'server_misconfigured');
    }
    throw error;
  }

  let appId: string;
  try {
    appId = getMetaAppId();
  } catch (error) {
    if (error instanceof MissingMetaAppIdError) {
      logMetaOAuthError('app_id_env_missing', { requestId });
      return errorResponse(500, 'server_misconfigured');
    }
    throw error;
  }

  // Facebook Login for Business: a URL de autorização usa config_id (que
  // substitui scope). Sem a Configuration não há como montar a URL.
  let loginConfigId: string;
  try {
    loginConfigId = getMetaLoginConfigId();
  } catch (error) {
    if (error instanceof MissingMetaLoginConfigIdError) {
      logMetaOAuthError('login_config_id_env_missing', { requestId });
      return errorResponse(500, 'server_misconfigured');
    }
    throw error;
  }

  let appUrl: URL;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    if (error instanceof InvalidAppUrlError) {
      logMetaOAuthError('app_url_invalid', { requestId });
      return errorResponse(500, 'server_misconfigured');
    }
    throw error;
  }

  // ── CSRF de origem (mesma postura dos outros POSTs do projeto) ─────
  if (!isOriginAllowed(request, appUrl)) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_start',
      result: 'invalid_origin',
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(403, 'invalid_origin');
  }

  // ── body (opcional): { company_id? } ─────────────────────────────
  const bodyResult = await readJsonObjectBody(request, ALLOWED_BODY_KEYS);
  if (bodyResult.ok === false) {
    return errorResponse(bodyResult.error === 'body_too_large' ? 413 : 400, 'invalid_body');
  }
  const rawCompanyId = bodyResult.value.company_id;
  if (
    rawCompanyId !== undefined &&
    rawCompanyId !== null &&
    (typeof rawCompanyId !== 'string' || !isValidUuid(rawCompanyId))
  ) {
    return errorResponse(400, 'invalid_body');
  }

  const rawFlow = bodyResult.value.flow;
  if (rawFlow !== undefined && rawFlow !== null && rawFlow !== OAUTH_STATE_FLOW_REVIEW_UI) {
    return errorResponse(400, 'invalid_body');
  }
  const requestedReviewUiFlow = rawFlow === OAUTH_STATE_FLOW_REVIEW_UI;

  // ── autenticação (mecanismo real do CRM) ─────────────────────────
  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_start',
      result: 'unauthenticated',
      authenticatedUserPresent: false,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(401, 'unauthenticated');
  }
  const { actor, client: userClient } = actorResult;

  // ── resolver a company alvo ──────────────────────────────────────
  let targetCompanyId: string | null =
    typeof rawCompanyId === 'string' && rawCompanyId !== '' ? rawCompanyId : null;

  if (!targetCompanyId) {
    // current_membership_company_id(): SECURITY DEFINER, deriva de
    // auth.uid(); NULL para Super Admin ou se houver 0/>1 memberships.
    const { data, error } = await userClient.rpc('current_membership_company_id');
    if (error) {
      logMetaOAuthError('company_resolve_failed', { requestId });
      return errorResponse(500, 'server_misconfigured');
    }
    targetCompanyId = typeof data === 'string' && isValidUuid(data) ? data : null;
  }

  if (!targetCompanyId) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_start',
      result: 'company_unresolved',
      authenticatedUserPresent: true,
      companyResolved: false,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(403, 'company_unresolved');
  }

  // ── autorização: Manager daquela empresa OU Super Admin da plataforma
  // is_manager_or_platform(uuid): SECURITY DEFINER, deriva de auth.uid();
  // FALSE para Seller. Cobre num único ponto acesso + papel.
  const { data: allowed, error: permError } = await userClient.rpc('is_manager_or_platform', {
    p_target_company_id: targetCompanyId,
  });
  if (permError) {
    logMetaOAuthError('permission_check_failed', { requestId });
    return errorResponse(500, 'server_misconfigured');
  }
  if (allowed !== true) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_start',
      result: 'forbidden',
      authenticatedUserPresent: true,
      companyResolved: true,
      permissionGranted: false,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(403, 'forbidden');
  }

  // ── META-OAUTH-REVIEW-UI: gate ADICIONAL, só quando a UI de Integrações
  // pediu explicitamente o indicador `review_ui` — nunca aceito de um valor
  // não verificado do cliente. Precisa das DUAS condições, checadas
  // server-side: (a) a company já resolvida acima é EXATAMENTE a company de
  // teste fixa; (b) o ator é Super Admin de plataforma (is_platform_super_
  // admin(), mesma RPC usada por app/api/admin/users/[profileId]/email/
  // route.ts — nunca inferido de is_manager_or_platform, que também aceita
  // Manager). Falhar qualquer uma das duas => 403 forbidden, SEM `f` no
  // state (o fluxo de start continua funcionando normalmente pros pilotos
  // — só perde o indicador de redirect da UI de review). ──────────────────
  let reviewUiAuthorized = false;
  if (requestedReviewUiFlow) {
    if (!isMetaIntegrationsReviewEnabled() || targetCompanyId !== META_TEST_COMPANY_ID) {
      logMetaOAuthEvent({
        requestId,
        operation: 'oauth_start',
        result: 'forbidden',
        authenticatedUserPresent: true,
        companyResolved: true,
        permissionGranted: true,
        durationMs: Date.now() - startedAt,
      });
      return errorResponse(403, 'forbidden');
    }
    const { data: isSuperAdmin, error: superAdminError } = await userClient.rpc('is_platform_super_admin');
    if (superAdminError) {
      logMetaOAuthError('permission_check_failed', { requestId });
      return errorResponse(500, 'server_misconfigured');
    }
    if (isSuperAdmin !== true) {
      logMetaOAuthEvent({
        requestId,
        operation: 'oauth_start',
        result: 'forbidden',
        authenticatedUserPresent: true,
        companyResolved: true,
        permissionGranted: true,
        durationMs: Date.now() - startedAt,
      });
      return errorResponse(403, 'forbidden');
    }
    reviewUiAuthorized = true;
  }

  // ── binding + state ─────────────────────────────────────────────
  const binding = generateBinding();
  const state = createOAuthState({
    secret: stateSecret,
    binding,
    userId: actor.profileId,
    companyId: targetCompanyId,
    ttlSeconds: BINDING_COOKIE_MAX_AGE_SECONDS,
    ...(reviewUiAuthorized ? { flow: OAUTH_STATE_FLOW_REVIEW_UI } : {}),
  });

  const setCookie = serializeBindingCookie({ value: binding, secure: isSecureEnv() });

  const built = buildMetaAuthorizationUrl({
    appId,
    configId: loginConfigId,
    appOrigin: appUrl.origin,
    state,
  });

  logMetaOAuthEvent({
    requestId,
    operation: 'oauth_start',
    result: 'authorization_url_issued',
    authenticatedUserPresent: true,
    companyResolved: true,
    permissionGranted: true,
    bindingSet: true,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(
    200,
    {
      ok: true,
      stage: 'authorization_url_ready',
      flow: 'facebook_login_for_business',
      authorizationUrl: built.url,
      redirectUri: built.redirectUri,
      responseType: built.responseType,
      graphApiVersion: built.graphApiVersion,
      expiresInSeconds: BINDING_COOKIE_MAX_AGE_SECONDS,
    },
    { 'Set-Cookie': setCookie },
  );
}
