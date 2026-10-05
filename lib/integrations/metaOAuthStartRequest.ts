// lib/integrations/metaOAuthStartRequest.ts — camada HTTP client-safe do
// início do fluxo OAuth Meta (META-OAUTH-REVIEW-UI). Mesmo molde de
// lib/users/emailRequest.ts: roda inteiramente no browser, nunca importa
// lib/server/*, nunca confia cegamente em response.json(), nenhuma exceção
// lançada carrega token/Authorization/body.
//
// Único caminho: POST /api/integrations/meta/oauth/start — nunca monta a
// URL de autorização da Meta no cliente, nunca lê META_APP_ID/config_id
// aqui. Este arquivo só encapsula a chamada e devolve a `authorizationUrl`
// pronta, para o chamador navegar o browser até ela.
export type StartMetaOAuthResult =
  | { outcome: 'ok'; authorizationUrl: string }
  // code é o catálogo fechado de app/api/integrations/meta/oauth/start/route.ts
  // (nunca importado aqui — este arquivo é client-safe).
  | { outcome: 'domain_error'; code: string }
  | { outcome: 'error' };

export type StartMetaOAuthFlow = 'review_ui';

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

// accessToken é sempre resolvido pelo CHAMADOR (nunca lido daqui). Body
// contém EXATAMENTE { company_id, flow? } — nenhum outro campo, mesmo
// quando o chamador tiver outros dados disponíveis.
export async function startMetaOAuthRequest(
  companyId: string,
  accessToken: string,
  flow?: StartMetaOAuthFlow,
  signal?: AbortSignal,
): Promise<StartMetaOAuthResult> {
  let response: Response;
  try {
    response = await fetch('/api/integrations/meta/oauth/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal,
      body: JSON.stringify(flow ? { company_id: companyId, flow } : { company_id: companyId }),
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

  if (typeof body.authorizationUrl !== 'string' || body.authorizationUrl === '') {
    return { outcome: 'error' };
  }

  return { outcome: 'ok', authorizationUrl: body.authorizationUrl };
}
