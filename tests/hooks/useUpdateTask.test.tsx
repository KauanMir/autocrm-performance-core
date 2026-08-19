// Testes de useUpdateTask (COMMERCIAL-REMOTE-B1-B2-C2-A). Supabase
// mockado (rpc). Cobre: payload full-replace completo, invalidação de
// sucesso, política de invalidação por conflito (stale_write/
// task_completed invalidam; forbidden não), retry 0, e proteção de
// geração em AMBOS os caminhos (sucesso e rejeição) — mesma suíte
// crítica de useCreateTask.test.tsx, sem repetir aqui os casos de mode/
// identity gating já exaustivamente cobertos lá (mesmo padrão de checagem
// reutilizado, §34 — evitar repetição inútil).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateTask, type UseUpdateTaskOptions, type UpdateTaskCallInput } from '@/lib/hooks/useUpdateTask';
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

const UPDATED = {
  id: 'task-1', company_id: 'company-a', lead_id: 'lead-1', assigned_seller_id: 's2',
  title: 'Título atualizado', note: 'Nota atualizada', priority: 'media', status: 'pending',
  due_at: '2026-08-22T18:00:00+00:00', completed_at: null, created_by: 'profile-1',
  updated_by: 'profile-1', completed_by: null, created_at: '2026-08-20T10:00:00+00:00',
  updated_at: '2026-08-22T18:00:00+00:00', version: 2,
};

function baseOptions(overrides: Partial<UseUpdateTaskOptions> = {}): UseUpdateTaskOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseUpdateTaskOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseUpdateTaskOptions) => useUpdateTask(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const input: UpdateTaskCallInput = {
  taskId: 'task-1',
  expectedVersion: 1,
  title: 'Título atualizado',
  note: 'Nota atualizada',
  priority: 'media',
  dueAt: '2026-08-22T18:00:00+00:00',
  assignedSellerId: 's2',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UPDATED, error: null });
  mocks.resolveTaskRemoteMode.mockReset().mockReturnValue('task_remote_ready');
});

describe('useUpdateTask — mode/identity gating (amostra, mesmo padrão de useCreateTask)', () => {
  it('mode=task_blocked: bloqueia sem chamar o Supabase', async () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_blocked');
    const { hook } = setup();
    await expect(hook.result.current.updateTask(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem identidade (companyId ausente): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.updateTask(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateTask — payload FULL REPLACE completo', () => {
  it('envia EXATAMENTE os 7 argumentos do full-replace', async () => {
    const { hook } = setup();
    await hook.result.current.updateTask(input);
    expect(mocks.rpc).toHaveBeenCalledWith('update_task', {
      p_id: 'task-1',
      p_expected_version: 1,
      p_title: 'Título atualizado',
      p_note: 'Nota atualizada',
      p_priority: 'media',
      p_due_at: '2026-08-22T18:00:00+00:00',
      p_assigned_seller_id: 's2',
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(7);
  });
});

describe('useUpdateTask — retry e invalidação de sucesso', () => {
  it('retry 0', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.updateTask(input)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso invalida SOMENTE taskQueryKeys.active(companyId capturado), uma vez', async () => {
    const { hook, invalidateSpy } = setup();
    const result = await hook.result.current.updateTask(input);
    expect(result).toEqual(UPDATED);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.active('company-a') });
  });
});

describe('useUpdateTask — política de invalidação por conflito (§15)', () => {
  it('stale_write: erro preservado + invalida active Tasks (cache pode estar desatualizado)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_stale_write',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.active('company-a') });
  });

  it('task_completed: erro preservado + invalida active Tasks', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'task_completed' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_task_completed',
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('task_not_found: erro preservado + invalida active Tasks', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'task_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_task_not_found',
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('forbidden: erro preservado, ZERO invalidação (não é problema de cache desatualizado)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateTask(input)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_forbidden',
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_title', 'remote_tasks_mutation_invalid_title'],
    ['seller_required', 'remote_tasks_mutation_seller_required'],
    ['seller_not_found', 'remote_tasks_mutation_seller_not_found'],
  ] as const)('%s (erro de validação): erro preservado, ZERO invalidação', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateTask(input)).rejects.toMatchObject({ code: expectedCode });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useUpdateTask — proteção de geração de cache (§0, AMBOS os caminhos)', () => {
  it('geração muda, resposta RESOLVE com sucesso: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.updateTask(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: UPDATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('CRÍTICO (§17): geração muda, resposta REJEITA com stale_write real — identity_changed (nunca stale_write), zero invalidação, mesmo sendo um código que normalmente invalidaria', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.updateTask(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'stale_write' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('§19: mesma company, identidade diferente (geração muda sem trocar companyId) — nenhuma invalidação da mutation antiga', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    // companyId permanece 'company-a' propositalmente — só a geração muda,
    // simulando logout/login de outra identidade na MESMA empresa.
    const { hook, queryClient, invalidateSpy } = setup({ userId: 'user-1' });

    const promise = hook.result.current.updateTask(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient); // simula resetQueryCache por troca de identidade
    resolveRpc({ data: UPDATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração estável: invalida normalmente', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, invalidateSpy } = setup();

    const promise = hook.result.current.updateTask(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    resolveRpc({ data: UPDATED, error: null });

    await expect(promise).resolves.toEqual(UPDATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.active('company-a') });
  });
});
