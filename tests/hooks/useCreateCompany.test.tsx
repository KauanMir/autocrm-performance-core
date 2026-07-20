// Testes de useCreateCompany (M1-F S3-B).
// Supabase mockado (rpc), QueryClient novo por teste, sem rede/snapshots.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCreateCompany,
  getCreateCompanyErrorMessage,
  CREATE_COMPANY_LOCAL_ERRORS,
} from '@/lib/hooks/useCreateCompany';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { resetQueryCache } from '@/lib/query/resetQueryCache';
import { PlatformCompanyError } from '@/lib/companies/errors';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const CREATED: PlatformCompanyRow = {
  id: 'new-company',
  name: 'Empresa Nova',
  trade_name: null,
  cnpj: null,
  phone: null,
  timezone: 'America/Sao_Paulo',
  status: 'implantacao',
  created_at: '2026-07-21T10:00:00+00:00',
};

const KEY_A = platformCompanyQueryKeys.list('user-a');
const KEY_B = platformCompanyQueryKeys.list('user-b');
const PREV_A = [{ id: 'old-a' } as PlatformCompanyRow];
const PREV_B = [{ id: 'old-b' } as PlatformCompanyRow];

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
    () => useCreateCompany({ userId: 'user-a', authorized: true, ...options }),
    { wrapper },
  );
  return { queryClient, invalidateSpy, hook };
}

async function expectRejection(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toThrow(message);
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
});

describe('useCreateCompany — payload da RPC', () => {
  it('chama rpc("create_company") com payload contendo EXATAMENTE os 5 campos aprovados', async () => {
    const { hook } = setup();
    await hook.result.current.createCompany({ name: 'Empresa Nova', tradeName: 'Fantasia', cnpj: '11.111.111/0001-11', phone: '(11) 4000-0000', timezone: 'America/Bahia' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fnName, payload] = mocks.rpc.mock.calls[0];
    expect(fnName).toBe('create_company');
    expect(Object.keys(payload).sort()).toEqual(['p_cnpj', 'p_name', 'p_phone', 'p_timezone', 'p_trade_name'].sort());
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('created_by_profile_id');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('company_id');
    expect(payload).not.toHaveProperty('profile_id');
  });

  it('campos opcionais em branco viram undefined (chave omitida), não string vazia forçada', async () => {
    const { hook } = setup();
    await hook.result.current.createCompany({ name: 'Só Nome' });
    const payload = mocks.rpc.mock.calls[0][1];
    expect(payload.p_name).toBe('Só Nome');
    expect(payload.p_trade_name).toBeUndefined();
    expect(payload.p_cnpj).toBeUndefined();
    expect(payload.p_phone).toBeUndefined();
    expect(payload.p_timezone).toBeUndefined();
  });

  it('valor digitado é preservado exatamente como veio (nenhuma normalização oculta)', async () => {
    const { hook } = setup();
    await hook.result.current.createCompany({ name: '  Empresa Com Espaços  ' });
    expect(mocks.rpc.mock.calls[0][1].p_name).toBe('  Empresa Com Espaços  ');
  });
});

describe('useCreateCompany — validações locais bloqueiam a chamada (sem INSERT direto, sem RPC)', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook, queryClient } = setup({ authorized: false });
    await expectRejection(hook.result.current.createCompany({ name: 'X' }), CREATE_COMPANY_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
  });

  it('userId ausente bloqueia', async () => {
    const { hook } = setup({ userId: null });
    await expectRejection(hook.result.current.createCompany({ name: 'X' }), CREATE_COMPANY_LOCAL_ERRORS.missingUser);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('nome em branco (só espaços) bloqueia', async () => {
    const { hook } = setup();
    await expectRejection(hook.result.current.createCompany({ name: '   ' }), CREATE_COMPANY_LOCAL_ERRORS.blankName);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('nome vazio bloqueia', async () => {
    const { hook } = setup();
    await expectRejection(hook.result.current.createCompany({ name: '' }), CREATE_COMPANY_LOCAL_ERRORS.blankName);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCreateCompany — respostas', () => {
  it('erro do Supabase é preservado (PlatformCompanyError) e o cache anterior fica intacto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { hook, queryClient, invalidateSpy } = setup();
    await expect(hook.result.current.createCompany({ name: 'X' })).rejects.toBeInstanceOf(PlatformCompanyError);
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
    expect(queryClient.getQueryData(KEY_B)).toBe(PREV_B);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('data null é rejeitado como resposta inesperada, cache intacto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const { hook, queryClient } = setup();
    await expect(hook.result.current.createCompany({ name: 'X' })).rejects.toBeInstanceOf(PlatformCompanyError);
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
  });

  it('sucesso: cache SOMENTE da identidade atual atualizado (prepend) + invalidação; outra identidade intocada', async () => {
    const { hook, queryClient, invalidateSpy } = setup();
    const created = await hook.result.current.createCompany({ name: 'Empresa Nova' });

    expect(created).toEqual(CREATED);
    const cachedA = queryClient.getQueryData(KEY_A) as PlatformCompanyRow[];
    expect(cachedA[0]).toEqual(CREATED);
    expect(cachedA).toHaveLength(PREV_A.length + 1);
    expect(queryClient.getQueryData(KEY_B)).toBe(PREV_B);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: KEY_A });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: KEY_B });
  });

  it('nenhuma empresa é selecionada automaticamente: o hook não expõe nenhum estado de seleção', async () => {
    const { hook } = setup();
    const result = await hook.result.current.createCompany({ name: 'Empresa Nova' });
    expect(result).not.toHaveProperty('selected');
    expect(Object.keys(hook.result.current)).not.toContain('selectedCompanyId');
  });

  it('sem retry automático: uma falha não é repetida sozinha (mutations.retry=0 do QueryClient padrão)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.createCompany({ name: 'X' })).rejects.toBeInstanceOf(PlatformCompanyError);
    expect(mocks.rpc).toHaveBeenCalledTimes(1); // não 2+
  });
});

describe('useCreateCompany — identidade obsoleta', () => {
  it('reset do cache durante a RPC descarta o resultado: erro estável, sem setQueryData/invalidate', async () => {
    let resolveRpc!: (v: { data: unknown; error: unknown }) => void;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const pending = hook.result.current.createCompany({ name: 'Empresa Nova' });
    const settled = pending.catch((e) => e);
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));

    resetQueryCache(queryClient);
    resolveRpc({ data: CREATED, error: null });

    const err = await settled;
    expect((err as Error).message).toBe(CREATE_COMPANY_LOCAL_ERRORS.staleIdentity);
    expect(getCreateCompanyErrorMessage(err)).toBe('A sessão mudou antes da conclusão da operação.');
    expect(queryClient.getQueryData(KEY_A)).toBeUndefined();
    expect(queryClient.getQueryData(KEY_B)).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  });
});

describe('getCreateCompanyErrorMessage', () => {
  it('cobre acesso negado, nome obrigatório, timezone inválida, sessão expirada e o fallback genérico', () => {
    expect(getCreateCompanyErrorMessage(new Error(CREATE_COMPANY_LOCAL_ERRORS.notAllowed)))
      .toBe('Você não tem permissão para criar empresas.');
    expect(getCreateCompanyErrorMessage(new Error(CREATE_COMPANY_LOCAL_ERRORS.missingUser)))
      .toBe('Sua sessão expirou. Faça login novamente.');
    expect(getCreateCompanyErrorMessage(new Error(CREATE_COMPANY_LOCAL_ERRORS.blankName)))
      .toBe('Informe o nome da empresa.');
    expect(getCreateCompanyErrorMessage(new PlatformCompanyError('platform_companies_create_failed', { code: '42501' })))
      .toBe('Você não tem permissão para criar empresas.');
    expect(getCreateCompanyErrorMessage(new PlatformCompanyError('platform_companies_create_failed', { code: '23502' })))
      .toBe('Informe o nome da empresa.');
    expect(getCreateCompanyErrorMessage(new PlatformCompanyError('platform_companies_create_failed', { code: '23514' })))
      .toBe('Informe o nome da empresa.');
    expect(getCreateCompanyErrorMessage(new PlatformCompanyError('platform_companies_create_failed', { code: '22023' })))
      .toBe('Fuso horário inválido.');
    expect(getCreateCompanyErrorMessage(new Error('anything else')))
      .toBe('Não foi possível criar a empresa. Tente novamente.');
    expect(getCreateCompanyErrorMessage(undefined))
      .toBe('Não foi possível criar a empresa. Tente novamente.');
  });

  it('nunca inclui SQLSTATE, nome de policy ou stack trace na mensagem', () => {
    const message = getCreateCompanyErrorMessage(
      new PlatformCompanyError('platform_companies_create_failed', { code: '42501', message: 'new row violates row-level security policy for table "companies"' }),
    );
    expect(message).not.toMatch(/policy/i);
    expect(message).not.toMatch(/42501/);
    expect(message).not.toMatch(/companies_select_accessible/);
  });
});
