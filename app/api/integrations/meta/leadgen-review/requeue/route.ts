// POST /api/integrations/meta/leadgen-review/requeue — META-MVP1.
// Reprocessamento de UM evento da fila de revisão do Lead Ads.
//
// Ordem: env → Origin → body → autenticação (Bearer) → flag de Integrações +
// empresa autorizada (META-MVP2) → RPC meta_leadgen_event_requeue COMO O USUÁRIO
// (o banco decide: Manager da company ou Super Admin com acesso; o evento
// precisa ser da company) → se requeued e a ingestão estiver ligada, agenda o
// processamento imediato (waitUntil, service_role). Sem ingestão ligada o
// evento fica received e o próximo sweep o processa.
//
// Resposta: só outcome e booleanos. Nunca IDs da Meta, PII, token ou erro bruto.
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import { isOriginAllowed, isValidUuid, jsonResponse, readJsonObjectBody, requireAuthenticatedActor } from '@/lib/server/invites/http';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';
import { isMetaLeadIngestionEnabled } from '@/lib/server/meta-webhook/env';
import { scheduleManualRequeueProcessing } from '@/lib/server/meta-webhook/schedule-leadgen-processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_BODY_KEYS = ['company_id', 'event_id'] as const;
const REQUEUE_OUTCOMES = ['requeued', 'not_found', 'not_requeueable', 'requeue_limit', 'too_old'] as const;
type RequeueOutcome = (typeof REQUEUE_OUTCOMES)[number];

function fail(status: number, error: string): Response {
  return jsonResponse(status, { ok: false, error });
}

export async function POST(request: Request): Promise<Response> {
  let appUrl: URL;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    if (error instanceof InvalidAppUrlError) return fail(500, 'server_misconfigured');
    throw error;
  }
  if (!isOriginAllowed(request, appUrl)) return fail(403, 'invalid_origin');

  const body = await readJsonObjectBody(request, ALLOWED_BODY_KEYS);
  if (body.ok === false) return fail(body.error === 'body_too_large' ? 413 : 400, 'invalid_body');
  const companyId = body.value.company_id;
  const eventId = body.value.event_id;
  if (typeof companyId !== 'string' || !isValidUuid(companyId) || typeof eventId !== 'string' || !isValidUuid(eventId)) {
    return fail(400, 'invalid_body');
  }

  const actor = await requireAuthenticatedActor(request);
  if (actor.ok === false) return fail(401, 'unauthenticated');

  // META-MVP2: a operação Lead Ads existe para empresa AUTORIZADA (relida como
  // o usuário: a RPC também confere Manager da empresa ou Super Admin).
  if (!isMetaIntegrationsReviewEnabled()) return fail(403, 'forbidden');
  try {
    const access = await actor.client.rpc('meta_lead_ads_company_access', { p_company_id: companyId });
    const enabled = !access.error && Array.isArray(access.data)
      && (access.data[0] as { enabled?: unknown } | undefined)?.enabled === true;
    if (!enabled) return fail(403, 'forbidden');
  } catch {
    return fail(503, 'unavailable');
  }

  let data: unknown;
  let error: { message?: string } | null;
  try {
    ({ data, error } = await actor.client.rpc('meta_leadgen_event_requeue', {
      p_company_id: companyId,
      p_event_id: eventId,
    }));
  } catch {
    return fail(503, 'unavailable');
  }
  if (error) return fail(error.message === 'forbidden' ? 403 : 503, error.message === 'forbidden' ? 'forbidden' : 'unavailable');

  const row = Array.isArray(data) && data.length === 1 ? (data[0] as { out_outcome?: unknown }) : null;
  const outcome = row && (REQUEUE_OUTCOMES as readonly string[]).includes(String(row.out_outcome))
    ? (row.out_outcome as RequeueOutcome)
    : null;
  if (outcome === null) return fail(503, 'unavailable');

  let processingScheduled = false;
  if (outcome === 'requeued' && isMetaLeadIngestionEnabled()) {
    scheduleManualRequeueProcessing(eventId);
    processingScheduled = true;
  }
  return jsonResponse(200, { ok: true, outcome, processingScheduled });
}
