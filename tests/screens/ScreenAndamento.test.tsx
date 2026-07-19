// Testes de integração do Kanban "Em progresso" (M1-D, commit 6).
// usePipelineStages é mockado (internals do TanStack já cobertos no commit 5);
// services mockados; sem Supabase real, sem rede, sem snapshots.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { adaptLocalStageNames } from '@/lib/pipeline/localStages';
import type { PipelineStage } from '@/lib/pipeline/adapter';

const m = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  moveCard: vi.fn(),
  getStages: vi.fn(),
  leads: { current: [] as any[] },
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({
  usePipelineStages: m.usePipelineStages,
}));

vi.mock('@/lib/store', () => ({
  useStore: () => ({}),
}));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.leads.current },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  PipelineService: { moveCard: m.moveCard, getStages: m.getStages },
}));

import { ScreenAndamento } from '@/components/screens/ScreensOps';

// ── Fixtures ─────────────────────────────────────────────────────────────

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

function stage(code: string, name: string, sortOrder: number, isTerminal = false): PipelineStage {
  return { id: `uuid-${code}`, code, name, sortOrder, isTerminal };
}

const REMOTE_STAGES: PipelineStage[] = [
  stage('new', 'Novo', 0),
  stage('qualified', 'Qualificado', 1),
  stage('visit_scheduled', 'Visita agendada', 2),
  stage('negotiation', 'Em negociação', 3),
  stage('closing', 'Fechamento', 4, true),
];

function lead(id: string, name: string, stageName: string) {
  return {
    id, name, stage: stageName, phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: 'Marcos Silva', sellerId: 's1', urgency: 'green',
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function hookResult(over: Partial<Record<string, unknown>> = {}) {
  const stages = (over.stages as PipelineStage[] | undefined) ?? [];
  return {
    source: 'remote',
    remoteStagesEnabled: true,
    queryEnabled: true,
    queryKey: ['company', 'company-a', 'pipeline-stages'],
    stages,
    byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null,
    isEmpty: false,
    hasData: stages.length > 0,
    refetch: vi.fn(),
    ...over,
  };
}

function localHookResult(names: readonly string[] = LOCAL_NAMES) {
  const stages = adaptLocalStageNames(names);
  return hookResult({
    source: 'local', remoteStagesEnabled: false, queryEnabled: false, stages,
  });
}

function renderScreen() {
  return render(<ScreenAndamento go={() => {}} />);
}

beforeEach(() => {
  m.leads.current = [lead('l1', 'Carlos Andrade', 'Novo'), lead('l2', 'Juliana Prado', 'Qualificado')];
  m.user.current = { id: 'user-1', companyId: 'company-a', role: 'admin', sellerId: null, name: 'Admin', email: 'a@a.com' };
  m.getStages.mockReturnValue(LOCAL_NAMES);
  m.usePipelineStages.mockReturnValue(localHookResult());
});

// ── A. Caminho local ─────────────────────────────────────────────────────

describe('ScreenAndamento — caminho local (flag OFF)', () => {
  it('renderiza as cinco colunas na ordem recebida, sem skeleton', () => {
    renderScreen();
    const grid = screen.getByTestId('kanban-grid');
    const titles = within(grid).getAllByText(/^(Novo|Qualificado|Visita agendada|Em negociação|Fechamento)$/);
    expect(titles.map((el) => el.textContent)).toEqual(LOCAL_NAMES);
    expect(screen.queryByTestId('kanban-skeleton')).toBeNull();
  });

  it('agrupa cards por stage.name com contagens corretas', () => {
    renderScreen();
    const colNovo = screen.getByTestId('kanban-col-new');
    expect(within(colNovo).getByText('Carlos Andrade')).toBeInTheDocument();
    expect(within(colNovo).getByText('1')).toBeInTheDocument();
    const colQual = screen.getByTestId('kanban-col-qualified');
    expect(within(colQual).getByText('Juliana Prado')).toBeInTheDocument();
    const colClosing = screen.getByTestId('kanban-col-closing');
    expect(within(colClosing).getByText('Nenhum cliente nesta etapa')).toBeInTheDocument();
    expect(within(colClosing).getByText('0')).toBeInTheDocument();
  });

  it('drag de card chama moveCard com o NOME da etapa (nunca uuid/code)', () => {
    renderScreen();
    const card = screen.getByTestId('pipe-card-l1');
    expect(card).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(screen.getByTestId('kanban-col-qualified'), { dataTransfer: {} });
    expect(m.moveCard).toHaveBeenCalledTimes(1);
    expect(m.moveCard).toHaveBeenCalledWith('l1', 'Qualificado');
    const stageArg = m.moveCard.mock.calls[0][1];
    expect(stageArg).not.toMatch(/^uuid-/);
    expect(stageArg).not.toBe('qualified');
  });
});

// ── B. Caminho remoto válido ─────────────────────────────────────────────

describe('ScreenAndamento — caminho remoto válido', () => {
  it('renderiza as colunas remotas na ordem entregue e agrupa cards por name', () => {
    const reordered = [REMOTE_STAGES[4], REMOTE_STAGES[0], ...REMOTE_STAGES.slice(1, 4)];
    m.usePipelineStages.mockReturnValue(hookResult({ stages: reordered }));
    renderScreen();
    const grid = screen.getByTestId('kanban-grid');
    const titles = within(grid).getAllByText(/^(Novo|Qualificado|Visita agendada|Em negociação|Fechamento)$/);
    expect(titles.map((el) => el.textContent)).toEqual([
      'Fechamento', 'Novo', 'Qualificado', 'Visita agendada', 'Em negociação',
    ]);
    expect(within(screen.getByTestId('kanban-col-new')).getByText('Carlos Andrade')).toBeInTheDocument();
  });

  it('usa o CODE para o tone (não o name) com fallback neutro para code desconhecido', () => {
    const custom = [
      stage('closing', 'Fechamento', 0, true),
      stage('etapa_custom', 'Novo', 1), // name oficial, code desconhecido
    ];
    m.usePipelineStages.mockReturnValue(hookResult({ stages: custom }));
    renderScreen();
    expect(screen.getByTestId('kanban-tone-closing')).toHaveStyle({ background: '#E8CE72' });
    expect(screen.getByTestId('kanban-tone-etapa_custom')).toHaveStyle({ background: '#8B8B93' });
  });

  it('marca a etapa terminal e não expõe nenhum reorder de coluna', () => {
    m.usePipelineStages.mockReturnValue(hookResult({ stages: REMOTE_STAGES }));
    renderScreen();
    expect(screen.getByTestId('kanban-col-closing')).toHaveAttribute('data-terminal', 'true');
    expect(screen.getByTestId('kanban-col-new')).toHaveAttribute('data-terminal', 'false');
    for (const s of REMOTE_STAGES) {
      expect(screen.getByTestId(`kanban-col-${s.code}`)).not.toHaveAttribute('draggable');
    }
  });
});

// ── C. Loading ───────────────────────────────────────────────────────────

describe('ScreenAndamento — loading remoto', () => {
  it('mostra skeleton sem nenhum stage local durante o loading inicial', () => {
    m.usePipelineStages.mockReturnValue(hookResult({
      stages: [], isLoading: true, hasData: false,
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
    expect(screen.queryByText('Fechamento')).toBeNull();
  });
});

// ── D. Erro ──────────────────────────────────────────────────────────────

describe('ScreenAndamento — erro remoto', () => {
  it('erro sem cache mostra mensagem e o retry chama refetch', () => {
    const refetch = vi.fn();
    m.usePipelineStages.mockReturnValue(hookResult({
      stages: [], isError: true, error: new Error('boom'), hasData: false, refetch,
    }));
    renderScreen();
    const state = screen.getByTestId('kanban-state-error');
    expect(state).toHaveTextContent('Não foi possível carregar as etapas do pipeline.');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull(); // sem fallback local
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('erro com dados anteriores mantém as colunas e mostra aviso discreto', () => {
    const refetch = vi.fn();
    m.usePipelineStages.mockReturnValue(hookResult({
      stages: REMOTE_STAGES, isError: true, error: new Error('offline'), hasData: true, refetch,
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-grid')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-col-new')).toBeInTheDocument();
    const warning = screen.getByTestId('kanban-stale-warning');
    expect(warning).toHaveTextContent('Não foi possível atualizar as etapas.');
    fireEvent.click(within(warning).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── E. Configuração incompatível ─────────────────────────────────────────

describe('ScreenAndamento — configError', () => {
  const configError = {
    ok: false as const,
    reason: 'name-mismatch' as const,
    expectedNames: LOCAL_NAMES,
    receivedNames: ['Entrada', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'],
    missingNames: ['Novo'],
    unexpectedNames: ['Entrada'],
    duplicateNames: [],
  };

  it('bloqueia o Kanban sem stages locais e sem detalhes técnicos', () => {
    m.usePipelineStages.mockReturnValue(hookResult({ stages: [], configError, hasData: false }));
    renderScreen();
    const state = screen.getByTestId('kanban-state-config-error');
    expect(state).toHaveTextContent('As etapas da loja não correspondem à configuração esperada.');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
    expect(screen.queryByText('Entrada')).toBeNull(); // detalhes não vazam pro usuário
    expect(state.textContent).not.toContain('missing');
  });

  it('retry do configError chama refetch', () => {
    const refetch = vi.fn();
    m.usePipelineStages.mockReturnValue(hookResult({ stages: [], configError, hasData: false, refetch }));
    renderScreen();
    fireEvent.click(within(screen.getByTestId('kanban-state-config-error')).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── F. Empty remoto ──────────────────────────────────────────────────────

describe('ScreenAndamento — empty remoto real', () => {
  it('mostra a mensagem de nenhuma etapa, sem fallback local', () => {
    m.usePipelineStages.mockReturnValue(hookResult({ stages: [], isEmpty: true, hasData: false }));
    renderScreen();
    expect(screen.getByTestId('kanban-state-empty')).toHaveTextContent('Nenhuma etapa configurada para sua loja.');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
  });
});

// ── G. Query desabilitada ────────────────────────────────────────────────

describe('ScreenAndamento — query remota desabilitada', () => {
  it('não renderiza stages locais nem inventa erro de rede', () => {
    m.usePipelineStages.mockReturnValue(hookResult({
      stages: [], queryEnabled: false, hasData: false,
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-state-disabled')).toHaveTextContent('Sessão indisponível');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
    expect(screen.queryByTestId('kanban-state-error')).toBeNull();
  });
});
