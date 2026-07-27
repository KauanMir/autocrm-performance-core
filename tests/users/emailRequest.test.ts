// tests/users/emailRequest.test.ts — camada HTTP client-safe de alteração
// administrativa de e-mail (M1-F S5-E1-B). fetch mockado — nenhuma rede real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateUserEmailRequest } from '@/lib/users/emailRequest';

const ACCESS_TOKEN = 'access-token-value';
const PROFILE_ID = '123e4567-e89b-12d3-a456-426614174000';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('updateUserEmailRequest — requisição', () => {
  it('POST /api/admin/users/:profileId/email, Content-Type, Authorization Bearer, cache no-store', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { profileId: PROFILE_ID, email: 'novo@test.local' }));

    await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);

    const [url, options] = (fetch as any).mock.calls[0];
    expect(url).toBe(`/api/admin/users/${PROFILE_ID}/email`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(options.cache).toBe('no-store');
  });

  it('body contém exatamente email, nenhum campo extra', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { profileId: PROFILE_ID, email: 'novo@test.local' }));

    await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);

    const [, options] = (fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({ email: 'novo@test.local' });
    expect(Object.keys(body)).toEqual(['email']);
  });

  it('nunca envia companyId/role/platformRole/name/status/membershipId', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { profileId: PROFILE_ID, email: 'novo@test.local' }));
    await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    const [, options] = (fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.companyId).toBeUndefined();
    expect(body.role).toBeUndefined();
    expect(body.platformRole).toBeUndefined();
    expect(body.name).toBeUndefined();
    expect(body.status).toBeUndefined();
    expect(body.membershipId).toBeUndefined();
  });

  it('repassa AbortSignal quando fornecido', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { profileId: PROFILE_ID, email: 'novo@test.local' }));
    const controller = new AbortController();

    await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN, controller.signal);

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });
});

describe('updateUserEmailRequest — sucesso', () => {
  it('200: outcome ok com profileId/email', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { profileId: PROFILE_ID, email: 'novo@test.local' }));

    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);

    expect(result).toEqual({ outcome: 'ok', profileId: PROFILE_ID, email: 'novo@test.local' });
  });
});

describe('updateUserEmailRequest — erros de domínio', () => {
  const cases: Array<[number, string]> = [
    [400, 'invalid_body'],
    [400, 'invalid_email'],
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [403, 'invalid_origin'],
    [404, 'user_not_found'],
    [409, 'user_inactive'],
    [409, 'email_already_in_use'],
    [409, 'user_email_state_conflict'],
    [413, 'body_too_large'],
    [500, 'email_update_failed'],
    [500, 'internal_error'],
    [503, 'email_compensation_failed'],
  ];

  for (const [status, code] of cases) {
    it(`${status} ${code}: outcome domain_error com o code exato`, async () => {
      (fetch as any).mockResolvedValue(jsonResponse(status, { success: false, code }));
      const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
      expect(result).toEqual({ outcome: 'domain_error', code });
    });
  }
});

describe('updateUserEmailRequest — respostas malformadas ou inesperadas', () => {
  it('fetch lança (rede indisponível): outcome error, nunca propaga a exceção', async () => {
    (fetch as any).mockRejectedValue(new Error('network down'));
    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('corpo vazio: outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('', { status: 200 }));
    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('corpo não é JSON válido: outcome error', async () => {
    (fetch as any).mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('200 mas faltando email: outcome error (nunca confia cegamente no shape)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { profileId: PROFILE_ID }));
    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('200 mas faltando profileId: outcome error', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { email: 'novo@test.local' }));
    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('success=false sem code: outcome error', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(400, { success: false }));
    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    expect(result).toEqual({ outcome: 'error' });
  });
});

describe('updateUserEmailRequest — segurança', () => {
  it('nunca acessa supabase.auth.admin (nenhuma importação de service role neste arquivo)', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, { profileId: PROFILE_ID, email: 'novo@test.local' }));
    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/service_role|SERVICE_ROLE/i);
  });

  it('resposta com campos extras (ex.: user Auth completo) nunca vaza além do tipado', async () => {
    (fetch as any).mockResolvedValue(jsonResponse(200, {
      profileId: PROFILE_ID,
      email: 'novo@test.local',
      user: { id: PROFILE_ID, app_metadata: {}, identities: [] },
      access_token: 'leaked-token',
    }));

    const result = await updateUserEmailRequest(PROFILE_ID, 'novo@test.local', ACCESS_TOKEN);

    expect(result).toEqual({ outcome: 'ok', profileId: PROFILE_ID, email: 'novo@test.local' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/leaked-token/);
    expect(serialized).not.toMatch(/identities/);
  });
});
