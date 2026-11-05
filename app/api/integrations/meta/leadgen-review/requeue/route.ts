// POST /api/integrations/meta/leadgen-review/requeue — META-MVP1.
// Reprocessamento de UM evento da fila de revisão do Lead Ads.
//
// Ordem: env → Origin → body → autenticação (Bearer) → gate do MVP-1 (flag de
// review + company de teste) → RPC meta_leadgen_event_requeue COMO O USUÁRIO
// (o banco decide: Manager da company ou Super Admin com acesso; o evento
// precisa ser da company) → se requeued e a ingestão estiver ligada, agenda o
// processamento imediato (waitUntil, service_role). Sem ingestão ligada o
// evento fica received e o próximo sweep o processa.
//
// Resposta: só outcome e booleanos. Nunca IDs da Meta, PII, token ou erro bruto.
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import { isOriginAllowed, isValidUuid, jsonResponse, readJsonObjectBody, requireAuthenticatedActor } from '@/lib/server/invites/http';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';
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

  // MVP-1: a operação Lead Ads só existe para a company de teste.
  if (!isMetaIntegrationsReviewEnabled() || companyId !== META_TEST_COMPANY_ID) return fail(403, 'forbidden');

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
