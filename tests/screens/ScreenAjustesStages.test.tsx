// Testes da aba Etapas de ScreenAjustes (M1-D, commit 7).
// usePipelineStages/useReorderStages mockados; services mockados; sem rede.
// O helper getReorderStagesErrorMessage permanece REAL (partial mock).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { adaptLocalStageNames } from '@/lib/pipeline/localStages';
import type { PipelineStage } from '@/lib/pipeline/adapter';

const m = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  useReorderStages: vi.fn(),
  reorderStagesLocal: vi.fn(),
  getStages: vi.fn(),
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({
  usePipelineStages: m.usePipelineStages,
}));

vi.mock('@/lib/hooks/useReorderStages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useReorderStages')>();
  return { ...actual, useReorderStages: m.useReorderStages };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/components/podiums/Podiums', () => ({ PLACE: {} }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  CompanyService: {
    get: () => ({ name: 'Loja', cnpj: '', phone: '', timezone: '' }),
    update: () => {},
  },
  PipelineService: { reorderStages: m.reorderStagesLocal, getStages: m.getStages },
}));

import { ScreenAjustes } from '@/components/screens/ScreensBiz';

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

function pipelineResult(over: Partial<Record<string, unknown>> = {}) {
  const stages = (over.stages as PipelineStage[] | undefined) ?? [];
  return {
    source: 'remote', remoteStagesEnabled: true, queryEnabled: true,
    queryKey: ['company', 'company-a', 'pipeline-stages'],
    stages, byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: stages.length > 0,
    refetch: vi.fn(),
    ...over,
  };
}

function reorderResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    reorderStages: vi.fn().mockResolvedValue({ ok: true }),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
    ...over,
  };
}

function openEtapas() {
  render(<ScreenAjustes go={() => {}} />);
  fireEvent.click(screen.getByText('Etapas'));
}

function dragTo(fromTestId: string, toTestId: string) {
  fireEvent.dragStart(screen.getByTestId(fromTestId), {
    dataTransfer: { setData: vi.fn(), effectAllowed: '' },
  });
  fireEvent.drop(screen.getByTestId(toTestId), { dataTransfer: {} });
}

beforeEach(() => {
  m.user.current = { id: 'user-1', companyId: 'company-a', role: 'admin', sellerId: null, name: 'Admin', email: 'a@a.com' };
  m.getStages.mockReturnValue(LOCAL_NAMES);
  m.usePipelineStages.mockReturnValue(pipelineResult({
    source: 'local', remoteStagesEnabled: false, queryEnabled: false,
    stages: adaptLocalStageNames(LOCAL_NAMES),
  }));
  m.useReorderStages.mockReturnValue(reorderResult());
});

// ── A. Caminho local ─────────────────────────────────────────────────────

describe('ScreenAjustes/Etapas — caminho local (flag OFF)', () => {
  it('usa a ordem local, reordena por NAMES via PipelineService e não chama a mutation', () => {
    openEtapas();
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();

    // Arrasta 'Qualificado' sobre 'Fechamento' — na semântica LEGADA o índice
    // do alvo é calculado antes da remoção, então o item cai DEPOIS do alvo.
    dragTo('stage-row-qualified', 'stage-row-closing');
    expect(m.reorderStagesLocal).toHaveBeenCalledTimes(1);
    expect(m.reorderStagesLocal).toHaveBeenCalledWith([
      'Novo', 'Visita agendada', 'Em negociação', 'Fechamento', 'Qualificado',
    ]);
    const remote = m.useReorderStages.mock.results[0]?.value;
    expect(remote.reorderStages).not.toHaveBeenCalled();
  });

  it('mantém "Novo" fixado: primeira linha não é draggable e drop na posição 0 é ignorado', () => {
    openEtapas();
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false');
    expect(screen.getByTestId('stage-row-qualified')).toHaveAttribute('draggable', 'true');

    dragTo('stage-row-qualified', 'stage-row-new');
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });
});

// ── B. Caminho remoto ────────────────────────────────────────────────────

describe('ScreenAjustes/Etapas — caminho remoto (flag ON)', () => {
  beforeEach(() => {
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
  });

  it('renderiza os stages remotos e envia TODOS os stage.id na nova ordem (sem names/codes)', () => {
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    openEtapas();

    // Arrasta 'Novo' para a posição de 'Em negociação' — "Novo" É móvel no remoto.
    dragTo('stage-row-new', 'stage-row-negotiation');

    expect(reorder.reorderStages).toHaveBeenCalledTimes(1);
    const sent = reorder.reorderStages.mock.calls[0][0];
    expect(sent).toEqual(['uuid-qualified', 'uuid-visit_scheduled', 'uuid-negotiation', 'uuid-new', 'uuid-closing']);
    expect(sent.every((id: string) => id.startsWith('uuid-'))).toBe(true);
    expect(sent).not.toContain('Novo');
    expect(sent).not.toContain('new');
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });

  it('não persiste mudança visual antes da resposta (ordem vem só do hook/cache)', () => {
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    openEtapas();
    dragTo('stage-row-closing', 'stage-row-new');
    // A mutation foi disparada, mas a ordem exibida continua a do hook.
    const rows = screen.getAllByTestId(/^stage-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'stage-row-new', 'stage-row-qualified', 'stage-row-visit_scheduled',
      'stage-row-negotiation', 'stage-row-closing',
    ]);
  });

  it('isPending bloqueia novos drags e mostra "Salvando ordem…"', () => {
    const reorder = reorderResult({ isPending: true });
    m.useReorderStages.mockReturnValue(reorder);
    openEtapas();

    expect(screen.getByTestId('stages-saving')).toHaveTextContent('Salvando ordem…');
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false');
    dragTo('stage-row-new', 'stage-row-closing');
    expect(reorder.reorderStages).not.toHaveBeenCalled();
  });

  it('erro mostra mensagem amigável e mantém a lista para nova tentativa', () => {
    m.useReorderStages.mockReturnValue(reorderResult({
      isError: true, error: { message: 'forbidden: manager/admin only' },
    }));
    openEtapas();
    expect(screen.getByTestId('stages-reorder-error'))
      .toHaveTextContent('Você não tem permissão para reordenar as etapas.');
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();
  });

  it('seller: acesso negado, nenhuma linha de etapa e hook recebe canReorder=false', () => {
    m.user.current = { ...m.user.current, role: 'seller' };
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    render(<ScreenAjustes go={() => {}} />);
    // Capabilities (commit 8): seller não tem NENHUMA aba — conteúdo proibido
    // não é montado, então não existe handler de reorder alcançável.
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
    expect(m.useReorderStages).toHaveBeenCalledWith(
      expect.objectContaining({ canReorder: false }),
    );
  });
});

// ── C. Estados remotos que bloqueiam reorder ─────────────────────────────

describe('ScreenAjustes/Etapas — estados remotos bloqueiam reorder', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['loading', { stages: [], isLoading: true, hasData: false }, 'Carregando etapas…'],
    ['error', { stages: [], isError: true, error: new Error('x'), hasData: false }, 'Não foi possível carregar as etapas.'],
    ['configError', { stages: [], configError: { ok: false, reason: 'name-mismatch' }, hasData: false }, 'As etapas da loja não correspondem à configuração esperada.'],
    ['empty', { stages: [], isEmpty: true, hasData: false }, 'Nenhuma etapa configurada para sua loja.'],
    ['disabled', { stages: [], queryEnabled: false, hasData: false }, 'Sessão indisponível. Entre novamente para gerenciar as etapas.'],
  ];

  it.each(cases)('estado %s: sem linhas de etapa e com a mensagem correta', (_label, over, text) => {
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    m.usePipelineStages.mockReturnValue(pipelineResult(over));
    openEtapas();
    expect(screen.getByTestId('stages-remote-state')).toHaveTextContent(text);
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
  });
});

// ── D. Capabilities por role (commit 8) ──────────────────────────────────

describe('ScreenAjustes — capabilities e abas permitidas', () => {
  it('admin flag OFF: abas completas e Etapas local preservada', () => {
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.getByText('Empresa')).toBeInTheDocument();
    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.getByText('Etapas')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Etapas'));
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false'); // Novo fixado no legado
    expect(screen.getByTestId('stage-row-qualified')).toHaveAttribute('draggable', 'true');
  });

  it('admin flag ON: abas completas e reorder remoto permitido (canReorder=true no hook)', () => {
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    openEtapas();
    expect(screen.getByText('Empresa')).toBeInTheDocument();
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'true');
    expect(m.useReorderStages).toHaveBeenCalledWith(
      expect.objectContaining({ canReorder: true, companyId: 'company-a' }),
    );
  });

  it('manager flag ON: somente a aba Etapas, sem conteúdo administrativo montado', () => {
    m.user.current = { ...m.user.current, role: 'manager' };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    render(<ScreenAjustes go={() => {}} />);

    // Só o chip Etapas; nada de Empresa/Usuários nem seus conteúdos.
    expect(screen.getByText('Etapas')).toBeInTheDocument();
    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.queryByText('Equipe')).toBeNull();

    // Aba Etapas já ativa por derivação síncrona (sem clique, sem flash).
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'true');
    expect(m.useReorderStages).toHaveBeenCalledWith(
      expect.objectContaining({ canReorder: true }),
    );

    // Manager pode mover inclusive "Novo"; mutation recebe os ids; local nunca.
    dragTo('stage-row-new', 'stage-row-closing');
    expect(reorder.reorderStages).toHaveBeenCalledTimes(1);
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });

  it('manager flag OFF: acesso negado, sem Etapas local, sem reorder algum', () => {
    m.user.current = { ...m.user.current, role: 'manager' };
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    render(<ScreenAjustes go={() => {}} />); // pipeline default = local/flag OFF
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });

  it('troca admin → manager: aba administrativa some imediatamente e manager cai em Etapas', () => {
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    const view = render(<ScreenAjustes go={() => {}} />);
    // Admin na aba default 'Empresa'.
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();

    m.user.current = { ...m.user.current, role: 'manager' };
    view.rerender(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();
  });

  it('troca manager → seller: todo o conteúdo some e nenhum handler antigo funciona', () => {
    m.user.current = { ...m.user.current, role: 'manager' };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    const view = render(<ScreenAjustes go={() => {}} />);
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();

    m.user.current = { ...m.user.current, role: 'seller' };
    view.rerender(<ScreenAjustes go={() => {}} />);
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
  });
});
