// Testes de useUpdateCompanySettings (COMPANY-SETTINGS-R1-EXEC).
// Supabase mockado (rpc), QueryClient novo por teste, sem rede/snapshots.
// Mesmo padrão estrutural de tests/hooks/useActivateCompany.test.tsx —
// CRÍTICO adicional aqui: invalidação dos TRÊS namespaces de cache
// (detail, list, useCurrentCompanyTimezone), não só um.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdateCompanySettings,
  getUpdateCompanySettingsErrorMessage,
  UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS,
} from '@/lib/hooks/useUpdateCompanySettings';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { currentCompanyTimezoneQueryKey } from '@/lib/hooks/useCurrentCompanyTimezone';
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
  name: 'Revenda Premium',
  trade_name: null,
  cnpj: '11.222.333/0001-44',
  phone: '(11) 4000-0000',
  timezone: 'America/Sao_Paulo',
  status: 'ativa',
  created_at: '2026-08-01T10:00:00+00:00',
  logo_path: null,
};

const UPDATED: PlatformCompanyRow = { ...TARGET, phone: '(11) 9999-8888', timezone: 'America/Bahia' };

const LIST_KEY = platformCompanyQueryKeys.list('user-a');
const DETAIL_KEY = platformCompanyQueryKeys.detail('company-1', 'user-a');
const TIMEZONE_KEY = currentCompanyTimezoneQueryKey('company-1', 'user-a');
const OTHER_LIST_KEY = platformCompanyQueryKeys.list('user-b');

function setup(options: { userId?: string | null; companyId?: string | null; authorized?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  queryClient.setQueryData(LIST_KEY, [TARGET]);
  queryClient.setQueryData(DETAIL_KEY, [TARGET]);
  queryClient.setQueryData(TIMEZONE_KEY, [TARGET]);
  queryClient.setQueryData(OTHER_LIST_KEY, [{ id: 'other' }]);
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useUpdateCompanySettings({ userId: 'user-a', companyId: 'company-1', authorized: true, ...options }),
    { wrapper },
  );
  return { queryClient, invalidateSpy, hook };
}

async function expectRejection(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toThrow(message);
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UPDATED, error: null });
});

describe('useUpdateCompanySettings — payload da RPC', () => {
  it('chama rpc("update_company_settings") com EXATAMENTE p_company_id/p_phone/p_timezone', async () => {
    const { hook } = setup();
    await hook.result.current.updateCompanySettings({ phone: '(11) 9999-8888', timezone: 'America/Bahia' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fnName, payload] = mocks.rpc.mock.calls[0];
    expect(fnName).toBe('update_company_settings');
    expect(Object.keys(payload).sort()).toEqual(['p_company_id', 'p_phone', 'p_timezone']);
    expect(payload.p_company_id).toBe('company-1');
    expect(payload.p_phone).toBe('(11) 9999-8888');
    expect(payload.p_timezone).toBe('America/Bahia');
    expect(payload).not.toHaveProperty('p_name');
    expect(payload).not.toHaveProperty('p_cnpj');
  });
});

describe('useUpdateCompanySettings — validações locais bloqueiam a chamada (sem RPC)', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook, queryClient } = setup({ authorized: false });
    await expectRejection(
      hook.result.current.updateCompanySettings({ phone: '', timezone: 'America/Bahia' }),
      UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.notAllowed,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(DETAIL_KEY)).toEqual([TARGET]);
  });

  it('userId ausente bloqueia', async () => {
    const { hook } = setup({ userId: null });
    await expectRejection(
      hook.result.current.updateCompanySettings({ phone: '', timezone: 'America/Bahia' }),
      UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingUser,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('companyId vazio/ausente bloqueia', async () => {
    const { hook } = setup({ companyId: null });
    await expectRejection(
      hook.result.current.updateCompanySettings({ phone: '', timezone: 'America/Bahia' }),
      UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingCompanyId,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateCompanySettings — respostas', () => {
  it('erro do Supabase é preservado (PlatformCompanyError), cache anterior intacto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid timezone' } });
    const { hook, queryClient, invalidateSpy } = setup();
    await expect(
      hook.result.current.updateCompanySettings({ phone: '', timezone: 'not-a-timezone' }),
    ).rejects.toBeInstanceOf(PlatformCompanyError);
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(queryClient.getQueryData(DETAIL_KEY)).toEqual([TARGET]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('data null é rejeitado como resposta inesperada', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const { hook } = setup();
    await expect(
      hook.result.current.updateCompanySettings({ phone: '', timezone: 'America/Bahia' }),
    ).rejects.toBeInstanceOf(PlatformCompanyError);
  });

  it('sucesso: atualiza o cache DETAIL e invalida os TRÊS namespaces (detail/list/timezone) — outra identidade intocada', async () => {
    const { hook, queryClient, invalidateSpy } = setup();
    const updated = await hook.result.current.updateCompanySettings({ phone: '(11) 9999-8888', timezone: 'America/Bahia' });

    expect(updated).toEqual(UPDATED);
    const cachedDetail = queryClient.getQueryData(DETAIL_KEY) as PlatformCompanyRow[];
    expect(cachedDetail.find((c) => c.id === 'company-1')).toEqual(UPDATED);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LIST_KEY });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TIMEZONE_KEY });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: OTHER_LIST_KEY });
    expect(queryClient.getQueryData(OTHER_LIST_KEY)).toEqual([{ id: 'other' }]);
  });

  it('sem retry automático: uma falha não é repetida sozinha', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { hook } = setup();
    await expect(
      hook.result.current.updateCompanySettings({ phone: '', timezone: 'America/Bahia' }),
    ).rejects.toBeInstanceOf(PlatformCompanyError);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useUpdateCompanySettings — identidade obsoleta', () => {
  it('reset do cache durante a RPC descarta o resultado: erro estável, sem setQueryData/invalidate', async () => {
    let resolveRpc!: (v: { data: unknown; error: unknown }) => void;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const pending = hook.result.current.updateCompanySettings({ phone: '', timezone: 'America/Bahia' });
    const settled = pending.catch((e) => e);
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));

    resetQueryCache(queryClient);
    resolveRpc({ data: UPDATED, error: null });

    const err = await settled;
    expect((err as Error).message).toBe(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.staleIdentity);
    expect(getUpdateCompanySettingsErrorMessage(err)).toBe('A sessão mudou antes da conclusão da operação.');
    expect(queryClient.getQueryData(DETAIL_KEY)).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  });
});

describe('getUpdateCompanySettingsErrorMessage', () => {
  it('cobre acesso negado, empresa não encontrada, conflito de status, timezone inválido, sessão expirada e o fallback genérico', () => {
    expect(getUpdateCompanySettingsErrorMessage(new Error(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.notAllowed)))
      .toBe('Você não tem permissão para editar esta empresa.');
    expect(getUpdateCompanySettingsErrorMessage(new Error(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingUser)))
      .toBe('Sua sessão expirou. Faça login novamente.');
    expect(getUpdateCompanySettingsErrorMessage(new Error(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingCompanyId)))
      .toBe('Empresa inválida.');
    expect(getUpdateCompanySettingsErrorMessage(new PlatformCompanyError('platform_companies_update_settings_failed', { code: '42501' })))
      .toBe('Você não tem permissão para editar esta empresa.');
    expect(getUpdateCompanySettingsErrorMessage(new PlatformCompanyError('platform_companies_update_settings_failed', { code: 'P0002' })))
      .toBe('Empresa não encontrada.');
    expect(getUpdateCompanySettingsErrorMessage(new PlatformCompanyError('platform_companies_update_settings_failed', { code: 'P0001' })))
      .toBe('Esta empresa não está disponível para configuração no momento.');
    expect(getUpdateCompanySettingsErrorMessage(new PlatformCompanyError('platform_companies_update_settings_failed', { code: '22023' })))
      .toBe('Selecione um fuso horário válido.');
    expect(getUpdateCompanySettingsErrorMessage(new Error('anything else')))
      .toBe('Não foi possível salvar as alterações. Tente novamente.');
    expect(getUpdateCompanySettingsErrorMessage(undefined))
      .toBe('Não foi possível salvar as alterações. Tente novamente.');
  });

  it('nunca inclui SQLSTATE, nome de policy ou stack trace na mensagem', () => {
    const message = getUpdateCompanySettingsErrorMessage(
      new PlatformCompanyError('platform_companies_update_settings_failed', { code: '42501', message: 'permission denied for function update_company_settings' }),
    );
    expect(message).not.toMatch(/permission denied/i);
    expect(message).not.toMatch(/42501/);
    expect(message).not.toMatch(/update_company_settings/);
  });
});
