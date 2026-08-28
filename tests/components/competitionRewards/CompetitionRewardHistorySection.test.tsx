// COMPETITION-REWARDS-V1-B3-EXEC §26-§28/§31-§34/§54/§55 — histórico Manager
// (Ajustes → Competição) e o render puro compartilhado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { HistoryMonth } from '@/lib/competitionRewards/homeTypes';

const m = vi.hoisted(() => ({ useHistory: vi.fn() }));
vi.mock('@/lib/hooks/useCompetitionRewardHistory', () => ({ useCompetitionRewardHistory: m.useHistory }));

import { CompetitionRewardHistorySection, CompetitionRewardHistoryList } from '@/components/competitionRewards/CompetitionRewardHistorySection';

function month(over: Partial<HistoryMonth> = {}): HistoryMonth {
  return {
    competitionMonthId: 'cm-8', monthStart: '2026-08-01', hadCompetition: true, title: 'Agosto',
    rows: [
      { sellerId: 's1', sellerName: 'Lucas', rank: 1, saleCount: 12, completedVisitCount: 8, scheduledVisitCount: 21, rewardAmountCents: 100000, rewardText: null },
      { sellerId: 's2', sellerName: 'Fernanda', rank: 2, saleCount: 10, completedVisitCount: 11, scheduledVisitCount: 18, rewardAmountCents: 50000, rewardText: null },
    ],
    ...over,
  };
}

const PROPS = { userId: 'u-mgr', companyId: 'co-a', membershipRole: 'manager' as const };

beforeEach(() => {
  m.useHistory.mockReset().mockReturnValue({ status: 'ready', months: [month()] });
});

describe('CompetitionRewardHistorySection (Manager)', () => {
  it('standings completos com nome-snapshot, contagens-snapshot e prêmio-snapshot (§27/§31/§32/§33)', () => {
    render(<CompetitionRewardHistorySection {...PROPS} />);
    const aug = screen.getByTestId('history-month-2026-08-01');
    expect(aug).toHaveTextContent('Agosto 2026');
    const r1 = within(aug).getByTestId('history-row-2026-08-01-1');
    expect(r1).toHaveTextContent('Lucas');
    expect(r1).toHaveTextContent('12 vendas · 8 visitas · 21 agendamentos');
    expect(r1).toHaveTextContent('R$ 1.000,00');
    expect(within(aug).getByTestId('history-row-2026-08-01-2')).toHaveTextContent('Fernanda');
  });

  it('mês sem competição → "Sem competição no período." e nenhum ranking 0/0/0 (§28)', () => {
    m.useHistory.mockReturnValue({ status: 'ready', months: [month({ monthStart: '2026-09-01', competitionMonthId: 'cm-9', hadCompetition: false, rows: [], title: null })] });
    render(<CompetitionRewardHistorySection {...PROPS} />);
    expect(screen.getByTestId('history-no-competition-2026-09-01')).toHaveTextContent('Sem competição no período.');
    expect(screen.queryByTestId('history-row-2026-09-01-1')).toBeNull();
  });

  it('nenhum mês encerrado → empty state (não inventa meses — §26)', () => {
    m.useHistory.mockReturnValue({ status: 'ready', months: [] });
    render(<CompetitionRewardHistorySection {...PROPS} />);
    expect(screen.getByTestId('history-empty')).toBeInTheDocument();
  });

  it('loading / error', () => {
    m.useHistory.mockReturnValue({ status: 'loading' });
    const { rerender } = render(<CompetitionRewardHistorySection {...PROPS} />);
    expect(screen.getByTestId('history-loading')).toBeInTheDocument();
    m.useHistory.mockReturnValue({ status: 'error', retry: vi.fn() });
    rerender(<CompetitionRewardHistorySection {...PROPS} />);
    expect(screen.getByTestId('history-error')).toBeInTheDocument();
  });
});

describe('CompetitionRewardHistoryList (puro)', () => {
  it('linha sem prêmio no snapshot não mostra bloco de reward (nunca "Sem prêmio")', () => {
    render(<CompetitionRewardHistoryList months={[month({ rows: [
      { sellerId: 's3', sellerName: 'Bruno', rank: 3, saleCount: 4, completedVisitCount: 2, scheduledVisitCount: 5, rewardAmountCents: null, rewardText: null },
    ] })]} />);
    const row = screen.getByTestId('history-row-2026-08-01-3');
    expect(row).toHaveTextContent('Bruno');
    expect(row).not.toHaveTextContent('R$');
    expect(row).not.toHaveTextContent('Sem prêmio');
  });
});
