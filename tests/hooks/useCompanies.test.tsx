// Testes de useCompanies (M1-F S3-B).
// Mock isolado de lib/supabase/client (cadeia from→select→order→order).
// Nenhuma rede real, nenhum Supabase remoto.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompanies } from '@/lib/hooks/useCompanies';
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
    cnpj: null,
    phone: null,
    timezone: 'America/Sao_Paulo',
    status: 'ativa',
    created_at: '2026-07-20T12:00:00+00:00',
    ...overrides,
  };
}

function mockCompaniesResponse(response: { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select });
  return { select, order1, order2 };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useCompanies — não autorizado / sem usuário', () => {
  it('authorized=false: nenhuma query é executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: 'user-1', authorized: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result.current.companies).toEqual([]);
  });

  it('userId ausente: nenhuma query é executada mesmo com authorized=true', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: null, authorized: true }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('key sentinela quando desabilitado, distinta de qualquer usuário real', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: null, authorized: true }), { wrapper });
    expect(result.current.queryKey).toEqual(['platform-admin', null, 'companies', 'disabled']);
  });
});

describe('useCompanies — sucesso', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('lista com múltiplas empresas, ordenadas pela query (created_at desc, id asc)', async () => {
    mockCompaniesResponse({
      data: [companyRow({ id: 'c1' }), companyRow({ id: 'c2', status: 'implantacao' })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: 'user-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.companies).toHaveLength(2);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.queryKey).toEqual(platformCompanyQueryKeys.list('user-1'));
  });

  it('SELECT exato: só as 8 colunas esperadas, sem company_id/membership/profile/auth.users', async () => {
    const { select } = mockCompaniesResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    renderHook(() => useCompanies({ userId: 'user-1', authorized: true }), { wrapper });

    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(mocks.from).toHaveBeenCalledWith('companies');
    expect(select).toHaveBeenCalledWith('id, name, trade_name, cnpj, phone, timezone, status, created_at');
  });

  it('empty state: lista vazia', async () => {
    mockCompaniesResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: 'user-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
  });

  it('campos opcionais ausentes (trade_name/cnpj/phone null) não quebram o resultado', async () => {
    mockCompaniesResponse({
      data: [companyRow({ trade_name: null, cnpj: null, phone: null })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: 'user-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.companies[0].trade_name).toBeNull();
    expect(result.current.companies[0].cnpj).toBeNull();
    expect(result.current.companies[0].phone).toBeNull();
  });

  it('cobre os 3 status possíveis (implantacao/ativa/suspensa) — cancelada nunca aparece (RLS já omite)', async () => {
    mockCompaniesResponse({
      data: [
        companyRow({ id: 'c1', status: 'implantacao' }),
        companyRow({ id: 'c2', status: 'ativa' }),
        companyRow({ id: 'c3', status: 'suspensa' }),
      ],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: 'user-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.companies.map((c) => c.status)).toEqual(['implantacao', 'ativa', 'suspensa']);
  });
});

describe('useCompanies — erro e retry', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('erro do Supabase é exposto, nunca vira lista vazia silenciosa', async () => {
    mockCompaniesResponse({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: 'user-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.companies).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });

  it('refetch dispara nova chamada', async () => {
    mockCompaniesResponse({ data: [companyRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCompanies({ userId: 'user-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    const callsBefore = mocks.from.mock.calls.length;
    result.current.refetch();
    await waitFor(() => expect(mocks.from.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe('useCompanies — isolamento por identidade (cache partition)', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('query keys diferentes por usuário — troca de usuário não reaproveita cache', async () => {
    mockCompaniesResponse({ data: [companyRow()], error: null });
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) => useCompanies({ userId, authorized: true }),
      { wrapper, initialProps: { userId: 'user-a' } },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.queryKey).toEqual(platformCompanyQueryKeys.list('user-a'));

    rerender({ userId: 'user-b' });
    expect(result.current.queryKey).toEqual(platformCompanyQueryKeys.list('user-b'));
  });
});
