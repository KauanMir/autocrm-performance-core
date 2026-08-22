// Testes de lib/sales/salesRanking.ts (COMMERCIAL-REMOTE-RESULTS-R1). Puro —
// sem mocks, sem React, sem Supabase, sem relógio: sales chega já
// carregada/já autorizada pela RLS (Manager: company-wide; Seller: só as
// próprias — o chamador decide o array, nunca este helper), o helper só
// agrega. Mesmo padrão de tests/home/managerAttention.test.ts.
import { describe, expect, it } from 'vitest';
import { buildSalesRanking, SALES_RANKING_UNAVAILABLE_LABEL } from '@/lib/sales/salesRanking';
import type { RemoteSaleModel } from '@/lib/sales/adapter';

function sale(over: Partial<RemoteSaleModel> = {}): RemoteSaleModel {
  return {
    id: 'sale-1', companyId: 'company-1', dealId: 'deal-1', leadId: 'lead-1',
    assignedSellerId: 's1', soldValueCents: 10000000, paymentMethod: 'a_vista',
    soldBy: 'user-1', soldAt: '2026-08-20T10:00:00Z', createdAt: '2026-08-20T10:00:00Z',
    ...over,
  };
}

const SELLERS_BY_ID = {
  s1: { id: 's1', name: 'Lucas Martins' },
  s2: { id: 's2', name: 'Fernanda Dias' },
};

describe('buildSalesRanking — agregação (R1-EXEC §17)', () => {
  it('Lucas: 3 Sales (100k+80k+70k) / Fernanda: 2 Sales (150k+120k) — Lucas primeiro por volume', () => {
    const rows = buildSalesRanking(
      [
        sale({ id: 's1a', assignedSellerId: 's1', soldValueCents: 10000000 }),
        sale({ id: 's1b', assignedSellerId: 's1', soldValueCents: 8000000 }),
        sale({ id: 's1c', assignedSellerId: 's1', soldValueCents: 7000000 }),
        sale({ id: 's2a', assignedSellerId: 's2', soldValueCents: 15000000 }),
        sale({ id: 's2b', assignedSellerId: 's2', soldValueCents: 12000000 }),
      ],
      SELLERS_BY_ID,
    );
    expect(rows).toEqual([
      { sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, revenueCents: 25000000 },
      { sellerId: 's2', sellerLabel: 'Fernanda Dias', saleCount: 2, revenueCents: 27000000 },
    ]);
  });

  it('sem SUM float: soma exata de centavos, sem arredondamento', () => {
    const rows = buildSalesRanking(
      [sale({ assignedSellerId: 's1', soldValueCents: 100 }), sale({ id: 's1b', assignedSellerId: 's1', soldValueCents: 199 })],
      SELLERS_BY_ID,
    );
    expect(rows[0].revenueCents).toBe(299);
  });
});

describe('buildSalesRanking — sort determinístico (R1-EXEC §15/§18)', () => {
  it('saleCount DESC tem prioridade sobre revenueCents', () => {
    const rows = buildSalesRanking(
      [
        sale({ id: 'a', assignedSellerId: 's2', soldValueCents: 90000000 }), // 1 venda, alta receita
        sale({ id: 'b', assignedSellerId: 's1', soldValueCents: 1000000 }),
        sale({ id: 'c', assignedSellerId: 's1', soldValueCents: 1000000 }), // 2 vendas, baixa receita
      ],
      SELLERS_BY_ID,
    );
    expect(rows.map((r) => r.sellerId)).toEqual(['s1', 's2']);
  });

  it('mesmo saleCount: maior revenueCents primeiro', () => {
    const rows = buildSalesRanking(
      [
        sale({ id: 'a', assignedSellerId: 's1', soldValueCents: 5000000 }),
        sale({ id: 'b', assignedSellerId: 's2', soldValueCents: 9000000 }),
      ],
      SELLERS_BY_ID,
    );
    expect(rows.map((r) => r.sellerId)).toEqual(['s2', 's1']);
  });

  it('mesmo saleCount e revenueCents: sellerLabel ASC (nunca a ordem do array)', () => {
    const rows = buildSalesRanking(
      [
        sale({ id: 'a', assignedSellerId: 's1', soldValueCents: 5000000 }), // Lucas — chega primeiro no array
        sale({ id: 'b', assignedSellerId: 's2', soldValueCents: 5000000 }), // Fernanda
      ],
      SELLERS_BY_ID,
    );
    expect(rows.map((r) => r.sellerLabel)).toEqual(['Fernanda Dias', 'Lucas Martins']);
  });
});

describe('buildSalesRanking — RLS é autoridade, nenhum filtro de role aqui (R1-EXEC §20)', () => {
  it('array já escopado por Seller (só a própria Sale): agrega exatamente o que recebeu', () => {
    const sellerScopedInput = [sale({ id: 'own-1', assignedSellerId: 's1', soldValueCents: 4000000 })];
    const rows = buildSalesRanking(sellerScopedInput, SELLERS_BY_ID);
    expect(rows).toEqual([{ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 1, revenueCents: 4000000 }]);
  });

  it('array company-wide (Manager): agrega todos os Sellers presentes, sem reintroduzir filtro', () => {
    const managerScopedInput = [
      sale({ id: 'a', assignedSellerId: 's1' }),
      sale({ id: 'b', assignedSellerId: 's2' }),
    ];
    const rows = buildSalesRanking(managerScopedInput, SELLERS_BY_ID);
    expect(rows.map((r) => r.sellerId).sort()).toEqual(['s1', 's2']);
  });
});

describe('buildSalesRanking — Vendedor indisponível (R1-EXEC §21)', () => {
  it('Sale com assignedSellerId fora de sellerLabels: não desaparece, revenue/count preservados', () => {
    const rows = buildSalesRanking(
      [sale({ id: 'a', assignedSellerId: 'ghost-1', soldValueCents: 3000000 })],
      SELLERS_BY_ID,
    );
    expect(rows).toEqual([{ sellerId: '__sales_ranking_unavailable__', sellerLabel: SALES_RANKING_UNAVAILABLE_LABEL, saleCount: 1, revenueCents: 3000000 }]);
  });

  it('IDs desconhecidos diferentes viram um único bucket agregado, nunca linhas separadas', () => {
    const rows = buildSalesRanking(
      [
        sale({ id: 'a', assignedSellerId: 'ghost-1', soldValueCents: 1000000 }),
        sale({ id: 'b', assignedSellerId: 'ghost-2', soldValueCents: 2000000 }),
      ],
      SELLERS_BY_ID,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].saleCount).toBe(2);
    expect(rows[0].revenueCents).toBe(3000000);
  });

  it('bucket indisponível participa do mesmo sort, nenhuma regra especial', () => {
    const rows = buildSalesRanking(
      [
        sale({ id: 'a', assignedSellerId: 'ghost-1' }),
        sale({ id: 'b', assignedSellerId: 's1' }),
      ],
      SELLERS_BY_ID,
    );
    // Empate 1x1: "Lucas Martins" < "Vendedor indisponível" alfabeticamente.
    expect(rows.map((r) => r.sellerLabel)).toEqual(['Lucas Martins', SALES_RANKING_UNAVAILABLE_LABEL]);
  });
});

describe('buildSalesRanking — zero-noise (R1-EXEC §8)', () => {
  it('Seller conhecido sem nenhuma Sale no array: ausente do resultado (nunca lista o catálogo inteiro com zeros)', () => {
    const rows = buildSalesRanking([sale({ assignedSellerId: 's1' })], SELLERS_BY_ID);
    expect(rows.find((r) => r.sellerId === 's2')).toBeUndefined();
  });

  it('array vazio produz resultado vazio', () => {
    expect(buildSalesRanking([], SELLERS_BY_ID)).toEqual([]);
  });
});
