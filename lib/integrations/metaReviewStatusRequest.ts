// lib/integrations/metaReviewStatusRequest.ts — camada HTTP client-safe da
// verificação do resultado do fluxo review_ui (META-OAUTH-REVIEW-UI). Mesmo
// molde de metaOAuthStartRequest.ts. Único caminho: GET
// /api/integrations/meta/oauth/review-status?token=... — o token vem
// EXATAMENTE da querystring que o callback devolveu (nunca gerado/adivinhado
// no cliente).
export type MetaReviewStatusResult =
  | {
      outcome: 'ok';
      reviewOutcome: 'success';
      persisted: boolean;
      stage: string;
      page: { matched: boolean; advertiseTaskPresent: boolean; readEngagementVerified: boolean };
      pageSubscription: { verified: boolean; field: string };
    }
  | { outcome: 'ok'; reviewOutcome: 'failure'; failureCode: string }
  | { outcome: 'domain_error'; code: string }
  | { outcome: 'error' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonSafely(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchMetaReviewStatusRequest(
  token: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<MetaReviewStatusResult> {
  let response: Response;
  try {
    response = await fetch(`/api/integrations/meta/oauth/review-status?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal,
    });
  } catch {
    return { outcome: 'error' };
  }

  const body = await readJsonSafely(response);
  if (!isPlainObject(body)) {
    return { outcome: 'error' };
  }

  if (body.ok === false) {
    if (typeof body.error !== 'string') {
      return { outcome: 'error' };
    }
    return { outcome: 'domain_error', code: body.error };
  }

  if (body.outcome === 'failure') {
    if (typeof body.failureCode !== 'string') {
      return { outcome: 'error' };
    }
    return { outcome: 'ok', reviewOutcome: 'failure', failureCode: body.failureCode };
  }

  const page = body.page;
  const pageSubscription = body.pageSubscription;
  if (
    typeof body.stage !== 'string' ||
    !isPlainObject(page) ||
    typeof page.matched !== 'boolean' ||
    typeof page.advertiseTaskPresent !== 'boolean' ||
    typeof page.readEngagementVerified !== 'boolean' ||
    !isPlainObject(pageSubscription) ||
    typeof pageSubscription.verified !== 'boolean' ||
    typeof pageSubscription.field !== 'string'
  ) {
    return { outcome: 'error' };
  }

  return {
    outcome: 'ok',
    reviewOutcome: 'success',
    persisted: body.persisted === true,
    stage: body.stage,
    page: {
      matched: page.matched,
      advertiseTaskPresent: page.advertiseTaskPresent,
      readEngagementVerified: page.readEngagementVerified,
    },
    pageSubscription: { verified: pageSubscription.verified, field: pageSubscription.field },
  };
}
