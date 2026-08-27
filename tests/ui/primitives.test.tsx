// tests/ui/primitives.test.tsx — MOBILE-RESPONSIVENESS-V1-B1-EXEC §37.
// Primitives de layout: sem lógica de negócio. jsdom não faz layout real,
// então os testes verificam o CONTRATO de estilo emitido (o que cada
// primitive garante estruturalmente), não pixels renderizados.
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutoGrid, Cluster, Stack, TableScroller } from '@/components/ui/primitives';

describe('Stack', () => {
  it('coluna flex com gap', () => {
    render(<Stack gap={20}><span>a</span><span>b</span></Stack>);
    const el = screen.getByText('a').parentElement as HTMLElement;
    expect(el.style.display).toBe('flex');
    expect(el.style.flexDirection).toBe('column');
    expect(el.style.gap).toBe('20px');
  });
  it('gap default 12', () => {
    render(<Stack><span>x</span></Stack>);
    expect((screen.getByText('x').parentElement as HTMLElement).style.gap).toBe('12px');
  });
});

describe('Cluster', () => {
  it('linha flex que SEMPRE quebra (flex-wrap: wrap)', () => {
    render(<Cluster gap={8}><span>a</span></Cluster>);
    const el = screen.getByText('a').parentElement as HTMLElement;
    expect(el.style.display).toBe('flex');
    expect(el.style.flexWrap).toBe('wrap');
    expect(el.style.gap).toBe('8px');
  });
});

describe('AutoGrid', () => {
  it('emite minmax(min(<min>px, 100%), 1fr) — nunca estoura o container', () => {
    render(<AutoGrid min={340} gap={16}><span>card</span></AutoGrid>);
    const el = screen.getByText('card').parentElement as HTMLElement;
    expect(el.style.display).toBe('grid');
    expect(el.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(min(340px, 100%), 1fr))');
    expect(el.style.gap).toBe('16px');
  });
});

describe('TableScroller', () => {
  it('overflow-x auto + largura contida + região rotulada e focável', () => {
    render(<TableScroller ariaLabel="Tabela X"><table><tbody><tr><td>c</td></tr></tbody></table></TableScroller>);
    const region = screen.getByRole('region', { name: 'Tabela X' });
    expect(region.style.overflowX).toBe('auto');
    expect(region.style.maxWidth).toBe('100%');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('tablescroller');
  });
});
