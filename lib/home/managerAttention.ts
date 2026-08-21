// lib/home/managerAttention.ts — view-model puro para a seção Manager-only
// "Equipe precisa de atenção" da Home (COMMERCIAL-REMOTE-DEALS-B7-B2). Sem
// React, sem rede, sem now/relógio — só agrupa rows JÁ carregadas/JÁ
// classificadas (Home decide readiness/loading/error, nunca este helper).
// Mesmo papel exato de lib/deals/dealScreenGrouping.ts/
// lib/visits/visitScreenGrouping.ts: transforma um array já resolvido em
// apresentação, nada mais.
//
// Tasks e Deals nunca compartilham uma linha — cada domínio tem seu próprio
// agrupamento independente (B7-B2-PRECHECK §5/§8: readiness/loading/error
// são independentes por domínio, uma linha combinada mostraria dado parcial
// como se fosse completo).
//
// lateTasks/openDeals chegam PRÉ-FILTRADOS pelo chamador (mesmo array já
// usado por useHomeTasksSummary.lateCount/useHomeDealsSummary.openCount) —
// este helper nunca reclassifica overdue nem status, apenas agrupa por
// Seller. RemoteTaskModel.state já vem de deriveTaskState() no momento da
// adaptação (lib/tasks/taskAdapter.ts) — nenhuma dependência de Date aqui.
import type { RemoteTaskModel } from '@/lib/tasks/taskAdapter';
import type { RemoteDealModel } from '@/lib/deals/adapter';

export interface SellerAttentionRow {
  sellerId: string;
  sellerLabel: string;
  count: number;
}

// Mesma constante/copy de DEAL_SELLER_UNAVAILABLE_DISPLAY_VALUE/
// VISIT_SELLER_UNAVAILABLE_DISPLAY_VALUE — um único bucket agregando todo
// sellerId não resolvido em sellersById (incluindo assignedTo===null de
// Tasks e ids antigos/inativos fora do catálogo atual). Nunca descarta a
// contagem, nunca fragmenta em buckets por id desconhecido individual.
export const SELLER_ATTENTION_UNAVAILABLE_LABEL = 'Vendedor indisponível';

const UNAVAILABLE_BUCKET_KEY = '__seller_attention_unavailable__';

function groupBySeller(
  sellerIds: readonly (string | null)[],
  sellersById: Readonly<Record<string, { id: string; name: string }>>,
): SellerAttentionRow[] {
  const counts = new Map<string, number>();
  for (const rawId of sellerIds) {
    const key = rawId !== null && sellersById[rawId] ? rawId : UNAVAILABLE_BUCKET_KEY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const rows: SellerAttentionRow[] = [];
  for (const [sellerId, count] of counts) {
    const sellerLabel = sellerId === UNAVAILABLE_BUCKET_KEY
      ? SELLER_ATTENTION_UNAVAILABLE_LABEL
      : sellersById[sellerId].name;
    rows.push({ sellerId, sellerLabel, count });
  }

  // count DESC, tie-break sellerLabel ASC — determinístico, sem score
  // combinado, sem regra especial para o bucket indisponível (participa do
  // mesmo sort que qualquer outro Seller, B7-B2-PRECHECK §37).
  rows.sort((a, b) => b.count - a.count || a.sellerLabel.localeCompare(b.sellerLabel));
  return rows;
}

export function groupLateTasksBySeller(
  lateTasks: readonly RemoteTaskModel[],
  sellersById: Readonly<Record<string, { id: string; name: string }>>,
): SellerAttentionRow[] {
  return groupBySeller(lateTasks.map((task) => task.assignedTo), sellersById);
}

export function groupOpenDealsBySeller(
  openDeals: readonly RemoteDealModel[],
  sellersById: Readonly<Record<string, { id: string; name: string }>>,
): SellerAttentionRow[] {
  return groupBySeller(openDeals.map((deal) => deal.assignedSellerId), sellersById);
}
