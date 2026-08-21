// Testes de lib/deals/errors.ts (COMMERCIAL-REMOTE-DEALS-B2-A read +
// B2-B mutations). Puro.
import { describe, expect, it } from 'vitest';
import {
  RemoteDealsError,
  isRemoteDealsError,
  mapRemoteDealsMutationError,
  createDealIdentityChangedMutationError,
  REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT,
  type RemoteDealsMutationErrorCode,
} from '@/lib/deals/errors';

describe('RemoteDealsError', () => {
  it('message é o código estável (nada interno vaza)', () => {
    const error = new RemoteDealsError('remote_deals_fetch_failed');
    expect(error.message).toBe('remote_deals_fetch_failed');
    expect(error.code).toBe('remote_deals_fetch_failed');
    expect(error.name).toBe('RemoteDealsError');
  });

  it('detail default é objeto vazio quando omitido', () => {
    const error = new RemoteDealsError('remote_deals_fetch_failed');
    expect(error.detail).toEqual({});
  });

  it('detail preserva somente o que foi passado explicitamente', () => {
    const error = new RemoteDealsError('remote_deals_fetch_failed', { code: '42501', message: 'permission denied' });
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
  });

  it('isRemoteDealsError reconhece a instância e rejeita outros erros', () => {
    expect(isRemoteDealsError(new RemoteDealsError('remote_deals_fetch_failed'))).toBe(true);
    expect(isRemoteDealsError(new Error('outro erro'))).toBe(false);
    expect(isRemoteDealsError('remote_deals_fetch_failed')).toBe(false);
    expect(isRemoteDealsError(null)).toBe(false);
    expect(isRemoteDealsError(undefined)).toBe(false);
  });

  it('é uma instância real de Error (compatível com try/catch/throw)', () => {
    const error = new RemoteDealsError('remote_deals_invalid_context');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('mapRemoteDealsMutationError — mapeamento exato mensagem→código', () => {
  const cases: [string, RemoteDealsMutationErrorCode][] = [
    ['forbidden', 'remote_deals_mutation_forbidden'],
    ['lead_not_found', 'remote_deals_mutation_lead_not_found'],
    ['lead_archived', 'remote_deals_mutation_lead_archived'],
    ['seller_required', 'remote_deals_mutation_seller_required'],
    ['seller_not_found', 'remote_deals_mutation_seller_not_found'],
    ['invalid_vehicle', 'remote_deals_mutation_invalid_vehicle'],
    ['invalid_value', 'remote_deals_mutation_invalid_value'],
    ['invalid_discount', 'remote_deals_mutation_invalid_discount'],
    ['deal_not_found', 'remote_deals_mutation_deal_not_found'],
    ['deal_closed', 'remote_deals_mutation_deal_closed'],
    ['stale_write', 'remote_deals_mutation_stale_write'],
  ];

  it.each(cases)('mensagem "%s" → código %s', (backendMessage, expectedCode) => {
    const error = mapRemoteDealsMutationError({ code: 'P0001', message: backendMessage }, 'create_deal');
    expect(error.code).toBe(expectedCode);
    expect(error.detail).toEqual({ code: 'P0001', message: backendMessage, operation: 'create_deal' });
  });

  it('mensagem não reconhecida vira generic_error, NUNCA um código adivinhado', () => {
    const error = mapRemoteDealsMutationError({ code: '22P02', message: 'invalid input value for enum deal_payment_method' }, 'create_deal');
    expect(error.code).toBe('remote_deals_mutation_generic_error');
  });

  it('sem substring matching amplo: mensagem que CONTÉM "forbidden" mas não é exatamente "forbidden" cai no fallback', () => {
    const error = mapRemoteDealsMutationError({ message: 'forbidden: something else entirely' }, 'update_deal');
    expect(error.code).toBe('remote_deals_mutation_generic_error');
  });

  it('sem mensagem (undefined) vira generic_error', () => {
    const error = mapRemoteDealsMutationError({}, 'mark_deal_lost');
    expect(error.code).toBe('remote_deals_mutation_generic_error');
  });

  it('nenhum código de approval/pending_approval/reject existe (workflow removido no pivot)', () => {
    for (const code of cases.map(([, c]) => c)) {
      expect(code).not.toMatch(/approv|reject|pending/i);
    }
  });

  it('detail nunca inclui campos extras do erro original (ex.: apikey)', () => {
    const error = mapRemoteDealsMutationError(
      { code: '42501', message: 'forbidden', apikey: 'nunca-copiar' } as { code: string; message: string },
      'update_deal',
    );
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
  });
});

describe('createDealIdentityChangedMutationError', () => {
  it('código estável, operation preservada em detail', () => {
    const error = createDealIdentityChangedMutationError('update_deal');
    expect(error.code).toBe('remote_deals_mutation_identity_changed');
    expect(error.detail).toEqual({ operation: 'update_deal' });
  });

  it('nunca vem do backend — só existe via chamada local explícita', () => {
    // Nenhuma mensagem de backend mapeia para identity_changed (não está
    // no mapa REMOTE_DEALS_MUTATION_BACKEND_MESSAGE_CODES).
    const error = mapRemoteDealsMutationError({ message: 'identity_changed' }, 'update_deal');
    expect(error.code).toBe('remote_deals_mutation_generic_error');
  });
});

describe('REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT', () => {
  it('uma mensagem PT-BR para cada código de mutation, nenhuma vazia', () => {
    const codes: RemoteDealsMutationErrorCode[] = [
      'remote_deals_mutation_forbidden',
      'remote_deals_mutation_lead_not_found',
      'remote_deals_mutation_lead_archived',
      'remote_deals_mutation_seller_required',
      'remote_deals_mutation_seller_not_found',
      'remote_deals_mutation_invalid_vehicle',
      'remote_deals_mutation_invalid_value',
      'remote_deals_mutation_invalid_discount',
      'remote_deals_mutation_deal_not_found',
      'remote_deals_mutation_deal_closed',
      'remote_deals_mutation_stale_write',
      'remote_deals_mutation_identity_changed',
      'remote_deals_mutation_generic_error',
    ];
    for (const code of codes) {
      expect(REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT[code]).toBeTruthy();
      expect(typeof REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT[code]).toBe('string');
    }
  });

  it('nenhuma mensagem menciona aprovação/proposta (vocabulário do pivot: "negociação")', () => {
    for (const message of Object.values(REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT)) {
      expect(message.toLowerCase()).not.toContain('aprova');
      expect(message.toLowerCase()).not.toContain('proposta');
    }
  });

  it('mensagens específicas congeladas (stale_write/deal_closed/lead_archived)', () => {
    expect(REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT.remote_deals_mutation_stale_write)
      .toBe('Esta negociação foi alterada. Os dados foram atualizados.');
    expect(REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT.remote_deals_mutation_deal_closed)
      .toBe('Esta negociação já foi encerrada.');
    expect(REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT.remote_deals_mutation_lead_archived)
      .toBe('Este cliente já foi arquivado.');
  });
});
