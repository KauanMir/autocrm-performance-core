// Testes de useActiveCompanyIdentity (COMPANY-IDENTITY-LOGO-R1-EXEC §22/§24/
// §25). Mesmo mock de lib/supabase/client (cadeia from→select→order→order) e
// mesma queryFn (fetchAccessibleCompanies) de useCompanySettings/
// useCurrentCompanyTimezone — só o gating e o shape do retorno mudam.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useActiveCompanyIdentity, currentCompanyIdentityQueryKey } from '@/lib/hooks/useActiveCompanyIdentity';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { currentCompanyTimezoneQueryKey } from '@/lib/hooks/useCurrentCompanyTimezone';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const m = vi.hoisted(() => ({ from: vi.fn(), isRemoteLeadsEnabled: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: m.from },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: m.isRemoteLeadsEnabled };
});

function companyRow(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-1',
    name: 'Rcar Seminovos Gama',
    trade_name: null,
    cnpj: null,
    phone: null,
    timezone: 'America/Sao_Paulo',
    status: 'ativa',
    created_at: '2026-07-20T12:00:00+00:00',
    logo_path: 'company-1/logos/abc.png',
    ...overrides,
  };
}

function mockCompaniesResponse(response: { data: unknown; error: unknown }) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  m.from.mockReturnValue({ select });
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
  m.from.mockReset();
  m.isRemoteLeadsEnabled.mockReturnValue(true);
});

describe('useActiveCompanyIdentity — flag OFF', () => {
  it('status local, nenhuma query, mesmo Manager com companyId válido', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('local');
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('useActiveCompanyIdentity — Super Admin / sem membership (§25)', () => {
  it('membershipRole null: unavailable, NUNCA uma empresa implícita, nenhuma query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-sa', companyId: null, membershipRole: null, userIsActive: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.from).not.toHaveBeenCalled();
  });

  it('companyId ausente mesmo com membershipRole setado: unavailable, nenhuma query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: null, membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.from).not.toHaveBeenCalled();
  });

  it('userIsActive=false: unavailable, nenhuma query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: false }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('useActiveCompanyIdentity — Manager/Seller com empresa (§24)', () => {
  it('Manager: status ready com id/name/logoPath/timezone', async () => {
    mockCompaniesResponse({ data: [companyRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.company).toEqual({
      id: 'company-1', name: 'Rcar Seminovos Gama', logoPath: 'company-1/logos/abc.png', timezone: 'America/Sao_Paulo',
    });
  });

  it('Seller: mesmo contrato de leitura do Manager (mesma empresa)', async () => {
    mockCompaniesResponse({ data: [companyRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-2', companyId: 'company-1', membershipRole: 'seller', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.company.id).toBe('company-1');
  });

  it('empresa sem logo (logo_path null): logoPath null, nunca uma logo fake', async () => {
    mockCompaniesResponse({ data: [companyRow({ logo_path: null })], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.company.logoPath).toBeNull();
  });

  it('SELECT reaproveita fetchAccessibleCompanies — mesmas 9 colunas, zero SELECT paralelo (§22)', async () => {
    const { select } = mockCompaniesResponse({ data: [companyRow()], error: null });
    const { wrapper } = createWrapper();
    renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(m.from).toHaveBeenCalledWith('companies');
    expect(select).toHaveBeenCalledWith('id, name, trade_name, cnpj, phone, timezone, status, created_at, logo_path');
  });

  it('empresa fora da lista retornada pela RLS: unavailable, nunca undefined solto', async () => {
    mockCompaniesResponse({ data: [companyRow({ id: 'other' })], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    expect(result.current.status).toBe('unavailable');
  });

  it('erro do Supabase: status error com retry', async () => {
    mockCompaniesResponse({ data: null, error: { code: '500', message: 'boom' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useActiveCompanyIdentity({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status === 'error' && typeof result.current.retry).toBe('function');
  });
});

describe('useActiveCompanyIdentity — query key própria (§23)', () => {
  it('namespace "identity" separado de company-settings/list/timezone', () => {
    expect(currentCompanyIdentityQueryKey('company-1', 'user-1')).toEqual(
      ['company', 'company-1', 'identity', 'remote', 'user-1'],
    );
    expect(currentCompanyIdentityQueryKey('company-1', 'user-1'))
      .not.toEqual(currentCompanyTimezoneQueryKey('company-1', 'user-1'));
    expect(currentCompanyIdentityQueryKey('company-1', 'user-1'))
      .not.toEqual(platformCompanyQueryKeys.detail('company-1', 'user-1'));
    expect(currentCompanyIdentityQueryKey('company-1', 'user-1'))
      .not.toEqual(platformCompanyQueryKeys.list('user-1'));
  });
});
