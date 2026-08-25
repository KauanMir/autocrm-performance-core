// Testes de useActivateCompany (PLATFORM-COMPANY-ACTIVATION-A1).
// Supabase mockado (rpc), QueryClient novo por teste, sem rede/snapshots.
// Mesmo padrão estrutural de tests/hooks/useCreateCompany.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useActivateCompany,
  getActivateCompanyErrorMessage,
  ACTIVATE_COMPANY_LOCAL_ERRORS,
} from '@/lib/hooks/useActivateCompany';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { resetQueryCache } from '@/lib/query/resetQueryCache';
import { PlatformCompanyError } from '@/lib/companies/errors';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const TARGET: PlatformCompanyRow = {
  id: 'company-1',
  name: 'Rcar Seminovos Gama',
  trade_name: null,
  cnpj: null,
  phone: null,
  timezone: 'America/Sao_Paulo',
  status: 'implantacao',
  created_at: '2026-08-01T10:00:00+00:00',
  logo_path: null,
};

const ACTIVATED: PlatformCompanyRow = { ...TARGET, status: 'ativa' };

const KEY_A = platformCompanyQueryKeys.list('user-a');
const KEY_B = platformCompanyQueryKeys.list('user-b');
const PREV_A = [TARGET, { id: 'other-a' } as PlatformCompanyRow];
const PREV_B = [{ id: 'other-b' } as PlatformCompanyRow];

function setup(options: { userId?: string | null; authorized?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  queryClient.setQueryData(KEY_A, PREV_A);
  queryClient.setQueryData(KEY_B, PREV_B);
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useActivateCompany({ userId: 'user-a', authorized: true, ...options }),
    { wrapper },
  );
  return { queryClient, invalidateSpy, hook };
}

async function expectRejection(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toThrow(message);
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: ACTIVATED, error: null });
});

describe('useActivateCompany — payload da RPC', () => {
  it('chama rpc("activate_company") com EXATAMENTE p_company_id', async () => {
    const { hook } = setup();
    await hook.result.current.activateCompany('company-1');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fnName, payload] = mocks.rpc.mock.calls[0];
    expect(fnName).toBe('activate_company');
    expect(Object.keys(payload)).toEqual(['p_company_id']);
    expect(payload.p_company_id).toBe('company-1');
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('p_note');
  });
});

describe('useActivateCompany — validações locais bloqueiam a chamada (sem RPC)', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook, queryClient } = setup({ authorized: false });
    await expectRejection(hook.result.current.activateCompany('company-1'), ACTIVATE_COMPANY_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
  });

  it('userId ausente bloqueia', async () => {
    const { hook } = setup({ userId: null });
    await expectRejection(hook.result.current.activateCompany('company-1'), ACTIVATE_COMPANY_LOCAL_ERRORS.missingUser);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('companyId vazio/ausente bloqueia', async () => {
    const { hook } = setup();
    await expectRejection(hook.result.current.activateCompany(''), ACTIVATE_COMPANY_LOCAL_ERRORS.missingCompanyId);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useActivateCompany — respostas', () => {
  it('erro do Supabase é preservado (PlatformCompanyError) e o cache anterior fica intacto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { hook, queryClient, invalidateSpy } = setup();
    await expect(hook.result.current.activateCompany('company-1')).rejects.toBeInstanceOf(PlatformCompanyError);
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
    expect(queryClient.getQueryData(KEY_B)).toBe(PREV_B);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('data null é rejeitado como resposta inesperada, cache intacto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const { hook, queryClient } = setup();
    await expect(hook.result.current.activateCompany('company-1')).rejects.toBeInstanceOf(PlatformCompanyError);
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
  });

  it('sucesso: a linha existente é ATUALIZADA no cache (nunca duplicada) + invalidação; outra identidade intocada', async () => {
    const { hook, queryClient, invalidateSpy } = setup();
    const activated = await hook.result.current.activateCompany('company-1');

    expect(activated).toEqual(ACTIVATED);
    const cachedA = queryClient.getQueryData(KEY_A) as PlatformCompanyRow[];
    expect(cachedA).toHaveLength(PREV_A.length);
    expect(cachedA.find((c) => c.id === 'company-1')).toEqual(ACTIVATED);
    expect(queryClient.getQueryData(KEY_B)).toBe(PREV_B);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: KEY_A });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: KEY_B });
  });

  it('idempotência do backend: chamar novamente para uma empresa já ativa não é tratado como caso especial pelo hook (apenas repassa o retorno)', async () => {
    mocks.rpc.mockResolvedValue({ data: ACTIVATED, error: null });
    const { hook } = setup();
    const first = await hook.result.current.activateCompany('company-1');
    const second = await hook.result.current.activateCompany('company-1');
    expect(first).toEqual(ACTIVATED);
    expect(second).toEqual(ACTIVATED);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('sem retry automático: uma falha não é repetida sozinha (mutations.retry=0 do QueryClient padrão)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.activateCompany('company-1')).rejects.toBeInstanceOf(PlatformCompanyError);
    expect(mocks.rpc).toHaveBeenCalledTimes(1); // não 2+
  });
});

describe('useActivateCompany — identidade obsoleta', () => {
  it('reset do cache durante a RPC descarta o resultado: erro estável, sem setQueryData/invalidate', async () => {
    let resolveRpc!: (v: { data: unknown; error: unknown }) => void;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const pending = hook.result.current.activateCompany('company-1');
    const settled = pending.catch((e) => e);
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));

    resetQueryCache(queryClient);
    resolveRpc({ data: ACTIVATED, error: null });

    const err = await settled;
    expect((err as Error).message).toBe(ACTIVATE_COMPANY_LOCAL_ERRORS.staleIdentity);
    expect(getActivateCompanyErrorMessage(err)).toBe('A sessão mudou antes da conclusão da operação.');
    expect(queryClient.getQueryData(KEY_A)).toBeUndefined();
    expect(queryClient.getQueryData(KEY_B)).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  });
});

describe('getActivateCompanyErrorMessage', () => {
  it('cobre acesso negado, empresa não encontrada, conflito de status, sessão expirada e o fallback genérico', () => {
    expect(getActivateCompanyErrorMessage(new Error(ACTIVATE_COMPANY_LOCAL_ERRORS.notAllowed)))
      .toBe('Você não tem permissão para ativar empresas.');
    expect(getActivateCompanyErrorMessage(new Error(ACTIVATE_COMPANY_LOCAL_ERRORS.missingUser)))
      .toBe('Sua sessão expirou. Faça login novamente.');
    expect(getActivateCompanyErrorMessage(new Error(ACTIVATE_COMPANY_LOCAL_ERRORS.missingCompanyId)))
      .toBe('Empresa inválida.');
    expect(getActivateCompanyErrorMessage(new PlatformCompanyError('platform_companies_activate_failed', { code: '42501' })))
      .toBe('Você não tem permissão para ativar empresas.');
    expect(getActivateCompanyErrorMessage(new PlatformCompanyError('platform_companies_activate_failed', { code: 'P0002' })))
      .toBe('Empresa não encontrada.');
    expect(getActivateCompanyErrorMessage(new PlatformCompanyError('platform_companies_activate_failed', { code: 'P0001' })))
      .toBe('Esta empresa não pode ser ativada no estado atual.');
    expect(getActivateCompanyErrorMessage(new Error('anything else')))
      .toBe('Não foi possível ativar a empresa. Tente novamente.');
    expect(getActivateCompanyErrorMessage(undefined))
      .toBe('Não foi possível ativar a empresa. Tente novamente.');
  });

  it('nunca inclui SQLSTATE, nome de policy ou stack trace na mensagem', () => {
    const message = getActivateCompanyErrorMessage(
      new PlatformCompanyError('platform_companies_activate_failed', { code: '42501', message: 'permission denied for function activate_company' }),
    );
    expect(message).not.toMatch(/permission denied/i);
    expect(message).not.toMatch(/42501/);
    expect(message).not.toMatch(/activate_company/);
  });
});
