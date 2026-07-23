// tests/invites/resendInviteRequest.test.ts — camada HTTP client-safe de
// reenvio de convite (M1-F S4-F3). fetch mockado — nenhuma rede real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resendInviteRequest } from '@/lib/invites/resendInviteRequest';

const ACCESS_TOKEN = 'access-token-value';
const INVITE_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resendInviteRequest — validação local do id', () => {
  it('id que não é UUID: outcome error, nunca chama fetch', async () => {
    const result = await resendInviteRequest('nao-e-um-uuid', ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('resendInviteRequest — requisição', () => {
  it('POST /api/platform/invites/[id]/resend, Content-Type, Authorization Bearer, cache no-store, body vazio', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, {
      success: true, code: 'ok', invite_id: 'invite-new', previous_invite_id: INVITE_ID, status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
    }));

    await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);

    const [url, options] = (fetch as any).mock.calls[0];
    expect(url).toBe(`/api/platform/invites/${INVITE_ID}/resend`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(options.cache).toBe('no-store');
    expect(options.body).toBe('{}');
  });

  it('repassa AbortSignal quando fornecido', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, {
      success: true, code: 'ok', invite_id: 'invite-new', previous_invite_id: INVITE_ID, status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
    }));
    const controller = new AbortController();
    await resendInviteRequest(INVITE_ID, ACCESS_TOKEN, controller.signal);
    const [, options] = (fetch as any).mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });
});

describe('resendInviteRequest — sucesso', () => {
  it('201/200: outcome ok com inviteId/previousInviteId/status/deliveryStatus/expiresAt', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, {
      success: true, code: 'ok', invite_id: 'invite-new', previous_invite_id: INVITE_ID, status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
    }));

    const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);

    expect(result).toEqual({
      outcome: 'ok', inviteId: 'invite-new', previousInviteId: INVITE_ID, status: 'pending', deliveryStatus: 'sent', expiresAt: '2026-08-01T00:00:00Z',
    });
  });
});

describe('resendInviteRequest — rate limit', () => {
  it('429 com Retry-After: outcome rate_limited', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(429, { success: false, code: 'rate_limited' }, { 'Retry-After': '45' }));
    const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 45 });
  });

  it('429 sem Retry-After: fallback seguro (60)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(429, { success: false, code: 'rate_limited' }));
    const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 60 });
  });
});

describe('resendInviteRequest — erros de domínio', () => {
  const cases: Array<[number, string]> = [
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [403, 'invalid_origin'],
    [404, 'invite_not_found'],
    [409, 'invite_not_actionable'],
    [409, 'duplicate_pending'],
    [409, 'token_conflict'],
    [422, 'company_not_operational'],
    [502, 'delivery_failed'],
    [503, 'auth_unavailable'],
    [503, 'delivery_finalize_failed'],
    [500, 'internal_error'],
  ];

  for (const [status, code] of cases) {
    it(`${status} ${code}: outcome domain_error com o code exato`, async () => {
      (fetch as any).mockResolvedValue(jsonResponse(status, { success: false, code }));
      const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);
      expect(result).toEqual({ outcome: 'domain_error', code });
    });
  }
});

describe('resendInviteRequest — respostas malformadas ou inesperadas', () => {
  it('fetch lança (rede indisponível): outcome error', async () => {
    (fetch as any).mockRejectedValue(new Error('network down'));
    const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('corpo vazio: outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('', { status: 200 }));
    const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('success=true mas faltando previous_invite_id: outcome error', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { success: true, code: 'ok', invite_id: 'invite-new', status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z' }));
    const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });
});

describe('resendInviteRequest — segurança', () => {
  it('resposta nunca carrega token/hash/link, wrapper não expõe nada além do tipado', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, {
      success: true, code: 'ok', invite_id: 'invite-new', previous_invite_id: INVITE_ID, status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
      invite_token: 'leaked-token', token_hash: 'leaked-hash', redirect_to: 'https://x/convite/aceitar#leaked',
    }));
    const result = await resendInviteRequest(INVITE_ID, ACCESS_TOKEN);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/invite_token/);
    expect(serialized).not.toMatch(/token_hash/);
    expect(serialized).not.toMatch(/convite\/aceitar/);
    expect(serialized).not.toContain('leaked');
  });
});
