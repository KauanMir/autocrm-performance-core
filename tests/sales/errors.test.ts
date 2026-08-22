// Testes de lib/sales/errors.ts (COMMERCIAL-REMOTE-SALES-A2). Puro. Mesmo
// padrão de tests/deals/errors.test.ts.
import { describe, expect, it } from 'vitest';
import {
  RemoteSalesError,
  isRemoteSalesError,
  mapRemoteSalesMutationError,
  createSaleIdentityChangedMutationError,
  REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT,
  type RemoteSalesMutationErrorCode,
} from '@/lib/sales/errors';

describe('RemoteSalesError', () => {
  it('message é o código estável (nada interno vaza)', () => {
    const error = new RemoteSalesError('remote_sales_fetch_failed');
    expect(error.message).toBe('remote_sales_fetch_failed');
    expect(error.code).toBe('remote_sales_fetch_failed');
    expect(error.name).toBe('RemoteSalesError');
  });

  it('detail default é objeto vazio quando omitido', () => {
    const error = new RemoteSalesError('remote_sales_fetch_failed');
    expect(error.detail).toEqual({});
  });

  it('detail preserva somente o que foi passado explicitamente', () => {
    const error = new RemoteSalesError('remote_sales_fetch_failed', { code: '42501', message: 'permission denied' });
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
  });

  it('isRemoteSalesError reconhece a instância e rejeita outros erros', () => {
    expect(isRemoteSalesError(new RemoteSalesError('remote_sales_fetch_failed'))).toBe(true);
    expect(isRemoteSalesError(new Error('outro erro'))).toBe(false);
    expect(isRemoteSalesError('remote_sales_fetch_failed')).toBe(false);
    expect(isRemoteSalesError(null)).toBe(false);
    expect(isRemoteSalesError(undefined)).toBe(false);
  });

  it('é uma instância real de Error (compatível com try/catch/throw)', () => {
    const error = new RemoteSalesError('remote_sales_invalid_context');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('mapRemoteSalesMutationError — mapeamento exato mensagem→código', () => {
  const cases: [string, RemoteSalesMutationErrorCode][] = [
    ['forbidden', 'remote_sales_mutation_forbidden'],
    ['deal_not_found', 'remote_sales_mutation_deal_not_found'],
    ['deal_closed', 'remote_sales_mutation_deal_closed'],
    ['stale_write', 'remote_sales_mutation_stale_write'],
    ['invalid_value', 'remote_sales_mutation_invalid_value'],
    ['invalid_payment_method', 'remote_sales_mutation_invalid_payment_method'],
  ];

  it.each(cases)('mensagem "%s" → código %s', (backendMessage, expectedCode) => {
    const error = mapRemoteSalesMutationError({ code: 'P0001', message: backendMessage }, 'register_sale');
    expect(error.code).toBe(expectedCode);
    expect(error.detail).toEqual({ code: 'P0001', message: backendMessage, operation: 'register_sale' });
  });

  it('mensagem não reconhecida vira generic_error, NUNCA um código adivinhado', () => {
    const error = mapRemoteSalesMutationError({ code: '22P02', message: 'invalid input value for enum deal_payment_method' }, 'register_sale');
    expect(error.code).toBe('remote_sales_mutation_generic_error');
  });

  it('sem substring matching amplo: mensagem que CONTÉM "forbidden" mas não é exatamente "forbidden" cai no fallback', () => {
    const error = mapRemoteSalesMutationError({ message: 'forbidden: something else entirely' }, 'register_sale');
    expect(error.code).toBe('remote_sales_mutation_generic_error');
  });

  it('sem mensagem (undefined) vira generic_error', () => {
    const error = mapRemoteSalesMutationError({}, 'register_sale');
    expect(error.code).toBe('remote_sales_mutation_generic_error');
  });

  it('nenhum código de cancel/update/delete existe (Sale imutável, sem esses conceitos)', () => {
    for (const code of cases.map(([, c]) => c)) {
      expect(code).not.toMatch(/cancel|update|delete/i);
    }
  });

  it('detail nunca inclui campos extras do erro original (ex.: apikey)', () => {
    const error = mapRemoteSalesMutationError(
      { code: '42501', message: 'forbidden', apikey: 'nunca-copiar' } as { code: string; message: string },
      'register_sale',
    );
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
  });
});

describe('createSaleIdentityChangedMutationError', () => {
  it('código estável, operation preservada em detail', () => {
    const error = createSaleIdentityChangedMutationError('register_sale');
    expect(error.code).toBe('remote_sales_mutation_identity_changed');
    expect(error.detail).toEqual({ operation: 'register_sale' });
  });

  it('nunca vem do backend — só existe via chamada local explícita', () => {
    const error = mapRemoteSalesMutationError({ message: 'identity_changed' }, 'register_sale');
    expect(error.code).toBe('remote_sales_mutation_generic_error');
  });
});

describe('REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT', () => {
  it('uma mensagem PT-BR para cada código de mutation, nenhuma vazia', () => {
    const codes: RemoteSalesMutationErrorCode[] = [
      'remote_sales_mutation_forbidden',
      'remote_sales_mutation_deal_not_found',
      'remote_sales_mutation_deal_closed',
      'remote_sales_mutation_stale_write',
      'remote_sales_mutation_invalid_value',
      'remote_sales_mutation_invalid_payment_method',
      'remote_sales_mutation_identity_changed',
      'remote_sales_mutation_generic_error',
    ];
    for (const code of codes) {
      expect(REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT[code]).toBeTruthy();
      expect(typeof REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT[code]).toBe('string');
    }
  });

  it('nenhuma mensagem menciona aprovação/proposta (vocabulário do pivot: "negociação")', () => {
    for (const message of Object.values(REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT)) {
      expect(message.toLowerCase()).not.toContain('aprova');
      expect(message.toLowerCase()).not.toContain('proposta');
    }
  });

  it('mensagens específicas congeladas (stale_write/deal_closed)', () => {
    expect(REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT.remote_sales_mutation_stale_write)
      .toBe('Esta negociação foi alterada. Os dados foram atualizados.');
    expect(REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT.remote_sales_mutation_deal_closed)
      .toBe('Esta negociação já foi encerrada.');
  });
});
