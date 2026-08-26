// Testes de useManagementFollowUpTemplates (FOLLOW-UP-TEMPLATES-A3-EXEC).
// Dois caminhos de leitura distintos: Manager (SELECT direto, RLS) vs Super
// Admin contextual (RPC list_platform_followup_templates_for_company),
// nunca a mesma query key (precheck A3-EXEC §4/§20).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useManagementFollowUpTemplates, type UseManagementFollowUpTemplatesOptions } from '@/lib/hooks/useManagementFollowUpTemplates';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc }, isSupabaseConfigured: true }));

const ROWS_ACTIVE_INACTIVE = [
  { id: 'tpl-1', company_id: 'company-a', name: 'A', task_title: 'x', task_note: '', priority: 'media', offset_value: 1, offset_unit: 'day', default_time: null, is_active: true, sort_order: 0, created_by: 'p1', updated_by: 'p1', created_at: 't', updated_at: 't', version: 1 },
  { id: 'tpl-2', company_id: 'company-a', name: 'B', task_title: 'y', task_note: '', priority: 'media', offset_value: 1, offset_unit: 'day', default_time: null, is_active: false, sort_order: 1, created_by: 'p1', updated_by: 'p1', created_at: 't', updated_at: 't', version: 1 },
];

function mockManagerResponse(response: { data: unknown; error: unknown }) {
  const order = vi.fn().mockReturnValue(Promise.resolve(response));
  const select = vi.fn(() => ({ order }));
  mocks.from.mockReturnValue({ select });
  return { select, order };
}

function setup(options: Partial<UseManagementFollowUpTemplatesOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    (opts: UseManagementFollowUpTemplatesOptions) => useManagementFollowUpTemplates(opts),
    { wrapper, initialProps: { userId: 'user-1', companyId: 'company-a', readAuthorized: true, isSuperAdminContext: false, ...options } },
  );
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe('useManagementFollowUpTemplates — Manager (SELECT direto)', () => {
  it('busca SEM filtro is_active (ativos+inativos), nunca chama a RPC platform', async () => {
    const { select } = mockManagerResponse({ data: ROWS_ACTIVE_INACTIVE, error: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(select).toHaveBeenCalledWith('*');
    expect(mocks.rpc).not.toHaveBeenCalled();
    if (result.current.status === 'ready') {
      expect(result.current.templates).toHaveLength(2);
    }
  });

  it('readAuthorized=false: unavailable, nunca busca', () => {
    mockManagerResponse({ data: ROWS_ACTIVE_INACTIVE, error: null });
    const { result } = setup({ readAuthorized: false });
    expect(result.current).toEqual({ status: 'unavailable' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('erro: status error com retry', async () => {
    mockManagerResponse({ data: null, error: { message: 'boom' } });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('useManagementFollowUpTemplates — Super Admin contextual (RPC)', () => {
  it('chama list_platform_followup_templates_for_company com include_inactive=true, nunca SELECT direto', async () => {
    mocks.rpc.mockResolvedValue({ data: ROWS_ACTIVE_INACTIVE, error: null });
    const { result } = setup({ isSuperAdminContext: true });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_followup_templates_for_company', {
      p_company_id: 'company-a',
      p_include_inactive: true,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useManagementFollowUpTemplates — isolamento de query key', () => {
  it('management e platform NUNCA compartilham a mesma key', () => {
    expect(followUpTemplateQueryKeys.management('company-a')).not.toEqual(followUpTemplateQueryKeys.platform('company-a'));
  });

  it('empresas diferentes nunca compartilham a mesma key', () => {
    expect(followUpTemplateQueryKeys.management('company-a')).not.toEqual(followUpTemplateQueryKeys.management('company-b'));
  });
});
