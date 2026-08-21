// lib/visits/visitScreenGrouping.ts — view-model puro para o cutover de
// leitura de ScreenVisitas (COMMERCIAL-REMOTE-VISITS-B3). Sem React, sem
// rede, sem window/localStorage — só transforma RemoteVisitModel[] (já
// adaptado, lib/visits/adapter.ts) em agrupamentos/textos de apresentação.
//
// Cópia deliberada (não importada) do padrão now-como-parâmetro/
// comparação-por-dia-local já usado por lib/tasks/deriveTaskState.ts +
// lib/tasks/formatTaskWhen.ts — Visits nunca depende de módulos de Tasks
// (lib/visits/remoteVisitsMode.ts já documenta a independência entre os
// quatro domínios comerciais: Tasks/Visits/Deals/Sales).
import type { RemoteVisitModel } from '@/lib/visits/adapter';

const OPEN_STATUSES = new Set<RemoteVisitModel['status']>(['scheduled', 'confirmed']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Início do dia civil LOCAL (00:00, timezone do browser/runtime) — nunca
// UTC, nunca meio-dia, nunca epoch bruto.
export function startOfVisitLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface VisitScreenGroups {
  today: RemoteVisitModel[];
  tomorrow: RemoteVisitModel[];
  future: RemoteVisitModel[];
  pendingResult: RemoteVisitModel[];
}

// Regra de prioridade congelada no B3-PRECHECK §17: uma Visit
// scheduled/confirmed cujo INSTANTE já passou pertence somente a
// "Pendentes de resultado" — nunca também a Hoje/Amanhã/Próximos dias,
// mesmo quando scheduledAt cai no dia local de hoje. completed/canceled
// nunca entram em nenhum dos quatro grupos (histórico fora de escopo
// deste lote, B3-PRECHECK §5/§16).
//
// `now` é sempre o MESMO Date para todo o lote (nunca um `new Date()` por
// item) — evita um boundary inconsistente entre itens do mesmo render.
export function groupVisitsForScreen(
  visits: readonly RemoteVisitModel[],
  now: Date,
): VisitScreenGroups {
  const groups: VisitScreenGroups = { today: [], tomorrow: [], future: [], pendingResult: [] };
  const today = startOfVisitLocalDay(now).getTime();

  for (const visit of visits) {
    if (!OPEN_STATUSES.has(visit.status)) continue;

    const scheduledAtDate = new Date(visit.scheduledAt);
    if (scheduledAtDate.getTime() < now.getTime()) {
      groups.pendingResult.push(visit);
      continue;
    }

    // scheduledAt >= now (instante) implica dia-local(scheduledAt) >=
    // dia-local(now) — a comparação por dia é monotônica em relação ao
    // instante, então diffDays nunca é negativo neste ponto.
    const visitDay = startOfVisitLocalDay(scheduledAtDate).getTime();
    const diffDays = Math.round((visitDay - today) / MS_PER_DAY);

    if (diffDays === 0) groups.today.push(visit);
    else if (diffDays === 1) groups.tomorrow.push(visit);
    else groups.future.push(visit); // diffDays >= 2 por construção
  }

  return groups;
}

const WEEKDAY_ABBR_PT_BR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatVisitTime(scheduledAt: Date): string {
  return `${pad2(scheduledAt.getHours())}:${pad2(scheduledAt.getMinutes())}`;
}

// Usado só pelo grupo "Próximos dias" (B3-PRECHECK §19) — os outros três
// grupos já têm o dia implícito no próprio nome do grupo (Hoje/Amanhã), e
// "Pendentes de resultado" mostra a data por ser potencialmente de
// qualquer dia passado.
export function formatVisitShortDate(scheduledAt: Date): string {
  return `${WEEKDAY_ABBR_PT_BR[scheduledAt.getDay()]}, ${pad2(scheduledAt.getDate())}/${pad2(scheduledAt.getMonth() + 1)}`;
}

export const VISIT_REMOTE_STATUS_LABEL: Readonly<
  Record<RemoteVisitModel['status'], { tone: string; label: string; solid?: boolean }>
> = {
  scheduled: { tone: 'amber', label: 'Agendada' },
  confirmed: { tone: 'green', label: 'Confirmada' },
  canceled: { tone: 'red', label: 'Cancelada' },
  completed: { tone: 'green', label: 'Realizada', solid: true },
};

export const VISIT_SELLER_UNAVAILABLE_DISPLAY_VALUE = 'Vendedor indisponível';

// Primeiro nome apenas quando o nome resolvido é real (mesma convenção do
// legado, v.seller.split(' ')[0]) — nunca faz split do placeholder
// neutro, que já é a mensagem inteira a ser exibida.
export function resolveVisitSellerDisplayName(
  assignedSellerId: string,
  sellersById: Readonly<Record<string, { id: string; name: string }>>,
): string {
  const seller = sellersById[assignedSellerId];
  if (!seller) return VISIT_SELLER_UNAVAILABLE_DISPLAY_VALUE;
  const firstName = seller.name.split(' ')[0]?.trim();
  return firstName || seller.name;
}
