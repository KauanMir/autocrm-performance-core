// Testes de usePipelineStages (M1-D, commit 5).
// Mock isolado do módulo lib/supabase/client (cadeia from→select→order, com
// spy de eq para provar que NENHUM filtro de company_id é usado) e mock
// controlável de isRemoteStagesEnabled. Nenhuma rede real, sem snapshots.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePipelineStages } from '@/lib/hooks/usePipelineStages';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteStagesEnabled: mocks.isRemoteStagesEnabled };
});

// ── Fixtures (formato das 5 colunas projetadas pelo select) ──────────────

const REMOTE_ROWS = [
  { id: 'uuid-new',   code: 'new',             name: 'Novo',            sort_order: 0, is_terminal: false },
  { id: 'uuid-qual',  code: 'qualified',       name: 'Qualificado',     sort_order: 1, is_terminal: false },
  { id: 'uuid-visit', code: 'visit_scheduled', name: 'Visita agendada', sort_order: 2, is_terminal: false },
  { id: 'uuid-neg',   code: 'negotiation',     name: 'Em negociação',   sort_order: 3, is_terminal: false },
  { id: 'uuid-close', code: 'closing',         name: 'Fechamento',      sort_order: 4, is_terminal: true },
];

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

const FULL_IDENTITY = {
  userId: 'user-1',
  companyId: 'company-a',
  userIsActive: true,
  localStageNames: LOCAL_NAMES,
};

// ── Helpers ──────────────────────────────────────────────────────────────

type ChainSpies = { select: ReturnType<typeof vi.fn>; order: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> };

function mockStagesResponse(response: { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>): ChainSpies {
  const eq = vi.fn();
  const order = vi.fn().mockReturnValue(Promise.resolve(response));
  const select = vi.fn(() => ({ order, eq }));
  mocks.from.mockReturnValue({ select, eq });
  return { select, order, eq };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.isRemoteStagesEnabled.mockReturnValue(false);
});

// ── A. Flag OFF ──────────────────────────────────────────────────────────

describe('usePipelineStages — flag OFF (caminho local)', () => {
  it('retorna source local preservando a ordem recebida', () => {
    const { wrapper } = createWrapper();
    const localOrder = ['Fechamento', 'Novo', 'Qualificado', 'Visita agendada', 'Em negociação'];
    const { result } = renderHook(
      () => usePipelineStages({ ...FULL_IDENTITY, localStageNames: localOrder }),
      { wrapper },
    );
    expect(result.current.source).toBe('local');
    expect(result.current.stages.map((s) => s.name)).toEqual(localOrder);
    expect(result.current.hasData).toBe(true);
  });

  it('queryEnabled=false, nenhuma chamada a supabase.from, sem loading/error', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.configError).toBeNull();
  });
});

// ── B. Gating remoto ─────────────────────────────────────────────────────

describe('usePipelineStages — gating remoto', () => {
  beforeEach(() => {
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    mockStagesResponse({ data: REMOTE_ROWS, error: null });
  });

  it('flag ON sem userId ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePipelineStages({ ...FULL_IDENTITY, userId: null }),
      { wrapper },
    );
    expect(result.current.source).toBe('remote');
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.stages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.configError).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('flag ON sem companyId ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePipelineStages({ ...FULL_IDENTITY, companyId: undefined }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('flag ON com userIsActive=false ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePipelineStages({ ...FULL_IDENTITY, userIsActive: false }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('flag ON com identidade completa ⇒ executa a query', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});

// ── C. Consulta ──────────────────────────────────────────────────────────

describe('usePipelineStages — forma exata da consulta', () => {
  it('from/select/order exatos e NENHUM filtro de company_id', async () => {
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    const spies = mockStagesResponse({ data: REMOTE_ROWS, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));

    expect(mocks.from).toHaveBeenCalledWith('pipeline_stages');
    expect(spies.select).toHaveBeenCalledWith('id, code, name, sort_order, is_terminal');
    expect(spies.order).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(spies.eq).not.toHaveBeenCalled();
  });

  it('query key contém o companyId e companies diferentes têm caches distintos', async () => {
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    mockStagesResponse({ data: REMOTE_ROWS, error: null });
    const { queryClient, wrapper } = createWrapper();

    const a = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    expect(a.result.current.queryKey).toEqual(['company', 'company-a', 'pipeline-stages']);
    await waitFor(() => expect(a.result.current.hasData).toBe(true));

    mockStagesResponse({ data: [], error: null });
    const b = renderHook(
      () => usePipelineStages({ ...FULL_IDENTITY, companyId: 'company-b' }),
      { wrapper },
    );
    expect(b.result.current.queryKey).toEqual(['company', 'company-b', 'pipeline-stages']);
    await waitFor(() => expect(b.result.current.isEmpty).toBe(true));

    // Entradas de cache separadas por company — A continua com os 5 stages.
    expect(queryClient.getQueryData(pipelineStageQueryKeys.byCompany('company-a'))).not.toEqual(
      queryClient.getQueryData(pipelineStageQueryKeys.byCompany('company-b')),
    );
    expect(a.result.current.stages).toHaveLength(5);
    expect(b.result.current.stages).toHaveLength(0);
  });
});

// ── D. Sucesso ───────────────────────────────────────────────────────────

describe('usePipelineStages — sucesso remoto', () => {
  beforeEach(() => {
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
  });

  it('rows são adaptadas, ordenadas e indexadas; sem configError', async () => {
    mockStagesResponse({ data: [...REMOTE_ROWS].reverse(), error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));

    expect(result.current.source).toBe('remote');
    expect(result.current.configError).toBeNull();
    expect(result.current.stages.map((s) => s.code)).toEqual([
      'new', 'qualified', 'visit_scheduled', 'negotiation', 'closing',
    ]);
    expect(result.current.stages[0]).toEqual({
      id: 'uuid-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false,
    });
    expect(result.current.byId['uuid-close'].isTerminal).toBe(true);
    expect(result.current.byCode['negotiation'].name).toBe('Em negociação');
    expect(result.current.byName['Qualificado'].code).toBe('qualified');
  });

  it('array remoto vazio é sucesso com isEmpty=true', async () => {
    mockStagesResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.configError).toBeNull();
    expect(result.current.stages).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });

  it('data null é tratado como array vazio', async () => {
    mockStagesResponse({ data: null, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
  });
});

// ── E. Incompatibilidade de names ────────────────────────────────────────

describe('usePipelineStages — name-mismatch', () => {
  beforeEach(() => {
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
  });

  it('mismatch expõe configError sem stages locais e sem erro de rede', async () => {
    const renamed = REMOTE_ROWS.map((r) =>
      r.name === 'Novo' ? { ...r, name: 'Entrada' } : r,
    );
    mockStagesResponse({ data: renamed, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    await waitFor(() => expect(result.current.configError).not.toBeNull());

    expect(result.current.configError?.reason).toBe('name-mismatch');
    expect(result.current.configError?.missingNames).toEqual(['Novo']);
    expect(result.current.configError?.unexpectedNames).toEqual(['Entrada']);
    expect(result.current.configError?.duplicateNames).toEqual([]);
    expect(result.current.stages).toEqual([]); // nunca a lista local
    expect(result.current.isError).toBe(false); // não é erro de rede
    expect(result.current.hasData).toBe(false);
  });
});

// ── F. Erro remoto ───────────────────────────────────────────────────────

describe('usePipelineStages — erro Supabase', () => {
  it('erro é exposto, isError=true e nenhum fallback local é usado', async () => {
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    const boom = { message: 'permission denied', code: '42501' };
    mockStagesResponse({ data: null, error: boom });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(boom);
    expect(result.current.stages).toEqual([]); // sem fallback local
    expect(result.current.configError).toBeNull();
  });
});

// ── G. Refetch e cache ───────────────────────────────────────────────────

describe('usePipelineStages — refetch e cache', () => {
  it('refetch mantém os dados anteriores disponíveis durante a nova busca', async () => {
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    mockStagesResponse({ data: REMOTE_ROWS, error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePipelineStages(FULL_IDENTITY), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(typeof result.current.refetch).toBe('function');

    // Segunda resposta fica pendente até resolvermos manualmente.
    let resolveSecond!: (v: { data: unknown; error: unknown }) => void;
    const pending = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      resolveSecond = resolve;
    });
    mockStagesResponse(pending);

    result.current.refetch();
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    // Dados anteriores permanecem visíveis durante o refetch.
    expect(result.current.stages).toHaveLength(5);
    expect(result.current.hasData).toBe(true);

    resolveSecond({ data: REMOTE_ROWS, error: null });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.stages).toHaveLength(5);
  });
});
