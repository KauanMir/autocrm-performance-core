// POST /api/integrations/meta/leadgen-review/unrouted-adopt — META-MVP2.
// O Super Admin libera para a empresa aberta os eventos retidos de uma Página.
//
// Ordem: env → Origin → body → autenticação (Bearer) → flag de Integrações →
// RPC meta_leadgen_unrouted_adopt COMO O USUÁRIO (o banco exige Super Admin, a
// Página conectada nesta empresa, a empresa habilitada e nenhuma outra dona) →
// se liberou e a ingestão está ligada, agenda um sweep.
//
// Resposta: só outcome, contagens e booleano. Nunca IDs da Meta ou erro bruto.
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import { isOriginAllowed, isValidUuid, jsonResponse, readJsonObjectBody, requireAuthenticatedActor } from '@/lib/server/invites/http';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';
import { isMetaLeadIngestionEnabled } from '@/lib/server/meta-webhook/env';
import { scheduleUnroutedAdoptionSweep } from '@/lib/server/meta-webhook/schedule-leadgen-processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_BODY_KEYS = ['company_id', 'page_id'] as const;
const PAGE_ID_PATTERN = /^[0-9]{1,30}$/;
const OUTCOMES = ['adopted', 'nothing_pending', 'not_connected', 'company_disabled', 'owner_conflict'] as const;
type AdoptOutcome = (typeof OUTCOMES)[number];

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
  const pageId = body.value.page_id;
  if (typeof companyId !== 'string' || !isValidUuid(companyId) || typeof pageId !== 'string' || !PAGE_ID_PATTERN.test(pageId)) {
    return fail(400, 'invalid_body');
  }

  const actor = await requireAuthenticatedActor(request);
  if (actor.ok === false) return fail(401, 'unauthenticated');
  if (!isMetaIntegrationsReviewEnabled()) return fail(403, 'forbidden');

  let data: unknown;
  let error: { message?: string } | null;
  try {
    ({ data, error } = await actor.client.rpc('meta_leadgen_unrouted_adopt', { p_company_id: companyId, p_page_id: pageId }));
  } catch {
    return fail(503, 'unavailable');
  }
  if (error) return fail(error.message === 'forbidden' ? 403 : 503, error.message === 'forbidden' ? 'forbidden' : 'unavailable');

  const row = Array.isArray(data) && data.length === 1
    ? (data[0] as { out_outcome?: unknown; out_adopted?: unknown; out_already_registered?: unknown })
    : null;
  const outcome = row && (OUTCOMES as readonly string[]).includes(String(row.out_outcome)) ? (row.out_outcome as AdoptOutcome) : null;
  if (outcome === null) return fail(503, 'unavailable');

  const adopted = typeof row?.out_adopted === 'number' ? row.out_adopted : 0;
  let processingScheduled = false;
  if (adopted > 0 && isMetaLeadIngestionEnabled()) {
    scheduleUnroutedAdoptionSweep();
    processingScheduled = true;
  }
  return jsonResponse(200, { ok: true, outcome, adopted, processingScheduled });
}
