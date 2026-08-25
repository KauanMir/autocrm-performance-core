// Testes de components/podiums/Podiums.tsx (PODIUM-COMPETITION-R1-EXEC).
// Cobre o bug real corrigido nesta etapa: PodiumA/B/C/D assumiam sempre
// EXATAMENTE 3 sellers em top3 (herdado do fixture local, que sempre tinha
// >=3) e quebravam com dados reais de uma empresa pequena (1 ou 2 sellers
// ativos). Cobre também os campos condicionais (team/leads/conv/scheduled/
// growth omitidos quando ausentes — shape real do leaderboard) e a
// remoção do <image-slot> morto do PodiumD.
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Podium } from '@/components/podiums/Podiums';

function row(over: Partial<Record<string, unknown>> = {}) {
  return { id: 's1', name: 'Lucas Martins', sales: 3, visits: 2, ...over };
}

describe('Podium — top3 com menos de 3 sellers nunca quebra (bug real corrigido)', () => {
  for (const variant of ['A', 'B', 'C', 'D'] as const) {
    it(`variante ${variant}: 1 seller renderiza sem lançar`, () => {
      expect(() => render(<Podium variant={variant} top3={[row()]} />)).not.toThrow();
      expect(screen.getByText('Lucas Martins')).toBeInTheDocument();
    });

    it(`variante ${variant}: 2 sellers renderiza sem lançar`, () => {
      expect(() => render(<Podium variant={variant} top3={[row(), row({ id: 's2', name: 'Ana Souza', sales: 2 })]} />)).not.toThrow();
      expect(screen.getByText('Lucas Martins')).toBeInTheDocument();
      expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    });

    it(`variante ${variant}: 3 sellers (caso comum) renderiza sem lançar`, () => {
      const top3 = [row(), row({ id: 's2', name: 'Ana Souza', sales: 2 }), row({ id: 's3', name: 'João Ferreira', sales: 1 })];
      expect(() => render(<Podium variant={variant} top3={top3} />)).not.toThrow();
      expect(screen.getByText('Lucas Martins')).toBeInTheDocument();
      expect(screen.getByText('Ana Souza')).toBeInTheDocument();
      expect(screen.getByText('João Ferreira')).toBeInTheDocument();
    });

    it(`variante ${variant}: roster vazio (top3=[]) renderiza null, nunca lança`, () => {
      const { container } = render(<Podium variant={variant} top3={[]} />);
      expect(container).toBeEmptyDOMElement();
    });
  }
});

describe('Podium — campos condicionais (shape real do leaderboard, sem team/leads/conv/growth/scheduled)', () => {
  it('variante A: sem team/leads/conv, mostra só nome/vendas/visitas, nunca "undefined"', () => {
    render(<Podium variant="A" top3={[row(), row({ id: 's2', name: 'Ana Souza' }), row({ id: 's3', name: 'João Ferreira' })]} />);
    expect(screen.queryByText('Conv.')).toBeNull();
    expect(screen.queryByText('Leads')).toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it('variante B: sem growth/team no líder, nunca renderiza "% na semana"/"Equipe undefined"', () => {
    render(<Podium variant="B" top3={[row(), row({ id: 's2', name: 'Ana Souza' }), row({ id: 's3', name: 'João Ferreira' })]} />);
    expect(screen.queryByText(/na semana/)).toBeNull();
    expect(screen.queryByText(/^Equipe/)).toBeNull();
  });

  it('local/fixture (todos os campos presentes): team/leads/conv continuam aparecendo normalmente', () => {
    const fullRow = { id: 's1', name: 'Marcos Silva', team: 'Seminovos', leads: 10, visits: 5, sales: 8, conv: 40, scheduled: 2, growth: 12 };
    render(<Podium variant="B" top3={[fullRow, row({ id: 's2', name: 'Ana Souza' }), row({ id: 's3', name: 'João Ferreira' })]} />);
    expect(screen.getByText('Equipe Seminovos')).toBeInTheDocument();
    expect(screen.getByText('Conversão')).toBeInTheDocument();
  });
});

describe('PodiumD — sem <image-slot> morto, sempre iniciais reais', () => {
  it('nunca renderiza o elemento <image-slot> (Claude Design editor-only, sem upload real)', () => {
    const { container } = render(<Podium variant="D" top3={[row(), row({ id: 's2', name: 'Ana Souza' }), row({ id: 's3', name: 'João Ferreira' })]} />);
    expect(container.querySelector('image-slot')).toBeNull();
  });

  it('mostra iniciais reais (sem foto/avatar real no produto)', () => {
    render(<Podium variant="D" top3={[row(), row({ id: 's2', name: 'Ana Souza' }), row({ id: 's3', name: 'João Ferreira' })]} />);
    expect(screen.getAllByText('LM').length).toBeGreaterThan(0);
  });
});
