// tests/server/invites/http.test.ts — proteção HTTP comum aos Route
// Handlers de convites (M1-F S4-A2B, design §13/§14). Nenhuma rede real:
// createUserScopedClient é mockado.
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createUserScopedClient: vi.fn(),
}));

vi.mock('@/lib/server/supabase/user-token-client', () => ({
  createUserScopedClient: mocks.createUserScopedClient,
}));

import {
  readJsonObjectBody,
  isOriginAllowed,
  requireAuthenticatedActor,
  jsonResponse,
  errorResponse,
  isValidUuid,
  MAX_BODY_BYTES,
} from '@/lib/server/invites/http';

const ALLOWED_KEYS = ['company_id', 'email', 'name', 'role_kind'] as const;

function requestWithBody(body: string): Request {
  return new Request('http://127.0.0.1:3000/api/platform/invites', {
    method: 'POST',
    body,
  });
}

describe('readJsonObjectBody', () => {
  it('aceita um objeto válido com exatamente as chaves permitidas', async () => {
    const result = await readJsonObjectBody(
      requestWithBody(JSON.stringify({ company_id: null, email: 'a@b.com', name: 'A', role_kind: 'seller' })),
      ALLOWED_KEYS,
    );
    expect(result.ok).toBe(true);
  });

  it('corpo vazio vira {} (usado pelo resend)', async () => {
    const result = await readJsonObjectBody(requestWithBody(''), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it('rejeita corpo maior que 16 KiB com body_too_large', async () => {
    const huge = 'x'.repeat(MAX_BODY_BYTES + 1);
    const result = await readJsonObjectBody(requestWithBody(huge), ALLOWED_KEYS);
    expect(result).toEqual({ ok: false, error: 'body_too_large' });
  });

  it('rejeita JSON inválido com invalid_body', async () => {
    const result = await readJsonObjectBody(requestWithBody('{not json'), ALLOWED_KEYS);
    expect(result).toEqual({ ok: false, error: 'invalid_body' });
  });

  it('rejeita array com invalid_body', async () => {
    const result = await readJsonObjectBody(requestWithBody('[1,2,3]'), ALLOWED_KEYS);
    expect(result).toEqual({ ok: false, error: 'invalid_body' });
  });

  it('rejeita campo inesperado com invalid_body', async () => {
    const result = await readJsonObjectBody(
      requestWithBody(JSON.stringify({ company_id: null, email: 'a@b.com', name: 'A', role_kind: 'seller', extra: 1 })),
      ALLOWED_KEYS,
    );
    expect(result).toEqual({ ok: false, error: 'invalid_body' });
  });

  it('rejeita __proto__ como chave (prototype pollution)', async () => {
    const result = await readJsonObjectBody(requestWithBody('{"__proto__":{"a":1}}'), ['__proto__']);
    expect(result).toEqual({ ok: false, error: 'invalid_body' });
  });

  it('rejeita constructor como chave (prototype pollution)', async () => {
    const result = await readJsonObjectBody(requestWithBody('{"constructor":{}}'), ['constructor']);
    expect(result).toEqual({ ok: false, error: 'invalid_body' });
  });

  it('rejeita prototype como chave (prototype pollution)', async () => {
    const result = await readJsonObjectBody(requestWithBody('{"prototype":{}}'), ['prototype']);
    expect(result).toEqual({ ok: false, error: 'invalid_body' });
  });
});

describe('isOriginAllowed', () => {
  const appUrl = new URL('http://127.0.0.1:3000');

  it('aceita quando Origin está ausente (clientes não-browser/testes)', () => {
    const request = new Request('http://127.0.0.1:3000/api/x');
    expect(isOriginAllowed(request, appUrl)).toBe(true);
  });

  it('aceita quando Origin bate exatamente com APP_URL', () => {
    const request = new Request('http://127.0.0.1:3000/api/x', {
      headers: { Origin: 'http://127.0.0.1:3000' },
    });
    expect(isOriginAllowed(request, appUrl)).toBe(true);
  });

  it('rejeita quando Origin diverge', () => {
    const request = new Request('http://127.0.0.1:3000/api/x', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(isOriginAllowed(request, appUrl)).toBe(false);
  });
});

describe('requireAuthenticatedActor', () => {
  it('rejeita Authorization ausente', async () => {
    const request = new Request('http://127.0.0.1:3000/api/x');
    const result = await requireAuthenticatedActor(request);
    expect(result).toEqual({ ok: false });
  });

  it('rejeita header mal formado (sem "Bearer ")', async () => {
    const request = new Request('http://127.0.0.1:3000/api/x', {
      headers: { Authorization: 'Token abc123' },
    });
    const result = await requireAuthenticatedActor(request);
    expect(result).toEqual({ ok: false });
  });

  it('rejeita "Bearer" sem token', async () => {
    const request = new Request('http://127.0.0.1:3000/api/x', {
      headers: { Authorization: 'Bearer ' },
    });
    const result = await requireAuthenticatedActor(request);
    expect(result).toEqual({ ok: false });
  });

  it('rejeita JWT que getUser recusa', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    mocks.createUserScopedClient.mockReturnValue({ auth: { getUser } });

    const request = new Request('http://127.0.0.1:3000/api/x', {
      headers: { Authorization: 'Bearer bad-jwt' },
    });
    const result = await requireAuthenticatedActor(request);

    expect(result).toEqual({ ok: false });
    expect(getUser).toHaveBeenCalledWith('bad-jwt');
  });

  it('aceita JWT válido e devolve profileId + client escopado', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'profile-123' } }, error: null });
    const fakeClient = { auth: { getUser } };
    mocks.createUserScopedClient.mockReturnValue(fakeClient);

    const request = new Request('http://127.0.0.1:3000/api/x', {
      headers: { Authorization: 'Bearer good-jwt' },
    });
    const result = await requireAuthenticatedActor(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.profileId).toBe('profile-123');
      expect(result.client).toBe(fakeClient);
      expect(result.jwt).toBe('good-jwt');
    }
    expect(mocks.createUserScopedClient).toHaveBeenCalledWith('good-jwt');
  });
});

describe('errorResponse / jsonResponse', () => {
  it('errorResponse define status conforme o catálogo e nunca reflete texto interno', async () => {
    const response = errorResponse('rate_limited', { retryAfterSeconds: 42 });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = await response.json();
    expect(body).toEqual({ success: false, code: 'rate_limited' });
  });

  it('jsonResponse nunca expõe cache (Cache-Control: no-store sempre presente)', () => {
    const response = jsonResponse(201, { success: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('isValidUuid', () => {
  it('aceita um UUID bem formado', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('rejeita string que não é UUID', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('123')).toBe(false);
    expect(isValidUuid('')).toBe(false);
  });
});
