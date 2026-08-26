// Testes de useActiveFollowUpTemplates (FOLLOW-UP-TEMPLATES-A3-EXEC).
// Mock isolado da cadeia from→select→eq→order (mesmo molde de
// tests/hooks/usePipelineStages.test.tsx) e de resolveTaskRemoteMode.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useActiveFollowUpTemplates, type UseActiveFollowUpTemplatesOptions } from '@/lib/hooks/useActiveFollowUpTemplates';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';

const mocks = vi.hoisted(() => ({ from: vi.fn(), resolveTaskRemoteMode: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: mocks.from }, isSupabaseConfigured: true }));
vi.mock('@/lib/tasks/remoteTasksMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/remoteTasksMode')>();
  return { ...actual, resolveTaskRemoteMode: mocks.resolveTaskRemoteMode };
});

const ROWS = [
  { id: 'tpl-1', company_id: 'company-a', name: 'A', task_title: 'x', task_note: '', priority: 'media', offset_value: 1, offset_unit: 'day', default_time: null, is_active: true, sort_order: 0, created_by: 'p1', updated_by: 'p1', created_at: 't', updated_at: 't', version: 1 },
];

function mockResponse(response: { data: unknown; error: unknown }) {
  const order = vi.fn().mockReturnValue(Promise.resolve(response));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  mocks.from.mockReturnValue({ select });
  return { select, eq, order };
}

function baseOptions(overrides: Partial<UseActiveFollowUpTemplatesOptions> = {}): UseActiveFollowUpTemplatesOptions {
  return { userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true, ...overrides };
}

function setup(options: Partial<UseActiveFollowUpTemplatesOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook((opts: UseActiveFollowUpTemplatesOptions) => useActiveFollowUpTemplates(opts), { wrapper, initialProps: baseOptions(options) });
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.resolveTaskRemoteMode.mockReset().mockReturnValue('task_remote_ready');
});

describe('useActiveFollowUpTemplates', () => {
  it('filtra is_active=true e ordena por sort_order — Manager e Seller usam o mesmo fetch', async () => {
    const { select, eq } = mockResponse({ data: ROWS, error: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.templates.length).toBe(1));
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('is_active', true);
    expect(result.current.templates[0].name).toBe('A');
  });

  it('task_remote_mode != task_remote_ready: nunca busca (defesa em profundidade)', async () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_local');
    mockResponse({ data: ROWS, error: null });
    const { result } = setup();
    expect(result.current.templates).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller, ex.: super_admin): nunca busca', async () => {
    mockResponse({ data: ROWS, error: null });
    const { result } = setup({ membershipRole: null });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result.current.templates).toEqual([]);
  });

  it('sem companyId: nunca busca', () => {
    mockResponse({ data: ROWS, error: null });
    setup({ companyId: null });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('erro do Supabase: isError true, templates vazio', async () => {
    mockResponse({ data: null, error: { code: '500', message: 'boom' } });
    const { result } = setup();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.templates).toEqual([]);
  });

  it('query key particionada por companyId (isolamento entre empresas)', () => {
    expect(followUpTemplateQueryKeys.active('company-a')).not.toEqual(followUpTemplateQueryKeys.active('company-b'));
  });
});
