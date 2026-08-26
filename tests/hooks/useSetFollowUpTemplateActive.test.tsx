// Testes de useSetFollowUpTemplateActive (FOLLOW-UP-TEMPLATES-A3-EXEC).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSetFollowUpTemplateActive, type UseSetFollowUpTemplateActiveOptions } from '@/lib/hooks/useSetFollowUpTemplateActive';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: mocks.rpc }, isSupabaseConfigured: true }));

const ROW = {
  id: 'tpl-1', company_id: 'company-a', name: 'x', task_title: 'y', task_note: '', priority: 'media',
  offset_value: 1, offset_unit: 'day', default_time: null, is_active: false, sort_order: 0,
  created_by: 'p1', updated_by: 'p1', created_at: 't', updated_at: 't', version: 2,
};

function setup(options: Partial<UseSetFollowUpTemplateActiveOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    (opts: UseSetFollowUpTemplateActiveOptions) => useSetFollowUpTemplateActive(opts),
    { wrapper, initialProps: { userId: 'user-1', companyId: 'company-a', writeAuthorized: true, isSuperAdminContext: false, ...options } },
  );
  return { invalidateSpy, hook };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: ROW, error: null });
});

describe('useSetFollowUpTemplateActive', () => {
  it('desativar: envia p_is_active=false, p_company_id null para Manager', async () => {
    const { hook } = setup();
    await hook.result.current.setActive({ templateId: 'tpl-1', expectedVersion: 1, isActive: false });
    expect(mocks.rpc).toHaveBeenCalledWith('set_followup_template_active', {
      p_id: 'tpl-1', p_expected_version: 1, p_is_active: false, p_company_id: null,
    });
  });

  it('Super Admin contextual: envia p_company_id explícito', async () => {
    const { hook } = setup({ isSuperAdminContext: true, companyId: 'company-x' });
    await hook.result.current.setActive({ templateId: 'tpl-1', expectedVersion: 1, isActive: true });
    expect(mocks.rpc.mock.calls[0][1].p_company_id).toBe('company-x');
  });

  it('followup_template_limit_reached ao reativar é mapeado corretamente', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'followup_template_limit_reached' } });
    const { hook } = setup();
    await expect(hook.result.current.setActive({ templateId: 'tpl-1', expectedVersion: 1, isActive: true }))
      .rejects.toMatchObject({ code: 'remote_followup_templates_mutation_limit_reached' });
  });

  it('followup_template_conflict (version desatualizada) é mapeado corretamente', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'followup_template_conflict' } });
    const { hook } = setup();
    await expect(hook.result.current.setActive({ templateId: 'tpl-1', expectedVersion: 1, isActive: false }))
      .rejects.toMatchObject({ code: 'remote_followup_templates_mutation_conflict' });
  });

  it('writeAuthorized=false: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ writeAuthorized: false });
    await expect(hook.result.current.setActive({ templateId: 'tpl-1', expectedVersion: 1, isActive: false })).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sucesso invalida as 3 keys da empresa', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.setActive({ templateId: 'tpl-1', expectedVersion: 1, isActive: false });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.management('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.platform('company-a') });
  });
});
