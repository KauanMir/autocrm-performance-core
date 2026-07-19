// Integração REAL do reorder de etapas (commit 10): ScreenAjustes +
// usePipelineStages + useReorderStages + adapter + query keys + capabilities +
// TanStack Query reais. Mockados somente: cliente Supabase (from/rpc),
// isRemoteStagesEnabled, serviços locais e identidade (AuthService).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient, createTestQueryClient } from '../helpers/renderWithQueryClient';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';
import { resetQueryCache } from '@/lib/query/resetQueryCache';

const m = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  flag: { current: true },
  reorderLocal: vi.fn(),
  user: { current: null as any },
  localNames: { current: [] as string[] },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: m.from, rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteStagesEnabled: () => m.flag.current };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/components/podiums/Podiums', () => ({ PLACE: [] }));

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
  PipelineService: { reorderStages: m.reorderLocal, getStages: () => m.localNames.current },
}));

import { ScreenAjustes } from '@/components/screens/ScreensBiz';

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

// Rows como o select/RPC projetam. Ordem inicial: new → … → closing.
const ROWS = [
  { id: 'uuid-new',             code: 'new',             name: 'Novo',            sort_order: 0, is_terminal: false },
  { id: 'uuid-qualified',       code: 'qualified',       name: 'Qualificado',     sort_order: 1, is_terminal: false },
  { id: 'uuid-visit_scheduled', code: 'visit_scheduled', name: 'Visita agendada', sort_order: 2, is_terminal: false },
  { id: 'uuid-negotiation',     code: 'negotiation',     name: 'Em negociação',   sort_order: 3, is_terminal: false },
  { id: 'uuid-closing',         code: 'closing',         name: 'Fechamento',      sort_order: 4, is_terminal: true },
];

// Resultado do drag 'Novo' → posição de 'Em negociação' (mesma permutação que
// o handler calcula): qualified, visit_scheduled, negotiation, new, closing.
const REORDERED_IDS = ['uuid-qualified', 'uuid-visit_scheduled', 'uuid-negotiation', 'uuid-new', 'uuid-closing'];
const REORDERED_ROWS = ROWS.map((r) => ({
  ...r,
  sort_order: REORDERED_IDS.indexOf(r.id),
}));

const ORIGINAL_ORDER = ['stage-row-new', 'stage-row-qualified', 'stage-row-visit_scheduled', 'stage-row-negotiation', 'stage-row-closing'];
const REORDERED_ORDER = ['stage-row-qualified', 'stage-row-visit_scheduled', 'stage-row-negotiation', 'stage-row-new', 'stage-row-closing'];

const KEY_A = pipelineStageQueryKeys.byCompany('company-a');
const KEY_B = pipelineStageQueryKeys.byCompany('company-b');

type Deferred<T> = { resolve: (v: T) => void };

function mockSelect(response: { data: unknown; error: unknown }) {
  const order = vi.fn().mockReturnValue(Promise.resolve(response));
  const select = vi.fn(() => ({ order }));
  m.from.mockReturnValue({ select });
  return { select, order };
}

function mockRpc(response: { data: unknown; error: unknown } | 'deferred') {
  const deferred: Deferred<{ data: unknown; error: unknown }> = { resolve: () => {} };
  const promise = response === 'deferred'
    ? new Promise<{ data: unknown; error: unknown }>((resolve) => { deferred.resolve = resolve; })
    : Promise.resolve(response);
  m.rpc.mockReturnValue(promise);
  return { deferred };
}

async function openEtapas(queryClient = createTestQueryClient()) {
  const view = renderWithQueryClient(<ScreenAjustes go={() => {}} />, queryClient);
  fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
  await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());
  return { ...view, queryClient };
}

function dragTo(fromTestId: string, toTestId: string) {
  fireEvent.dragStart(screen.getByTestId(fromTestId), {
    dataTransfer: { setData: vi.fn(), effectAllowed: '' },
  });
  fireEvent.drop(screen.getByTestId(toTestId), { dataTransfer: {} });
}

function rowOrder(): string[] {
  return screen.getAllByTestId(/^stage-row-/).map((el) => el.getAttribute('data-testid') as string);
}

async function settled(queryClient: { isFetching: () => number }) {
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

beforeEach(() => {
  m.flag.current = true;
  m.localNames.current = LOCAL_NAMES;
  m.user.current = { id: 'user-1', companyId: 'company-a', role: 'admin', sellerId: null, name: 'Admin', email: 'a@a.com' };
});

describe('integração reorder — admin remoto (flag ON)', () => {
  it('consulta remota renderiza as etapas e o drop envia a lista COMPLETA de UUIDs à RPC, sem company_id e sem serviço local', async () => {
    mockSelect({ data: ROWS, error: null });
    mockRpc({ data: REORDERED_ROWS, error: null });
    const { queryClient } = await openEtapas();

    expect(m.from).toHaveBeenCalledWith('pipeline_stages');
    expect(rowOrder()).toEqual(ORIGINAL_ORDER);

    dragTo('stage-row-new', 'stage-row-negotiation');

    // A mutation inicia o rpc num microtask — aguarda a chamada real.
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    const [fnName, payload] = m.rpc.mock.calls[0];
    expect(fnName).toBe('reorder_pipeline_stages');
    expect(Object.keys(payload)).toEqual(['p_ordered_ids']);
    expect(payload.p_ordered_ids).toEqual(REORDERED_IDS);
    expect(payload.p_ordered_ids.every((id: string) => id.startsWith('uuid-'))).toBe(true);
    expect(payload).not.toHaveProperty('company_id');
    expect(m.reorderLocal).not.toHaveBeenCalled();

    // Refetch da invalidação confirma a nova ordem.
    mockSelect({ data: REORDERED_ROWS, error: null });
    await waitFor(() => expect(screen.getByTestId('stages-reorder-saved')).toBeInTheDocument());
    await settled(queryClient);
  });

  it('sem optimistic update: ordem intacta e drag bloqueado durante o pending; resposta atualiza cache e a nova ordem aparece', async () => {
    mockSelect({ data: ROWS, error: null });
    const rpc = mockRpc('deferred');
    const { queryClient } = await openEtapas();

    dragTo('stage-row-new', 'stage-row-negotiation');
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));

    // Pending: ordem visual anterior, "Salvando ordem…", nenhum drag novo.
    expect(screen.getByTestId('stages-saving')).toHaveTextContent('Salvando ordem…');
    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
    expect(screen.getByTestId('stage-row-qualified')).toHaveAttribute('draggable', 'false');
    dragTo('stage-row-qualified', 'stage-row-closing');
    expect(m.rpc).toHaveBeenCalledTimes(1);

    // Resposta chega: cache atualizado e nova ordem na tela.
    mockSelect({ data: REORDERED_ROWS, error: null });
    await act(async () => { rpc.deferred.resolve({ data: REORDERED_ROWS, error: null }); });
    await waitFor(() => expect(rowOrder()).toEqual(REORDERED_ORDER));
    expect(screen.getByTestId('stages-reorder-saved')).toHaveTextContent('Ordem salva.');

    const cached = queryClient.getQueryData(KEY_A) as { ok: boolean; stages: Array<{ id: string }> };
    expect(cached.ok).toBe(true);
    expect(cached.stages.map((s) => s.id)).toEqual(REORDERED_IDS);
    await settled(queryClient);
  });

  it('onSuccess invalida APENAS a key da empresa atual', async () => {
    mockSelect({ data: ROWS, error: null });
    mockRpc({ data: REORDERED_ROWS, error: null });
    const queryClient = createTestQueryClient();
    const otherCompany = { ok: true, stages: [{ id: 'de-outra-empresa' }], byId: {}, byCode: {}, byName: {} };
    queryClient.setQueryData(KEY_B, otherCompany);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    await openEtapas(queryClient);

    mockSelect({ data: REORDERED_ROWS, error: null });
    dragTo('stage-row-new', 'stage-row-negotiation');
    await waitFor(() => expect(screen.getByTestId('stages-reorder-saved')).toBeInTheDocument());

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: KEY_A });
    expect(queryClient.getQueryData(KEY_B)).toBe(otherCompany);
    await settled(queryClient);
  });
});

describe('integração reorder — erros (flag ON)', () => {
  it('erro da RPC mantém a ordem anterior no cache e na tela, com mensagem amigável', async () => {
    mockSelect({ data: ROWS, error: null });
    mockRpc({ data: null, error: { message: 'forbidden: manager/admin only' } });
    const { queryClient } = await openEtapas();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    dragTo('stage-row-new', 'stage-row-negotiation');

    await waitFor(() => expect(screen.getByTestId('stages-reorder-error'))
      .toHaveTextContent('Você não tem permissão para reordenar as etapas.'));
    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
    const cached = queryClient.getQueryData(KEY_A) as { stages: Array<{ id: string }> };
    expect(cached.stages.map((s) => s.id)).toEqual(ROWS.map((r) => r.id));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('name-mismatch no retorno da RPC não substitui o cache', async () => {
    mockSelect({ data: ROWS, error: null });
    const renamed = REORDERED_ROWS.map((r) => (r.name === 'Novo' ? { ...r, name: 'Entrada' } : r));
    mockRpc({ data: renamed, error: null });
    const { queryClient } = await openEtapas();

    dragTo('stage-row-new', 'stage-row-negotiation');

    await waitFor(() => expect(screen.getByTestId('stages-reorder-error'))
      .toHaveTextContent('As etapas retornadas não correspondem à configuração esperada.'));
    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
    const cached = queryClient.getQueryData(KEY_A) as { ok: boolean; stages: Array<{ name: string }> };
    expect(cached.ok).toBe(true);
    expect(cached.stages.map((s) => s.name)).toContain('Novo');
  });

  it('data null da RPC não substitui o cache e mostra o fallback genérico', async () => {
    mockSelect({ data: ROWS, error: null });
    mockRpc({ data: null, error: null });
    const { queryClient } = await openEtapas();

    dragTo('stage-row-new', 'stage-row-negotiation');

    await waitFor(() => expect(screen.getByTestId('stages-reorder-error'))
      .toHaveTextContent('Não foi possível salvar a nova ordem das etapas.'));
    const cached = queryClient.getQueryData(KEY_A) as { stages: Array<{ id: string }> };
    expect(cached.stages.map((s) => s.id)).toEqual(ROWS.map((r) => r.id));
  });

  it('reset de identidade durante a RPC descarta a resposta obsoleta e mostra a mensagem de sessão alterada', async () => {
    mockSelect({ data: ROWS, error: null });
    const rpc = mockRpc('deferred');
    const { queryClient } = await openEtapas();

    dragTo('stage-row-new', 'stage-row-negotiation');
    // Garante que a RPC já está em voo (geração capturada) antes do reset.
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('stages-saving')).toBeInTheDocument();

    // Identidade muda no meio do voo (logout/troca de empresa). A query ativa
    // refaz o fetch da identidade atual (mock devolve a ordem original) — a
    // resposta ANTIGA da RPC nunca pode repovoar o cache com a ordem nova.
    act(() => { resetQueryCache(queryClient); });
    await act(async () => { rpc.deferred.resolve({ data: REORDERED_ROWS, error: null }); });

    await waitFor(() => expect(screen.getByTestId('stages-reorder-error'))
      .toHaveTextContent('A sessão mudou antes da conclusão da operação.'));
    await settled(queryClient);
    expect(rowOrder()).toEqual(ORIGINAL_ORDER);
    const cached = queryClient.getQueryData(KEY_A) as { stages: Array<{ id: string }> };
    expect(cached.stages.map((s) => s.id)).toEqual(ROWS.map((r) => r.id));
  });
});

describe('integração reorder — caminho local (flag OFF)', () => {
  beforeEach(() => { m.flag.current = false; });

  it('reorder local envia NAMES ao PipelineService, mantém "Novo" fixado e nunca chama RPC/Supabase', async () => {
    await openEtapas();

    // "Novo" fixado: primeira linha não é draggable e drop na posição 0 é ignorado.
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false');
    dragTo('stage-row-qualified', 'stage-row-new');
    expect(m.reorderLocal).not.toHaveBeenCalled();

    dragTo('stage-row-qualified', 'stage-row-closing');
    expect(m.reorderLocal).toHaveBeenCalledTimes(1);
    const sent = m.reorderLocal.mock.calls[0][0];
    expect(sent).toEqual(['Novo', 'Visita agendada', 'Em negociação', 'Fechamento', 'Qualificado']);
    expect(sent.every((name: string) => !name.startsWith('uuid-'))).toBe(true);

    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });
});
