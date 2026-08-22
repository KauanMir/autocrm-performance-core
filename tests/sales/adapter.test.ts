// Testes de lib/sales/adapter.ts (COMMERCIAL-REMOTE-SALES-A2). Puro —
// nenhum mock necessário. Mesmo padrão de tests/deals/adapter.test.ts.
import { describe, expect, it } from 'vitest';
import {
  adaptRemoteSaleRow,
  adaptRemoteSaleRows,
  isSaleAdapterError,
  type RemoteSaleRow,
} from '@/lib/sales/adapter';

function saleRow(overrides: Partial<RemoteSaleRow> = {}): RemoteSaleRow {
  return {
    id: 'sale-1',
    company_id: 'company-a',
    deal_id: 'deal-1',
    lead_id: 'lead-1',
    assigned_seller_id: 's1',
    sold_value_cents: 11500000,
    payment_method: 'a_vista',
    sold_by: 'profile-1',
    sold_at: '2026-08-22T10:00:00+00:00',
    created_at: '2026-08-22T10:00:00+00:00',
    ...overrides,
  };
}

describe('adaptRemoteSaleRow — caminho feliz', () => {
  it('mapeia todos os campos corretamente', () => {
    const result = adaptRemoteSaleRow(saleRow());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.id).toBe('sale-1');
    expect(result.sale.companyId).toBe('company-a');
    expect(result.sale.dealId).toBe('deal-1');
    expect(result.sale.leadId).toBe('lead-1');
    expect(result.sale.assignedSellerId).toBe('s1');
    expect(result.sale.soldValueCents).toBe(11500000);
    expect(result.sale.paymentMethod).toBe('a_vista');
    expect(result.sale.soldBy).toBe('profile-1');
    expect(result.sale.soldAt).toBe('2026-08-22T10:00:00+00:00');
    expect(result.sale.createdAt).toBe('2026-08-22T10:00:00+00:00');
  });

  it.each(['a_vista', 'financiamento_100', 'entrada_financiamento', 'troca'] as const)(
    'payment_method %s é aceito',
    (paymentMethod) => {
      const result = adaptRemoteSaleRow(saleRow({ payment_method: paymentMethod }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.sale.paymentMethod).toBe(paymentMethod);
    },
  );

  it('nenhum campo status/version existe no modelo (Sale imutável, sem sale_status neste V1)', () => {
    const result = adaptRemoteSaleRow(saleRow());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale).not.toHaveProperty('status');
    expect(result.sale).not.toHaveProperty('version');
    expect(result.sale).not.toHaveProperty('vehicle');
  });
});

describe('adaptRemoteSaleRow — validações (runtime guard, mesmo padrão de Deals)', () => {
  it('payment_method fora do enum → invalid_payment_method', () => {
    const result = adaptRemoteSaleRow(saleRow({ payment_method: 'boleto' as RemoteSaleRow['payment_method'] }));
    expect(isSaleAdapterError(result)).toBe(true);
    if (!isSaleAdapterError(result)) return;
    expect(result.code).toBe('invalid_payment_method');
    expect(result.saleId).toBe('sale-1');
  });

  it('sold_value_cents <= 0 → invalid_sold_value', () => {
    expect(isSaleAdapterError(adaptRemoteSaleRow(saleRow({ sold_value_cents: 0 })))).toBe(true);
    const result = adaptRemoteSaleRow(saleRow({ sold_value_cents: -100 }));
    expect(isSaleAdapterError(result)).toBe(true);
    if (!isSaleAdapterError(result)) return;
    expect(result.code).toBe('invalid_sold_value');
  });

  it('deal_id vazio/so-espacos → invalid_deal_id', () => {
    expect(isSaleAdapterError(adaptRemoteSaleRow(saleRow({ deal_id: '' })))).toBe(true);
    expect(isSaleAdapterError(adaptRemoteSaleRow(saleRow({ deal_id: '   ' })))).toBe(true);
  });

  it('lead_id vazio → invalid_lead_id', () => {
    const result = adaptRemoteSaleRow(saleRow({ lead_id: '' }));
    expect(isSaleAdapterError(result)).toBe(true);
    if (!isSaleAdapterError(result)) return;
    expect(result.code).toBe('invalid_lead_id');
  });

  it('assigned_seller_id vazio → invalid_seller_id', () => {
    const result = adaptRemoteSaleRow(saleRow({ assigned_seller_id: '' }));
    expect(isSaleAdapterError(result)).toBe(true);
    if (!isSaleAdapterError(result)) return;
    expect(result.code).toBe('invalid_seller_id');
  });

  it('sold_by vazio → invalid_sold_by', () => {
    const result = adaptRemoteSaleRow(saleRow({ sold_by: '' }));
    expect(isSaleAdapterError(result)).toBe(true);
    if (!isSaleAdapterError(result)) return;
    expect(result.code).toBe('invalid_sold_by');
  });
});

describe('adaptRemoteSaleRows — lista', () => {
  it('preserva a ordem recebida', () => {
    const rows = [saleRow({ id: 'sale-a' }), saleRow({ id: 'sale-b' })];
    const result = adaptRemoteSaleRows(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sales.map((s) => s.id)).toEqual(['sale-a', 'sale-b']);
  });

  it('falha determinística no PRIMEIRO registro inválido — nunca lista parcial', () => {
    const rows = [saleRow({ id: 'sale-a' }), saleRow({ id: 'sale-b', sold_value_cents: 0 }), saleRow({ id: 'sale-c' })];
    const result = adaptRemoteSaleRows(rows);
    expect(isSaleAdapterError(result)).toBe(true);
    if (!isSaleAdapterError(result)) return;
    expect(result.saleId).toBe('sale-b');
    expect(result.rowIndex).toBe(1);
  });

  it('lista vazia é sucesso vazio', () => {
    const result = adaptRemoteSaleRows([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sales).toEqual([]);
  });
});
