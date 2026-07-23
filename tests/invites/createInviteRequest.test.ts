// tests/invites/createInviteRequest.test.ts — camada HTTP client-safe de
// criação de convite (M1-F S4-F2). fetch mockado — nenhuma rede real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInviteRequest } from '@/lib/invites/createInviteRequest';

const ACCESS_TOKEN = 'access-token-value';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function payload(overrides: Partial<Parameters<typeof createInviteRequest>[0]> = {}) {
  return {
    companyId: 'company-a',
    email: 'convidado@test.local',
    name: 'Convidado',
    roleKind: 'seller' as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createInviteRequest — requisição', () => {
  it('POST /api/platform/invites, Content-Type, Authorization Bearer, cache no-store', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(201, {
      success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
    }));

    await createInviteRequest(payload(), ACCESS_TOKEN);

    const [url, options] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/platform/invites');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(options.cache).toBe('no-store');
  });

  it('body contém exatamente company_id/email/name/role_kind, nenhum campo extra', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(201, {
      success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
    }));

    await createInviteRequest(payload({ companyId: null, roleKind: 'super_admin' }), ACCESS_TOKEN);

    const [, options] = (fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({ company_id: null, email: 'convidado@test.local', name: 'Convidado', role_kind: 'super_admin' });
    expect(Object.keys(body).sort()).toEqual(['company_id', 'email', 'name', 'role_kind']);
  });

  it('repassa AbortSignal quando fornecido', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(201, {
      success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
    }));
    const controller = new AbortController();

    await createInviteRequest(payload(), ACCESS_TOKEN, controller.signal);

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });
});

describe('createInviteRequest — sucesso', () => {
  it('201: outcome ok com inviteId/status/deliveryStatus/expiresAt', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(201, {
      success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
    }));

    const result = await createInviteRequest(payload(), ACCESS_TOKEN);

    expect(result).toEqual({
      outcome: 'ok', inviteId: 'invite-1', status: 'pending', deliveryStatus: 'sent', expiresAt: '2026-08-01T00:00:00Z',
    });
  });
});

describe('createInviteRequest — rate limit', () => {
  it('429 com Retry-After: outcome rate_limited', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(429, { success: false, code: 'rate_limited' }, { 'Retry-After': '90' }));

    const result = await createInviteRequest(payload(), ACCESS_TOKEN);

    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 90 });
  });

  it('429 sem Retry-After: usa fallback seguro (60)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(429, { success: false, code: 'rate_limited' }));

    const result = await createInviteRequest(payload(), ACCESS_TOKEN);

    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 60 });
  });
});

describe('createInviteRequest — erros de domínio', () => {
  const cases: Array<[number, string]> = [
    [400, 'invalid_body'],
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [403, 'invalid_origin'],
    [409, 'duplicate_pending'],
    [409, 'already_member'],
    [409, 'not_eligible'],
    [409, 'token_conflict'],
    [413, 'body_too_large'],
    [422, 'invalid_role'],
    [422, 'invalid_company'],
    [422, 'company_not_operational'],
    [502, 'delivery_failed'],
    [503, 'auth_unavailable'],
    [503, 'delivery_finalize_failed'],
    [500, 'internal_error'],
  ];

  for (const [status, code] of cases) {
    it(`${status} ${code}: outcome domain_error com o code exato`, async () => {
      (fetch as any).mockResolvedValue(jsonResponse(status, { success: false, code }));
      const result = await createInviteRequest(payload(), ACCESS_TOKEN);
      expect(result).toEqual({ outcome: 'domain_error', code });
    });
  }
});

describe('createInviteRequest — respostas malformadas ou inesperadas', () => {
  it('fetch lança (rede indisponível): outcome error, nunca propaga a exceção', async () => {
    (fetch as any).mockRejectedValue(new Error('network down'));
    const result = await createInviteRequest(payload(), ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('corpo vazio: outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('', { status: 201 }));
    const result = await createInviteRequest(payload(), ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('corpo não é JSON válido: outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('<html>not json</html>', { status: 201 }));
    const result = await createInviteRequest(payload(), ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('success=true mas faltando invite_id: outcome error (nunca confia cegamente no shape)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(201, { success: true, code: 'ok', status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z' }));
    const result = await createInviteRequest(payload(), ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('sem campo success: outcome error', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(201, { code: 'ok' }));
    const result = await createInviteRequest(payload(), ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });
});

describe('createInviteRequest — segurança', () => {
  it('resposta de sucesso nunca carrega token/hash/link, e o wrapper não expõe nada além do tipado', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(201, {
      success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', delivery_status: 'sent', expires_at: '2026-08-01T00:00:00Z',
      invite_token: 'leaked-token', token_hash: 'leaked-hash', redirect_to: 'https://x/convite/aceitar#leaked',
    }));

    const result = await createInviteRequest(payload(), ACCESS_TOKEN);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/invite_token/);
    expect(serialized).not.toMatch(/token_hash/);
    expect(serialized).not.toMatch(/convite\/aceitar/);
    expect(serialized).not.toContain('leaked');
  });
});
