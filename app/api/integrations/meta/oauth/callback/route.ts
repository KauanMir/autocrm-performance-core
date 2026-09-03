// app/api/integrations/meta/oauth/callback/route.ts — callback do fluxo
// OAuth "Login do Facebook para Empresas" (FASE FUNDAÇÃO).
//
// URL final:
//   https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback
//
// ESCOPO DESTA FASE (proposital):
//   - valida o parâmetro `state` (stateless, assinado por HMAC, TTL curto);
//   - trata os parâmetros de erro da Meta (error/error_reason/
//     error_description) de forma sanitizada;
//   - responde de forma segura sem expor o `code`.
//
// NÃO FAZ NESTA FASE:
//   - NÃO troca `code` por access token;
//   - NÃO chama a Graph API;
//   - NÃO persiste nada (sem banco, sem tabela, sem token);
//   - NÃO cria lead / automação / notificação;
//   - NÃO tem UI, botão ou endpoint público de "start OAuth";
//   - NÃO vincula page_id -> company_id.
//
// ISOLAMENTO: esta rota e lib/server/meta-oauth/ são infraestrutura
// isolada, importada por nada além daqui. Não há middleware no projeto;
// nenhuma rota existente é afetada. Rota pública por necessidade (a Meta
// redireciona o browser sem o Bearer do SPA) — a proteção é a assinatura
// do `state`.
import { randomUUID } from 'node:crypto';
import {
  getMetaOAuthStateSecret,
  InvalidMetaOAuthStateSecretError,
} from '@/lib/server/meta-oauth/env';
import { verifyOAuthState } from '@/lib/server/meta-oauth/state';
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
  | 'provider_error';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function errorResponse(status: number, code: CallbackErrorCode): Response {
  return jsonResponse(status, { ok: false, error: code });
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

  // (7) segredo obrigatório — fail closed se ausente/inválido.
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
  // Lido só para registro sanitizado; NUNCA refletido na resposta.
  const providerErrorDescription = url.searchParams.get('error_description');

  // ── Caso de erro da Meta ────────────────────────────────────────────
  if (providerError !== null) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'provider_error',
      providerErrorCode:
        sanitizeForLog(providerError) ?? 'unknown',
      reason:
        sanitizeForLog(providerErrorReason) ??
        (providerErrorDescription ? 'has_description' : undefined),
      statePresent: state !== null,
      durationMs: Date.now() - startedAt,
    });
    // Resposta genérica — não reflete error_description externo.
    return errorResponse(400, 'provider_error');
  }

  // ── Callback sem `code` e sem `error` ───────────────────────────────
  if (code === null) {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'missing_code_and_error',
      statePresent: state !== null,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, 'invalid_request');
  }

  // ── `state` ausente ────────────────────────────────────────────────
  if (state === null || state === '') {
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: 'state_missing',
      codePresent: true,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, 'state_missing');
  }

  // ── `state` inválido / expirado ────────────────────────────────────
  const stateResult = verifyOAuthState(state, { secret });
  if (!stateResult.ok) {
    const reason = 'reason' in stateResult ? stateResult.reason : 'invalid';
    const expired = reason === 'expired';
    logMetaOAuthEvent({
      requestId,
      operation: 'oauth_callback',
      result: expired ? 'state_expired' : 'state_invalid',
      reason,
      codePresent: true,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(400, expired ? 'state_expired' : 'state_invalid');
  }

  // ── Sucesso estrutural: state válido + code presente ───────────────
  // (6) NÃO troca o code por access token. (7) NÃO persiste nada.
  logMetaOAuthEvent({
    requestId,
    operation: 'oauth_callback',
    result: 'validated_no_exchange',
    codePresent: true,
    codeLength: code.length, // só o comprimento, nunca o valor
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(200, {
    ok: true,
    stage: 'callback_received',
    // Mensagem de desenvolvimento — sem `code`, sem token, sem segredo.
    message:
      'OAuth callback recebido e state validado (fundacao/desenvolvimento). ' +
      'A troca de code por access token nao esta implementada nesta fase.',
  });
}
