// Testes de useCreateFollowUpTemplate (FOLLOW-UP-TEMPLATES-A3-EXEC).
// Supabase mockado (rpc), sem rede real. Mesmo molde de
// tests/hooks/useCreateTask.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateFollowUpTemplate, type UseCreateFollowUpTemplateOptions, type CreateFollowUpTemplateInput } from '@/lib/hooks/useCreateFollowUpTemplate';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const CREATED = {
  id: 'tpl-1', company_id: 'company-a', name: 'Cliente pediu para pensar',
  task_title: 'Retomar contato', task_note: '', priority: 'media',
  offset_value: 2, offset_unit: 'day', default_time: null, is_active: true, sort_order: 0,
  created_by: 'profile-1', updated_by: 'profile-1',
  created_at: '2026-08-26T10:00:00+00:00', updated_at: '2026-08-26T10:00:00+00:00', version: 1,
};

function baseOptions(overrides: Partial<UseCreateFollowUpTemplateOptions> = {}): UseCreateFollowUpTemplateOptions {
  return { userId: 'user-1', companyId: 'company-a', writeAuthorized: true, isSuperAdminContext: false, ...overrides };
}

function setup(options: Partial<UseCreateFollowUpTemplateOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseCreateFollowUpTemplateOptions) => useCreateFollowUpTemplate(opts), {
    wrapper, initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const input: CreateFollowUpTemplateInput = {
  name: 'Cliente pediu para pensar', taskTitle: 'Retomar contato', taskNote: '',
  priority: 'media', offsetValue: 2, offsetUnit: 'day', defaultTime: null,
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
});

describe('useCreateFollowUpTemplate — payload por ator', () => {
  it('Manager: nunca envia p_company_id (RPC ignora, backend deriva da membership)', async () => {
    const { hook } = setup({ isSuperAdminContext: false });
    await hook.result.current.createTemplate(input);
    expect(mocks.rpc).toHaveBeenCalledWith('create_followup_template', {
      p_name: 'Cliente pediu para pensar',
      p_task_title: 'Retomar contato',
      p_priority: 'media',
      p_offset_value: 2,
      p_offset_unit: 'day',
      p_task_note: '',
      p_default_time: null,
      p_sort_order: null,
      p_company_id: null,
    });
  });

  it('Super Admin contextual: SEMPRE envia p_company_id explícito', async () => {
    const { hook } = setup({ isSuperAdminContext: true, companyId: 'company-x' });
    await hook.result.current.createTemplate(input);
    expect(mocks.rpc.mock.calls[0][1].p_company_id).toBe('company-x');
  });
});

describe('useCreateFollowUpTemplate — identity/authorization gating', () => {
  it('writeAuthorized=false: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ writeAuthorized: false });
    await expect(hook.result.current.createTemplate(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem companyId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.createTemplate(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem userId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userId: null });
    await expect(hook.result.current.createTemplate(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCreateFollowUpTemplate — erros mapeados e retry', () => {
  it('retry 0 — sem reenvio automático', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.createTemplate(input)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('followup_template_limit_reached mapeado corretamente', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'followup_template_limit_reached' } });
    const { hook } = setup();
    await expect(hook.result.current.createTemplate(input)).rejects.toMatchObject({
      code: 'remote_followup_templates_mutation_limit_reached',
    });
  });

  it('sucesso invalida as 3 keys (active/management/platform) da empresa capturada', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.createTemplate(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.management('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: followUpTemplateQueryKeys.platform('company-a') });
  });

  it('erro real: nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'followup_template_invalid_name' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.createTemplate(input)).rejects.toBeTruthy();
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useCreateFollowUpTemplate — proteção de geração de cache', () => {
  it('geração muda ENQUANTO a RPC voa, resposta sucesso: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createTemplate(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_followup_templates_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração muda ENQUANTO a RPC voa, resposta rejeita: identity_changed, nunca o código de erro real', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createTemplate(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'followup_template_limit_reached' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_followup_templates_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_followup_templates_mutation_limit_reached' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
