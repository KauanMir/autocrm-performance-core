// lib/sales/salesRanking.ts — view-model puro para o Ranking remoto de
// Resultados (COMMERCIAL-REMOTE-RESULTS-R1). Sem React, sem rede, sem
// now/relógio, sem filtro de role — recebe Sales JÁ carregadas e JÁ
// autorizadas pela RLS (Manager: company-wide; Seller: só as próprias —
// RLS é a única autoridade, este helper nunca decide quem vê o quê) e só
// agrega. Mesmo papel/mesma convenção de bucket único para sellerId não
// resolvido de lib/home/managerAttention.ts (groupBySeller), adaptado para
// as duas métricas v1 deste lote.
//
// V1: SOMENTE saleCount e revenueCents, por Seller. Nenhum score, meta,
// comissão, forecast, ticket médio, conversão ou ranking por número de
// negociações — fora de escopo deste lote (R1-EXEC §3, fica FUTURE).
import type { RemoteSaleModel } from '@/lib/sales/adapter';

export interface SalesRankingRow {
  sellerId: string;
  sellerLabel: string;
  saleCount: number;
  revenueCents: number;
}

// Mesma copy de DEAL_SELLER_UNAVAILABLE_DISPLAY_VALUE/SELLER_ATTENTION_
// UNAVAILABLE_LABEL — um único bucket agregando toda Sale cujo
// assignedSellerId não está (mais) em sellersById. Nunca descarta a venda,
// nunca fragmenta em uma linha por id desconhecido individual.
export const SALES_RANKING_UNAVAILABLE_LABEL = 'Vendedor indisponível';

const UNAVAILABLE_BUCKET_KEY = '__sales_ranking_unavailable__';

// saleCount DESC, revenueCents DESC, sellerLabel ASC — determinístico,
// nunca a ordem de chegada do array (R1-EXEC §15).
export function buildSalesRanking(
  sales: readonly RemoteSaleModel[],
  sellersById: Readonly<Record<string, { id: string; name: string }>>,
): SalesRankingRow[] {
  const rowsById = new Map<string, SalesRankingRow>();

  for (const sale of sales) {
    const known = sellersById[sale.assignedSellerId];
    const key = known ? sale.assignedSellerId : UNAVAILABLE_BUCKET_KEY;
    const existing = rowsById.get(key);
    if (existing) {
      existing.saleCount += 1;
      existing.revenueCents += sale.soldValueCents;
    } else {
      rowsById.set(key, {
        sellerId: key,
        sellerLabel: known ? known.name : SALES_RANKING_UNAVAILABLE_LABEL,
        saleCount: 1,
        revenueCents: sale.soldValueCents,
      });
    }
  }

  return Array.from(rowsById.values()).sort((a, b) =>
    b.saleCount - a.saleCount
    || b.revenueCents - a.revenueCents
    || a.sellerLabel.localeCompare(b.sellerLabel));
}
