// tests/podiums/MobilePodium.test.tsx
// MOBILE-RESPONSIVENESS-V1-B4-EXEC §5/§6/§45/§51/§52 — apresentação
// mobile nativa do Top 3: sem transform:scale, todos os 3 critérios
// (Vendas/Visitas/Agendamentos), VOCÊ / SEU ALVO / movimento; ordem =
// ordem recebida (NUNCA reordena).
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobilePodium } from '@/components/podiums/MobilePodium';

const TOP3 = [
  { id: 's1', name: 'Lucas Martins', sales: 3, visits: 1, appointments: 5, move: 2 },
  { id: 's2', name: 'Fernanda Dias', sales: 3, visits: 1, appointments: 2 },
  { id: 's3', name: 'Ana Souza', sales: 0, visits: 0, appointments: 0 },
];

describe('MobilePodium', () => {
  it('lista vazia → não renderiza nada', () => {
    const { container } = render(<MobilePodium top3={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renderiza os 3 colocados com os 3 critérios visíveis', () => {
    render(<MobilePodium top3={TOP3} />);
    for (const s of TOP3) expect(screen.getByText(s.name)).toBeInTheDocument();
    // os 3 rótulos de critério aparecem (uma vez por card = 3x)
    expect(screen.getAllByText('Vendas').length).toBe(3);
    expect(screen.getAllByText('Visitas').length).toBe(3);
    expect(screen.getAllByText('Agendamentos').length).toBe(3);
    // valores do 1º
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1); // appointments do Lucas
  });

  it('NÃO usa transform:scale em nenhum elemento (§45)', () => {
    const { container } = render(<MobilePodium top3={TOP3} />);
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      expect(el.style.transform || '').not.toMatch(/scale/);
    }
  });

  it('preserva a ordem recebida (row.rank do backend é autoridade — sem re-sort)', () => {
    // passa fora de ordem por "vendas" de propósito
    const scrambled = [TOP3[2], TOP3[0], TOP3[1]];
    render(<MobilePodium top3={scrambled} />);
    const names = screen.getAllByText(/Martins|Dias|Souza/).map((e) => e.textContent);
    expect(names).toEqual(['Ana Souza', 'Lucas Martins', 'Fernanda Dias']);
  });

  it('badge VOCÊ para meId; SEU ALVO para targetId; movimento ↑', () => {
    render(<MobilePodium top3={TOP3} meId="s1" targetId="s2" />);
    expect(screen.getByText('VOCÊ')).toBeInTheDocument();
    expect(screen.getByText('SEU ALVO')).toBeInTheDocument();
    // movimento do 1º (move: 2) → seta ↑ com "2"
    expect(screen.getByTitle(/Subiu 2 posições no mês/)).toBeInTheDocument();
  });

  it('sem meId/targetId → sem badges', () => {
    render(<MobilePodium top3={TOP3} />);
    expect(screen.queryByText('VOCÊ')).toBeNull();
    expect(screen.queryByText('SEU ALVO')).toBeNull();
  });
});
