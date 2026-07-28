// Testes de CommercialCompanyContext (M1-F S8-C2-B2). Cobre: estado inicial
// null, seleção, reset em troca de identidade, cancelamento das queries
// platform da empresa anterior na troca (nunca resetQueryCache global), e o
// erro claro ao usar o hook fora do Provider.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import {
  CommercialCompanyProvider,
  useCommercialCompanyContext,
} from '@/lib/commercial/CommercialCompanyContext';

function Consumer() {
  const { selectedCompanyId, setSelectedCompanyId } = useCommercialCompanyContext();
  return (
    <div>
      <span data-testid="selected">{selectedCompanyId ?? 'null'}</span>
      <button onClick={() => setSelectedCompanyId('company-a')}>select-a</button>
      <button onClick={() => setSelectedCompanyId('company-b')}>select-b</button>
    </div>
  );
}

function renderWithProvider(identityKey: string | null, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <CommercialCompanyProvider identityKey={identityKey}>
        <Consumer />
      </CommercialCompanyProvider>
    </QueryClientProvider>,
  );
}

describe('CommercialCompanyContext — estado inicial', () => {
  it('começa em null (nada selecionado ainda) — nunca "todas as empresas"', () => {
    const queryClient = new QueryClient();
    renderWithProvider('user-1', queryClient);
    expect(screen.getByTestId('selected').textContent).toBe('null');
  });
});

describe('CommercialCompanyContext — seleção e compartilhamento', () => {
  it('setSelectedCompanyId reflete a seleção', () => {
    const queryClient = new QueryClient();
    renderWithProvider('user-1', queryClient);
    fireEvent.click(screen.getByText('select-a'));
    expect(screen.getByTestId('selected').textContent).toBe('company-a');
  });

  it('duas montagens de Consumer sob o MESMO Provider compartilham a seleção (Clientes/Andamento)', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <CommercialCompanyProvider identityKey="user-1">
          <Consumer />
          <Consumer />
        </CommercialCompanyProvider>
      </QueryClientProvider>,
    );
    const [selectBtnA] = screen.getAllByText('select-a');
    fireEvent.click(selectBtnA);
    const values = screen.getAllByTestId('selected').map((el) => el.textContent);
    expect(values).toEqual(['company-a', 'company-a']);
  });
});

describe('CommercialCompanyContext — troca de identidade', () => {
  it('mudar identityKey limpa a seleção', () => {
    const queryClient = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CommercialCompanyProvider identityKey="user-1">
          <Consumer />
        </CommercialCompanyProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('select-a'));
    expect(screen.getByTestId('selected').textContent).toBe('company-a');

    rerender(
      <QueryClientProvider client={queryClient}>
        <CommercialCompanyProvider identityKey="user-2">
          <Consumer />
        </CommercialCompanyProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('selected').textContent).toBe('null');
  });

  it('logout (identityKey null) limpa a seleção', () => {
    const queryClient = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CommercialCompanyProvider identityKey="user-1">
          <Consumer />
        </CommercialCompanyProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('select-a'));
    expect(screen.getByTestId('selected').textContent).toBe('company-a');

    rerender(
      <QueryClientProvider client={queryClient}>
        <CommercialCompanyProvider identityKey={null}>
          <Consumer />
        </CommercialCompanyProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('selected').textContent).toBe('null');
  });
});

describe('CommercialCompanyContext — troca de empresa cancela queries da empresa anterior', () => {
  it('cancela as queries platform (leads/stages) da empresa anterior, nunca a nova', () => {
    const queryClient = new QueryClient();
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
    renderWithProvider('user-1', queryClient);

    fireEvent.click(screen.getByText('select-a'));
    expect(cancelSpy).not.toHaveBeenCalled(); // primeira seleção: nada "anterior" a cancelar

    fireEvent.click(screen.getByText('select-b'));
    const calledKeys = cancelSpy.mock.calls.map((args) => (args[0] as { queryKey: unknown[] }).queryKey);
    expect(calledKeys).toContainEqual(['company', 'company-a', 'leads', 'platform']);
    expect(calledKeys).toContainEqual(['company', 'company-a', 'pipeline-stages', 'platform']);
    expect(calledKeys.flat()).not.toContain('company-b');
  });

  it('NUNCA usa resetQueryCache global — clear() do QueryClient nunca é chamado na troca', () => {
    const queryClient = new QueryClient();
    const clearSpy = vi.spyOn(queryClient, 'clear');
    renderWithProvider('user-1', queryClient);
    fireEvent.click(screen.getByText('select-a'));
    fireEvent.click(screen.getByText('select-b'));
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe('CommercialCompanyContext — uso fora do Provider', () => {
  it('lança erro explícito', () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    expect(() => renderHook(() => useCommercialCompanyContext(), { wrapper })).toThrowError(
      /useCommercialCompanyContext/,
    );
  });
});
