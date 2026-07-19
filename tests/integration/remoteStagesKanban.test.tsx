// Integração REAL do Kanban (commit 10): ScreenAndamento + usePipelineStages +
// adapter + query keys + TanStack Query reais. Mockados somente: cliente
// Supabase, isRemoteStagesEnabled e os serviços locais (leads/stages/user).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient, createTestQueryClient } from '../helpers/renderWithQueryClient';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';

const m = vi.hoisted(() => ({
  from: vi.fn(),
  flag: { current: false },
  moveCard: vi.fn(),
  leads: { current: [] as any[] },
  user: { current: null as any },
  localNames: { current: [] as string[] },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: m.from },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteStagesEnabled: () => m.flag.current };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.leads.current },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  PipelineService: { moveCard: m.moveCard, getStages: () => m.localNames.current },
}));

import { ScreenAndamento } from '@/components/screens/ScreensOps';

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

// Rows como o select projeta (5 colunas), deliberadamente FORA de ordem para
// provar a ordenação por sort_order do caminho real.
const REMOTE_ROWS = [
  { id: 'uuid-close', code: 'closing',         name: 'Fechamento',      sort_order: 4, is_terminal: true },
  { id: 'uuid-new',   code: 'new',             name: 'Novo',            sort_order: 0, is_terminal: false },
  { id: 'uuid-neg',   code: 'negotiation',     name: 'Em negociação',   sort_order: 3, is_terminal: false },
  { id: 'uuid-qual',  code: 'qualified',       name: 'Qualificado',     sort_order: 1, is_terminal: false },
  { id: 'uuid-visit', code: 'visit_scheduled', name: 'Visita agendada', sort_order: 2, is_terminal: false },
];

function lead(id: string, name: string, stageName: string) {
  return {
    id, name, stage: stageName, phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: 'Marcos Silva', sellerId: 's1', urgency: 'green',
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

type Deferred = { resolve: (v: { data: unknown; error: unknown }) => void };

function mockQuery(response: { data: unknown; error: unknown } | 'deferred'): { eq: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; order: ReturnType<typeof vi.fn>; deferred: Deferred } {
  const deferred: Deferred = { resolve: () => {} };
  const promise = response === 'deferred'
    ? new Promise<{ data: unknown; error: unknown }>((resolve) => { deferred.resolve = resolve; })
    : Promise.resolve(response);
  const eq = vi.fn();
  const order = vi.fn().mockReturnValue(promise);
  const select = vi.fn(() => ({ order, eq }));
  m.from.mockReturnValue({ select, eq });
  return { eq, select, order, deferred };
}

function renderKanban(queryClient = createTestQueryClient()) {
  return renderWithQueryClient(<ScreenAndamento go={() => {}} />, queryClient);
}

function dragCardTo(cardTestId: string, colTestId: string) {
  fireEvent.dragStart(screen.getByTestId(cardTestId), {
    dataTransfer: { setData: vi.fn(), effectAllowed: '' },
  });
  fireEvent.drop(screen.getByTestId(colTestId), { dataTransfer: {} });
}

beforeEach(() => {
  m.flag.current = false;
  m.localNames.current = LOCAL_NAMES;
  m.leads.current = [lead('l1', 'Carlos Andrade', 'Novo'), lead('l2', 'Juliana Prado', 'Qualificado')];
  m.user.current = { id: 'user-1', companyId: 'company-a', role: 'admin', sellerId: null, name: 'Admin', email: 'a@a.com' };
});

describe('integração Kanban — flag OFF (caminho local intacto)', () => {
  it('renderiza as cinco etapas locais na ordem local, agrupa cards por name e não toca o Supabase', () => {
    renderKanban();
    const grid = screen.getByTestId('kanban-grid');
    const titles = within(grid).getAllByText(/^(Novo|Qualificado|Visita agendada|Em negociação|Fechamento)$/);
    expect(titles.map((el) => el.textContent)).toEqual(LOCAL_NAMES);
    expect(within(screen.getByTestId('kanban-col-new')).getByText('Carlos Andrade')).toBeInTheDocument();
    expect(within(screen.getByTestId('kanban-col-qualified')).getByText('Juliana Prado')).toBeInTheDocument();
    expect(m.from).not.toHaveBeenCalled();
    expect(screen.queryByTestId('kanban-skeleton')).toBeNull();
    expect(screen.queryByTestId('kanban-state-error')).toBeNull();
  });

  it('drag de card chama PipelineService.moveCard com o NAME — nenhum uuid/code persiste', () => {
    renderKanban();
    dragCardTo('pipe-card-l1', 'kanban-col-qualified');
    expect(m.moveCard).toHaveBeenCalledTimes(1);
    expect(m.moveCard).toHaveBeenCalledWith('l1', 'Qualificado');
    expect(m.moveCard.mock.calls[0][1]).not.toMatch(/^uuid-|^qualified$/);
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('integração Kanban — flag ON, sucesso', () => {
  beforeEach(() => { m.flag.current = true; });

  it('loading sem stages locais → resposta ordena por sort_order, agrupa cards e usa tone/terminal por code', async () => {
    const spies = mockQuery('deferred');
    renderKanban();

    // Loading real do hook: skeleton, sem nenhum name local.
    expect(screen.getByTestId('kanban-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Novo')).toBeNull();

    await act(async () => { spies.deferred.resolve({ data: REMOTE_ROWS, error: null }); });
    await waitFor(() => expect(screen.getByTestId('kanban-grid')).toBeInTheDocument());

    // Consulta real: 5 colunas exatas, sem filtro de company.
    expect(m.from).toHaveBeenCalledWith('pipeline_stages');
    expect(spies.select).toHaveBeenCalledWith('id, code, name, sort_order, is_terminal');
    expect(spies.order).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(spies.eq).not.toHaveBeenCalled();

    // Ordem final vem do adapter (input estava embaralhado).
    const grid = screen.getByTestId('kanban-grid');
    const titles = within(grid).getAllByText(/^(Novo|Qualificado|Visita agendada|Em negociação|Fechamento)$/);
    expect(titles.map((el) => el.textContent)).toEqual(LOCAL_NAMES);

    expect(within(screen.getByTestId('kanban-col-new')).getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-tone-closing')).toHaveStyle({ background: '#E8CE72' });
    expect(screen.getByTestId('kanban-col-closing')).toHaveAttribute('data-terminal', 'true');
    // Nenhum drag de colunas.
    expect(screen.getByTestId('kanban-col-new')).not.toHaveAttribute('draggable');
  });
});

describe('integração Kanban — flag ON, outros estados', () => {
  beforeEach(() => { m.flag.current = true; });

  it('retorno vazio mostra empty state sem fallback local', async () => {
    mockQuery({ data: [], error: null });
    renderKanban();
    await waitFor(() => expect(screen.getByTestId('kanban-state-empty')).toBeInTheDocument());
    expect(screen.queryByText('Novo')).toBeNull();
  });

  it('name-mismatch mostra configError sem Kanban parcial', async () => {
    const renamed = REMOTE_ROWS.map((r) => (r.name === 'Novo' ? { ...r, name: 'Entrada' } : r));
    mockQuery({ data: renamed, error: null });
    renderKanban();
    await waitFor(() => expect(screen.getByTestId('kanban-state-config-error')).toBeInTheDocument());
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
  });

  it('erro Supabase mostra retry, e o retry executa uma NOVA query real', async () => {
    const first = mockQuery({ data: null, error: { message: 'boom' } });
    renderKanban();
    await waitFor(() => expect(screen.getByTestId('kanban-state-error')).toBeInTheDocument());

    // Segunda resposta: sucesso.
    const second = mockQuery({ data: REMOTE_ROWS, error: null });
    fireEvent.click(within(screen.getByTestId('kanban-state-error')).getByText('Tentar novamente'));
    await waitFor(() => expect(screen.getByTestId('kanban-grid')).toBeInTheDocument());
    expect(first.order).toHaveBeenCalledTimes(1);
    expect(second.order).toHaveBeenCalledTimes(1);
  });

  it('dados válidos permanecem visíveis durante refetch', async () => {
    mockQuery({ data: REMOTE_ROWS, error: null });
    const { queryClient } = renderKanban();
    await waitFor(() => expect(screen.getByTestId('kanban-grid')).toBeInTheDocument());

    const pendingRefetch = mockQuery('deferred');
    act(() => { void queryClient.invalidateQueries(); });
    // Durante o refetch, as colunas anteriores continuam na tela.
    expect(screen.getByTestId('kanban-grid')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-col-new')).toBeInTheDocument();

    await act(async () => { pendingRefetch.deferred.resolve({ data: REMOTE_ROWS, error: null }); });
    expect(screen.getByTestId('kanban-grid')).toBeInTheDocument();
  });

  it('company A e company B usam caches separados', async () => {
    mockQuery({ data: REMOTE_ROWS, error: null });
    const shared = createTestQueryClient();
    const a = renderWithQueryClient(<ScreenAndamento go={() => {}} />, shared);
    await waitFor(() => expect(screen.getByTestId('kanban-grid')).toBeInTheDocument());
    a.unmount();

    m.user.current = { ...m.user.current, id: 'user-2', companyId: 'company-b' };
    mockQuery({ data: [], error: null });
    renderWithQueryClient(<ScreenAndamento go={() => {}} />, shared);
    await waitFor(() => expect(screen.getByTestId('kanban-state-empty')).toBeInTheDocument());

    const dataA = shared.getQueryData(pipelineStageQueryKeys.byCompany('company-a')) as { ok: boolean; stages: unknown[] };
    const dataB = shared.getQueryData(pipelineStageQueryKeys.byCompany('company-b')) as { ok: boolean; stages: unknown[] };
    expect(dataA.stages).toHaveLength(5);
    expect(dataB.stages).toHaveLength(0);
  });
});
