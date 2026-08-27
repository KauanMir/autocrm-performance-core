// tests/flows/StepRailResponsive.test.tsx
// MOBILE-RESPONSIVENESS-V1-B3-EXEC §46 — StepRail responsivo.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepRail } from '@/components/flows/FlowsShared';

const ORIGINAL_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}
afterEach(() => setWidth(ORIGINAL_WIDTH));

const STEPS4 = ['Arquivo', 'Colunas', 'Conferir', 'Resultado'];
const STEPS3 = ['Escolher', 'Confirmar', 'Pronto'];

describe('StepRail — desktop (>= md)', () => {
  it('mostra todos os labels e marca o passo atual com aria-current', () => {
    setWidth(1200);
    render(<StepRail steps={STEPS4} current={1} />);
    for (const s of STEPS4) expect(screen.getByText(s)).toBeInTheDocument();
    // círculo do passo atual carrega aria-current="step"
    expect(document.querySelector('[aria-current="step"]')).not.toBeNull();
    // sem progressbar no desktop
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('StepRail — mobile (< md)', () => {
  it('4 passos: versão compacta "Passo N de M" + label atual + progressbar', () => {
    setWidth(390);
    render(<StepRail steps={STEPS4} current={1} />);
    expect(screen.getByText('Colunas')).toBeInTheDocument();
    expect(screen.getByText('Passo 2 de 4')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    // não empilha 4 labels grandes
    expect(screen.queryByText('Arquivo')).toBeNull();
    expect(screen.queryByText('Resultado')).toBeNull();
  });

  it('3 passos: "Passo 3 de 3" no último', () => {
    setWidth(390);
    render(<StepRail steps={STEPS3} current={2} />);
    expect(screen.getByText('Pronto')).toBeInTheDocument();
    expect(screen.getByText('Passo 3 de 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3');
  });

  it('mantém noção de progresso (aria-current no rótulo do passo atual)', () => {
    setWidth(390);
    render(<StepRail steps={STEPS4} current={0} />);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('Arquivo');
  });
});
