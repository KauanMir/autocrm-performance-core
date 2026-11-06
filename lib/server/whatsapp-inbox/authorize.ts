// lib/server/whatsapp-inbox/authorize.ts — W2B-8: portão único da leitura da inbox.
// SERVER-ONLY. Fail-closed, nesta ordem: JWT válido → Super Admin de plataforma →
// company_id explícito e igual à TEST COMPANY → WHATSAPP_INBOX_READ_ENABLED.
//
// A permissão vem do client do próprio usuário, nunca do service_role. As RPCs
// repetem a regra no banco. Ampliar para Manager ou Seller exige aprovar a matriz de
// permissões da inbox e uma migration própria.
import { isValidUuid, requireAuthenticatedActor } from '@/lib/server/invites/http';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';

export function isWhatsAppInboxReadEnabled(): boolean {
  return process.env.WHATSAPP_INBOX_READ_ENABLED === 'true';
}

export type WhatsAppInboxAccess =
  | { ok: true; actorProfileId: string; companyId: string }
  | { ok: false; status: 400 | 401 | 403 | 500 | 503; error: string; logResult: string };

export async function authorizeWhatsAppInboxRead(request: Request): Promise<WhatsAppInboxAccess> {
  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    return { ok: false, status: 401, error: 'unauthenticated', logResult: 'unauthenticated' };
  }

  const { data: isSuperAdmin, error } = await actorResult.client.rpc('is_platform_super_admin');
  if (error) {
    return { ok: false, status: 500, error: 'server_misconfigured', logResult: 'permission_check_failed' };
  }
  if (isSuperAdmin !== true) {
    return { ok: false, status: 403, error: 'forbidden', logResult: 'forbidden' };
  }

  const requestedCompany = new URL(request.url).searchParams.get('company_id');
  if (requestedCompany === null || !isValidUuid(requestedCompany)) {
    return { ok: false, status: 400, error: 'invalid_request', logResult: 'invalid_company' };
  }
  const companyId = requestedCompany.toLowerCase();
  if (companyId !== META_TEST_COMPANY_ID) {
    return { ok: false, status: 403, error: 'forbidden', logResult: 'company_forbidden' };
  }

  if (!isWhatsAppInboxReadEnabled()) {
    return { ok: false, status: 503, error: 'inbox_disabled', logResult: 'inbox_disabled' };
  }

  return { ok: true, actorProfileId: actorResult.actor.profileId, companyId };
}
