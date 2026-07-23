// lib/invites/resendInviteRequest.ts — camada HTTP client-safe de REENVIO
// de convite (M1-F S4-F3). Mesmo molde de createInviteRequest.ts: roda
// inteiramente no browser, nunca importa lib/server/*, nunca confia
// cegamente em response.json(), nenhuma exceção lançada carrega token/
// Authorization/body.
//
// Único caminho de reenvio: POST /api/platform/invites/[id]/resend —
// nunca supabase.rpc('resend_invite', ...) direto do browser (a RPC é
// service_role-only desde m1f_s4a2a, revogada de authenticated — só o
// Route Handler, via createAdminClient(), pode chamá-la). O Route Handler
// já revalida autorização/elegibilidade inteiramente (reserve_resend_
// invite_rate_limit + resend_invite), este módulo nunca decide nada,
// só transporta a requisição e valida a forma da resposta.
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ResendInviteResult =
  | { outcome: 'ok'; inviteId: string; previousInviteId: string; status: string; deliveryStatus: string; expiresAt: string }
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  // code é o catálogo fechado de lib/server/invites/errors.ts (nunca
  // importado aqui — client-safe, o código chega como texto no corpo).
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

function parseRetryAfterSeconds(response: Response): number {
  const raw = response.headers.get('Retry-After');
  const parsed = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60;
}

// accessToken sempre resolvido pelo CHAMADOR (lib/hooks/useResendInvite.ts),
// nunca lido/persistido aqui. inviteId validado como UUID antes de montar a
// URL — defesa em profundidade, nunca a autoridade real (isValidUuid do
// próprio Route Handler é quem decide de verdade).
export async function resendInviteRequest(
  inviteId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<ResendInviteResult> {
  if (!UUID_PATTERN.test(inviteId)) {
    return { outcome: 'error' };
  }

  let response: Response;
  try {
    response = await fetch(`/api/platform/invites/${inviteId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal,
      body: '{}',
    });
  } catch {
    return { outcome: 'error' };
  }

  if (response.status === 429) {
    return { outcome: 'rate_limited', retryAfterSeconds: parseRetryAfterSeconds(response) };
  }

  const body = await readJsonSafely(response);
  if (!isPlainObject(body) || typeof body.success !== 'boolean' || typeof body.code !== 'string') {
    return { outcome: 'error' };
  }

  if (body.success !== true) {
    return { outcome: 'domain_error', code: body.code };
  }

  if (
    typeof body.invite_id !== 'string'
    || typeof body.previous_invite_id !== 'string'
    || typeof body.status !== 'string'
    || typeof body.delivery_status !== 'string'
    || typeof body.expires_at !== 'string'
  ) {
    return { outcome: 'error' };
  }

  return {
    outcome: 'ok',
    inviteId: body.invite_id,
    previousInviteId: body.previous_invite_id,
    status: body.status,
    deliveryStatus: body.delivery_status,
    expiresAt: body.expires_at,
  };
}
