// Testes de FitBox (components/ui/kit.tsx) — PODIUM-VIEWPORT-FIT-R1-EXEC.
// Cobre a regressão real: antes escalava SOMENTE pela largura do
// container (scale = w / naturalWidth), nunca checando se a altura
// resultante cabia — em containers mais curtos que o conteúdo, o Pódio
// era cortado por overflow:hidden (achado real, reproduzido visualmente
// em zoom 100%). Não afirma nada sobre layout/medida visual real (jsdom
// não renderiza) — controla clientWidth/clientHeight/offsetHeight via
// stub direto nos nós montados e verifica a fórmula de escala resultante
// (scale = min(1, largura/naturalWidth, altura/naturalHeight)), que é a
// autoridade real do bug corrigido. O smoke visual em navegador real
// continua sendo a autoridade principal para a correção em si.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, act } from '@testing-library/react';
import { FitBox } from '@/components/ui/kit';

let resizeCallbacks: Array<() => void> = [];

class MockResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) { this.cb = cb; }
  observe() { resizeCallbacks.push(this.cb); }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  resizeCallbacks = [];
  (globalThis as any).ResizeObserver = MockResizeObserver;
});

afterEach(() => {
  delete (globalThis as any).ResizeObserver;
});

function triggerResize() {
  resizeCallbacks.forEach((cb) => cb());
}

function stubDimensions(outer: HTMLElement, inner: HTMLElement, dims: { w: number; h: number; naturalH: number }) {
  Object.defineProperty(outer, 'clientWidth', { configurable: true, value: dims.w });
  Object.defineProperty(outer, 'clientHeight', { configurable: true, value: dims.h });
  Object.defineProperty(inner, 'offsetHeight', { configurable: true, value: dims.naturalH });
  // O setState dentro do callback do ResizeObserver precisa estar dentro
  // de act() pra flush síncrono — fora dele, o React agenda a atualização
  // sem garantir que o DOM já reflita o novo valor no momento do assert.
  act(() => { triggerResize(); });
}

function renderFitBox(naturalWidth: number) {
  const { container } = render(
    <FitBox naturalWidth={naturalWidth} align="bottom">
      <div>conteúdo do pódio</div>
    </FitBox>,
  );
  const outer = container.firstElementChild as HTMLElement;
  const inner = outer.firstElementChild as HTMLElement;
  return { outer, inner };
}

describe('FitBox — escala considera altura, não só largura (regressão do bug real)', () => {
  it('cabe em largura mas NÃO em altura: escala pela altura (bug original nunca detectava isso)', () => {
    const { outer, inner } = renderFitBox(900);
    // largura cabe perfeitamente (scaleW=1), mas o container só tem 400px
    // de altura para um conteúdo que naturalmente precisa de 800px —
    // exatamente o cenário do Pódio D em zoom 100%.
    stubDimensions(outer, inner, { w: 900, h: 400, naturalH: 800 });
    expect(inner.style.transform).toBe('scale(0.5)');
  });

  it('cabe em largura E altura: nenhuma escala aplicada (transform none)', () => {
    const { outer, inner } = renderFitBox(900);
    stubDimensions(outer, inner, { w: 900, h: 900, naturalH: 600 });
    expect(inner.style.transform).toBe('none');
  });

  it('largura é o fator limitante: comportamento original (escalar por largura) preservado', () => {
    const { outer, inner } = renderFitBox(900);
    // altura sobra de longe; só a largura força a redução.
    stubDimensions(outer, inner, { w: 450, h: 2000, naturalH: 300 });
    expect(inner.style.transform).toBe('scale(0.5)');
  });

  it('nunca amplia além do tamanho natural do design (scale sempre <= 1)', () => {
    const { outer, inner } = renderFitBox(900);
    // container generoso nas duas dimensões — não deve aumentar o pódio.
    stubDimensions(outer, inner, { w: 1800, h: 1800, naturalH: 300 });
    expect(inner.style.transform).toBe('none');
  });

  it('usa o MENOR fator entre largura e altura, nunca o maior', () => {
    const { outer, inner } = renderFitBox(1000);
    // scaleW = 500/1000 = 0.5; scaleH = 900/300 = 3 -> deve escolher 0.5 (o menor), nunca 1 nem 3.
    stubDimensions(outer, inner, { w: 500, h: 900, naturalH: 300 });
    expect(inner.style.transform).toBe('scale(0.5)');
  });
});
