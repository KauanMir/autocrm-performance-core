// Smoke tests do AppProviders (M1-D, commit 2).
// Probe captura a instância vista por useQueryClient() para provar a
// estabilidade por montagem sem tocar em internals do provider.
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { AppProviders } from '@/components/providers/AppProviders';

function Probe({ capture }: { capture: (client: QueryClient) => void }) {
  capture(useQueryClient());
  return <div data-testid="probe-child">probe</div>;
}

describe('AppProviders', () => {
  it('renderiza children normalmente', () => {
    render(
      <AppProviders>
        <div data-testid="child">conteúdo</div>
      </AppProviders>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('conteúdo');
  });

  it('useQueryClient funciona dentro da árvore (sem erro de provider ausente)', () => {
    const seen: QueryClient[] = [];
    render(
      <AppProviders>
        <Probe capture={(c) => seen.push(c)} />
      </AppProviders>,
    );
    expect(screen.getByTestId('probe-child')).toBeInTheDocument();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBeInstanceOf(QueryClient);
  });

  it('mantém a MESMA instância do QueryClient em rerenders da mesma montagem', () => {
    const seen: QueryClient[] = [];
    // Elemento novo a cada rerender — reutilizar a mesma referência JSX faria
    // o React aplicar bailout e nem re-renderizar o Probe.
    const makeUi = () => (
      <AppProviders>
        <Probe capture={(c) => seen.push(c)} />
      </AppProviders>
    );
    const { rerender } = render(makeUi());
    rerender(makeUi());
    rerender(makeUi());
    expect(seen.length).toBeGreaterThanOrEqual(3);
    const unique = new Set(seen);
    expect(unique.size).toBe(1);
  });

  it('uma NOVA montagem recebe outra instância', () => {
    const first: QueryClient[] = [];
    const second: QueryClient[] = [];

    const a = render(
      <AppProviders>
        <Probe capture={(c) => first.push(c)} />
      </AppProviders>,
    );
    a.unmount();

    render(
      <AppProviders>
        <Probe capture={(c) => second.push(c)} />
      </AppProviders>,
    );

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(second[0]).not.toBe(first[0]);
  });
});
