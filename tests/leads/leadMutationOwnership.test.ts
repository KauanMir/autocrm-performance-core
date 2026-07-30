// Testes de lib/leads/leadMutationOwnership.ts (M1-E, E5-A1). Função pura —
// sem mocks. Prova a matriz de posse por Lead que o E5-B1/B2 vai consumir:
// Manager em qualquer Lead da empresa; Seller só no próprio; capability
// false sempre vence (nenhuma posse supre uma capability desligada).
import { describe, expect, it } from 'vitest';
import { canActorMutateLead } from '@/lib/leads/leadMutationOwnership';

describe('canActorMutateLead — capability desligada sempre vence', () => {
  it('Manager com capability false: negado', () => {
    expect(canActorMutateLead({ capability: false, actorRole: 'manager' })).toBe(false);
  });
  it('Seller no próprio Lead com capability false: negado', () => {
    expect(canActorMutateLead({
      capability: false, actorRole: 'seller', actorSellerId: 's1', leadSellerId: 's1',
    })).toBe(false);
  });
});

describe('canActorMutateLead — Manager operacional', () => {
  it('capability true: autorizado em qualquer Lead da empresa (nenhuma checagem de sellerId)', () => {
    expect(canActorMutateLead({ capability: true, actorRole: 'manager' })).toBe(true);
    expect(canActorMutateLead({ capability: true, actorRole: 'manager', leadSellerId: 's-qualquer' })).toBe(true);
  });
});

describe('canActorMutateLead — Seller operacional', () => {
  it('leadSellerId === actorSellerId: autorizado', () => {
    expect(canActorMutateLead({
      capability: true, actorRole: 'seller', actorSellerId: 's1', leadSellerId: 's1',
    })).toBe(true);
  });

  it('Lead de outro Seller: negado', () => {
    expect(canActorMutateLead({
      capability: true, actorRole: 'seller', actorSellerId: 's1', leadSellerId: 's2',
    })).toBe(false);
  });

  it('Lead sem Seller (leadSellerId null/undefined): negado', () => {
    expect(canActorMutateLead({ capability: true, actorRole: 'seller', actorSellerId: 's1', leadSellerId: null })).toBe(false);
    expect(canActorMutateLead({ capability: true, actorRole: 'seller', actorSellerId: 's1' })).toBe(false);
  });

  it('Seller sem sellerId próprio resolvido: negado, mesmo com leadSellerId presente', () => {
    expect(canActorMutateLead({ capability: true, actorRole: 'seller', actorSellerId: null, leadSellerId: 's1' })).toBe(false);
    expect(canActorMutateLead({ capability: true, actorRole: 'seller', leadSellerId: 's1' })).toBe(false);
  });
});

describe('canActorMutateLead — actorRole ausente/desconhecido', () => {
  it('null/undefined: sempre negado, mesmo com capability true', () => {
    expect(canActorMutateLead({ capability: true, actorRole: null })).toBe(false);
    expect(canActorMutateLead({ capability: true, actorRole: undefined })).toBe(false);
  });
});
