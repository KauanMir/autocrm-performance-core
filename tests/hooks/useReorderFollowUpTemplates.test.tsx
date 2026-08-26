// Testes de useReorderFollowUpTemplates (FOLLOW-UP-TEMPLATES-A3-EXEC).
// Cobre especialmente: payload ATÔMICO (uma única chamada RPC, nunca N
// updates individuais — precheck A3-EXEC §16).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useReorderFollowUpTemplates, type UseReorderFollowUpTemplatesOptions } from '@/lib/hooks/useReorderFollowUpTemplates';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: mocks.rpc }, isSupabaseConfigured: true }));

const ROWS = [
  { id: 'tpl-2', company_id: 'company-a', name: 'B', task_title: 'y', task_note: '', priority: 'media', offset_value: 1, offset_unit: 'day', default_time: null, is_active: true, sort_order: 0, created_by: 'p1', updated_by: 'p1', created_at: 't', updated_at: 't', version: 2 },
  { id: 'tpl-1', company_id: 'company-a', name: 'A', task_title: 'x', task_note: '', priority: 'media', offset_value: 1, offset_unit: 'day', default_time: null, is_active: true, sort_order: 1, created_by: 'p1', updated_by: 'p1', created_at: 't', updated_at: 't', version: 2 },
];

function setup(options: Partial<UseReorderFollowUpTemplatesOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    (opts: UseReorderFollowUpTemplatesOptions) => useReorderFollowUpTemplates(opts),
    { wrapper, initialProps: { userId: 'user-1', companyId: 'company-a', writeAuthorized: true, isSuperAdminContext: false, ...options } },
  );
  return { invalidateSpy, hook };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: ROWS, error: null });
});

describe('useReorderFollowUpTemplates', () => {
  it('envia UMA única chamada RPC com a lista completa (nunca N updates individuais)', async () => {
    const { hook } = setup();
    await hook.result.current.reorderTemplates(['tpl-2', 'tpl-1']);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('reorder_followup_templates', {
      p_ordered_ids: ['tpl-2', 'tpl-1'],
      p_company_id: null,
    });
  });

  it('nunca modifica o array recebido (envia uma cópia nova)', async () => {
    const { hook } = setup();
    const original = Object.freeze(['tpl-2', 'tpl-1']);
    await expect(hook.result.current.reorderTemplates(original)).resolves.toBeTruthy();
  });

  it('Super Admin contextual: envia p_company_id explícito', async () => {
    const { hook } = setup({ isSuperAdminContext: true, companyId: 'company-x' });
    await hook.result.current.reorderTemplates(['tpl-1']);
    expect(mocks.rpc.mock.calls[0][1].p_company_id).toBe('company-x');
  });

  it('followup_template_reorder_incomplete mapeado corretamente', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'followup_template_reorder_incomplete' } });
    const { hook } = setup();
    await expect(hook.result.current.reorderTemplates(['tpl-1']))
      .rejects.toMatchObject({ code: 'remote_followup_templates_mutation_reorder_incomplete' });
  });

  it('Seller (writeAuthorized=false): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ writeAuthorized: false });
    await expect(hook.result.current.reorderTemplates(['tpl-1'])).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sucesso invalida as 3 keys da empresa', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.reorderTemplates(['tpl-2', 'tpl-1']);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.management('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.platform('company-a') });
  });
});
