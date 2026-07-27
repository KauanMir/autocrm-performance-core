// lib/users/emailRequest.ts — camada HTTP client-safe de ALTERAÇÃO
// administrativa de e-mail (M1-F S5-E1-B). Mesmo molde de
// lib/invites/createInviteRequest.ts: roda inteiramente no browser, nunca
// importa lib/server/*, nunca confia cegamente em response.json() (valida
// shape/tipo antes de expor qualquer campo), nenhuma exceção lançada carrega
// token/Authorization/body.
//
// Único caminho de alteração, por design (S5-E1-A): POST
// /api/admin/users/[profileId]/email — nunca supabase.auth.admin.*
// diretamente do browser (a service_role key nunca existe no bundle
// client-side), nunca update direto em profiles/auth.users. O Route Handler
// já publicado é a única superfície — este arquivo só encapsula a chamada.
export type UpdateUserEmailResult =
  | { outcome: 'ok'; profileId: string; email: string }
  // code é o catálogo fechado de lib/server/users/errors.ts (nunca
  // importado aqui — este arquivo é client-safe, o código chega como texto
  // no corpo da resposta, exatamente como createInviteRequest.ts trata
  // CreateInviteResult).
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

// accessToken é sempre resolvido pelo CHAMADOR (lib/hooks/useUpdateUserEmail.ts
// — via getAccessToken() injetado, nunca lido daqui) e nunca persiste neste
// módulo. signal é opcional — permite ao chamador cancelar/ignorar uma
// requisição em voo (ex.: modal fechado, identidade trocou). Body contém
// EXATAMENTE { email } — nenhum companyId/role/platformRole/name/status/
// membershipId, mesmo quando o chamador tiver esses dados disponíveis.
export async function updateUserEmailRequest(
  profileId: string,
  email: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<UpdateUserEmailResult> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/users/${profileId}/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal,
      body: JSON.stringify({ email }),
    });
  } catch {
    return { outcome: 'error' };
  }

  const body = await readJsonSafely(response);
  if (!isPlainObject(body)) {
    return { outcome: 'error' };
  }

  if (body.success === false) {
    if (typeof body.code !== 'string') {
      return { outcome: 'error' };
    }
    return { outcome: 'domain_error', code: body.code };
  }

  if (typeof body.profileId !== 'string' || typeof body.email !== 'string') {
    return { outcome: 'error' };
  }

  return { outcome: 'ok', profileId: body.profileId, email: body.email };
}
