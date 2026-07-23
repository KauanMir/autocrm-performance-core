// lib/invites/createInviteRequest.ts — camada HTTP client-safe de CRIAÇÃO
// de convite (M1-F S4-F2). Mesmo molde de lib/invites/acceptance-client.ts:
// roda inteiramente no browser, nunca importa lib/server/*, nunca confia
// cegamente em response.json() (valida shape/tipo antes de expor qualquer
// campo), nenhuma exceção lançada carrega token/Authorization/body.
//
// Único caminho de criação, por design (S4-F1/S4-F2): POST
// /api/platform/invites — nunca supabase.rpc('create_invite', ...) direto
// do browser (a RPC é service_role-only desde m1f_s4a2a, revogada de
// authenticated), nunca supabase.auth.admin.* (Admin API só existe no
// Route Handler, via createAdminClient()). Isto preserva a separação já
// estabelecida em lib/invites/repository.ts: leitura via PostgREST/RLS
// (fetchInvites) fica lá; criação via Route Handler fica aqui.
export type CreateInviteRoleKind = 'super_admin' | 'manager' | 'seller';

export type CreateInvitePayload = {
  companyId: string | null;
  email: string;
  name: string;
  roleKind: CreateInviteRoleKind;
};

export type CreateInviteResult =
  | { outcome: 'ok'; inviteId: string; status: string; deliveryStatus: string; expiresAt: string }
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  // code é o catálogo fechado de lib/server/invites/errors.ts (nunca
  // importado aqui — este arquivo é client-safe, o código chega como texto
  // no corpo da resposta, exatamente como acceptance-client.ts trata
  // ValidateInviteResult/AcceptInviteResult).
  | { outcome: 'domain_error'; code: string }
  | { outcome: 'error' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Nunca response.json() direto — corpo vazio, HTML de erro de proxy, ou
// JSON malformado nunca lançam, só devolvem null (tratado como forma
// inesperada pelo chamador).
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

// accessToken é sempre resolvido pelo CHAMADOR (lib/hooks/useCreateInvite.ts
// — via getAccessToken() injetado, nunca lido daqui) e nunca persiste neste
// módulo. signal é opcional — quando fornecido, permite ao chamador
// cancelar/ignorar uma requisição em voo (ex.: modal fechado, identidade
// trocou).
export async function createInviteRequest(
  payload: CreateInvitePayload,
  accessToken: string,
  signal?: AbortSignal,
): Promise<CreateInviteResult> {
  let response: Response;
  try {
    response = await fetch('/api/platform/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal,
      body: JSON.stringify({
        company_id: payload.companyId,
        email: payload.email,
        name: payload.name,
        role_kind: payload.roleKind,
      }),
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
    || typeof body.status !== 'string'
    || typeof body.delivery_status !== 'string'
    || typeof body.expires_at !== 'string'
  ) {
    return { outcome: 'error' };
  }

  return {
    outcome: 'ok',
    inviteId: body.invite_id,
    status: body.status,
    deliveryStatus: body.delivery_status,
    expiresAt: body.expires_at,
  };
}
