// Testes de usePlatformPipelineStages (M1-F S8-C2-B2). Supabase mockado (rpc).
// Caminho TOTALMENTE separado de usePipelineStages (Manager/Seller) — nunca
// reorder, nunca a mesma query key.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformPipelineStages } from '@/lib/hooks/usePlatformPipelineStages';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => mocks.rpc.mockReset());

describe('usePlatformPipelineStages — gating', () => {
  it('companyId null: nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformPipelineStages({ companyId: null, authorized: true }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('authorized=false: nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformPipelineStages({ companyId: 'company-a', authorized: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('usePlatformPipelineStages — sucesso', () => {
  it('busca com p_company_id exato, ordena por sort_order e monta stagesById', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { id: 's2', code: 'qualified', name: 'Qualificado', sort_order: 1 },
        { id: 's1', code: 'new', name: 'Novo', sort_order: 0 },
      ],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformPipelineStages({ companyId: 'company-a', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('list_pipeline_stages_for_company', { p_company_id: 'company-a' });
    expect(result.current.stages.map((s) => s.code)).toEqual(['new', 'qualified']);
    expect(result.current.stagesById['s1'].name).toBe('Novo');
    expect(result.current.stagesById['s2'].name).toBe('Qualificado');
  });

  it('empresa vazia (sem etapas configuradas) é um estado vazio válido', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformPipelineStages({ companyId: 'company-a', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.stages).toEqual([]);
  });
});

describe('usePlatformPipelineStages — nunca chama reorder', () => {
  it('a RPC de reorder_pipeline_stages nunca é chamada por este hook', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    renderHook(() => usePlatformPipelineStages({ companyId: 'company-a', authorized: true }), { wrapper });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    expect(mocks.rpc).not.toHaveBeenCalledWith('reorder_pipeline_stages', expect.anything());
  });
});
