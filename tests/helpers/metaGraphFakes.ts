// META-MVP1 — respostas FAKE da Graph usadas pelos testes do callback OAuth.
// Nenhum token real: valores fixos de teste.

export function debugTokenResponse(
  appId: string,
  overrides: Partial<{ is_valid: boolean; type: string; app_id: string; expires_at: number; data_access_expires_at: number; profile_id: string }> = {},
): Response {
  return new Response(
    JSON.stringify({
      data: {
        app_id: appId,
        type: 'PAGE',
        is_valid: true,
        expires_at: 0,
        data_access_expires_at: 0,
        ...overrides,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

export function isDebugTokenUrl(url: URL): boolean {
  return url.pathname.endsWith('/debug_token');
}

export function isLongLivedExchangeUrl(url: URL): boolean {
  return url.pathname.endsWith('/oauth/access_token') && url.searchParams.get('grant_type') === 'fb_exchange_token';
}
