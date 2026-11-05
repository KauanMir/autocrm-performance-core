// app/api/integrations/whatsapp/diagnostics/route.ts — W2B-2. GET read-only com
// a saúde da integração WhatsApp da TEST COMPANY.
//
// Gates (fail-closed, nesta ordem): JWT válido → Super Admin de plataforma →
// company (se informada) == TEST COMPANY. A conexão consultada é SEMPRE a da
// TEST COMPANY, fixa no servidor. Sem Graph, sem escrita em banco, sem token,
// ID externo ou valor de variável na resposta ou no log.
import { randomUUID } from 'node:crypto';
import { isValidUuid, jsonResponse, requireAuthenticatedActor } from '@/lib/server/invites/http';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';
import { fetchWhatsAppConnectionHealth } from '@/lib/server/whatsapp-connection/connection-rpc';
import { logWhatsAppDiagnostics, runWhatsAppDiagnostics } from '@/lib/server/whatsapp-connection/diagnostics';
import { fetchWhatsAppDiagnosticsSummary } from '@/lib/server/whatsapp-webhook/capture-rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(status: number, error: string): Response {
  return jsonResponse(status, { ok: false, error });
}

async function loadConnectionHealth(companyId: string) {
  const { data, error } = await fetchWhatsAppConnectionHealth(companyId);
  return error || !data ? ({ ok: false } as const) : ({ ok: true, rows: data } as const);
}

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const log = (result: string) => logWhatsAppDiagnostics({ requestId, result, durationMs: Date.now() - startedAt });

  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    log('unauthenticated');
    return errorResponse(401, 'unauthenticated');
  }

  const { data: isSuperAdmin, error: superAdminError } = await actorResult.client.rpc('is_platform_super_admin');
  if (superAdminError) {
    log('permission_check_failed');
    return errorResponse(500, 'server_misconfigured');
  }
  if (isSuperAdmin !== true) {
    log('forbidden');
    return errorResponse(403, 'forbidden');
  }

  const requestedCompany = new URL(request.url).searchParams.get('company_id');
  if (requestedCompany !== null) {
    if (!isValidUuid(requestedCompany)) return errorResponse(400, 'invalid_request');
    if (requestedCompany.toLowerCase() !== META_TEST_COMPANY_ID) {
      log('company_forbidden');
      return errorResponse(403, 'forbidden');
    }
  }

  const report = await runWhatsAppDiagnostics({
    testCompanyId: META_TEST_COMPANY_ID,
    loadConnectionHealth,
    loadSummary: fetchWhatsAppDiagnosticsSummary,
  });
  log('completed');
  return jsonResponse(200, { ok: true, ...report });
}
