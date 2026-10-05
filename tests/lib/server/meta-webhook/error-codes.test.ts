// Classificação pura dos códigos internos de erro do processamento leadgen.
import { describe, expect, it } from 'vitest';
import {
  isMetaLeadErrorCode,
  isMetaLeadErrorRetryable,
  META_LEAD_ERROR_CODES,
  metaLeadErrorKind,
} from '@/lib/server/meta-webhook/error-codes';

describe('lista fechada de códigos', () => {
  it('contém exatamente os 15 códigos aprovados', () => {
    expect([...META_LEAD_ERROR_CODES].sort()).toEqual(
      [
        'token_decrypt_failed',
        'token_invalid',
        'graph_permission_missing',
        'graph_timeout',
        'graph_error',
        'graph_malformed',
        'lead_not_found',
        'crm_create_failed',
        'initial_stage_missing',
        'integration_not_found',
        'invalid_field_data',
        'missing_name',
        'missing_phone',
        'max_attempts',
        'event_expired',
      ].sort(),
    );
  });

  it('todo código tem classificação', () => {
    for (const code of META_LEAD_ERROR_CODES) {
      expect(['retryable', 'operational', 'terminal']).toContain(metaLeadErrorKind(code));
    }
  });

  it('isMetaLeadErrorCode aceita só códigos da lista', () => {
    expect(isMetaLeadErrorCode('graph_timeout')).toBe(true);
    expect(isMetaLeadErrorCode('lead_not_found')).toBe(true);
    expect(isMetaLeadErrorCode('Invalid param foo')).toBe(false);
    expect(isMetaLeadErrorCode('')).toBe(false);
    expect(isMetaLeadErrorCode(undefined)).toBe(false);
    expect(isMetaLeadErrorCode('object_not_found')).toBe(false);
  });
});

describe('lead_not_found', () => {
  it('existe e é retryable', () => {
    expect(isMetaLeadErrorCode('lead_not_found')).toBe(true);
    expect(metaLeadErrorKind('lead_not_found')).toBe('retryable');
    expect(isMetaLeadErrorRetryable('lead_not_found')).toBe(true);
  });
});

describe('classes', () => {
  it('retryable: falhas transitórias', () => {
    for (const code of ['graph_timeout', 'graph_error', 'graph_malformed', 'lead_not_found', 'crm_create_failed'] as const) {
      expect(metaLeadErrorKind(code)).toBe('retryable');
      expect(isMetaLeadErrorRetryable(code)).toBe(true);
    }
  });

  it('operational: reintenta mas exige ação do operador', () => {
    for (const code of [
      'token_decrypt_failed',
      'token_invalid',
      'graph_permission_missing',
      'initial_stage_missing',
    ] as const) {
      expect(metaLeadErrorKind(code)).toBe('operational');
      expect(isMetaLeadErrorRetryable(code)).toBe(true);
    }
  });

  it('terminal: nenhuma nova tentativa muda o resultado', () => {
    for (const code of [
      'integration_not_found',
      'invalid_field_data',
      'missing_name',
      'missing_phone',
      'max_attempts',
      'event_expired',
    ] as const) {
      expect(metaLeadErrorKind(code)).toBe('terminal');
      expect(isMetaLeadErrorRetryable(code)).toBe(false);
    }
  });
});
