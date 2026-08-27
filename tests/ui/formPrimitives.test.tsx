// tests/ui/formPrimitives.test.tsx
// MOBILE-RESPONSIVENESS-V1-B3-EXEC §47/§39 — FormGrid + LBtn block.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormGrid } from '@/components/ui/primitives';
import { LBtn } from '@/components/ui/kit';

const ORIGINAL_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}
afterEach(() => setWidth(ORIGINAL_WIDTH));

describe('FormGrid', () => {
  it('< md: 1 coluna', () => {
    setWidth(390);
    const { container } = render(<FormGrid><input /><input /></FormGrid>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.display).toBe('grid');
    expect(el.style.gridTemplateColumns).toBe('1fr');
  });

  it('>= md: `columns` colunas (default 2)', () => {
    setWidth(1000);
    const { container } = render(<FormGrid><input /><input /></FormGrid>);
    expect((container.firstChild as HTMLElement).style.gridTemplateColumns).toBe('repeat(2, 1fr)');
  });

  it('>= md com columns=3', () => {
    setWidth(1000);
    const { container } = render(<FormGrid columns={3}><input /></FormGrid>);
    expect((container.firstChild as HTMLElement).style.gridTemplateColumns).toBe('repeat(3, 1fr)');
  });

  it('767 ainda é < md → 1 coluna; 768 → multi', () => {
    setWidth(767);
    const a = render(<FormGrid><i /></FormGrid>);
    expect((a.container.firstChild as HTMLElement).style.gridTemplateColumns).toBe('1fr');
    a.unmount();
    setWidth(768);
    const b = render(<FormGrid><i /></FormGrid>);
    expect((b.container.firstChild as HTMLElement).style.gridTemplateColumns).toBe('repeat(2, 1fr)');
  });
});

describe('LBtn block', () => {
  it('block: width 100% + centrado', () => {
    render(<LBtn block>Importar 1.234 clientes</LBtn>);
    const btn = screen.getByRole('button', { name: 'Importar 1.234 clientes' });
    expect(btn.style.width).toBe('100%');
    expect(btn.style.justifyContent).toBe('center');
  });

  it('sem block: comportamento anterior (sem width imposta)', () => {
    render(<LBtn>Avançar</LBtn>);
    const btn = screen.getByRole('button', { name: 'Avançar' });
    expect(btn.style.width === '' || btn.style.width === 'auto').toBe(true);
  });
});
