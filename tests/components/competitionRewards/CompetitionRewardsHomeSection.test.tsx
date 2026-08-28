// COMPETITION-REWARDS-V1-B3-EXEC §48-§53/§56/§57 — CompetitionRewardsHomeSection.
// Os 3 hooks são mockados (comportamento próprio já coberto). Este arquivo
// cobre o que a seção FAZ com o resultado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { RewardsOverview, HistoryMonth } from '@/lib/competitionRewards/homeTypes';
import { CompetitionRewardError } from '@/lib/competitionRewards/errors';

const m = vi.hoisted(() => ({
  useOverview: vi.fn(),
  useHistory: vi.fn(),
  useAck: vi.fn(),
  acknowledge: vi.fn(),
  ackPending: false,
}));

vi.mock('@/lib/hooks/useCompetitionRewardsOverview', () => ({ useCompetitionRewardsOverview: m.useOverview }));
vi.mock('@/lib/hooks/useCompetitionRewardHistory', () => ({ useCompetitionRewardHistory: m.useHistory }));
vi.mock('@/lib/hooks/useAcknowledgeCompetitionMonthResult', () => ({ useAcknowledgeCompetitionMonthResult: m.useAck }));

import { CompetitionRewardsHomeSection } from '@/components/competitionRewards/CompetitionRewardsHomeSection';

function overview(over: Partial<RewardsOverview> = {}): RewardsOverview {
  return {
    monthStart: '2026-08-01',
    campaign: {
      id: 'camp-1', status: 'published', title: null, totalAmountCents: 175000,
      tiers: [
        { position: 1, amountCents: 100000, rewardText: null },
        { position: 2, amountCents: 50000, rewardText: null },
        { position: 3, amountCents: 25000, rewardText: null },
      ],
    },
    myRank: null, myReward: null, firstPlaceReward: null, lastResult: null,
    ...over,
  };
}

const PROPS_SELLER = { userId: 'u-sel', companyId: 'co-a', membershipRole: 'seller' as const };
const PROPS_MANAGER = { userId: 'u-mgr', companyId: 'co-a', membershipRole: 'manager' as const };
const PROPS_SA = { userId: 'u-sa', companyId: 'co-a', membershipRole: null, isSuperAdminContext: true };

beforeEach(() => {
  m.ackPending = false;
  m.acknowledge.mockReset().mockResolvedValue(1);
  m.useAck.mockReset().mockImplementation(() => ({ acknowledge: m.acknowledge, isPending: m.ackPending, isError: false, error: null, reset: vi.fn() }));
  m.useHistory.mockReset().mockReturnValue({ status: 'ready', months: [] });
  m.useOverview.mockReset().mockReturnValue({ status: 'ready', overview: overview() });
});

// ── §3/§4/§41 ──────────────────────────────────────────────────────────
describe('ausência de campanha', () => {
  it('sem campanha e sem last_result → renderiza null (Home fica como hoje)', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ campaign: null }) });
    const { container } = render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('campanha DRAFT → Seller não vê bloco (renderiza null)', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ campaign: { ...overview().campaign!, status: 'draft' } }) });
    const { container } = render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('loading → null (sem layout jump); error → aviso local com retry (não quebra a Home)', () => {
    m.useOverview.mockReturnValue({ status: 'loading' });
    const { container, rerender } = render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(container).toBeEmptyDOMElement();
    m.useOverview.mockReturnValue({ status: 'error', retry: vi.fn() });
    rerender(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(screen.getByTestId('reward-section-error')).toBeInTheDocument();
  });
});

// ── §5/§8/§9 ───────────────────────────────────────────────────────────
describe('bloco Prêmios do mês', () => {
  it('published com Top 3 → 3 tiers, sem "R$ 0"', () => {
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    const block = screen.getByTestId('reward-current-block');
    expect(within(block).getByTestId('reward-tier-1')).toHaveTextContent('R$ 1.000,00');
    expect(within(block).getByTestId('reward-tier-2')).toHaveTextContent('R$ 500,00');
    expect(within(block).getByTestId('reward-tier-3')).toHaveTextContent('R$ 250,00');
    expect(block).not.toHaveTextContent('R$ 0,00');
  });

  it('só 1º configurado → mostra só 1º (§9)', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ campaign: { ...overview().campaign!, tiers: [{ position: 1, amountCents: 100000, rewardText: null }] } }) });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(screen.getByTestId('reward-tier-1')).toBeInTheDocument();
    expect(screen.queryByTestId('reward-tier-2')).toBeNull();
  });

  it('money / text / combined (§8)', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ campaign: { ...overview().campaign!, tiers: [
      { position: 1, amountCents: 100000, rewardText: '1 dia de folga' },
      { position: 2, amountCents: null, rewardText: 'iPhone 17' },
      { position: 3, amountCents: 25000, rewardText: null },
    ] } }) });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    const t1 = screen.getByTestId('reward-tier-1');
    expect(t1).toHaveTextContent('R$ 1.000,00');
    expect(t1).toHaveTextContent('1 dia de folga');
    const t2 = screen.getByTestId('reward-tier-2');
    expect(t2).toHaveTextContent('iPhone 17');
    expect(t2).not.toHaveTextContent('R$');
  });

  it('title presente é usado; ausente → "Prêmios de {Mês}" (§44)', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ campaign: { ...overview().campaign!, title: 'Disputa de Agosto' } }) });
    const { rerender } = render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    // textContent = valor cru (o uppercase é só CSS).
    expect(screen.getByTestId('reward-current-block')).toHaveTextContent('Disputa de Agosto');
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ campaign: { ...overview().campaign!, title: null } }) });
    rerender(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(screen.getByTestId('reward-current-block')).toHaveTextContent('Prêmios de Agosto');
  });
});

// ── §11/§12/§14 ────────────────────────────────────────────────────────
describe('prêmio da posição atual + 1º lugar (Seller)', () => {
  it('Seller 2º com tier → "Prêmio da sua posição · 2º lugar" + copy "se terminasse hoje"', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ myRank: 2, myReward: { amountCents: 50000, rewardText: null }, firstPlaceReward: { amountCents: 100000, rewardText: null } }) });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    const mine = screen.getByTestId('reward-my-position');
    expect(mine).toHaveTextContent('Prêmio da sua posição · 2º lugar');
    expect(mine).toHaveTextContent('R$ 500,00');
    expect(mine).toHaveTextContent('Se a competição terminasse hoje');
    expect(mine).not.toHaveTextContent('Você ganhou');
  });

  it('Seller 4º com tiers só Top 3 → SEM linha de prêmio da posição (§14, nunca "R$ 0")', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ myRank: 4, myReward: null, firstPlaceReward: { amountCents: 100000, rewardText: null } }) });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(screen.queryByTestId('reward-my-position')).toBeNull();
    // ainda mostra "1º lugar vale ..." (§12)
    expect(screen.getByTestId('reward-first-place')).toHaveTextContent('1º lugar vale');
  });

  it('Seller em 1º → não repete "1º lugar vale" (já é o prêmio dele)', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ myRank: 1, myReward: { amountCents: 100000, rewardText: null }, firstPlaceReward: { amountCents: 100000, rewardText: null } }) });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(screen.getByTestId('reward-my-position')).toBeInTheDocument();
    expect(screen.queryByTestId('reward-first-place')).toBeNull();
  });
});

// ── §15/§16 ────────────────────────────────────────────────────────────
describe('Manager / Super Admin', () => {
  it('Manager vê o bloco + link "Gerenciar premiação"; sem prêmio pessoal', () => {
    const onManage = vi.fn();
    render(<CompetitionRewardsHomeSection {...PROPS_MANAGER} onManageRewards={onManage} />);
    expect(screen.getByTestId('reward-current-block')).toBeInTheDocument();
    expect(screen.queryByTestId('reward-my-position')).toBeNull();
    expect(screen.queryByTestId('reward-result-card')).toBeNull();
    fireEvent.click(screen.getByTestId('reward-manage-link'));
    expect(onManage).toHaveBeenCalled();
  });

  it('Super Admin contextual → bloco read-only; sem prêmio pessoal, sem link, sem histórico Seller', () => {
    render(<CompetitionRewardsHomeSection {...PROPS_SA} />);
    expect(screen.getByTestId('reward-current-block')).toBeInTheDocument();
    expect(screen.queryByTestId('reward-my-position')).toBeNull();
    expect(screen.queryByTestId('reward-manage-link')).toBeNull();
    expect(screen.queryByTestId('seller-history-toggle')).toBeNull();
  });
});

// ── §17-§24 ────────────────────────────────────────────────────────────
describe('card de resultado + acknowledge', () => {
  const withResult = (over = {}) => overview({
    campaign: null,
    lastResult: {
      competitionMonthId: 'cm-7', monthStart: '2026-07-01', hadCompetition: true, rank: 1,
      saleCount: 12, completedVisitCount: 8, scheduledVisitCount: 21,
      rewardAmountCents: 100000, rewardText: null, ...over,
    },
  });

  it('mostra "JULHO ENCERRADO", posição, contagens e "Prêmio conquistado" (§18/§19)', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: withResult() });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    const card = screen.getByTestId('reward-result-card');
    expect(card).toHaveTextContent('JULHO ENCERRADO');
    expect(card).toHaveTextContent('Você terminou em 1º lugar.');
    expect(card).toHaveTextContent('12 vendas · 8 visitas · 21 agendamentos');
    expect(within(card).getByTestId('reward-result-prize')).toHaveTextContent('R$ 1.000,00');
  });

  it('rank sem tier → fechamento SEM "Prêmio conquistado" (§20, nunca "Sem prêmio")', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: withResult({ rank: 4, rewardAmountCents: null, rewardText: null }) });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    const card = screen.getByTestId('reward-result-card');
    expect(card).toHaveTextContent('Você terminou em 4º lugar.');
    expect(within(card).queryByTestId('reward-result-prize')).toBeNull();
    expect(card).not.toHaveTextContent('Sem prêmio');
  });

  it('"Entendi" chama acknowledge com o competition_month_id (§53)', async () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: withResult() });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    fireEvent.click(screen.getByTestId('reward-ack-button'));
    expect(m.acknowledge).toHaveBeenCalledWith('cm-7');
  });

  it('falha no acknowledge → card permanece + erro (§23)', async () => {
    m.acknowledge.mockRejectedValue(new CompetitionRewardError('reward_ack_failed'));
    m.useOverview.mockReturnValue({ status: 'ready', overview: withResult() });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    fireEvent.click(screen.getByTestId('reward-ack-button'));
    expect(await screen.findByTestId('reward-ack-error')).toBeInTheDocument();
    expect(screen.getByTestId('reward-result-card')).toBeInTheDocument();
  });

  it('pending → botão desabilitado (§24)', () => {
    m.ackPending = true;
    m.useOverview.mockReturnValue({ status: 'ready', overview: withResult() });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(screen.getByTestId('reward-ack-button')).toBeDisabled();
  });

  it('Manager NUNCA vê o card de resultado pessoal', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: withResult() });
    render(<CompetitionRewardsHomeSection {...PROPS_MANAGER} />);
    expect(screen.queryByTestId('reward-result-card')).toBeNull();
  });
});

// ── §29/§30 ────────────────────────────────────────────────────────────
describe('histórico colapsável do Seller', () => {
  it('fechado por padrão; abre ao clicar (aria-expanded) e renderiza o histórico', () => {
    m.useHistory.mockReturnValue({ status: 'ready', months: [
      { competitionMonthId: 'cm-8', monthStart: '2026-08-01', hadCompetition: true, title: null,
        rows: [{ sellerId: 's1', sellerName: 'Você', rank: 1, saleCount: 5, completedVisitCount: 3, scheduledVisitCount: 7, rewardAmountCents: 100000, rewardText: null }] } as HistoryMonth,
    ] });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    const toggle = screen.getByTestId('seller-history-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('history-month-2026-08-01')).toHaveTextContent('Agosto 2026');
  });
});

// ── §57 ────────────────────────────────────────────────────────────────
describe('sem efeito colateral de negócio', () => {
  it('renderizar a seção não invoca acknowledge nem nenhuma mutation', () => {
    m.useOverview.mockReturnValue({ status: 'ready', overview: overview({ myRank: 1, myReward: { amountCents: 100000, rewardText: null } }) });
    render(<CompetitionRewardsHomeSection {...PROPS_SELLER} />);
    expect(m.acknowledge).not.toHaveBeenCalled();
  });
});
