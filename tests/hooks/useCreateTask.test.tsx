// Testes de useCreateTask (COMMERCIAL-REMOTE-B1-B2-C2-A). Supabase
// mockado (rpc), sem rede real. Cobre: payload por actorRole, mode
// gating, identity gating, role mismatch (§6/§22), retry 0, invalidação
// de sucesso, e a proteção de geração de cache em AMBOS os caminhos —
// sucesso E rejeição (§0, correção crítica desta etapa — gap real que o
// precedente de Leads não fecha, ver lib/tasks/taskMutationGeneration.ts).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateTask, type UseCreateTaskOptions, type CreateTaskCallInput } from '@/lib/hooks/useCreateTask';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import { isRemoteTasksError } from '@/lib/tasks/errors';
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

const CREATED = {
  id: 'task-1', company_id: 'company-a', lead_id: 'lead-1', assigned_seller_id: 's1',
  title: 'Ligar para Carlos', note: '', priority: 'alta', status: 'pending',
  due_at: '2026-08-21T17:00:00+00:00', completed_at: null, created_by: 'profile-1',
  updated_by: 'profile-1', completed_by: null, created_at: '2026-08-20T10:00:00+00:00',
  updated_at: '2026-08-20T10:00:00+00:00', version: 1,
};

function baseOptions(overrides: Partial<UseCreateTaskOptions> = {}): UseCreateTaskOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseCreateTaskOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseCreateTaskOptions) => useCreateTask(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const managerInput: CreateTaskCallInput = {
  actorRole: 'manager',
  assignedSellerId: 's1',
  title: 'Ligar para Carlos',
  priority: 'alta',
  dueAt: '2026-08-21T17:00:00+00:00',
  leadId: 'lead-1',
  note: 'Retornar após o almoço',
};

const sellerInput: CreateTaskCallInput = {
  actorRole: 'seller',
  title: 'Ligar para Carlos',
  priority: 'alta',
  dueAt: '2026-08-21T17:00:00+00:00',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
  mocks.resolveTaskRemoteMode.mockReset().mockReturnValue('task_remote_ready');
});

describe('useCreateTask — payload por actorRole', () => {
  it('Manager: envia assignedSellerId, nunca p_company_id/status/version', async () => {
    const { hook } = setup();
    await hook.result.current.createTask(managerInput);
    expect(mocks.rpc).toHaveBeenCalledWith('create_task', {
      p_title: 'Ligar para Carlos',
      p_priority: 'alta',
      p_due_at: '2026-08-21T17:00:00+00:00',
      p_assigned_seller_id: 's1',
      p_lead_id: 'lead-1',
      p_note: 'Retornar após o almoço',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('version');
  });

  it('Seller: p_assigned_seller_id sempre null (tipo estruturalmente sem esse campo — backend autoatribui)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await hook.result.current.createTask(sellerInput);
    expect(mocks.rpc.mock.calls[0][1].p_assigned_seller_id).toBeNull();
  });
});

describe('useCreateTask — mode gating (§20)', () => {
  it.each(['task_local', 'task_blocked', 'task_remote_misconfigured'] as const)(
    'mode=%s: bloqueia sem chamar o Supabase',
    async (mode) => {
      mocks.resolveTaskRemoteMode.mockReturnValue(mode);
      const { hook } = setup();
      await expect(hook.result.current.createTask(managerInput)).rejects.toSatisfy((e: unknown) => isRemoteTasksError(e));
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});

describe('useCreateTask — identity gating (§21)', () => {
  it('sem companyId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.createTask(managerInput)).rejects.toSatisfy((e: unknown) => isRemoteTasksError(e));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem userId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userId: null });
    await expect(hook.result.current.createTask(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('usuário inativo: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.createTask(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.createTask(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCreateTask — consistência de role (§6/§22, CRÍTICO)', () => {
  it('hook Manager + input actorRole seller: bloqueia antes da RPC', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await expect(hook.result.current.createTask(sellerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('hook Seller + input actorRole manager: bloqueia antes da RPC', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.createTask(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('hook Manager + input actorRole manager + responsável: permitido', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await expect(hook.result.current.createTask(managerInput)).resolves.toEqual(CREATED);
  });

  it('hook Seller + input actorRole seller: permitido', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.createTask(sellerInput)).resolves.toEqual(CREATED);
  });
});

describe('useCreateTask — retry e invalidação de sucesso', () => {
  it('retry 0 — sem reenvio automático (create_task não é idempotente)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.createTask(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso invalida SOMENTE taskQueryKeys.active(companyId capturado), uma vez', async () => {
    const { hook, invalidateSpy } = setup();
    const created = await hook.result.current.createTask(managerInput);
    expect(created).toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.active('company-a') });
  });

  it('erro do backend (seller_not_found) vira RemoteTasksError mapeado, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.createTask(managerInput)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_seller_not_found',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useCreateTask — proteção de geração de cache (§0, AMBOS os caminhos)', () => {
  it('geração muda ENQUANTO a RPC ainda não resolveu, resposta RESOLVE com sucesso: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createTask(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('CRÍTICO (§17): geração muda ENQUANTO a RPC ainda não resolveu, resposta REJEITA (stale_write-like) — identity_changed, NUNCA o código de erro da geração antiga, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createTask(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    // Resposta real da RPC da geração ANTIGA é um erro de negócio real
    // (aqui, seller_not_found) — mesmo assim, NUNCA deve chegar como tal à
    // sessão nova.
    resolveRpc({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_tasks_mutation_seller_not_found' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração estável: invalida normalmente', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, invalidateSpy } = setup();

    const promise = hook.result.current.createTask(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).resolves.toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskQueryKeys.active('company-a') });
  });
});
