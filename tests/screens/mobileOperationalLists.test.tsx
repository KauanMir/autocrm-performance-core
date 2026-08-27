// tests/screens/mobileOperationalLists.test.tsx
// MOBILE-RESPONSIVENESS-V1-B2-EXEC §36 — em 390px a lista de Clientes
// renderiza (grid seguro, filtros acessíveis, cards com todos os dados,
// ações presentes) sem depender de layout real do jsdom.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const ORIGINAL_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  useArchivedLeads: vi.fn(),
  openFlow: vi.fn(),
  leads: [] as any[],
  user: null as any,
}));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({ useRemoteLeadsScreenState: m.useRemoteLeadsScreenState }));
vi.mock('@/lib/hooks/useArchivedLeads', () => ({ useArchivedLeads: m.useArchivedLeads }));
vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));
vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.leads },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [{ id: 's1', first: 'Marcos' }] },
  AuthService: { getCurrentUser: () => m.user },
  PipelineService: { moveCard: vi.fn(), getStages: () => [] },
}));

import { ScreenClientes } from '@/components/screens/ScreensOps';

beforeEach(() => {
  setWidth(390);
  m.leads = [
    { id: 'l1', name: 'Carlos Andrade', stage: 'Em negociação', phone: '(11) 90000-0000', car: 'Golf GTI', seller: 'Marcos Silva', sellerId: 's1', urgency: 'red', last: 'há 3 dias', alert: 'Sem contato', pay: 'À vista', value: 'R$ 1' },
    { id: 'l2', name: 'Juliana Prado', stage: 'Novo', phone: '(11) 90000-0001', car: 'HR-V', seller: 'Marcos Silva', sellerId: 's1', urgency: 'green', last: 'hoje', alert: 'ok', pay: 'À vista', value: 'R$ 1' },
  ];
  m.user = { id: 'u1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
  m.useRemoteLeadsScreenState.mockReturnValue({ mode: 'local' });
  m.useArchivedLeads.mockReturnValue({ queryEnabled: false, queryKey: [], leads: [], isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
});

afterEach(() => setWidth(ORIGINAL_WIDTH));

describe('Clientes @ 390px', () => {
  it('grid de cards usa minmax seguro (min(340px,100%)) — nunca estoura a viewport', () => {
    render(<ScreenClientes go={() => {}} initialFilter={null} />);
    const grids = Array.from(document.querySelectorAll('div')).filter(
      (d) => (d as HTMLElement).style.display === 'grid' && (d as HTMLElement).style.gridTemplateColumns.includes('minmax'),
    ) as HTMLElement[];
    expect(grids.length).toBeGreaterThanOrEqual(1);
    expect(grids.every((g) => g.style.gridTemplateColumns.includes('minmax(min(340px, 100%), 1fr)'))).toBe(true);
    // garantia extra: nenhum grid de cards ainda usa o minmax antigo inseguro
    expect(document.body.innerHTML).not.toContain('minmax(340px, 1fr)');
  });

  it('cards mostram nome, carro, etapa, responsável e as ações', () => {
    render(<ScreenClientes go={() => {}} initialFilter={null} />);
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByText('Juliana Prado')).toBeInTheDocument();
    expect(screen.getAllByText('Golf GTI').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Em negociação').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Marcos Silva/).length).toBeGreaterThanOrEqual(1);
    // ações do card
    expect(screen.getAllByText(/Ligar/).length).toBeGreaterThanOrEqual(1);
  });

  it('filtros de cliente ficam num scroller horizontal (ChipRow, nowrap + overflow-x auto)', () => {
    render(<ScreenClientes go={() => {}} initialFilter={null} />);
    const todos = screen.getAllByText('Todos')[0];
    // sobe até a ChipRow (o contêiner flex que embrulha os chips)
    let el: HTMLElement | null = todos.parentElement;
    let found: HTMLElement | null = null;
    while (el) {
      if (el.style.display === 'flex' && (el.style.overflowX === 'auto' || el.style.flexWrap === 'wrap')) { found = el; break; }
      el = el.parentElement;
    }
    expect(found).not.toBeNull();
    expect(found!.style.flexWrap).toBe('nowrap');
    expect(found!.style.overflowX).toBe('auto');
  });

  it('ação "Novo cliente/Novo Lead" continua acessível', () => {
    render(<ScreenClientes go={() => {}} initialFilter={null} />);
    expect(screen.getByText(/Novo (cliente|Lead)/)).toBeInTheDocument();
  });
});
