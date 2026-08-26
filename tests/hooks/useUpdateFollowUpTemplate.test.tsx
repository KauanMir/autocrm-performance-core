// Testes de useUpdateFollowUpTemplate (FOLLOW-UP-TEMPLATES-A3-EXEC). FULL
// REPLACE — todos os campos de conteúdo são obrigatórios no payload.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateFollowUpTemplate, type UseUpdateFollowUpTemplateOptions, type UpdateFollowUpTemplateInput } from '@/lib/hooks/useUpdateFollowUpTemplate';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: mocks.rpc }, isSupabaseConfigured: true }));

const ROW = {
  id: 'tpl-1', company_id: 'company-a', name: 'Editado', task_title: 'y', task_note: 'nota', priority: 'alta',
  offset_value: 3, offset_unit: 'day', default_time: '09:00', is_active: true, sort_order: 0,
  created_by: 'p1', updated_by: 'p1', created_at: 't', updated_at: 't', version: 2,
};

const input: UpdateFollowUpTemplateInput = {
  templateId: 'tpl-1', expectedVersion: 1, name: 'Editado', taskTitle: 'y', taskNote: 'nota',
  priority: 'alta', offsetValue: 3, offsetUnit: 'day', defaultTime: '09:00',
};

function setup(options: Partial<UseUpdateFollowUpTemplateOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    (opts: UseUpdateFollowUpTemplateOptions) => useUpdateFollowUpTemplate(opts),
    { wrapper, initialProps: { userId: 'user-1', companyId: 'company-a', writeAuthorized: true, isSuperAdminContext: false, ...options } },
  );
  return { invalidateSpy, hook };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: ROW, error: null });
});

describe('useUpdateFollowUpTemplate', () => {
  it('envia todos os campos (full replace), p_company_id null para Manager', async () => {
    const { hook } = setup();
    await hook.result.current.updateTemplate(input);
    expect(mocks.rpc).toHaveBeenCalledWith('update_followup_template', {
      p_id: 'tpl-1', p_expected_version: 1, p_name: 'Editado', p_task_title: 'y',
      p_task_note: 'nota', p_priority: 'alta', p_offset_value: 3, p_offset_unit: 'day',
      p_default_time: '09:00', p_company_id: null,
    });
  });

  it('Super Admin contextual: envia p_company_id explícito', async () => {
    const { hook } = setup({ isSuperAdminContext: true, companyId: 'company-x' });
    await hook.result.current.updateTemplate(input);
    expect(mocks.rpc.mock.calls[0][1].p_company_id).toBe('company-x');
  });

  it('followup_template_not_found mapeado corretamente (cross-company/id inexistente)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'followup_template_not_found' } });
    const { hook } = setup();
    await expect(hook.result.current.updateTemplate(input))
      .rejects.toMatchObject({ code: 'remote_followup_templates_mutation_not_found' });
  });

  it('followup_template_conflict (stale version) mapeado corretamente, nunca sobrescreve silenciosamente', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'followup_template_conflict' } });
    const { hook } = setup();
    await expect(hook.result.current.updateTemplate(input))
      .rejects.toMatchObject({ code: 'remote_followup_templates_mutation_conflict' });
  });

  it('Seller (writeAuthorized=false): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ writeAuthorized: false });
    await expect(hook.result.current.updateTemplate(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sucesso invalida as 3 keys da empresa', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.updateTemplate(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.management('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.platform('company-a') });
  });
});
