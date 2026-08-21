// Testes de lib/deals/adapter.ts (COMMERCIAL-REMOTE-DEALS-B2-A). Puro —
// nenhum mock necessário, sem contexto externo (diferente de
// tests/visits/adapter.test.ts — client_name_snapshot já vem na row).
import { describe, expect, it } from 'vitest';
import {
  adaptRemoteDealRow,
  adaptRemoteDealRows,
  isDealAdapterError,
  type RemoteDealRow,
} from '@/lib/deals/adapter';

function dealRow(overrides: Partial<RemoteDealRow> = {}): RemoteDealRow {
  return {
    id: 'deal-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    client_name_snapshot: 'Carlos Andrade',
    assigned_seller_id: 's1',
    vehicle: 'Golf GTI 2022',
    value_cents: 12000000,
    discount_percent: 3,
    payment_method: 'financiamento_100',
    down_payment_cents: 2000000,
    installments: '48x de R$ 2.100',
    note: 'Cliente quer financiamento',
    status: 'open',
    lost_by: null,
    lost_at: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-21T10:00:00+00:00',
    version: 1,
    ...overrides,
  };
}

describe('adaptRemoteDealRow — caminho feliz', () => {
  it('mapeia todos os campos corretamente', () => {
    const result = adaptRemoteDealRow(dealRow());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deal.id).toBe('deal-1');
    expect(result.deal.leadId).toBe('lead-1');
    expect(result.deal.clientName).toBe('Carlos Andrade');
    expect(result.deal.assignedSellerId).toBe('s1');
    expect(result.deal.vehicle).toBe('Golf GTI 2022');
    expect(result.deal.valueCents).toBe(12000000);
    expect(result.deal.discountPercent).toBe(3);
    expect(result.deal.paymentMethod).toBe('financiamento_100');
    expect(result.deal.downPaymentCents).toBe(2000000);
    expect(result.deal.installments).toBe('48x de R$ 2.100');
    expect(result.deal.note).toBe('Cliente quer financiamento');
    expect(result.deal.status).toBe('open');
    expect(result.deal.lostBy).toBeNull();
    expect(result.deal.lostAt).toBeNull();
    expect(result.deal.createdAt).toBe('2026-08-20T10:00:00+00:00');
    expect(result.deal.updatedAt).toBe('2026-08-21T10:00:00+00:00');
    expect(result.deal.version).toBe(1);
  });

  it('down_payment_cents/installments nullable preservados como null', () => {
    const result = adaptRemoteDealRow(dealRow({ down_payment_cents: null, installments: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deal.downPaymentCents).toBeNull();
    expect(result.deal.installments).toBeNull();
  });

  it.each(['open', 'lost', 'sold'] as const)('status %s é aceito', (status) => {
    const overrides: Partial<RemoteDealRow> = { status };
    if (status === 'lost') Object.assign(overrides, { lost_by: 'profile-2', lost_at: '2026-08-21T12:00:00+00:00' });
    const result = adaptRemoteDealRow(dealRow(overrides));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deal.status).toBe(status);
  });

  it.each(['a_vista', 'financiamento_100', 'entrada_financiamento', 'troca'] as const)(
    'payment_method %s é aceito',
    (paymentMethod) => {
      const result = adaptRemoteDealRow(dealRow({ payment_method: paymentMethod }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.deal.paymentMethod).toBe(paymentMethod);
    },
  );

  it('lost com lost_by/lost_at preenchidos', () => {
    const result = adaptRemoteDealRow(
      dealRow({ status: 'lost', lost_by: 'profile-2', lost_at: '2026-08-21T12:00:00+00:00' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deal.lostBy).toBe('profile-2');
    expect(result.deal.lostAt).toBe('2026-08-21T12:00:00+00:00');
  });

  it('nenhum campo de approval workflow removido (approved/rejected) existe no modelo', () => {
    const result = adaptRemoteDealRow(dealRow());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deal).not.toHaveProperty('approvedBy');
    expect(result.deal).not.toHaveProperty('approvedAt');
    expect(result.deal).not.toHaveProperty('rejectedBy');
    expect(result.deal).not.toHaveProperty('rejectedAt');
  });
});

describe('adaptRemoteDealRow — validações (runtime guard, mesmo padrão de Visits/Tasks)', () => {
  it('status fora do enum → invalid_status', () => {
    const result = adaptRemoteDealRow(dealRow({ status: 'pending_approval' as RemoteDealRow['status'] }));
    expect(isDealAdapterError(result)).toBe(true);
    if (!isDealAdapterError(result)) return;
    expect(result.code).toBe('invalid_status');
    expect(result.dealId).toBe('deal-1');
  });

  it('payment_method fora do enum → invalid_payment_method', () => {
    const result = adaptRemoteDealRow(dealRow({ payment_method: 'boleto' as RemoteDealRow['payment_method'] }));
    expect(isDealAdapterError(result)).toBe(true);
    if (!isDealAdapterError(result)) return;
    expect(result.code).toBe('invalid_payment_method');
  });

  it('vehicle vazio/so-espacos → invalid_vehicle', () => {
    expect(isDealAdapterError(adaptRemoteDealRow(dealRow({ vehicle: '' })))).toBe(true);
    expect(isDealAdapterError(adaptRemoteDealRow(dealRow({ vehicle: '   ' })))).toBe(true);
  });

  it('value_cents <= 0 → invalid_value', () => {
    const result = adaptRemoteDealRow(dealRow({ value_cents: 0 }));
    expect(isDealAdapterError(result)).toBe(true);
    if (!isDealAdapterError(result)) return;
    expect(result.code).toBe('invalid_value');
  });

  it('discount_percent fora de 0..10 → invalid_discount', () => {
    expect(isDealAdapterError(adaptRemoteDealRow(dealRow({ discount_percent: -1 })))).toBe(true);
    expect(isDealAdapterError(adaptRemoteDealRow(dealRow({ discount_percent: 11 })))).toBe(true);
  });

  it('client_name_snapshot vazio/so-espacos → invalid_client_name', () => {
    const result = adaptRemoteDealRow(dealRow({ client_name_snapshot: '   ' }));
    expect(isDealAdapterError(result)).toBe(true);
    if (!isDealAdapterError(result)) return;
    expect(result.code).toBe('invalid_client_name');
  });

  it('version < 1 ou não-inteira → invalid_version', () => {
    expect(isDealAdapterError(adaptRemoteDealRow(dealRow({ version: 0 })))).toBe(true);
    expect(isDealAdapterError(adaptRemoteDealRow(dealRow({ version: 1.5 })))).toBe(true);
  });
});

describe('adaptRemoteDealRows — lista', () => {
  it('preserva a ordem recebida', () => {
    const rows = [dealRow({ id: 'deal-a' }), dealRow({ id: 'deal-b' })];
    const result = adaptRemoteDealRows(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals.map((d) => d.id)).toEqual(['deal-a', 'deal-b']);
  });

  it('falha determinística no PRIMEIRO registro inválido — nunca lista parcial', () => {
    const rows = [dealRow({ id: 'deal-a' }), dealRow({ id: 'deal-b', vehicle: '' }), dealRow({ id: 'deal-c' })];
    const result = adaptRemoteDealRows(rows);
    expect(isDealAdapterError(result)).toBe(true);
    if (!isDealAdapterError(result)) return;
    expect(result.dealId).toBe('deal-b');
    expect(result.rowIndex).toBe(1);
  });

  it('lista vazia é sucesso vazio', () => {
    const result = adaptRemoteDealRows([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals).toEqual([]);
  });
});
