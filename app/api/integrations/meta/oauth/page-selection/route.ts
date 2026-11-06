// /api/integrations/meta/oauth/page-selection — META-MVP2.
//
// GET                → lista as Páginas oferecidas (id e nome).
// POST { page_id }   → conecta a Página escolhida.
//
// O token assinado da seleção vem SÓ do cookie HttpOnly gravado pelo callback:
// nunca de URL ou corpo. Empresa e usuário saem desse token, nunca do cliente.
//
// Ordem (as duas): env → (POST: Origin + body) → Bearer → token assinado da
// seleção (HMAC, TTL) → o usuário autenticado é o MESMO que iniciou o OAuth →
// autorização relida COMO O USUÁRIO (meta_lead_ads_company_access: Manager da
// empresa ou Super Admin, e a empresa precisa estar habilitada) → operação
// service_role. Nada de token da Meta, ciphertext ou erro bruto na resposta.
import { randomUUID } from 'node:crypto';
import { clearPageSelectionCookie, readPageSelectionCookie } from '@/lib/server/meta-oauth/cookie';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import {
  isOriginAllowed,
  jsonResponse,
  readJsonObjectBody,
  requireAuthenticatedActor,
} from '@/lib/server/invites/http';
import {
  getMetaAppId,
  getMetaAppSecret,
  getMetaOAuthStateSecret,
  isMetaConnectionPersistenceEnabled,
} from '@/lib/server/meta-oauth/env';
import { resolveGraphApiVersion } from '@/lib/server/meta-oauth/config';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { logMetaOAuthEvent } from '@/lib/server/meta-oauth/logger';
import {
  connectSelectedPage,
  createPageSelectionRpc,
  verifyPageSelectionToken,
} from '@/lib/server/meta-oauth/page-selection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_ID_PATTERN = /^[0-9]{1,30}$/;

function fail(status: number, error: string): Response {
  return jsonResponse(status, { ok: false, error });
}

function clearCookieHeaders(): Record<string, string> {
  return { 'Set-Cookie': clearPageSelectionCookie(process.env.NODE_ENV === 'production') };
}

type Authorized = { ok: true; selectionId: string; companyId: string; userId: string } | { ok: false; response: Response };

async function authorize(request: Request): Promise<Authorized> {
  const token = readPageSelectionCookie(request.headers.get('cookie'));
  let secret: Buffer;
  try {
    secret = getMetaOAuthStateSecret();
  } catch {
    return { ok: false, response: fail(500, 'server_misconfigured') };
  }
  if (!isMetaConnectionPersistenceEnabled()) return { ok: false, response: fail(403, 'persistence_disabled') };

  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) return { ok: false, response: fail(401, 'unauthenticated') };
  const { actor, client } = actorResult;

  const verified = verifyPageSelectionToken(token, { secret });
  if (!('selectionId' in verified)) {
    return { ok: false, response: fail(400, verified.reason === 'expired' ? 'selection_expired' : 'selection_invalid') };
  }
  // A seleção pertence a quem iniciou o OAuth: outra sessão não a usa.
  if (verified.userId !== actor.profileId) return { ok: false, response: fail(403, 'forbidden') };

  let access: { data: unknown; error: unknown | null };
  try {
    access = await client.rpc('meta_lead_ads_company_access', { p_company_id: verified.companyId });
  } catch {
    return { ok: false, response: fail(503, 'unavailable') };
  }
  if (access.error) return { ok: false, response: fail(403, 'forbidden') };
  const enabled = Array.isArray(access.data) && (access.data[0] as { enabled?: unknown } | undefined)?.enabled === true;
  if (!enabled) return { ok: false, response: fail(403, 'company_access_disabled') };

  return { ok: true, selectionId: verified.selectionId, companyId: verified.companyId, userId: verified.userId };
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!('selectionId' in auth)) return auth.response;

  let selection: ReturnType<typeof createPageSelectionRpc>;
  try {
    selection = createPageSelectionRpc();
  } catch {
    return fail(500, 'server_misconfigured');
  }
  const pages = await selection.list({
    selectionId: auth.selectionId,
    companyId: auth.companyId,
    profileId: auth.userId,
  });
  if (pages === null) return fail(503, 'unavailable');
  if (pages.length === 0) return jsonResponse(410, { ok: false, error: 'selection_unavailable' }, clearCookieHeaders());
  return jsonResponse(200, { ok: true, pages });
}

// Falhas em que a seleção continua válida: o usuário pode escolher outra Página.
const SELECTION_STILL_USABLE = ['page_not_offered', 'page_already_connected', 'company_access_disabled', 'connection_lookup_failed'];

export async function POST(request: Request): Promise<Response> {
  let appUrl: URL;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    if (error instanceof InvalidAppUrlError) return fail(500, 'server_misconfigured');
    throw error;
  }
  if (!isOriginAllowed(request, appUrl)) return fail(403, 'invalid_origin');

  const body = await readJsonObjectBody(request, ['page_id'] as const);
  if (body.ok === false) return fail(body.error === 'body_too_large' ? 413 : 400, 'invalid_body');
  const pageId = body.value.page_id;
  if (typeof pageId !== 'string' || !PAGE_ID_PATTERN.test(pageId)) return fail(400, 'invalid_body');

  const auth = await authorize(request);
  if (!('selectionId' in auth)) return auth.response;

  let appId: string;
  let appSecret: string;
  try {
    appId = getMetaAppId();
    appSecret = getMetaAppSecret();
  } catch {
    return fail(500, 'server_misconfigured');
  }

  let selection: ReturnType<typeof createPageSelectionRpc>;
  let connection: ReturnType<typeof createMetaConnectionRpcPort>;
  try {
    selection = createPageSelectionRpc();
    connection = createMetaConnectionRpcPort();
  } catch {
    return fail(500, 'server_misconfigured');
  }

  const startedAt = Date.now();
  const result = await connectSelectedPage(
    {
      selection,
      connection,
      appId,
      appSecret,
      graphApiVersion: resolveGraphApiVersion(),
    },
    { selectionId: auth.selectionId, companyId: auth.companyId, userId: auth.userId, pageId },
  );

  logMetaOAuthEvent({
    requestId: randomUUID(),
    operation: 'oauth_callback',
    result: 'error' in result ? `page_connect_${result.error}` : 'page_connected',
    // Inscrita na Meta e sem conexão gravada: os eventos da Página ficam retidos
    // até a reconexão. Sinal operacional, sem IDs.
    reason: 'error' in result && result.subscribedWithoutConnection ? 'subscribed_without_connection' : undefined,
    durationMs: Date.now() - startedAt,
  });

  if ('error' in result) {
    const status = ['selection_expired', 'selection_already_used', 'selection_unavailable'].includes(result.error)
      ? 410
      : ['page_already_connected', 'company_access_disabled', 'page_not_offered'].includes(result.error)
        ? 409
        : result.error === 'connection_lookup_failed'
          ? 503
          : 502;
    return jsonResponse(
      status,
      { ok: false, error: result.error },
      SELECTION_STILL_USABLE.includes(result.error) && !result.subscribedWithoutConnection ? undefined : clearCookieHeaders(),
    );
  }
  return jsonResponse(200, { ok: true, page: { id: result.pageId, name: result.pageName } }, clearCookieHeaders());
}
