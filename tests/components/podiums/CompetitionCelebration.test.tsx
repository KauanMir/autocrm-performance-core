// COMPETITION-RANKUP-FEEDBACK-V1-EXEC §13-§16/§28/§32 — CompetitionCelebration.
// Casca visual pura: recebe copy + newRank + saleCount + reward já
// resolvidos. Aqui se prova o que ela FAZ com o prêmio (mostra / omite,
// nunca "R$ 0") e a acessibilidade mínima do modal.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CompetitionCelebration } from '@/components/podiums/CompetitionCelebration';
import type { CompetitionCelebrationCopy } from '@/lib/podium/competitionCelebration';

const COPY: CompetitionCelebrationCopy = {
  eyebrow: 'VOCÊ CHEGOU AO PÓDIO',
  headline: 'Você chegou ao pódio! 🏆',
  message: 'Agora você está em 3º lugar.',
};

function renderCelebration(props: Partial<React.ComponentProps<typeof CompetitionCelebration>> = {}) {
  const onDismiss = props.onDismiss ?? vi.fn();
  render(
    <CompetitionCelebration
      copy={COPY}
      newRank={3}
      saleCount={5}
      onDismiss={onDismiss}
      {...props}
    />,
  );
  return { onDismiss };
}

describe('CompetitionCelebration — prêmio da nova posição (§9/§10/§32)', () => {
  it('sem reward: nenhum bloco de prêmio, nenhuma menção a R$ 0', () => {
    renderCelebration();
    expect(screen.queryByTestId('celebration-position-reward')).toBeNull();
    expect(screen.queryByTestId('celebration-first-place')).toBeNull();
    expect(screen.queryByText(/R\$\s*0/)).toBeNull();
  });

  it('§32 — money only', () => {
    renderCelebration({ reward: { amountCents: 50000, rewardText: null } });
    const block = screen.getByTestId('celebration-position-reward');
    expect(block).toHaveTextContent('Prêmio da sua posição');
    expect(block).toHaveTextContent('R$ 500,00');
    expect(block).toHaveTextContent('Se o mês terminasse agora, essa seria sua premiação.');
  });

  it('§32 — text only', () => {
    renderCelebration({ reward: { amountCents: null, rewardText: '1 dia de folga' } });
    const block = screen.getByTestId('celebration-position-reward');
    expect(block).toHaveTextContent('1 dia de folga');
    expect(block).not.toHaveTextContent('R$');
  });

  it('§32 — money + text', () => {
    renderCelebration({ reward: { amountCents: 50000, rewardText: '1 dia de folga' } });
    const block = screen.getByTestId('celebration-position-reward');
    expect(block).toHaveTextContent('R$ 500,00');
    expect(block).toHaveTextContent('1 dia de folga');
  });

  it('§12 — nunca afirma prêmio conquistado ("você ganhou R$")', () => {
    renderCelebration({ reward: { amountCents: 50000, rewardText: null } });
    expect(screen.queryByText(/você ganhou/i)).toBeNull();
  });
});

describe('CompetitionCelebration — 1º lugar vale X (§11)', () => {
  it('mostra a linha discreta quando NÃO há prêmio da própria posição', () => {
    renderCelebration({ firstPlaceReward: { amountCents: 100000, rewardText: null } });
    expect(screen.getByTestId('celebration-first-place')).toHaveTextContent('1º lugar vale');
    expect(screen.getByTestId('celebration-first-place')).toHaveTextContent('R$ 1.000,00');
  });

  it('§11 — não polui: com prêmio da própria posição, a linha de 1º lugar some', () => {
    renderCelebration({
      reward: { amountCents: 50000, rewardText: null },
      firstPlaceReward: { amountCents: 100000, rewardText: null },
    });
    expect(screen.getByTestId('celebration-position-reward')).toBeInTheDocument();
    expect(screen.queryByTestId('celebration-first-place')).toBeNull();
  });
});

describe('CompetitionCelebration — descarte e acessibilidade (§15/§28)', () => {
  it('role dialog + heading acessível', () => {
    renderCelebration();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Você chegou ao pódio!');
  });

  it('foco inicial no botão de fechar', () => {
    renderCelebration();
    expect(screen.getByLabelText('Fechar')).toHaveFocus();
  });

  it('ESC dispara onDismiss', () => {
    const { onDismiss } = renderCelebration();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('botão "Continuar" dispara onDismiss', () => {
    const { onDismiss } = renderCelebration();
    fireEvent.click(screen.getByText('Continuar'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismissLabel customizado', () => {
    renderCelebration({ dismissLabel: 'Concluir' });
    expect(screen.getByText('Concluir')).toBeInTheDocument();
  });
});
