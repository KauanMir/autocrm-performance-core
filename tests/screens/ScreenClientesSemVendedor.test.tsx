// META-MVP2 — fila "Sem vendedor" na tela Clientes (remote_active).
// useRemoteLeadsScreenState mockado, como em ScreenClientes.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  useArchivedLeads: vi.fn(),
  openFlow: vi.fn(),
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({ useRemoteLeadsScreenState: m.useRemoteLeadsScreenState }));
vi.mock('@/lib/hooks/useArchivedLeads', () => ({ useArchivedLeads: m.useArchivedLeads }));
vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));
vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  PipelineService: { moveCard: vi.fn(), getStages: () => [] },
}));

import { ScreenClientes } from '@/components/screens/ScreensOps';
import { isUnassignedLead, UNASSIGNED_SELLER_FILTER } from '@/lib/commercial/leadDisplay';

function lead(id: string, name: string, sellerId: string | null) {
  return {
    id, name, stage: 'Novo', stageId: 'stage-new', phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: sellerId ? 'Ana Souza' : '—', sellerId, urgency: 'green',
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function state(leads: unknown, over: Record<string, unknown> = {}) {
  return {
    mode: 'remote_active',
    pipeline: {
      source: 'remote', remoteStagesEnabled: true, queryEnabled: true, queryKey: [],
      stages: [{ id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false }],
      byId: {}, byCode: {}, byName: {}, isLoading: false, isFetching: false, isError: false, error: null,
      configError: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    },
    sellerLabels: {
      remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
      sellerLabels: [{ seller_id: 's1', name: 'Ana Souza' }], sellersById: {},
      isLoading: false, isFetching: false, isError: false, error: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    },
    leads: {
      remoteLeadsEnabled: true, queryEnabled: true, queryKey: [], leads,
      isLoading: false, isFetching: false, isError: false, error: null, configError: null,
      isEmpty: Array.isArray(leads) && leads.length === 0, hasData: Array.isArray(leads) && leads.length > 0, refetch: vi.fn(),
      ...over,
    },
  };
}

const MANAGER = { id: 'u1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
const SELLER = { id: 'u2', name: 'Vendedora', email: 'v@a.com', activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } };

beforeEach(() => {
  m.user.current = MANAGER;
  m.useRemoteLeadsScreenState.mockReturnValue(state([lead('l1', 'Com vendedor', 's1'), lead('l2', 'Da Meta 1', null), lead('l3', 'Da Meta 2', null)]));
  m.useArchivedLeads.mockReturnValue({ queryEnabled: false, queryKey: [], leads: [], isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
});

const render390 = () => render(<ScreenClientes go={() => {}} initialFilter={null} />);
// Os chips de filtro são a primeira linha com este texto dentro de um <button> sem card.
const chip = (name: string) => screen.getByTestId('clientes-seller-filter').querySelectorAll('button')[
  Array.from(screen.getByTestId('clientes-seller-filter').querySelectorAll('button')).findIndex((b) => b.textContent === name)
] as HTMLButtonElement;

describe('fila "Sem vendedor"', () => {
  it('Manager vê o filtro com a contagem correta', () => {
    render390();
    expect(screen.getByText('Sem vendedor (2)')).toBeInTheDocument();
  });

  it('o aviso mostra a quantidade e leva para a fila', () => {
    render390();
    expect(screen.getByTestId('clientes-unassigned-banner')).toHaveTextContent('2 leads sem vendedor');
    fireEvent.click(screen.getByText('Ver sem vendedor'));
    expect(screen.queryByText('Com vendedor')).toBeNull();
    expect(screen.getByText('Da Meta 1')).toBeInTheDocument();
    expect(screen.getByText('Da Meta 2')).toBeInTheDocument();
    expect(screen.queryByTestId('clientes-unassigned-banner')).toBeNull();
  });

  it('singular: 1 lead', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(state([lead('l2', 'Da Meta 1', null)]));
    render390();
    expect(screen.getByTestId('clientes-unassigned-banner')).toHaveTextContent('1 lead sem vendedor');
  });

  it('o filtro mostra só os leads sem vendedor e voltar a "Todos" recupera a lista', () => {
    render390();
    fireEvent.click(screen.getByText('Sem vendedor (2)'));
    expect(screen.queryByText('Com vendedor')).toBeNull();
    fireEvent.click(chip('Todos'));
    expect(screen.getByText('Com vendedor')).toBeInTheDocument();
    expect(screen.getByText('Da Meta 1')).toBeInTheDocument();
  });

  it('filtro por vendedor não traz leads sem vendedor', () => {
    render390();
    fireEvent.click(chip('Ana Souza'));
    expect(screen.getByText('Com vendedor')).toBeInTheDocument();
    expect(screen.queryByText('Da Meta 1')).toBeNull();
  });

  it('sem leads sem vendedor: contagem zero e nenhum aviso', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(state([lead('l1', 'Com vendedor', 's1')]));
    render390();
    expect(screen.getByText('Sem vendedor (0)')).toBeInTheDocument();
    expect(screen.queryByTestId('clientes-unassigned-banner')).toBeNull();
  });

  it('fila vazia depois de filtrar não quebra a tela', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(state([lead('l1', 'Com vendedor', 's1')]));
    render390();
    fireEvent.click(screen.getByText('Sem vendedor (0)'));
    expect(screen.queryByText('Com vendedor')).toBeNull();
  });

  it('o card da fila abre o fluxo com atribuição liberada para o Manager', () => {
    render390();
    fireEvent.click(screen.getByText('Sem vendedor (2)'));
    fireEvent.click(screen.getByText('Da Meta 1'));
    expect(m.openFlow).toHaveBeenCalled();
    expect(JSON.stringify(m.openFlow.mock.calls[0])).toContain('"canAssignSeller":true');
  });

  it('Seller nunca vê a fila, o filtro nem o aviso', () => {
    m.user.current = SELLER;
    m.useRemoteLeadsScreenState.mockReturnValue(state([lead('l1', 'Carteira da Vendedora', 's1')]));
    render390();
    expect(screen.getByText('Carteira da Vendedora')).toBeInTheDocument();
    expect(screen.queryByText(/Sem vendedor/)).toBeNull();
    expect(screen.queryByTestId('clientes-unassigned-banner')).toBeNull();
  });

  it('carregando: sem contagem provisória', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(state([], { isLoading: true, isEmpty: false }));
    render390();
    expect(screen.getByText('Sem vendedor')).toBeInTheDocument();
    expect(screen.queryByText(/Sem vendedor \(/)).toBeNull();
  });

  it('erro de leitura sem cache: mostra o erro, nunca "0 sem vendedor"', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(state([], { isError: true, isEmpty: false }));
    render390();
    expect(screen.queryByText(/Sem vendedor \(/)).toBeNull();
  });

  it('erro com dados em cache: a contagem continua valendo sobre o que está na tela', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(state([lead('l2', 'Da Meta 1', null)], { isError: true }));
    render390();
    expect(screen.getByText('Sem vendedor (1)')).toBeInTheDocument();
  });
});

describe('responsividade básica da fila', () => {
  it('o filtro fica no scroller horizontal, sem estourar a largura', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    render390();
    let el: HTMLElement | null = screen.getByText('Sem vendedor (2)').parentElement;
    while (el && el.style.overflowX !== 'auto') el = el.parentElement;
    expect(el).not.toBeNull();
    expect(el?.style.flexWrap).toBe('nowrap');
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
  });
});

describe('isUnassignedLead', () => {
  it.each([[null, true], [undefined, true], ['', true], ['s1', false]])('sellerId %j → %j', (sellerId, expected) => {
    expect(isUnassignedLead({ sellerId })).toBe(expected);
  });

  it('valor reservado do filtro não colide com um id de vendedor real', () => {
    expect(UNASSIGNED_SELLER_FILTER).toBe('__sem_vendedor__');
  });
});
