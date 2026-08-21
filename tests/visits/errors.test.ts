// Testes de lib/visits/errors.ts (COMMERCIAL-REMOTE-VISITS-B2-A read +
// B2-B mutations). Mesmo padrão de tests/tasks/errors.test.ts:
// mapRemoteVisitsMutationError e createVisitIdentityChangedMutationError.
import { describe, expect, it } from 'vitest';
import {
  mapRemoteVisitsMutationError,
  createVisitIdentityChangedMutationError,
  isRemoteVisitsError,
  RemoteVisitsError,
  REMOTE_VISITS_MUTATION_ERROR_MESSAGES_PT,
} from '@/lib/visits/errors';

describe('mapRemoteVisitsMutationError — os 11 códigos confirmados na migration #52', () => {
  const cases: Array<[string, string]> = [
    ['forbidden', 'remote_visits_mutation_forbidden'],
    ['seller_required', 'remote_visits_mutation_seller_required'],
    ['seller_not_found', 'remote_visits_mutation_seller_not_found'],
    ['lead_not_found', 'remote_visits_mutation_lead_not_found'],
    ['lead_archived', 'remote_visits_mutation_lead_archived'],
    ['client_name_required', 'remote_visits_mutation_client_name_required'],
    ['invalid_vehicles', 'remote_visits_mutation_invalid_vehicles'],
    ['visit_not_found', 'remote_visits_mutation_visit_not_found'],
    ['visit_closed', 'remote_visits_mutation_visit_closed'],
    ['invalid_status_transition', 'remote_visits_mutation_invalid_status_transition'],
    ['stale_write', 'remote_visits_mutation_stale_write'],
  ];

  it.each(cases)('mensagem "%s" mapeia para o código "%s"', (message, expectedCode) => {
    const error = mapRemoteVisitsMutationError({ code: '42501', message }, 'create_visit');
    expect(error).toBeInstanceOf(RemoteVisitsError);
    expect(error.code).toBe(expectedCode);
  });

  it('preserva code/message/operation em detail, sem outro campo', () => {
    const rawSupabaseError = { code: '42501', message: 'forbidden', apikey: 'nunca-copiar', details: 'interno' };
    const error = mapRemoteVisitsMutationError(rawSupabaseError, 'create_visit');
    expect(error.detail).toEqual({ code: '42501', message: 'forbidden', operation: 'create_visit' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
  });
});

describe('mapRemoteVisitsMutationError — mensagem desconhecida', () => {
  it('mensagem não reconhecida vira SEMPRE generic_error, nunca stale_write/forbidden por adivinhação', () => {
    const error = mapRemoteVisitsMutationError({ code: 'XX000', message: 'algo_nunca_visto' }, 'update_visit');
    expect(error.code).toBe('remote_visits_mutation_generic_error');
    expect(error.detail.message).toBe('algo_nunca_visto');
  });

  it('outcome fora do enum (rejeitado pelo Postgres como 22P02, nunca uma exceção de negócio) também vira generic_error', () => {
    const error = mapRemoteVisitsMutationError(
      { code: '22P02', message: 'invalid input value for enum visit_outcome: "lost"' },
      'register_visit_result',
    );
    expect(error.code).toBe('remote_visits_mutation_generic_error');
  });

  it('sem message (undefined/não-string) também vira generic_error', () => {
    const error = mapRemoteVisitsMutationError({ code: 'XX000' }, 'confirm_visit');
    expect(error.code).toBe('remote_visits_mutation_generic_error');
    expect(error.detail.message).toBeUndefined();
  });

  it('raw Postgres nunca é exposto — message é sempre o código estável, não o texto original', () => {
    const error = mapRemoteVisitsMutationError({ message: 'forbidden' }, 'create_visit');
    expect(error.message).toBe('remote_visits_mutation_forbidden');
    expect(error.message).not.toBe('forbidden');
  });
});

describe('createVisitIdentityChangedMutationError', () => {
  it('produz um RemoteVisitsError com o código local, nunca vindo do backend', () => {
    const error = createVisitIdentityChangedMutationError('create_visit');
    expect(isRemoteVisitsError(error)).toBe(true);
    expect(error.code).toBe('remote_visits_mutation_identity_changed');
    expect(error.detail.operation).toBe('create_visit');
  });
});

describe('isRemoteVisitsError', () => {
  it('reconhece a instância própria e rejeita erros genéricos', () => {
    expect(isRemoteVisitsError(new RemoteVisitsError('remote_visits_fetch_failed'))).toBe(true);
    expect(isRemoteVisitsError(new Error('outro erro'))).toBe(false);
    expect(isRemoteVisitsError(null)).toBe(false);
    expect(isRemoteVisitsError(undefined)).toBe(false);
  });
});

describe('REMOTE_VISITS_MUTATION_ERROR_MESSAGES_PT — cobertura completa (sem UI conectada ainda)', () => {
  it('possui exatamente uma mensagem para cada um dos 13 códigos de mutation', () => {
    const codes = [
      'remote_visits_mutation_forbidden',
      'remote_visits_mutation_seller_required',
      'remote_visits_mutation_seller_not_found',
      'remote_visits_mutation_lead_not_found',
      'remote_visits_mutation_lead_archived',
      'remote_visits_mutation_client_name_required',
      'remote_visits_mutation_invalid_vehicles',
      'remote_visits_mutation_visit_not_found',
      'remote_visits_mutation_visit_closed',
      'remote_visits_mutation_invalid_status_transition',
      'remote_visits_mutation_stale_write',
      'remote_visits_mutation_identity_changed',
      'remote_visits_mutation_generic_error',
    ] as const;
    for (const code of codes) {
      expect(typeof REMOTE_VISITS_MUTATION_ERROR_MESSAGES_PT[code]).toBe('string');
      expect(REMOTE_VISITS_MUTATION_ERROR_MESSAGES_PT[code].length).toBeGreaterThan(0);
    }
    expect(Object.keys(REMOTE_VISITS_MUTATION_ERROR_MESSAGES_PT)).toHaveLength(13);
  });
});
