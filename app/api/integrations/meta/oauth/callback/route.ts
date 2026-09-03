// app/api/integrations/meta/oauth/callback/route.ts — callback do fluxo
// OAuth "Login do Facebook para Empresas".
//
// URL final:
//   https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback
//
// ESCOPO ATUAL (proposital):
//   - EXIGE e valida o `state` (assinado por HMAC, TTL curto) e o binding
//     anti-CSRF (cookie HttpOnly setado por POST .../oauth/start) ANTES de
//     qualquer tratamento — inclusive quando a Meta devolve `error`
//     (usuário cancelou/negou). Não há caminho que responda sem provar que
//     o retorno pertence a um fluxo iniciado pelo KAPA CRM.
//   - confirma o contexto assinado (propósito/versão; uid/cid quando
//     presentes);
//   - SÓ DEPOIS de state+binding válidos: OU trata o erro do provider de
//     forma sanitizada, OU troca o `code` por access token SERVER-SIDE.
//   - a troca do `code` roda exclusivamente no servidor (GET direto à
//     Meta — conforme a doc oficial —, com META_APP_SECRET); o access
//     token NUNCA é devolvido ao browser, NUNCA é logado, NUNCA é
//     persistido, NUNCA vai a cookie/URL — só existe em memória durante a
//     request e é descartado.
//   - responde de forma segura sem expor o `code` nem o token;
//   - limpa o cookie de binding depois de consumido (sucesso ou erro).
//
// NÃO FAZ NESTA FASE:
//   - NÃO usa o token para NENHUMA chamada de negócio (GET /me, Pages,
//     businesses, forms, lead retrieval, subscribe_apps, debug_token…);
//   - NÃO persiste nada (sem banco, sem tabela, sem token, sem page_id,
//     sem portfolio/business id);
//   - NÃO cria lead / automação / notificação;
//   - NÃO tem UI;
//   - NÃO vincula page_id -> company_id.
//
// ISOLAMENTO: esta rota e lib/server/meta-oauth/ são infraestrutura
// isolada, importada por nada além do fluxo Meta OAuth. Não há middleware
// no projeto; nenhuma rota existente é afetada. Rota pública por
// necessidade (a Meta redireciona o browser sem o Bearer do SPA) — a
// proteção é a assinatura do `state` + o binding do cookie.
import { randomUUID } from 'node:crypto';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import {
  getMetaOAuthStateSecret,
  InvalidMetaOAuthStateSecretError,
  getMetaAppId,
  MissingMetaAppIdError,
  getMetaAppSecret,
  MissingMetaAppSecretError,
} from '@/lib/server/meta-oauth/env';
import { resolveGraphApiVersion } from '@/lib/server/meta-oauth/config';
import { verifyOAuthState } from '@/lib/server/meta-oauth/state';
import { readBindingCookie, clearBindingCookie } from '@/lib/server/meta-oauth/cookie';
import { exchangeCodeForToken } from '@/lib/server/meta-oauth/token-exchange';
import { logMetaOAuthEvent, logMetaOAuthError } from '@/lib/server/meta-oauth/logger';

export const runtime = 'nodejs';
// Um callback OAuth nunca pode ser servido de cache. Escopo estrito desta
// rota — não afeta nenhuma outra.
export const dynamic = 'force-dynamic';

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
  | 'token_exchange_failed';

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
    return errorResponse(400, 'provider_error', { clearCookie: true });
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
    return errorResponse(400, 'invalid_request', { clearCookie: true });
  }

  // ═══ (7) state válido + binding conferido + code presente ═══════════
  // SÓ AGORA (depois de TODO o gate) troca o `code` por access token,
  // exclusivamente server-side. O cookie é consumido (limpo) em todos os
  // ramos abaixo — o binding não pode ser reutilizado (anti-replay).
  const { uid, cid } = stateResult.payload;
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
    return errorResponse(500, 'server_misconfigured', { clearCookie: true });
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
    return errorResponse(502, 'token_exchange_failed', { clearCookie: true });
  }

  logMetaOAuthEvent({
    requestId,
    operation: 'oauth_callback',
    result: 'token_exchange_verified',
    codePresent: true,
    codeLength: (code as string).length, // só o comprimento, nunca o valor
    bindingCookiePresent: true,
    metaHttpStatus: exchange.httpStatus,
    tokenType: exchange.tokenType, // ex.: "bearer" — não sensível
    tokenExpiresInSeconds: exchange.expiresInSeconds, // não sensível
    durationMs: Date.now() - startedAt,
  });

  // Resposta: só metadados seguros. NUNCA o access token (nem parcial, nem
  // hash), nunca o `code`, nunca o App Secret.
  return jsonResponse(
    200,
    {
      ok: true,
      stage: 'token_exchange_verified',
      context: contextFlags,
      token: { received: true },
      message:
        'Token da Meta obtido e validado server-side (etapa de validacao tecnica). ' +
        'O token nao e persistido nem exposto; foi descartado ao final da request.',
    },
    { 'Set-Cookie': clearBindingCookie(isSecureEnv()) },
  );
}
