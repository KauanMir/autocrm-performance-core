// Testes de useCompleteTask (COMMERCIAL-REMOTE-B1-B2-C2-A). Supabase
// mockado (rpc). Cobre: payload mínimo, invalidação de sucesso, política
// de invalidação por conflito (stale_write/already_completed/
// task_not_found invalidam; forbidden não), retry 0, proteção de geração
// em ambos os caminhos — mesmo padrão crítico de useCreateTask/
// useUpdateTask (§34 — sem repetir mode/identity gating já cobertos lá).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompleteTask, type UseCompleteTaskOptions, type CompleteTaskCallInput } from '@/lib/hooks/useCompleteTask';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveTaskRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/tasks/remoteTasksMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/remoteTasksMode')>();
  return { ...actual, resolveTaskRemoteMode: mocks.resolveTaskRemoteMode };
});

const COMPLETED = {
  id: 'task-1', company_id: 'company-a', lead_id: 'lead-1', assigned_seller_id: 's1',
  title: 'Ligar para Carlos', note: '', priority: 'alta', status: 'completed',
  due_at: '2026-08-21T17:00:00+00:00', completed_at: '2026-08-21T18:00:00+00:00',
  created_by: 'profile-1', updated_by: 'profile-1', completed_by: 'profile-1',
  created_at: '2026-08-20T10:00:00+00:00', updated_at: '2026-08-21T18:00:00+00:00', version: 2,
};

function baseOptions(overrides: Partial<UseCompleteTaskOptions> = {}): UseCompleteTaskOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseCompleteTaskOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseCompleteTaskOptions) => useCompleteTask(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const input: CompleteTaskCallInput = { taskId: 'task-1', expectedVersion: 1 };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: COMPLETED, error: null });
  mocks.resolveTaskRemoteMode.mockReset().mockReturnValue('task_remote_ready');
});

describe('useCompleteTask — mode/identity gating (amostra)', () => {
  it('mode=task_remote_misconfigured: bloqueia sem chamar o Supabase', async () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_misconfigured');
    const { hook } = setup();
    await expect(hook.result.current.completeTask(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem identidade (userId ausente): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userId: null });
    await expect(hook.result.current.completeTask(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCompleteTask — payload mínimo', () => {
  it('envia SOMENTE p_id/p_expected_version', async () => {
    const { hook } = setup();
    await hook.result.current.completeTask(input);
    expect(mocks.rpc).toHaveBeenCalledWith('complete_task', {
      p_id: 'task-1',
      p_expected_version: 1,
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(2);
  });
});

describe('useCompleteTask — retry e invalidação de sucesso', () => {
  it('retry 0', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.completeTask(input)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso invalida SOMENTE taskQueryKeys.active(companyId capturado), uma vez — Task concluída sai do pending via refetch', async () => {
    const { hook, invalidateSpy } = setup();
    const result = await hook.result.current.completeTask(input);
    expect(result).toEqual(COMPLETED);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.active('company-a') });
  });
});

describe('useCompleteTask — política de invalidação por conflito (§15)', () => {
  it('stale_write: erro preservado + invalida active Tasks', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.completeTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_stale_write',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('already_completed: erro preservado + invalida active Tasks', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'already_completed' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.completeTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_already_completed',
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('task_not_found: erro preservado + invalida active Tasks', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'task_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.completeTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_task_not_found',
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('forbidden: erro preservado, ZERO invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.completeTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_forbidden',
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useCompleteTask — proteção de geração de cache (§0, AMBOS os caminhos)', () => {
  it('geração muda, resposta RESOLVE com sucesso: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.completeTask(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: COMPLETED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('CRÍTICO (§17): geração muda, resposta REJEITA com already_completed real — identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.completeTask(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'already_completed' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração estável: invalida normalmente', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, invalidateSpy } = setup();

    const promise = hook.result.current.completeTask(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    resolveRpc({ data: COMPLETED, error: null });

    await expect(promise).resolves.toEqual(COMPLETED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.active('company-a') });
  });
});
