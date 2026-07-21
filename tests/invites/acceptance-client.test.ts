// tests/invites/acceptance-client.test.ts — camada HTTP client-safe para
// os endpoints públicos de convite (M1-F S4-C2B). fetch mockado — nenhuma
// rede real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateInvite, acceptInvite } from '@/lib/invites/acceptance-client';

const RAW_TOKEN = 'A'.repeat(43);
const ACCESS_TOKEN = 'access-token-value';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateInvite', () => {
  it('POST /api/invites/validate com Content-Type e cache no-store', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { valid: true, code: 'ok', masked_email: 'f***@x.com' }));

    await validateInvite(RAW_TOKEN);

    const [url, options] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/invites/validate');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.cache).toBe('no-store');
    expect(JSON.parse(options.body)).toEqual({ invite_token: RAW_TOKEN });
  });

  it('valid=true: devolve valid/code/maskedEmail', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { valid: true, code: 'ok', masked_email: 'f***@x.com' }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'ok', valid: true, code: 'ok', maskedEmail: 'f***@x.com' });
  });

  it('valid=false: maskedEmail sempre null mesmo que o corpo traga algo', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { valid: false, code: 'invite_expired', masked_email: 'vazamento@x.com' }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'ok', valid: false, code: 'invite_expired', maskedEmail: null });
  });

  it('429: outcome rate_limited com Retry-After', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(429, { valid: false, code: 'rate_limited', masked_email: null }, { 'Retry-After': '120' }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 120 });
  });

  it('429 sem Retry-After: usa fallback seguro (60)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(429, { valid: false, code: 'rate_limited', masked_email: null }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 60 });
  });

  it('corpo vazio (texto vazio) → outcome error, nunca lança', async () => {
    (fetch as any).mockResolvedValue(new Response('', { status: 200 }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('JSON inválido → outcome error, nunca lança', async () => {
    (fetch as any).mockResolvedValue(new Response('{not json', { status: 200 }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('HTML (proxy de erro) → outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 200 }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('array em vez de objeto → outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('[1,2,3]', { status: 200 }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('tipos incorretos (valid como string) → outcome error', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { valid: 'true', code: 'ok', masked_email: null }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('código desconhecido ainda é aceito (passthrough, não é uma enumeração fechada no cliente)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { valid: false, code: 'algum_codigo_novo', masked_email: null }));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'ok', valid: false, code: 'algum_codigo_novo', maskedEmail: null });
  });

  it('erro de rede (fetch rejeita) → outcome error, nunca lança', async () => {
    (fetch as any).mockRejectedValue(new Error('network down'));
    const result = await validateInvite(RAW_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('nunca inclui Authorization no validate', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { valid: true, code: 'ok', masked_email: 'f***@x.com' }));
    await validateInvite(RAW_TOKEN);
    const [, options] = (fetch as any).mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });
});

describe('acceptInvite', () => {
  it('POST /api/invites/accept com Authorization Bearer e Content-Type', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { success: true, code: 'ok', role_kind: 'seller' }));

    await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);

    const [url, options] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/invites/accept');
    expect(options.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.cache).toBe('no-store');
    expect(JSON.parse(options.body)).toEqual({ invite_token: RAW_TOKEN });
  });

  it('sucesso: devolve success/code/roleKind', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { success: true, code: 'ok', role_kind: 'manager' }));
    const result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'ok', success: true, code: 'ok', roleKind: 'manager' });
  });

  it('falha: roleKind sempre null mesmo que o corpo traga algo', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { success: false, code: 'membership_conflict', role_kind: 'seller' }));
    const result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'ok', success: false, code: 'membership_conflict', roleKind: null });
  });

  it('role_kind fora do catálogo → outcome error (falha fechado)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { success: true, code: 'ok', role_kind: 'ceo' }));
    const result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('429: outcome rate_limited com Retry-After', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(429, { success: false, code: 'rate_limited', role_kind: null }, { 'Retry-After': '45' }));
    const result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 45 });
  });

  it('tipos incorretos (success ausente) → outcome error', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { code: 'ok', role_kind: 'seller' }));
    const result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('erro de rede → outcome error, nunca lança, nunca inclui token/Authorization na exceção', async () => {
    (fetch as any).mockRejectedValue(new Error('network down'));
    let thrown: unknown = null;
    let result;
    try {
      result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    expect(result).toEqual({ outcome: 'error' });
  });

  it('JSON inválido → outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('not json at all', { status: 200 }));
    const result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('nenhuma resposta bruta (Response) é exposta ao chamador em nenhum outcome', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { success: true, code: 'ok', role_kind: 'seller' }));
    const result = await acceptInvite(RAW_TOKEN, ACCESS_TOKEN);
    expect(result).not.toHaveProperty('response');
    expect(result).not.toBeInstanceOf(Response);
  });
});
