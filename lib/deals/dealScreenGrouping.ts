// lib/deals/dealScreenGrouping.ts — view-model puro para o cutover de
// leitura de ScreenPropostas/Negociações (COMMERCIAL-REMOTE-DEALS-B3). Sem
// React, sem rede, sem window/localStorage — só transforma
// RemoteDealModel[] (já adaptado, lib/deals/adapter.ts) em agrupamentos/
// textos de apresentação. Mesmo papel exato de
// lib/visits/visitScreenGrouping.ts (B3 de Visits) — cópia deliberada do
// padrão (não importada): Deals nunca depende de módulos de Visits/Tasks
// (mesma independência entre os quatro domínios comerciais já documentada
// em lib/visits/remoteVisitsMode.ts).
import type { RemoteDealModel } from '@/lib/deals/adapter';

export interface DealScreenGroups {
  open: RemoteDealModel[];
  lost: RemoteDealModel[];
  sold: RemoteDealModel[];
}

// Agrupamento exclusivo por status — nenhuma inferência adicional (nunca
// deriva status de updatedAt/discountPercent/Tasks/Visits, B3-PRECHECK
// §22). Preserva a ordem recebida (repository já ordena created_at DESC,
// id ASC) — nenhum resort client-side (B3-PRECHECK §19/§21).
export function groupDealsForScreen(deals: readonly RemoteDealModel[]): DealScreenGroups {
  const groups: DealScreenGroups = { open: [], lost: [], sold: [] };
  for (const deal of deals) {
    if (deal.status === 'open') groups.open.push(deal);
    else if (deal.status === 'lost') groups.lost.push(deal);
    else groups.sold.push(deal);
  }
  return groups;
}

export const DEAL_SELLER_UNAVAILABLE_DISPLAY_VALUE = 'Vendedor indisponível';

// Primeiro nome apenas quando o nome resolvido é real (mesma convenção de
// resolveVisitSellerDisplayName) — nunca faz split do placeholder neutro,
// que já é a mensagem inteira a ser exibida.
export function resolveDealSellerDisplayName(
  assignedSellerId: string,
  sellersById: Readonly<Record<string, { id: string; name: string }>>,
): string {
  const seller = sellersById[assignedSellerId];
  if (!seller) return DEAL_SELLER_UNAVAILABLE_DISPLAY_VALUE;
  const firstName = seller.name.split(' ')[0]?.trim();
  return firstName || seller.name;
}

function startOfDealLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// `now` é sempre parâmetro explícito (nunca um `new Date()` interno) — o
// chamador (ScreenPropostas) calcula uma única vez por render, mesmo
// padrão de groupVisitsForScreen. Isso também torna o formatter
// determinístico em teste sem precisar de vi.setSystemTime (B3-PRECHECK
// §20/§40: "não criar teste dependente do horário real da máquina").
// Só três casos, de propósito (clareza > sofisticação, B3-PRECHECK §18):
// nenhum bucket "há N dias".
export function formatDealUpdatedAt(updatedAt: string, now: Date): string {
  const updated = new Date(updatedAt);
  const today = startOfDealLocalDay(now).getTime();
  const updatedDay = startOfDealLocalDay(updated).getTime();
  const diffDays = Math.round((today - updatedDay) / MS_PER_DAY);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  return `${pad2(updated.getDate())}/${pad2(updated.getMonth() + 1)}`;
}
