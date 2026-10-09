// app/api/integrations/meta/diagnostics/route.ts — P2.6. GET read-only que
// consolida os checks manuais do Graph Explorer para a TEST COMPANY.
//
// Gates (fail-closed, nesta ordem): flag de review → JWT válido → Super Admin
// de plataforma → company (se informada) == META_TEST_COMPANY_ID. A conexão
// consultada é SEMPRE a da Page de teste fixa; qualquer outra company dona
// dela é recusada pelo módulo. Só GET na Graph, sem POST, sem escrita em
// banco, sem token/ID/PII na resposta ou no log.
import { randomUUID } from 'node:crypto';
import { requireAuthenticatedActor } from '@/lib/server/invites/http';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';
import { MissingMetaAppIdError, getMetaAppId } from '@/lib/server/meta-oauth/env';
import {
  META_TEST_COMPANY_ID,
  META_TEST_FORM_ID,
  META_TEST_PAGE_ID,
  resolveGraphApiVersion,
} from '@/lib/server/meta-oauth/config';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import {
  decryptDiagnosticsToken,
  runMetaLeadAdsDiagnostics,
  type ConnectionLookup,
  type DiagnosticsDeps,
} from '@/lib/server/meta-oauth/diagnostics';
import { createProcessingRpc } from '@/lib/server/meta-webhook/processing-rpc';
import { logMetaOAuthEvent, logMetaOAuthError } from '@/lib/server/meta-oauth/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse(status, { ok: false, error });
}

async function findTestConnection(pageId: string): ReturnType<DiagnosticsDeps['findConnection']> {
  try {
    const owner = await createMetaConnectionRpcPort().ownerByPage(pageId);
    if (owner.error) return { ok: false };
    const rows = owner.data ?? [];
    if (rows.length === 0) return { ok: true, value: null };
    if (rows.length > 1) return { ok: false };
    const lookup = await createProcessingRpc().lookupIntegration(rows[0].integration_id);
    if (!lookup.ok) return { ok: false };
    const value: ConnectionLookup | null = lookup.value;
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  if (!isMetaIntegrationsReviewEnabled()) {
    return errorResponse(403, 'forbidden');
  }

  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    logMetaOAuthEvent({
      requestId,
      operation: 'diagnostics',
      result: 'unauthenticated',
      authenticatedUserPresent: false,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(401, 'unauthenticated');
  }

  const { data: isSuperAdmin, error: superAdminError } = await actorResult.client.rpc('is_platform_super_admin');
  if (superAdminError) {
    logMetaOAuthError('permission_check_failed', { requestId });
    return errorResponse(500, 'server_misconfigured');
  }
  if (isSuperAdmin !== true) {
    logMetaOAuthEvent({
      requestId,
      operation: 'diagnostics',
      result: 'forbidden',
      authenticatedUserPresent: true,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(403, 'forbidden');
  }

  const requestedCompany = new URL(request.url).searchParams.get('company_id');
  if (requestedCompany !== null) {
    if (!UUID_PATTERN.test(requestedCompany)) return errorResponse(400, 'invalid_request');
    if (requestedCompany.toLowerCase() !== META_TEST_COMPANY_ID) return errorResponse(403, 'forbidden');
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

  const diagnostics = await runMetaLeadAdsDiagnostics({
    findConnection: findTestConnection,
    decrypt: decryptDiagnosticsToken,
    graphApiVersion: resolveGraphApiVersion(),
    appId,
    testCompanyId: META_TEST_COMPANY_ID,
    testPageId: META_TEST_PAGE_ID,
    testFormId: META_TEST_FORM_ID,
  });

  logMetaOAuthEvent({
    requestId,
    operation: 'diagnostics',
    result: diagnostics.connection === 'ok' ? 'completed' : 'connection_unavailable',
    reason: diagnostics.connectionFailure,
    authenticatedUserPresent: true,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(200, { ok: true, ...diagnostics });
}
