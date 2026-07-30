// Testes de lib/leads/localCommercialAccess.ts (M1-E, E5-B2-A1). Função
// pura — mocka lib/flags (única dependência) para controlar
// resolveRemoteLeadsFlagMode deterministicamente. Cobre: local permite,
// remote_ready bloqueia, remote_misconfigured bloqueia (falha fechada nos
// dois), nenhuma leitura de StoreAdapter/React envolvida.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isLocalCommercialDataAllowed,
  assertLocalCommercialDataAllowed,
  LocalCommercialDataDisabledError,
  isLocalCommercialDataDisabledError,
} from '@/lib/leads/localCommercialAccess';

const mocks = vi.hoisted(() => ({
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...actual,
    isRemoteLeadsEnabled: mocks.isRemoteLeadsEnabled,
    isRemoteStagesEnabled: mocks.isRemoteStagesEnabled,
  };
});

beforeEach(() => {
  mocks.isRemoteLeadsEnabled.mockReset();
  mocks.isRemoteStagesEnabled.mockReset();
});

describe('isLocalCommercialDataAllowed', () => {
  it('REMOTE_LEADS=false (modo local): true', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(false);
    expect(isLocalCommercialDataAllowed()).toBe(true);
  });

  it('REMOTE_LEADS=true e REMOTE_STAGES=true (remote_ready): false', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    expect(isLocalCommercialDataAllowed()).toBe(false);
  });

  it('REMOTE_LEADS=true e REMOTE_STAGES=false (remote_misconfigured): false — falha fechada também aqui', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(false);
    expect(isLocalCommercialDataAllowed()).toBe(false);
  });
});

describe('assertLocalCommercialDataAllowed', () => {
  it('modo local: não lança', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(false);
    expect(() => assertLocalCommercialDataAllowed('Teste.op')).not.toThrow();
  });

  it('remote_ready: lança LocalCommercialDataDisabledError com o código estável e a operação', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    try {
      assertLocalCommercialDataAllowed('VisitService.create');
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(isLocalCommercialDataDisabledError(e)).toBe(true);
      if (isLocalCommercialDataDisabledError(e)) {
        expect(e.code).toBe('remote_commercial_local_data_disabled');
        expect(e.operation).toBe('VisitService.create');
        expect(e.message).toBe('remote_commercial_local_data_disabled');
      }
    }
  });

  it('remote_misconfigured: também lança', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(false);
    expect(() => assertLocalCommercialDataAllowed('DealService.getAll')).toThrow(LocalCommercialDataDisabledError);
  });
});

describe('isLocalCommercialDataDisabledError', () => {
  it('reconhece a instância própria e rejeita erros genéricos', () => {
    expect(isLocalCommercialDataDisabledError(new LocalCommercialDataDisabledError('x'))).toBe(true);
    expect(isLocalCommercialDataDisabledError(new Error('outro erro'))).toBe(false);
    expect(isLocalCommercialDataDisabledError(null)).toBe(false);
    expect(isLocalCommercialDataDisabledError(undefined)).toBe(false);
  });
});
