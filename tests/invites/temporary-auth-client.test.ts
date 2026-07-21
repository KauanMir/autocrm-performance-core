// tests/invites/temporary-auth-client.test.ts — fábrica do cliente Auth
// temporário do fluxo de aceite de convite (M1-F S4-C2B). Confirma
// configuração (nunca persiste/refresca/lê a URL) e que cada chamada
// devolve uma instância nova, nunca singleton.
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}));

import { createTemporaryInviteAuthClient } from '@/lib/invites/temporary-auth-client';

describe('createTemporaryInviteAuthClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.createClient.mockReset();
  });

  it('usa NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (mesmas do cliente principal)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-value');
    mocks.createClient.mockReturnValue({ auth: {} });

    createTemporaryInviteAuthClient();

    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key-value',
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        }),
      }),
    );
  });

  it('persistSession=false', () => {
    mocks.createClient.mockReturnValue({ auth: {} });
    createTemporaryInviteAuthClient();
    const config = mocks.createClient.mock.calls[0][2];
    expect(config.auth.persistSession).toBe(false);
  });

  it('autoRefreshToken=false', () => {
    mocks.createClient.mockReturnValue({ auth: {} });
    createTemporaryInviteAuthClient();
    const config = mocks.createClient.mock.calls[0][2];
    expect(config.auth.autoRefreshToken).toBe(false);
  });

  it('detectSessionInUrl=false', () => {
    mocks.createClient.mockReturnValue({ auth: {} });
    createTemporaryInviteAuthClient();
    const config = mocks.createClient.mock.calls[0][2];
    expect(config.auth.detectSessionInUrl).toBe(false);
  });

  it('nenhuma configuração de storage persistente customizado', () => {
    mocks.createClient.mockReturnValue({ auth: {} });
    createTemporaryInviteAuthClient();
    const config = mocks.createClient.mock.calls[0][2];
    expect(config.auth.storage).toBeUndefined();
  });

  it('cria uma NOVA instância a cada chamada — nunca singleton', () => {
    mocks.createClient.mockReturnValueOnce({ auth: {}, id: 'first' }).mockReturnValueOnce({ auth: {}, id: 'second' });

    const first = createTemporaryInviteAuthClient();
    const second = createTemporaryInviteAuthClient();

    expect(mocks.createClient).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });

  it('não usa nenhuma variável de service_role/Admin API', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-value');
    mocks.createClient.mockReturnValue({ auth: {} });

    createTemporaryInviteAuthClient();

    const args = JSON.stringify(mocks.createClient.mock.calls[0]);
    expect(args).not.toMatch(/service_role/i);
    expect(args).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('funciona (não lança) mesmo sem env vars configuradas — usa fallback sintaticamente válido', () => {
    mocks.createClient.mockReturnValue({ auth: {} });
    expect(() => createTemporaryInviteAuthClient()).not.toThrow();
  });
});
