// app/api/integrations/meta/oauth/callback/route.ts — callback do fluxo
// OAuth "Login do Facebook para Empresas".
//
// URL final:
//   https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback
//
// GATE DE SEGURANÇA (inalterado): EXIGE e valida o `state` (HMAC, TTL curto) e
// o binding anti-CSRF (cookie HttpOnly setado por POST .../oauth/start) ANTES de
// qualquer tratamento — inclusive quando a Meta devolve `error`. Só depois:
// trata o erro do provider de forma sanitizada OU troca o `code` por token
// server-side. O cookie de binding é limpo em todos os ramos pós-verificação.
//
// META-MVP2 — multiempresa (substitui a company/Página de teste fixas):
//   1. a empresa do `state` precisa estar AUTORIZADA para Lead Ads
//      (company_meta_lead_ads_access, desligada por padrão, só o Super Admin
//      liga) e a persistência precisa estar ligada; senão a resposta é a de
//      sempre (`token_exchange_verified`) e nada é feito com o token;
//   2. troca por token de longa duração quando possível (MVP-1);
//   3. confere as quatro permissões de Lead Ads;
//   4. lista as Páginas elegíveis (/me/accounts com a task ADVERTISE), cifra o
//      token de cada uma (AAD company+page) e grava uma SELEÇÃO de uso único
//      com TTL de 10 min (lib/server/meta-oauth/page-selection.ts);
//   5. o navegador recebe só um cookie HttpOnly com o token assinado da seleção
//      (302 para Ajustes > Integrações no fluxo da UI, com um marcador sem
//      segredo na URL). A Página escolhida é verificada (debug_token), inscrita
//      no webhook leadgen e persistida por POST
//      /api/integrations/meta/oauth/page-selection.
// No fluxo da UI, falha depois do gate volta para Ajustes > Integrações com um
// código do catálogo fechado (`meta_error`), nunca JSON cru para o usuário.
// Nenhum token da Meta é logado, devolvido, posto em cookie/URL ou salvo em
// claro, e o token assinado da seleção nunca vai em URL nem em corpo de resposta.
import { randomUUID } from 'node:crypto';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import {
  getMetaOAuthStateSecret,
  InvalidMetaOAuthStateSecretError,
  getMetaAppId,
  MissingMetaAppIdError,
  getMetaAppSecret,
  MissingMetaAppSecretError,
  isMetaConnectionPersistenceEnabled,
} from '@/lib/server/meta-oauth/env';
import { resolveGraphApiVersion } from '@/lib/server/meta-oauth/config';
import { verifyOAuthState, OAUTH_STATE_FLOW_REVIEW_UI } from '@/lib/server/meta-oauth/state';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';
import { readBindingCookie, clearBindingCookie, serializePageSelectionCookie } from '@/lib/server/meta-oauth/cookie';
import { exchangeCodeForToken } from '@/lib/server/meta-oauth/token-exchange';
import {
  fetchGrantedUserPermissions,
  findMissingRequiredPermission,
} from '@/lib/server/meta-oauth/user-permissions';
import { logMetaOAuthEvent, logMetaOAuthError } from '@/lib/server/meta-oauth/logger';
import { exchangeForLongLivedUserToken } from '@/lib/server/meta-oauth/token-lifetime';
import type { TokenOrigin } from '@/lib/server/meta-oauth/connection-persistence';
import {
  createPageSelectionRpc,
  createPageSelectionToken,
  encryptSelectionPages,
  fetchEligiblePages,
  PAGE_SELECTION_TTL_SECONDS,
  type PageSelectionRpc,
} from '@/lib/server/meta-oauth/page-selection';

export const runtime = 'nodejs';
// Um callback OAuth nunca pode ser servido de cache. Escopo estrito desta
// rota — não afeta nenhuma outra.
export const dynamic = 'force-dynamic';
// Next 14 serve do Data Cache os fetch do supabase-js e da Graph mesmo com force-dynamic (comprovado em produção
// em 2026-11-13 no cron kapa-leads-sync). Nenhum fetch desta rota pode vir do cache.
export const fetchCache = 'force-no-store';

// Catálogo fechado de códigos devolvidos ao cliente — genéricos, sem
// detalhe sensível, sem texto externo refletido.
type CallbackErrorCode =
  | 'server_misconfigured'
  | 'invalid_request'
  | 'state_missing'
  | 'state_invalid'
  | 'state_expired'
  | 'binding_missing'
  | 'binding_invalid'
  | 'provider_error'
  | 'token_exchange_failed'
  // META-MVP2 — fluxo de conexão de empresa autorizada.
  | 'context_missing'
  | 'company_access_disabled'
  | 'missing_required_permission'
  | 'user_permissions_lookup_failed'
  | 'user_permissions_lookup_incomplete'
  | 'page_token_lookup_failed'
  | 'no_eligible_page'
  | 'token_encryption_failed'
  | 'page_selection_unavailable';

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

function errorResponse(status: number, code: CallbackErrorCode, opts?: { clearCookie?: boolean }): Response {
  const headers = opts?.clearCookie ? { 'Set-Cookie': clearBindingCookie(isSecureEnv()) } : undefined;
  return jsonResponse(status, { ok: false, error: code }, headers);
}

// Consome o binding e entrega o token assinado da seleção só no cookie HttpOnly.
function selectionHeaders(selectionToken: string): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearBindingCookie(isSecureEnv()));
  headers.append(
    'Set-Cookie',
    serializePageSelectionCookie({ value: selectionToken, secure: isSecureEnv(), maxAgeSeconds: PAGE_SELECTION_TTL_SECONDS }),
  );
  return headers;
}

// 302 de volta para a SPA (Ajustes > Integrações). A URL leva só um marcador
// sem segredo; nunca code, token da Meta ou o token da seleção.
function selectionRedirectResponse(location: string, selectionToken: string): Response {
  const headers = selectionHeaders(selectionToken);
  headers.set('Location', location);
  return new Response(null, { status: 302, headers });
}

// Fluxo da UI: quem clicou em "Conectar Meta" volta para a tela com um código do
// catálogo fechado. Sem APP_URL válida, null: cai na resposta JSON.
function uiFailureResponse(companyId: string, code: CallbackErrorCode): Response | null {
  let origin: string;
  try {
    origin = getAppUrl().origin;
  } catch {
    return null;
  }
  const location = new URL(`/company/${companyId}`, origin);
  location.searchParams.set('meta_error', code);
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': clearBindingCookie(isSecureEnv()),
    },
  });
}

// Sanitização defensiva de qualquer string vinda da Meta antes de ir para
// LOG (nunca para o corpo da resposta): só um subconjunto seguro, cortada
// curta. Evita log injection / vazamento de conteúdo inesperado.
function sanitizeForLog(value: string | null, maxLength = 64): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, maxLength);
  return cleaned === '' ? undefined : cleaned;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  // segredo obrigatório — fail closed se ausente/inválido.
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

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');
  const providerErrorReason = url.searchParams.get('error_reason');
  // Lido só para registro sanitizado; NUNCA refletido na resposta, NUNCA
  // logado em bruto.
  const providerErrorDescription = url.searchParams.get('error_description');

  const hasProviderError = providerError !== null;
  const hasCode = code !== null;
  // Metadado técnico sanitizado, seguro para log em qualquer ramo.
  const providerErrorCodeSafe = sanitizeForLog(providerError) ?? (hasProviderError ? 'unknown' : undefined);

  // ── (1) Nada acionável: sem `code` e sem `error` ──────────────────────
  if (!hasCode && !hasProviderError) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'missing_code_and_error',
      statePresent: state !== null,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, 'invalid_request');
  }

  // ── (2) `state` ausente ──────────────────────────────────────────────
  // Vale para `code` OU `error`: sem `state` não há prova de que o retorno
  // pertence a um fluxo OAuth iniciado pelo KAPA CRM. Erro seguro, sem
  // refletir nada da Meta, sem efeito colateral.
  if (state === null || state === '') {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'state_missing',
      codePresent: hasCode,
      providerErrorCode: providerErrorCodeSafe,
      statePresent: false,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, 'state_missing');
  }

  // ── (3) binding anti-CSRF: cookie obrigatório ───────────────────────
  const bindingCookie = readBindingCookie(request.headers.get('cookie'));
  if (!bindingCookie) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'binding_missing',
      codePresent: hasCode,
      providerErrorCode: providerErrorCodeSafe,
      bindingCookiePresent: false,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, 'binding_missing');
  }

  // ── (4) `state`: assinatura + expiração + binding + contexto ────────
  const stateResult = verifyOAuthState(state, { secret, expectedBinding: bindingCookie });
  if (!stateResult.ok) {
    const reason = 'reason' in stateResult ? stateResult.reason : 'invalid';
    let failCode: CallbackErrorCode;
    if (reason === 'expired') {
      failCode = 'state_expired';
    } else if (reason === 'context_mismatch') {
      // assinatura já bateu -> a divergência é do binding (ou do
      // propósito, só possível com o segredo). Tratado como binding.
      failCode = 'binding_invalid';
    } else {
      failCode = 'state_invalid';
    }
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: failCode,
      reason,
      codePresent: hasCode,
      providerErrorCode: providerErrorCodeSafe,
      bindingCookiePresent: true,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, failCode, { clearCookie: true });
  }

  // ═══ A PARTIR DAQUI: state assinado + não expirado + binding conferido.
  //     O cookie é consumido (limpo) em todos os ramos abaixo. ═══════════
  const { uid, cid, f: flow } = stateResult.payload;
  // Fluxo da UI: só com o `f` assinado pelo /start e a flag ligada. Nunca
  // inferido de nenhum input não assinado desta request.
  const isReviewUiFlow = flow === OAUTH_STATE_FLOW_REVIEW_UI && isMetaIntegrationsReviewEnabled();
  const failAfterGate = (status: number, code: CallbackErrorCode): Response =>
    (isReviewUiFlow && typeof cid === 'string' ? uiFailureResponse(cid, code) : null)
    ?? errorResponse(status, code, { clearCookie: true });

  // ── (5) Erro do provider (usuário cancelou/negou etc.) ─────────────
  if (hasProviderError) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'provider_error',
      providerErrorCode: providerErrorCodeSafe,
      reason:
        sanitizeForLog(providerErrorReason) ??
        (providerErrorDescription ? 'has_description' : undefined),
      codePresent: hasCode,
      bindingCookiePresent: true,
      durationMs: Date.now() - startedAt,
    });
    // Resposta genérica — nunca reflete error_description externo.
    return failAfterGate(400, 'provider_error');
  }

  // ── (6) Defensivo: sem provider error e sem code (não deveria ocorrer
  //        após o gate (1)). Fail closed. ────────────────────────────────
  if (!hasCode) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'invalid_request',
      bindingCookiePresent: true,
      durationMs: Date.now() - startedAt,
    });
    return failAfterGate(400, 'invalid_request');
  }

  // ═══ (7) state válido + binding conferido + code presente ═══════════
  // SÓ AGORA (depois de TODO o gate) troca o `code` por access token,
  // exclusivamente server-side. O cookie é consumido (limpo) em todos os
  // ramos abaixo — o binding não pode ser reutilizado (anti-replay).
  const contextFlags = {
    userIdPresent: typeof uid === 'string',
    companyIdPresent: typeof cid === 'string',
  };

  // Envs da troca — fail closed. META_APP_SECRET é a MESMA credencial já
  // usada em Production pelo webhook; server-only, nunca devolvida/logada.
  let appId: string;
  let appSecret: string;
  let appOrigin: string;
  try {
    appId = getMetaAppId();
    appSecret = getMetaAppSecret();
    appOrigin = getAppUrl().origin;
  } catch (envError) {
    const which =
      envError instanceof MissingMetaAppIdError
        ? 'app_id'
        : envError instanceof MissingMetaAppSecretError
          ? 'app_secret'
          : envError instanceof InvalidAppUrlError
            ? 'app_url'
            : 'unknown';
    if (which === 'unknown') throw envError;
    logMetaOAuthError('token_exchange_env_missing', { requestId, which });
    return failAfterGate(500, 'server_misconfigured');
  }

  const exchange = await exchangeCodeForToken({
    code: code as string,
    appId,
    appSecret,
    appOrigin,
    graphApiVersion: resolveGraphApiVersion(),
  });
  // A partir daqui `code` e o token da Meta não são mais referenciados —
  // o token nunca saiu de dentro de exchangeCodeForToken().

  if (!exchange.ok) {
    // `in` em vez de narrowing pelo discriminante: o tsconfig do projeto
    // roda com strict:false.
    const reason = 'reason' in exchange ? exchange.reason : 'unknown';
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'token_exchange_failed',
      reason, // enum interno sanitizado
      metaHttpStatus: 'httpStatus' in exchange ? exchange.httpStatus : undefined,
      codePresent: true,
      bindingCookiePresent: true,
      durationMs: Date.now() - startedAt,
    });
    // Erro genérico — nunca o corpo bruto da Meta, nunca code/secret/token.
    return failAfterGate(502, 'token_exchange_failed');
  }

  // ═══ (8) META-MVP2 — autorização da empresa ═══════════════════════════
  // A empresa é a do `state` assinado pelo /start (que já exigiu Manager da
  // empresa ou Super Admin). Empresa não autorizada ou persistência desligada:
  // resposta de sempre, o token é descartado e nada mais é chamado.
  if (typeof cid !== 'string' || typeof uid !== 'string') {
    logMetaOAuthEvent({ requestId, operation: 'oauth_callback', result: 'context_missing', durationMs: Date.now() - startedAt });
    return errorResponse(400, 'context_missing', { clearCookie: true });
  }

  // Persistência desligada: o banco nem é consultado.
  const persistenceOn = isMetaConnectionPersistenceEnabled();
  let selectionRpc: PageSelectionRpc | null = null;
  let companyEnabled = false;
  if (persistenceOn) {
    try {
      selectionRpc = createPageSelectionRpc();
    } catch {
      logMetaOAuthError('page_selection_rpc_unavailable', { requestId });
      return failAfterGate(500, 'server_misconfigured');
    }
    companyEnabled = (await selectionRpc.leadAdsEnabled(cid)) === true;
  }
  if (!companyEnabled || selectionRpc === null) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'token_exchange_verified',
      reason: persistenceOn ? 'company_not_enabled' : 'persistence_disabled',
      codePresent: true,
      codeLength: (code as string).length, // só o comprimento, nunca o valor
      bindingCookiePresent: true,
      metaHttpStatus: exchange.httpStatus,
      tokenType: exchange.tokenType,
      tokenExpiresInSeconds: exchange.expiresInSeconds,
      durationMs: Date.now() - startedAt,
    });
    if (isReviewUiFlow) return failAfterGate(403, 'company_access_disabled');
    return jsonResponse(
      200,
      {
        ok: true,
        stage: 'token_exchange_verified',
        context: contextFlags,
        token: { received: true },
        message:
          'Token da Meta obtido e validado server-side. A empresa não está habilitada para Lead Ads: ' +
          'o token foi descartado e nenhuma Página foi conectada.',
      },
      { 'Set-Cookie': clearBindingCookie(isSecureEnv()) },
    );
  }

  const graphApiVersion = resolveGraphApiVersion();

  // ═══ (9) token de longa duração ANTES de derivar os de Página (MVP-1) ══
  // Falha na troca não recusa: o debug_token da Página escolhida decide.
  let tokenOrigin: TokenOrigin = 'original_token';
  let userAccessToken = exchange.accessToken;
  if (exchange.expiresInSeconds !== undefined) {
    const longLived = await exchangeForLongLivedUserToken({
      userAccessToken: exchange.accessToken,
      appId,
      appSecret,
      graphApiVersion,
    });
    if ('accessToken' in longLived) {
      userAccessToken = longLived.accessToken;
      tokenOrigin = 'exchanged_long_lived';
    } else {
      logMetaOAuthEvent({
        requestId,
        operation: 'oauth_callback',
        result: 'long_lived_exchange_skipped',
        reason: longLived.reason,
        metaHttpStatus: longLived.httpStatus,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  // ═══ (10) as quatro permissões de Lead Ads ════════════════════════════
  const userPermissions = await fetchGrantedUserPermissions({ userAccessToken, graphApiVersion });
  if (!userPermissions.ok) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'user_permissions_lookup_failed',
      reason: 'reason' in userPermissions ? userPermissions.reason : 'unknown',
      metaHttpStatus: 'httpStatus' in userPermissions ? userPermissions.httpStatus : undefined,
      durationMs: Date.now() - startedAt,
    });
    const incomplete = 'reason' in userPermissions && userPermissions.reason === 'pagination_limit_exceeded';
    return failAfterGate(502, incomplete ? 'user_permissions_lookup_incomplete' : 'user_permissions_lookup_failed');
  }
  const missingPermission = findMissingRequiredPermission(userPermissions.grantedPermissions);
  if (missingPermission) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'missing_required_permission',
      reason: missingPermission,
      durationMs: Date.now() - startedAt,
    });
    if (isReviewUiFlow) return failAfterGate(403, 'missing_required_permission');
    return jsonResponse(
      403,
      { ok: false, error: 'missing_required_permission', permission: missingPermission },
      { 'Set-Cookie': clearBindingCookie(isSecureEnv()) },
    );
  }

  // ═══ (11) Páginas elegíveis ═══════════════════════════════════════════
  const eligible = await fetchEligiblePages({ accessToken: userAccessToken, graphApiVersion });
  // A partir daqui o token de usuário não é mais referenciado.
  if (!('pages' in eligible)) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'page_token_lookup_failed',
      reason: eligible.reason,
      metaHttpStatus: eligible.httpStatus,
      durationMs: Date.now() - startedAt,
    });
    return failAfterGate(502, 'page_token_lookup_failed');
  }
  if (eligible.pages.length === 0) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'no_eligible_page',
      pageFound: false,
      durationMs: Date.now() - startedAt,
    });
    return failAfterGate(502, 'no_eligible_page');
  }

  // ═══ (12) seleção cifrada de uso único ════════════════════════════════
  let encryptedPages: ReturnType<typeof encryptSelectionPages>;
  try {
    encryptedPages = encryptSelectionPages(cid, eligible.pages);
  } catch {
    logMetaOAuthError('page_selection_encryption_failed', { requestId });
    return failAfterGate(500, 'token_encryption_failed');
  }
  const selectionId = await selectionRpc.create({ companyId: cid, profileId: uid, pages: encryptedPages, tokenOrigin });
  if (!selectionId) {
    logMetaOAuthEvent({ requestId, operation: 'oauth_callback', result: 'page_selection_unavailable', durationMs: Date.now() - startedAt });
    return failAfterGate(502, 'page_selection_unavailable');
  }

  const selectionToken = createPageSelectionToken({ secret, selectionId, companyId: cid, userId: uid });
  logMetaOAuthEvent({
    requestId,
    operation: 'oauth_callback',
    result: 'page_selection_ready',
    pageFound: true,
    tokenOrigin,
    reviewUiRedirect: isReviewUiFlow,
    durationMs: Date.now() - startedAt,
  });

  if (isReviewUiFlow) {
    // Manager opera sempre a própria empresa em /company/[id] (a URL só vale
    // para Super Admin); o cid aqui veio do state assinado.
    const redirectUrl = new URL(`/company/${cid}`, appOrigin);
    redirectUrl.searchParams.set('meta_select', '1');
    return selectionRedirectResponse(redirectUrl.toString(), selectionToken);
  }

  const headers = selectionHeaders(selectionToken);
  headers.set('Content-Type', 'application/json');
  return new Response(
    JSON.stringify({
      ok: true,
      stage: 'page_selection_required',
      context: contextFlags,
      selection: { pageCount: eligible.pages.length, truncated: eligible.truncated },
    }),
    { status: 200, headers },
  );
}
