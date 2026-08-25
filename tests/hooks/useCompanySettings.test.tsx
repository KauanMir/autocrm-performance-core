// Testes de useCompanySettings (COMPANY-SETTINGS-R1-EXEC).
// Mesmo mock de lib/supabase/client (cadeia from→select→order→order) de
// tests/hooks/useCompanies.test.tsx — mesma queryFn (fetchAccessibleCompanies),
// filtrada aqui por companyId explícito.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompanySettings } from '@/lib/hooks/useCompanySettings';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from },
  isSupabaseConfigured: true,
}));

function companyRow(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-1',
    name: 'Revenda Premium',
    trade_name: null,
    cnpj: '11.222.333/0001-44',
    phone: '(11) 4000-0000',
    timezone: 'America/Sao_Paulo',
    status: 'ativa',
    created_at: '2026-07-20T12:00:00+00:00',
    logo_path: null,
    ...overrides,
  };
}

function mockCompaniesResponse(response: { data: unknown; error: unknown }) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select });
  return { select };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.from.mockReset();
});

describe('useCompanySettings — não autorizado / dados ausentes', () => {
  it('authorized=false: nenhuma query, status unavailable', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySettings({ userId: 'user-1', companyId: 'company-1', authorized: false }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('companyId ausente: nenhuma query mesmo autorizado', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySettings({ userId: 'user-1', companyId: null, authorized: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('userId ausente: nenhuma query mesmo autorizado', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySettings({ userId: null, companyId: 'company-1', authorized: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useCompanySettings — sucesso', () => {
  it('empresa encontrada na lista: status ready com a linha certa', async () => {
    mockCompaniesResponse({
      data: [companyRow({ id: 'other' }), companyRow({ id: 'company-1', phone: '(11) 9999-0000' })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySettings({ userId: 'user-1', companyId: 'company-1', authorized: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.company.id).toBe('company-1');
    expect(result.current.status === 'ready' && result.current.company.phone).toBe('(11) 9999-0000');
  });

  it('SELECT exato: mesmas 9 colunas de useCompanies, mesma fetchAccessibleCompanies', async () => {
    const { select } = mockCompaniesResponse({ data: [companyRow()], error: null });
    const { wrapper } = createWrapper();
    renderHook(
      () => useCompanySettings({ userId: 'user-1', companyId: 'company-1', authorized: true }),
      { wrapper },
    );

    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(mocks.from).toHaveBeenCalledWith('companies');
    expect(select).toHaveBeenCalledWith('id, name, trade_name, cnpj, phone, timezone, status, created_at, logo_path');
  });

  it('empresa fora da lista retornada (RLS não devolveu essa linha): unavailable, nunca undefined solto', async () => {
    mockCompaniesResponse({ data: [companyRow({ id: 'other-company' })], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySettings({ userId: 'user-1', companyId: 'company-1', authorized: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    expect(result.current.status).toBe('unavailable');
  });

  it('query key própria (detail), separada de useCompanies.list e de useCurrentCompanyTimezone', async () => {
    mockCompaniesResponse({ data: [companyRow()], error: null });
    const { wrapper } = createWrapper();
    renderHook(
      () => useCompanySettings({ userId: 'user-1', companyId: 'company-1', authorized: true }),
      { wrapper },
    );
    await waitFor(() => expect(mocks.from).toHaveBeenCalled());
    expect(platformCompanyQueryKeys.detail('company-1', 'user-1')).toEqual(
      ['company-settings', 'user-1', 'company-1'],
    );
    expect(platformCompanyQueryKeys.detail('company-1', 'user-1'))
      .not.toEqual(platformCompanyQueryKeys.list('user-1'));
  });
});

describe('useCompanySettings — erro e retry', () => {
  it('erro do Supabase é exposto, retry disponível', async () => {
    mockCompaniesResponse({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySettings({ userId: 'user-1', companyId: 'company-1', authorized: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status === 'error' && typeof result.current.retry).toBe('function');
  });
});

describe('useCompanySettings — isolamento por identidade (cache partition)', () => {
  it('troca de companyId busca de novo (query key diferente)', async () => {
    mockCompaniesResponse({ data: [companyRow({ id: 'company-1' }), companyRow({ id: 'company-2' })], error: null });
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ companyId }: { companyId: string }) => useCompanySettings({ userId: 'user-1', companyId, authorized: true }),
      { wrapper, initialProps: { companyId: 'company-1' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.company.id).toBe('company-1');

    rerender({ companyId: 'company-2' });
    await waitFor(() => expect(result.current.status === 'ready' && result.current.company.id).toBe('company-2'));
  });
});
