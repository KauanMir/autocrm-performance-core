// Testes de lib/deals/dealScreenGrouping.ts (COMMERCIAL-REMOTE-DEALS-B3).
// Puro — sem mocks, sem React, sem Supabase.
import { describe, expect, it } from 'vitest';
import {
  groupDealsForScreen,
  resolveDealSellerDisplayName,
  formatDealUpdatedAt,
  DEAL_SELLER_UNAVAILABLE_DISPLAY_VALUE,
} from '@/lib/deals/dealScreenGrouping';
import type { RemoteDealModel } from '@/lib/deals/adapter';

function deal(over: Partial<RemoteDealModel> = {}): RemoteDealModel {
  return {
    id: 'deal-1', leadId: 'lead-1', clientName: 'Carlos Andrade', assignedSellerId: 's1',
    vehicle: 'Golf GTI 2022', valueCents: 12000000, discountPercent: 3,
    paymentMethod: 'financiamento_100', downPaymentCents: null, installments: null, note: '',
    status: 'open', lostBy: null, lostAt: null,
    createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-21T10:00:00Z', version: 1,
    ...over,
  };
}

describe('groupDealsForScreen', () => {
  it('agrupa por status exato — open/lost/sold, sem inferência', () => {
    const open1 = deal({ id: 'd1', status: 'open' });
    const lost1 = deal({ id: 'd2', status: 'lost' });
    const sold1 = deal({ id: 'd3', status: 'sold' });
    const open2 = deal({ id: 'd4', status: 'open' });

    const groups = groupDealsForScreen([open1, lost1, sold1, open2]);

    expect(groups.open).toEqual([open1, open2]);
    expect(groups.lost).toEqual([lost1]);
    expect(groups.sold).toEqual([sold1]);
  });

  it('preserva a ordem recebida dentro de cada status — nenhum resort', () => {
    const a = deal({ id: 'a', status: 'open', createdAt: '2026-08-20T00:00:00Z' });
    const b = deal({ id: 'b', status: 'open', createdAt: '2026-08-19T00:00:00Z' });
    const c = deal({ id: 'c', status: 'open', createdAt: '2026-08-21T00:00:00Z' });

    // Ordem de entrada é [a, b, c] (não ordenada por createdAt) — o
    // grouping preserva exatamente essa ordem, prova de que não reordena.
    const groups = groupDealsForScreen([a, b, c]);
    expect(groups.open.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('lista vazia produz os três grupos vazios', () => {
    const groups = groupDealsForScreen([]);
    expect(groups).toEqual({ open: [], lost: [], sold: [] });
  });

  it('nunca deriva status de discountPercent/updatedAt', () => {
    const highDiscountButOpen = deal({ id: 'd5', status: 'open', discountPercent: 10, updatedAt: '2020-01-01T00:00:00Z' });
    const groups = groupDealsForScreen([highDiscountButOpen]);
    expect(groups.open).toEqual([highDiscountButOpen]);
    expect(groups.lost).toEqual([]);
    expect(groups.sold).toEqual([]);
  });
});

describe('resolveDealSellerDisplayName', () => {
  it('resolve o primeiro nome quando o Seller existe no mapa', () => {
    const sellersById = { s1: { id: 's1', name: 'Ana Assignable' } };
    expect(resolveDealSellerDisplayName('s1', sellersById)).toBe('Ana');
  });

  it('fallback "Vendedor indisponível" quando o id não está no mapa', () => {
    expect(resolveDealSellerDisplayName('s-desconhecido', {})).toBe(DEAL_SELLER_UNAVAILABLE_DISPLAY_VALUE);
  });

  it('nome de uma palavra só: usa o nome inteiro, sem string vazia', () => {
    const sellersById = { s1: { id: 's1', name: 'Madonna' } };
    expect(resolveDealSellerDisplayName('s1', sellersById)).toBe('Madonna');
  });

  it('nunca faz split do placeholder — mensagem inteira preservada', () => {
    const result = resolveDealSellerDisplayName('s-ausente', {});
    expect(result).toBe('Vendedor indisponível');
    expect(result.split(' ')[0]).not.toBe(result);
  });
});

describe('formatDealUpdatedAt', () => {
  // Construção via Date local + toISOString() (nunca um offset UTC
  // hardcoded tipo "-03:00") — correto em qualquer timezone da máquina
  // que rodar o teste, mesma preocupação já registrada no B3-PRECHECK §18
  // ("não usar timezone de forma incorreta").
  it('mesmo dia local de "now" -> "Hoje"', () => {
    const now = new Date(2026, 7, 21, 15, 0, 0);
    const updatedToday = new Date(2026, 7, 21, 10, 0, 0).toISOString();
    expect(formatDealUpdatedAt(updatedToday, now)).toBe('Hoje');
  });

  it('dia anterior local -> "Ontem"', () => {
    const now = new Date(2026, 7, 21, 8, 0, 0);
    const updatedYesterday = new Date(2026, 7, 20, 23, 0, 0).toISOString();
    expect(formatDealUpdatedAt(updatedYesterday, now)).toBe('Ontem');
  });

  it('mais antigo -> dd/mm', () => {
    const now = new Date(2026, 7, 21, 8, 0, 0);
    const updatedOlder = new Date(2026, 7, 10, 12, 0, 0).toISOString();
    expect(formatDealUpdatedAt(updatedOlder, now)).toBe('10/08');
  });

  it('data futura (clock skew defensivo) -> dd/mm, nunca "Hoje"/"Ontem" incorretos', () => {
    const now = new Date(2026, 7, 21, 8, 0, 0);
    const updatedFuture = new Date(2026, 7, 25, 8, 0, 0).toISOString();
    expect(formatDealUpdatedAt(updatedFuture, now)).toBe('25/08');
  });

  it('determinístico — nunca depende do relógio real da máquina (now sempre explícito)', () => {
    const fixedNow = new Date(2026, 0, 1, 12, 0, 0);
    const updatedSameDay = new Date(2026, 0, 1, 0, 0, 1).toISOString();
    expect(formatDealUpdatedAt(updatedSameDay, fixedNow)).toBe('Hoje');
  });
});
