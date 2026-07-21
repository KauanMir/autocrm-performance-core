// tests/api/invites/invites.validate.test.ts — Route Handler PÚBLICO de
// validação de convite (M1-F S4-C2A). createAdminClient mockado — nenhuma
// rede real, nenhum Supabase local necessário.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { POST } from '@/app/api/invites/validate/route';

const APP_URL = 'http://127.0.0.1:3000';
const PEPPER = 'a'.repeat(64);
const VALID_TOKEN = 'A'.repeat(43);

function makeAdmin(opts: {
  reserveResponse?: { data: unknown; error: unknown };
  validateResponse?: { data: unknown; error: unknown };
}) {
  const reserveResponse = opts.reserveResponse ?? { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
  const validateResponse = opts.validateResponse ?? { data: [{ valid: true, code: 'ok', masked_email: 'f***@x.com' }], error: null };

  const rpc = vi.fn((name: string) => {
    if (name === 'reserve_invite_validation_rate_limit') {
      return Promise.resolve(reserveResponse);
    }
    if (name === 'validate_invite_token') {
      return Promise.resolve(validateResponse);
    }
    throw new Error(`unexpected rpc: ${name}`);
  });

  return { rpc };
}

function makeRequest(opts: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request('http://127.0.0.1:3000/api/invites/validate', {
    method: 'POST',
    body: opts.body ?? JSON.stringify({ invite_token: VALID_TOKEN }),
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
}

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', PEPPER);
  mocks.createAdminClient.mockReturnValue(makeAdmin({}));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/invites/validate', () => {
  it('403 Origin divergente', async () => {
    const response = await POST(makeRequest({ headers: { Origin: 'https://evil.example.com' } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ valid: false, code: 'invalid_origin', masked_email: null });
  });

  it('Origin ausente é aceito', async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
  });

  it('Origin igual a APP_URL é aceito', async () => {
    const response = await POST(makeRequest({ headers: { Origin: APP_URL } }));
    expect(response.status).toBe(200);
  });

  it('400 Content-Type diferente de application/json', async () => {
    const response = await POST(makeRequest({ headers: { 'Content-Type': 'text/plain' } }));
    expect(response.status).toBe(400);
  });

  it('400 JSON inválido', async () => {
    const response = await POST(makeRequest({ body: '{not json' }));
    expect(response.status).toBe(400);
  });

  it('400 array em vez de objeto', async () => {
    const response = await POST(makeRequest({ body: '[1,2,3]' }));
    expect(response.status).toBe(400);
  });

  it('400 body null', async () => {
    const response = await POST(makeRequest({ body: 'null' }));
    expect(response.status).toBe(400);
  });

  it('400 chave __proto__ (prototype pollution)', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ __proto__: { x: 1 } }) }));
    expect(response.status).toBe(400);
  });

  it('400 chave extra além de invite_token', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: VALID_TOKEN, extra: 1 }) }));
    expect(response.status).toBe(400);
  });

  it('413 body maior que 16 KiB', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: 'x'.repeat(20000) }) }));
    expect(response.status).toBe(413);
  });

  it('400 invite_token ausente', async () => {
    const response = await POST(makeRequest({ body: '{}' }));
    expect(response.status).toBe(400);
  });

  it('400 invite_token curto (42 caracteres)', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: 'a'.repeat(42) }) }));
    expect(response.status).toBe(400);
  });

  it('400 invite_token longo (44 caracteres)', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: 'a'.repeat(44) }) }));
    expect(response.status).toBe(400);
  });

  it('400 invite_token com padding "="', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: `${'a'.repeat(42)}=` }) }));
    expect(response.status).toBe(400);
  });

  it('400 invite_token com caractere inválido', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: `${'a'.repeat(42)}+` }) }));
    expect(response.status).toBe(400);
  });

  it('invite_token válido: reserve chamado ANTES de validate, com o SHA-256 correto e o hash de IP correto', async () => {
    const admin = makeAdmin({});
    mocks.createAdminClient.mockReturnValue(admin);

    const { hashInviteToken } = await import('@/lib/server/invites/token');
    const { hashIp } = await import('@/lib/server/invites/ip');
    const expectedTokenHash = hashInviteToken(VALID_TOKEN);
    const expectedIpHash = hashIp('unknown-local-sentinel', Buffer.from(PEPPER, 'hex'));

    await POST(makeRequest());

    const calls = admin.rpc.mock.calls;
    expect(calls[0][0]).toBe('reserve_invite_validation_rate_limit');
    expect(calls[0][1]).toEqual({ p_ip_hash: expectedIpHash, p_token_hash: expectedTokenHash });
    expect(calls[1][0]).toBe('validate_invite_token');
    expect(calls[1][1]).toEqual({ p_token_hash: expectedTokenHash });
  });

  it('rate limited: NUNCA chama validate_invite_token, devolve 429 + Retry-After, sem contagem no corpo', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: [{ allowed: false, code: 'ip_rate_limited', retry_after_seconds: 300 }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('300');
    expect(await response.json()).toEqual({ valid: false, code: 'rate_limited', masked_email: null });
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'validate_invite_token')).toBe(false);
  });

  it('valid=true: 200 com masked_email', async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true, code: 'ok', masked_email: 'f***@x.com' });
  });

  it.each([
    'invite_not_found',
    'invite_expired',
    'invite_not_actionable',
    'invite_already_used',
    'company_not_operational',
  ])('valid=false (%s): HTTP 200, masked_email sempre null', async (code) => {
    mocks.createAdminClient.mockReturnValue(
      makeAdmin({ validateResponse: { data: [{ valid: false, code, masked_email: null }], error: null } }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false, code, masked_email: null });
  });

  it('erro de transporte na RPC admin → 503, sem vazar detalhe', async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdmin({ reserveResponse: { data: null, error: { message: 'boom' } } }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ valid: false, code: 'internal_error', masked_email: null });
  });

  it('pepper ausente → 500 seguro, nunca crash não tratado', async () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', '');
    const response = await POST(makeRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ valid: false, code: 'internal_error', masked_email: null });
  });

  it('nenhuma chamada de Auth (getUser/signInWithOtp/verifyOtp) e nenhum accept_invite', async () => {
    const admin = makeAdmin({});
    mocks.createAdminClient.mockReturnValue(admin);

    await POST(makeRequest());

    expect(admin.rpc.mock.calls.some((c) => c[0] === 'accept_invite')).toBe(false);
    expect((admin as any).auth).toBeUndefined();
  });

  it('resposta nunca contém token/hash/IP/invite_id/company_id/role_kind/e-mail completo', async () => {
    const response = await POST(makeRequest());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(Object.keys(body).sort()).toEqual(['code', 'masked_email', 'valid']);
    expect(serialized).not.toMatch(VALID_TOKEN);
    expect(serialized).not.toMatch(/token_hash/);
    expect(serialized).not.toMatch(/invite_id/);
    expect(serialized).not.toMatch(/company_id/);
    expect(serialized).not.toMatch(/role_kind/);
  });

  it('resposta tem Cache-Control: no-store', async () => {
    const response = await POST(makeRequest());
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('nenhum segredo/token/IP aparece nos logs (console.log/console.error)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await POST(makeRequest({ headers: { 'x-forwarded-for': '203.0.113.10' } }));

    const allLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join('\n');
    expect(allLogged).not.toContain(VALID_TOKEN);
    expect(allLogged).not.toContain('203.0.113.10');
    expect(allLogged).not.toContain(PEPPER);
  });
});
