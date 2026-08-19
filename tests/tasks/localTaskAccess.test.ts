// Testes de lib/tasks/localTaskAccess.ts (COMMERCIAL-REMOTE-B1-B1). Função
// pura — mocka lib/tasks/remoteTasksMode (única dependência) para controlar
// resolveTaskRemoteMode deterministicamente. Cobre os 4 estados: task_local
// permite, task_blocked/task_remote_ready/task_remote_misconfigured
// bloqueiam igualmente (falha fechada nos três, mesmo padrão de
// localCommercialAccess.test.ts).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isLocalTaskDataAllowed,
  assertLocalTaskDataAllowed,
  LocalTaskDataDisabledError,
  isLocalTaskDataDisabledError,
} from '@/lib/tasks/localTaskAccess';

const mocks = vi.hoisted(() => ({
  resolveTaskRemoteMode: vi.fn(),
}));

vi.mock('@/lib/tasks/remoteTasksMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/remoteTasksMode')>();
  return { ...actual, resolveTaskRemoteMode: mocks.resolveTaskRemoteMode };
});

beforeEach(() => {
  mocks.resolveTaskRemoteMode.mockReset();
});

describe('isLocalTaskDataAllowed', () => {
  it('task_local: true', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_local');
    expect(isLocalTaskDataAllowed()).toBe(true);
  });

  it('task_blocked: false (rollout parcial esperado também bloqueia local)', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_blocked');
    expect(isLocalTaskDataAllowed()).toBe(false);
  });

  it('task_remote_ready: false', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    expect(isLocalTaskDataAllowed()).toBe(false);
  });

  it('task_remote_misconfigured: false — falha fechada também aqui', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_misconfigured');
    expect(isLocalTaskDataAllowed()).toBe(false);
  });
});

describe('assertLocalTaskDataAllowed', () => {
  it('task_local: não lança', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_local');
    expect(() => assertLocalTaskDataAllowed('Teste.op')).not.toThrow();
  });

  it('task_blocked: lança LocalTaskDataDisabledError com o código estável e a operação', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_blocked');
    try {
      assertLocalTaskDataAllowed('TaskService.create');
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(isLocalTaskDataDisabledError(e)).toBe(true);
      if (isLocalTaskDataDisabledError(e)) {
        expect(e.code).toBe('remote_task_local_data_disabled');
        expect(e.operation).toBe('TaskService.create');
        expect(e.message).toBe('remote_task_local_data_disabled');
      }
    }
  });

  it('task_remote_ready: também lança', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    expect(() => assertLocalTaskDataAllowed('TaskService.update')).toThrow(LocalTaskDataDisabledError);
  });

  it('task_remote_misconfigured: também lança', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_misconfigured');
    expect(() => assertLocalTaskDataAllowed('TaskService.getAll')).toThrow(LocalTaskDataDisabledError);
  });
});

describe('isLocalTaskDataDisabledError', () => {
  it('reconhece a instância própria e rejeita erros genéricos', () => {
    expect(isLocalTaskDataDisabledError(new LocalTaskDataDisabledError('x'))).toBe(true);
    expect(isLocalTaskDataDisabledError(new Error('outro erro'))).toBe(false);
    expect(isLocalTaskDataDisabledError(null)).toBe(false);
    expect(isLocalTaskDataDisabledError(undefined)).toBe(false);
  });
});
