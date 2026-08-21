// Testes de lib/deals/labels.ts (COMMERCIAL-REMOTE-DEALS-B2-A). Puro.
import { describe, expect, it } from 'vitest';
import { DEAL_STATUS_LABELS_PT, DEAL_PAYMENT_METHOD_LABELS_PT } from '@/lib/deals/labels';

describe('DEAL_STATUS_LABELS_PT', () => {
  it('exatamente 3 chaves: open/lost/sold', () => {
    expect(Object.keys(DEAL_STATUS_LABELS_PT).sort()).toEqual(['lost', 'open', 'sold']);
  });

  it('labels corretos, sem vocabulário de aprovação removido', () => {
    expect(DEAL_STATUS_LABELS_PT.open).toBe('Em negociação');
    expect(DEAL_STATUS_LABELS_PT.lost).toBe('Perdida');
    expect(DEAL_STATUS_LABELS_PT.sold).toBe('Vendida');
    const values = Object.values(DEAL_STATUS_LABELS_PT);
    for (const forbidden of ['Em aberto', 'Aguardando aprovação', 'Aprovada', 'Recusada']) {
      expect(values).not.toContain(forbidden);
    }
  });
});

describe('DEAL_PAYMENT_METHOD_LABELS_PT', () => {
  it('exatamente 4 chaves, mesmos valores do enum remoto', () => {
    expect(Object.keys(DEAL_PAYMENT_METHOD_LABELS_PT).sort()).toEqual([
      'a_vista',
      'entrada_financiamento',
      'financiamento_100',
      'troca',
    ]);
  });

  it('labels idênticos aos 4 valores de PAYS (FlowsShared.tsx)', () => {
    expect(DEAL_PAYMENT_METHOD_LABELS_PT.a_vista).toBe('À vista');
    expect(DEAL_PAYMENT_METHOD_LABELS_PT.financiamento_100).toBe('Financiamento 100%');
    expect(DEAL_PAYMENT_METHOD_LABELS_PT.entrada_financiamento).toBe('Entrada + Financiamento');
    expect(DEAL_PAYMENT_METHOD_LABELS_PT.troca).toBe('Troca');
  });
});
