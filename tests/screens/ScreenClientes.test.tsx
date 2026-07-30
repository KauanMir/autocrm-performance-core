// Testes de integração de "Clientes" (M1-E, E3-B1). useRemoteLeadsScreenState
// é mockado (usePipelineStages/useLeads/useCurrentCompanySellerLabels
// internos já têm cobertura própria); services mockados; sem Supabase real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  openFlow: vi.fn(),
  leads: { current: [] as any[] },
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.leads.current },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [{ id: 's1', first: 'Marcos' }] },
  AuthService: { getCurrentUser: () => m.user.current },
  PipelineService: { moveCard: vi.fn(), getStages: () => [] },
}));

import { ScreenClientes } from '@/components/screens/ScreensOps';

function localLead(id: string, name: string, urgency: string, stage = 'Novo') {
  return {
    id, name, stage, phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: 'Marcos Silva', sellerId: 's1', urgency,
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function remoteLead(id: string, name: string, urgency: string, sellerId: string | null = 's1') {
  return {
    id, name, stage: 'Novo', stageId: 'stage-new', phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: sellerId ? 'Ana Souza' : '—', sellerId, urgency,
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function pipelineResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    source: 'remote', remoteStagesEnabled: true, queryEnabled: true, queryKey: [],
    stages: [{ id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false }],
    byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

function sellerLabelsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    sellerLabels: [{ seller_id: 's1', name: 'Ana Souza' }], sellersById: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

function leadsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    leads: [], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function screenState(mode: string, over: {
  pipeline?: Partial<Record<string, unknown>>;
  sellerLabels?: Partial<Record<string, unknown>>;
  leads?: Partial<Record<string, unknown>>;
} = {}) {
  return {
    mode,
    pipeline: pipelineResult(over.pipeline),
    sellerLabels: sellerLabelsResult(over.sellerLabels),
    leads: leadsResult(over.leads),
  };
}

function renderScreen() {
  return render(<ScreenClientes go={() => {}} />);
}

beforeEach(() => {
  m.leads.current = [localLead('l1', 'Carlos Andrade', 'red'), localLead('l2', 'Juliana Prado', 'green')];
  m.user.current = {
    id: 'user-1', name: 'Gerente', email: 'g@a.com',
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
  };
  m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
});

describe('ScreenClientes — caminho local intacto (REMOTE_LEADS=false)', () => {
  it('usa LeadService.getAll() e mostra "Novo cliente"', () => {
    renderScreen();
    expect(screen.getByText('Novo cliente')).toBeInTheDocument();
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByText('Juliana Prado')).toBeInTheDocument();
  });

  it('LeadCard local não é readOnly: ações de mutation aparecem no card', () => {
    renderScreen();
    expect(screen.getAllByText(/Ligar/).length).toBeGreaterThan(0);
  });
});

describe('ScreenClientes — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('mostra estado de configuração indisponível, sem "Novo cliente", sem dados locais', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_misconfigured'));
    renderScreen();
    expect(screen.getByTestId('clientes-state-misconfigured')).toHaveTextContent(
      'As etapas remotas precisam estar disponíveis para carregar os Leads.',
    );
    expect(screen.queryByText('Novo cliente')).toBeNull();
    expect(screen.queryByText('Carlos Andrade')).toBeNull();
    expect(screen.queryByTestId('clientes-grid')).toBeNull();
  });
});

describe('ScreenClientes — remote_unavailable_identity', () => {
  it('mostra sessão indisponível, sem dados locais', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_unavailable_identity'));
    renderScreen();
    expect(screen.getByTestId('clientes-state-disabled')).toHaveTextContent('Sessão indisponível');
    expect(screen.queryByText('Carlos Andrade')).toBeNull();
  });
});

describe('ScreenClientes — remote_active, estados', () => {
  it('loading de stages mostra skeleton, sem dados', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { hasData: false, isLoading: true } }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('clientes-grid')).toBeNull();
  });

  it('erro de stages mostra estado de erro com retry', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { hasData: false, isError: true, refetch } }),
    );
    renderScreen();
    const state = screen.getByTestId('clientes-state-error');
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('configError de stages mostra mensagem sanitizada', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { hasData: false, configError: { ok: false, reason: 'name-mismatch' } } }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-state-stage-config-error')).toBeInTheDocument();
  });

  it('leads com configError (stage/seller órfão) mostra estado sanitizado, sem UUID', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { configError: { ok: false, code: 'seller_not_found', leadId: 'lead-x' }, refetch } }),
    );
    renderScreen();
    const state = screen.getByTestId('clientes-state-lead-config-error');
    expect(state.textContent).not.toContain('lead-x');
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('leads em loading mostra skeleton', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isLoading: true, isEmpty: false } }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-skeleton')).toBeInTheDocument();
  });

  it('erro de leads sem cache mostra estado de erro com retry', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch } }),
    );
    renderScreen();
    const state = screen.getByTestId('clientes-state-error');
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('leads vazio real mostra estado vazio dedicado', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active'));
    renderScreen();
    expect(screen.getByTestId('clientes-state-empty')).toHaveTextContent('Nenhum cliente cadastrado ainda.');
  });

  it('erro com dados anteriores mantém a grade e mostra aviso discreto', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { isError: true, hasData: true, isEmpty: false, leads: [remoteLead('l1', 'Ana Vitória', 'green')], refetch },
      }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-grid')).toBeInTheDocument();
    const warning = screen.getByTestId('clientes-stale-warning');
    fireEvent.click(within(warning).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenClientes — remote_active, sucesso', () => {
  it('renderiza clientes remotos, sem botão "Novo cliente", sem dado local', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'red'), remoteLead('r2', 'Bruno Lima', 'green')] },
      }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-grid')).toBeInTheDocument();
    expect(screen.getByText('Ana Vitória')).toBeInTheDocument();
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
    expect(screen.queryByText('Novo cliente')).toBeNull();
    expect(screen.queryByText('Carlos Andrade')).toBeNull(); // nenhum dado local vaza
  });

  it('cards remotos são readOnly: nenhuma ação de mutation rápida aparece', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'amber')] },
      }),
    );
    renderScreen();
    expect(screen.queryByText('Ligar agora')).toBeNull();
    expect(screen.queryByText('Visita')).toBeNull();
  });

  // M1-E E4-B2: LeadCard passou a propagar capabilities (não mais o
  // booleano readOnly) — canCreate/canEditDetails true (E4). M1-E E5-B1:
  // canMoveStage também true para este Manager operacional (Kanban remoto
  // conectado); eventos/atribuir/arquivar seguem sempre false até E5-B2/E6.
  it('abrir o card chama __openFlow com capabilities granulares (canCreate/canEditDetails/canMoveStage true, resto false)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'amber')] },
      }),
    );
    renderScreen();
    fireEvent.click(screen.getByText('Ana Vitória'));
    expect(m.openFlow).toHaveBeenCalledWith('ver-cliente', expect.objectContaining({
      capabilities: {
        canCreate: true,
        canEditDetails: true,
        canApplyEvents: false,
        canMoveStage: true,
        canAssignSeller: false,
        canArchive: false,
      },
    }));
  });

  it('filtro por vendedor usa os seller labels remotos (nunca SellerService)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: {
          hasData: true, isEmpty: false,
          leads: [remoteLead('r1', 'Ana Vitória', 'red', 's1'), remoteLead('r2', 'Bruno Lima', 'green', 's2')],
        },
        sellerLabels: { sellerLabels: [{ seller_id: 's1', name: 'Rótulo Vendedor Um' }, { seller_id: 's2', name: 'Rótulo Vendedor Dois' }] },
      }),
    );
    renderScreen();
    expect(screen.getByText('Rótulo Vendedor Um')).toBeInTheDocument();
    expect(screen.getByText('Rótulo Vendedor Dois')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Rótulo Vendedor Dois'));
    expect(screen.queryByText('Ana Vitória')).toBeNull();
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
  });
});
