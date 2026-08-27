// tests/flows/FlowShellResponsive.test.tsx
// MOBILE-RESPONSIVENESS-V1-B3-EXEC §45 — FlowShell responsivo.
// jsdom não faz layout — verifica o CONTRATO de estilo emitido.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowShell } from '@/components/flows/FlowsShared';

const ORIGINAL_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}
afterEach(() => setWidth(ORIGINAL_WIDTH));

function renderShell(withFooter = true) {
  return render(
    <FlowShell
      eyebrow="EYEBROW"
      title="Título do Flow"
      icon="calendar"
      onClose={() => {}}
      footer={withFooter ? (<><button>Voltar</button><button style={{ marginLeft: 'auto' }}>Avançar</button></>) : undefined}
    >
      <div>corpo</div>
    </FlowShell>,
  );
}

function outerShell(container: HTMLElement): HTMLElement {
  // primeiro filho do container = o <div position:fixed> da FlowShell
  return container.firstElementChild as HTMLElement;
}

describe('FlowShell — desktop (>= md)', () => {
  it('mantém a seta "voltar" no header (2 controles) e o footer em linha', () => {
    setWidth(1200);
    const { container } = renderShell();
    // desktop: seta-voltar + X + Voltar + Avançar = 4 botões
    expect(screen.getAllByRole('button').length).toBe(4);
    const shell = outerShell(container);
    expect(shell.style.height).toBe('var(--app-vh)');
    const footer = shell.lastElementChild as HTMLElement;
    const footerInner = footer.firstElementChild as HTMLElement;
    expect(footerInner.style.flexDirection === 'row' || footerInner.style.flexDirection === '').toBe(true);
    expect(screen.getByText('Título do Flow')).toBeInTheDocument();
  });
});

describe('FlowShell — mobile (< md)', () => {
  it('altura em --app-vh; header com UM só controle de fechar (o X)', () => {
    setWidth(390);
    const { container } = renderShell();
    const shell = outerShell(container);
    expect(shell.style.height).toBe('var(--app-vh)');
    // o botão "Fechar" (X) existe; a seta-voltar duplicada some
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
    // mobile: X + Voltar + Avançar = 3 botões (sem a seta duplicada)
    expect(screen.getAllByRole('button').length).toBe(3);
  });

  it('footer empilha (column-reverse) e estica (alignItems stretch)', () => {
    setWidth(390);
    const { container } = renderShell();
    const shell = outerShell(container);
    const footer = shell.lastElementChild as HTMLElement;
    const footerInner = footer.firstElementChild as HTMLElement;
    expect(footerInner.style.flexDirection).toBe('column-reverse');
    expect(footerInner.style.alignItems).toBe('stretch');
  });

  it('corpo continua scrollável verticalmente (overflow-y auto), sem overflow-x', () => {
    setWidth(390);
    const { container } = renderShell(false);
    const body = container.querySelector('.flowshell-body') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.style.overflowY).toBe('auto');
    expect(body.style.overflowX === '' || body.style.overflowX === 'visible').toBe(true);
  });

  it('título e eyebrow presentes (só truncados via ellipsis, nunca removidos)', () => {
    setWidth(390);
    renderShell();
    expect(screen.getByText('Título do Flow')).toBeInTheDocument();
    expect(screen.getByText('EYEBROW')).toBeInTheDocument();
  });
});
