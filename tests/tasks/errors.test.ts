// Testes de lib/tasks/errors.ts (COMMERCIAL-REMOTE-B1-B2-A). Mesmo padrão
// de tests/leads/errors.test.ts: mapRemoteTasksMutationError e
// createTaskIdentityChangedMutationError.
import { describe, expect, it } from 'vitest';
import {
  mapRemoteTasksMutationError,
  createTaskIdentityChangedMutationError,
  isRemoteTasksError,
  RemoteTasksError,
} from '@/lib/tasks/errors';

describe('mapRemoteTasksMutationError — os 9 códigos confirmados na migration #51', () => {
  const cases: Array<[string, string]> = [
    ['forbidden', 'remote_tasks_mutation_forbidden'],
    ['seller_required', 'remote_tasks_mutation_seller_required'],
    ['seller_not_found', 'remote_tasks_mutation_seller_not_found'],
    ['lead_not_found', 'remote_tasks_mutation_lead_not_found'],
    ['invalid_title', 'remote_tasks_mutation_invalid_title'],
    ['task_not_found', 'remote_tasks_mutation_task_not_found'],
    ['task_completed', 'remote_tasks_mutation_task_completed'],
    ['already_completed', 'remote_tasks_mutation_already_completed'],
    ['stale_write', 'remote_tasks_mutation_stale_write'],
  ];

  it.each(cases)('mensagem "%s" mapeia para o código "%s"', (message, expectedCode) => {
    const error = mapRemoteTasksMutationError({ code: '42501', message }, 'create_task');
    expect(error).toBeInstanceOf(RemoteTasksError);
    expect(error.code).toBe(expectedCode);
  });

  it('preserva code/message/operation em detail, sem outro campo', () => {
    const rawSupabaseError = { code: '42501', message: 'forbidden', apikey: 'nunca-copiar', details: 'interno' };
    const error = mapRemoteTasksMutationError(rawSupabaseError, 'create_task');
    expect(error.detail).toEqual({ code: '42501', message: 'forbidden', operation: 'create_task' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
  });
});

describe('mapRemoteTasksMutationError — mensagem desconhecida', () => {
  it('mensagem não reconhecida vira SEMPRE generic_error, nunca stale_write/forbidden por adivinhação', () => {
    const error = mapRemoteTasksMutationError({ code: 'XX000', message: 'algo_nunca_visto' }, 'update_task');
    expect(error.code).toBe('remote_tasks_mutation_generic_error');
    expect(error.detail.message).toBe('algo_nunca_visto');
  });

  it('sem message (undefined/não-string) também vira generic_error', () => {
    const error = mapRemoteTasksMutationError({ code: 'XX000' }, 'complete_task');
    expect(error.code).toBe('remote_tasks_mutation_generic_error');
    expect(error.detail.message).toBeUndefined();
  });

  it('raw Postgres nunca é exposto — message é sempre o código estável, não o texto original', () => {
    const error = mapRemoteTasksMutationError({ message: 'forbidden' }, 'create_task');
    expect(error.message).toBe('remote_tasks_mutation_forbidden');
    expect(error.message).not.toBe('forbidden');
  });
});

describe('createTaskIdentityChangedMutationError', () => {
  it('produz um RemoteTasksError com o código local, nunca vindo do backend', () => {
    const error = createTaskIdentityChangedMutationError('create_task');
    expect(isRemoteTasksError(error)).toBe(true);
    expect(error.code).toBe('remote_tasks_mutation_identity_changed');
    expect(error.detail.operation).toBe('create_task');
  });
});

describe('isRemoteTasksError', () => {
  it('reconhece a instância própria e rejeita erros genéricos', () => {
    expect(isRemoteTasksError(new RemoteTasksError('remote_tasks_fetch_failed'))).toBe(true);
    expect(isRemoteTasksError(new Error('outro erro'))).toBe(false);
    expect(isRemoteTasksError(null)).toBe(false);
    expect(isRemoteTasksError(undefined)).toBe(false);
  });
});
