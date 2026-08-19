// Testes de resolveTaskRemoteMode (COMMERCIAL-REMOTE-B1-B1). Puro: mocka as
// duas dependências diretas (isRemoteTasksEnabled + resolveRemoteLeadsFlagMode)
// para controlar deterministicamente a tabela-verdade de 4 estados —
// já cobertas isoladamente em tests/flags.test.ts e
// tests/leads/remoteLeadsMode.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';

const mocks = vi.hoisted(() => ({
  isRemoteTasksEnabled: vi.fn(),
  resolveRemoteLeadsFlagMode: vi.fn(),
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteTasksEnabled: mocks.isRemoteTasksEnabled };
});

vi.mock('@/lib/leads/remoteLeadsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/leads/remoteLeadsMode')>();
  return { ...actual, resolveRemoteLeadsFlagMode: mocks.resolveRemoteLeadsFlagMode };
});

beforeEach(() => {
  mocks.isRemoteTasksEnabled.mockReset();
  mocks.resolveRemoteLeadsFlagMode.mockReset();
});

describe('resolveTaskRemoteMode — tabela-verdade completa (B1-B1-EXEC §0)', () => {
  it('1. Stages=false, Leads=false, Tasks=false → task_local', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    mocks.isRemoteTasksEnabled.mockReturnValue(false);
    expect(resolveTaskRemoteMode()).toBe('task_local');
  });

  it('2. Stages=true, Leads=false, Tasks=false → task_local (Leads local domina, Stages sozinho não move nada)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    mocks.isRemoteTasksEnabled.mockReturnValue(false);
    expect(resolveTaskRemoteMode()).toBe('task_local');
  });

  it('3. Stages=true, Leads=true, Tasks=false → task_blocked (rollout parcial esperado, NUNCA local)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteTasksEnabled.mockReturnValue(false);
    expect(resolveTaskRemoteMode()).toBe('task_blocked');
  });

  it('4. Stages=true, Leads=true, Tasks=true → task_remote_ready', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteTasksEnabled.mockReturnValue(true);
    expect(resolveTaskRemoteMode()).toBe('task_remote_ready');
  });

  it('5. Stages=true, Leads=false, Tasks=true → task_remote_misconfigured (Tasks pediu remoto sem Leads pronto)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    mocks.isRemoteTasksEnabled.mockReturnValue(true);
    expect(resolveTaskRemoteMode()).toBe('task_remote_misconfigured');
  });

  it('6. Stages=false, Leads=true, Tasks=true → task_remote_misconfigured (propaga o remote_misconfigured de Leads)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    mocks.isRemoteTasksEnabled.mockReturnValue(true);
    expect(resolveTaskRemoteMode()).toBe('task_remote_misconfigured');
  });

  it('Leads remote_misconfigured + Tasks=false também propaga (nunca reinterpreta como blocked/local)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    mocks.isRemoteTasksEnabled.mockReturnValue(false);
    expect(resolveTaskRemoteMode()).toBe('task_remote_misconfigured');
  });

  it('nunca escreve nas dependências (somente leitura)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteTasksEnabled.mockReturnValue(true);
    resolveTaskRemoteMode();
    expect(mocks.resolveRemoteLeadsFlagMode).toHaveBeenCalledTimes(1);
    expect(mocks.isRemoteTasksEnabled).toHaveBeenCalledTimes(1);
  });

  it('os 4 valores possíveis são exatamente os 4 estados documentados (sem valor surpresa)', () => {
    const seen = new Set<string>();
    for (const leadsMode of ['local', 'remote_ready', 'remote_misconfigured'] as const) {
      for (const tasksEnabled of [true, false]) {
        mocks.resolveRemoteLeadsFlagMode.mockReturnValue(leadsMode);
        mocks.isRemoteTasksEnabled.mockReturnValue(tasksEnabled);
        seen.add(resolveTaskRemoteMode());
      }
    }
    expect(seen).toEqual(
      new Set(['task_local', 'task_blocked', 'task_remote_ready', 'task_remote_misconfigured']),
    );
  });
});
