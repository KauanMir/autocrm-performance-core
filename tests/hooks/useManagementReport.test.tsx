// Testes de useManagementReport (KPI-REPORTS-B2-EXEC-FRONTEND §60/§67).
// Supabase RPC mockado; QueryClient novo por teste. Mesmo padrão de
// tests/hooks/useCompanySellerLeaderboard.test.tsx.
//
// FOCO CRÍTICO (§2/§52): Seller NUNCA dispara a RPC.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useManagementReport } from '@/lib/hooks/useManagementReport';
import { managementReportQueryKey } from '@/lib/managementReport/queryKeys';
import type { ResolvedPeriod } from '@/lib/date/companyPeriod';

const m = vi.hoisted(() => ({ rpc: vi.fn(), isRemoteLeadsEnabled: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: m.isRemoteLeadsEnabled };
});

const READY_PERIOD: ResolvedPeriod = { kind: 'ready', startMillis: 1_772_074_800_000, endMillis: 1_772_420_400_000 };

function validJson() {
  return {
    period: { start: '2026-03-10T03:00:00+00:00', end: '2026-03-14T03:00:00+00:00', timezone: 'America/Sao_Paulo', trend_granularity: 'day' },
    summary: {
      leads_received: 5, sales_count: 3, revenue_cents: 63333, average_ticket_cents: 21111,
      visits_completed: 2, tasks_completed: 3,
      deal_to_sale_conversion: { cohort_deals_count: 3, converted_deals_count: 1, rate_percent: 33.33 },
    },
    seller_breakdown: [], source_breakdown: [], trend: [],
  };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const MANAGER = {
  userId: 'user-1', companyId: 'company-1', membershipRole: 'manager' as const,
  userIsActive: true, period: READY_PERIOD,
};

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: validJson(), error: null });
  m.isRemoteLeadsEnabled.mockReturnValue(true);
});

describe('useManagementReport — gating', () => {
  it('flag OFF => status local, nenhuma chamada RPC', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useManagementReport(MANAGER), { wrapper });
    expect(result.current.status).toBe('local');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('SELLER => status unavailable e RPC NUNCA chamada (§2/§52)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useManagementReport({ ...MANAGER, membershipRole: 'seller' }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    // espera um tick para garantir que nenhum fetch assíncrono foi disparado
    await new Promise((r) => setTimeout(r, 20));
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('período loading => status loading, nenhuma RPC', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useManagementReport({ ...MANAGER, period: { kind: 'loading' } }),
      { wrapper },
    );
    expect(result.current.status).toBe('loading');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('período unavailable => status unavailable, nenhuma RPC', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useManagementReport({ ...MANAGER, period: { kind: 'unavailable' } }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('sem companyId => unavailable, nenhuma RPC', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useManagementReport({ ...MANAGER, companyId: null }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('useManagementReport — Manager', () => {
  it('período pronto => RPC chamada SEM p_company_id; status ready', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useManagementReport(MANAGER), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(m.rpc).toHaveBeenCalledWith('get_company_management_report', {
      p_period_start: new Date(READY_PERIOD.startMillis).toISOString(),
      p_period_end: new Date(READY_PERIOD.endMillis).toISOString(),
      p_company_id: undefined,
    });
    if (result.current.status === 'ready') {
      expect(result.current.report.summary.leadsReceived).toBe(5);
    }
  });

  it('erro de rede => status error com retry', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useManagementReport(MANAGER), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status === 'error') expect(typeof result.current.retry).toBe('function');
  });

  it('JSON que viola o contrato => status contract-error (nunca números fake)', async () => {
    const bad = validJson();
    delete (bad.summary as Record<string, unknown>).revenue_cents;
    m.rpc.mockResolvedValue({ data: bad, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useManagementReport(MANAGER), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('contract-error'));
  });
});

describe('useManagementReport — Super Admin contextual', () => {
  it('envia p_company_id explícito; status ready', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useManagementReport({
        userId: 'admin-1', companyId: 'company-b', membershipRole: null,
        userIsActive: true, period: READY_PERIOD, isSuperAdminContext: true,
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(m.rpc).toHaveBeenCalledWith('get_company_management_report', expect.objectContaining({
      p_company_id: 'company-b',
    }));
  });
});

describe('useManagementReport — isolamento de cache', () => {
  it('Company A e Company B usam query keys distintas', async () => {
    const { queryClient, wrapper } = createWrapper();
    renderHook(() => useManagementReport({ ...MANAGER, companyId: 'company-a' }), { wrapper });
    renderHook(() => useManagementReport({ ...MANAGER, companyId: 'company-b' }), { wrapper });
    await waitFor(() => {
      expect(queryClient.getQueryData(managementReportQueryKey('company-a', 'user-1', READY_PERIOD.startMillis, READY_PERIOD.endMillis))).toBeDefined();
      expect(queryClient.getQueryData(managementReportQueryKey('company-b', 'user-1', READY_PERIOD.startMillis, READY_PERIOD.endMillis))).toBeDefined();
    });
  });

  it('troca de período gera nova consulta (key distinta)', async () => {
    const { wrapper } = createWrapper();
    const other: ResolvedPeriod = { kind: 'ready', startMillis: 1, endMillis: 2 };
    const { rerender } = renderHook((props: Parameters<typeof useManagementReport>[0]) => useManagementReport(props), {
      wrapper, initialProps: MANAGER,
    });
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    rerender({ ...MANAGER, period: other });
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2));
  });
});
