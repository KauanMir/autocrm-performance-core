// Testes de useReorderStages (M1-D, commit 7).
// Supabase mockado (rpc), QueryClient novo por teste, sem rede/snapshots.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useReorderStages,
  getReorderStagesErrorMessage,
  REORDER_LOCAL_ERRORS,
} from '@/lib/hooks/useReorderStages';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const RPC_ROWS = [
  { id: 'uuid-close', code: 'closing',         name: 'Fechamento',      sort_order: 0, is_terminal: true,  company_id: 'c', created_at: '', updated_at: '' },
  { id: 'uuid-new',   code: 'new',             name: 'Novo',            sort_order: 1, is_terminal: false, company_id: 'c', created_at: '', updated_at: '' },
  { id: 'uuid-qual',  code: 'qualified',       name: 'Qualificado',     sort_order: 2, is_terminal: false, company_id: 'c', created_at: '', updated_at: '' },
  { id: 'uuid-visit', code: 'visit_scheduled', name: 'Visita agendada', sort_order: 3, is_terminal: false, company_id: 'c', created_at: '', updated_at: '' },
  { id: 'uuid-neg',   code: 'negotiation',     name: 'Em negociação',   sort_order: 4, is_terminal: false, company_id: 'c', created_at: '', updated_at: '' },
];

const IDS = ['uuid-close', 'uuid-new', 'uuid-qual', 'uuid-visit', 'uuid-neg'];
const KEY_A = pipelineStageQueryKeys.byCompany('company-a');
const KEY_B = pipelineStageQueryKeys.byCompany('company-b');
const PREV_A = { ok: true, stages: [{ id: 'antigo' }], byId: {}, byCode: {}, byName: {} };
const PREV_B = { ok: true, stages: [{ id: 'outra-empresa' }], byId: {}, byCode: {}, byName: {} };

function setup(options: { companyId?: string | null; canReorder?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  queryClient.setQueryData(KEY_A, PREV_A);
  queryClient.setQueryData(KEY_B, PREV_B);
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useReorderStages({ companyId: 'company-a', canReorder: true, ...options }),
    { wrapper },
  );
  return { queryClient, invalidateSpy, hook };
}

async function expectRejection(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toThrow(message);
}

beforeEach(() => {
  mocks.rpc.mockResolvedValue({ data: RPC_ROWS, error: null });
});

describe('useReorderStages — chamada da RPC', () => {
  it('chama rpc("reorder_pipeline_stages") com payload contendo APENAS p_ordered_ids', async () => {
    const { hook } = setup();
    await hook.result.current.reorderStages(IDS);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fnName, payload] = mocks.rpc.mock.calls[0];
    expect(fnName).toBe('reorder_pipeline_stages');
    expect(Object.keys(payload)).toEqual(['p_ordered_ids']);
    expect(payload.p_ordered_ids).toEqual(IDS);
    expect(payload).not.toHaveProperty('company_id');
  });

  it('não modifica o array de entrada (payload é cópia nova)', async () => {
    const { hook } = setup();
    const input = Object.freeze([...IDS]) as readonly string[];
    await hook.result.current.reorderStages(input);
    expect(input).toEqual(IDS);
    expect(mocks.rpc.mock.calls[0][1].p_ordered_ids).not.toBe(input);
  });
});

describe('useReorderStages — validações locais bloqueiam a chamada', () => {
  it('canReorder=false bloqueia sem chamar o Supabase', async () => {
    const { hook, queryClient } = setup({ canReorder: false });
    await expectRejection(hook.result.current.reorderStages(IDS), REORDER_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
  });

  it('companyId ausente bloqueia', async () => {
    const { hook } = setup({ companyId: null });
    await expectRejection(hook.result.current.reorderStages(IDS), REORDER_LOCAL_ERRORS.missingCompany);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('lista vazia bloqueia', async () => {
    const { hook } = setup();
    await expectRejection(hook.result.current.reorderStages([]), REORDER_LOCAL_ERRORS.emptyList);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('ID vazio bloqueia', async () => {
    const { hook } = setup();
    await expectRejection(hook.result.current.reorderStages(['uuid-1', '  ']), REORDER_LOCAL_ERRORS.invalidId);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('IDs duplicados bloqueiam', async () => {
    const { hook } = setup();
    await expectRejection(hook.result.current.reorderStages(['a', 'b', 'a']), REORDER_LOCAL_ERRORS.duplicateIds);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useReorderStages — respostas', () => {
  it('erro do Supabase é preservado e o cache anterior fica intacto', async () => {
    const boom = { message: 'forbidden: manager/admin only', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: boom });
    const { hook, queryClient, invalidateSpy } = setup();
    await expect(hook.result.current.reorderStages(IDS)).rejects.toBe(boom);
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.error).toBe(boom);
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
    expect(queryClient.getQueryData(KEY_B)).toBe(PREV_B);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('data null é rejeitado como resposta inesperada', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const { hook, queryClient } = setup();
    await expectRejection(hook.result.current.reorderStages(IDS), REORDER_LOCAL_ERRORS.emptyResponse);
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
  });

  it('name-mismatch no retorno é tratado como erro de configuração, sem tocar o cache', async () => {
    const renamed = RPC_ROWS.map((r) => (r.name === 'Novo' ? { ...r, name: 'Entrada' } : r));
    mocks.rpc.mockResolvedValue({ data: renamed, error: null });
    const { hook, queryClient } = setup();
    await expectRejection(hook.result.current.reorderStages(IDS), REORDER_LOCAL_ERRORS.configMismatch);
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);
  });

  it('retorno válido é adaptado, ordenado e gravado SOMENTE na key da empresa atual + invalidação', async () => {
    const { hook, queryClient, invalidateSpy } = setup();
    const result = await hook.result.current.reorderStages(IDS);

    expect(result.ok).toBe(true);
    expect(result.stages.map((s) => s.code)).toEqual([
      'closing', 'new', 'qualified', 'visit_scheduled', 'negotiation',
    ]);
    expect(result.stages.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4]);

    const cachedA = queryClient.getQueryData(KEY_A) as typeof result;
    // Mesmo formato exato que a query espera (o TanStack aplica structural
    // sharing, então comparamos conteúdo, não referência).
    expect(cachedA).toEqual(result);
    expect(cachedA.stages[0].name).toBe('Fechamento');
    // Cache de outra empresa intocado.
    expect(queryClient.getQueryData(KEY_B)).toBe(PREV_B);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: KEY_A });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: KEY_B });
  });

  it('sem optimistic update: cache não muda antes da resposta e isPending bloqueia reentrada', async () => {
    let resolveRpc!: (v: { data: unknown; error: unknown }) => void;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient } = setup();

    const pending = hook.result.current.reorderStages(IDS);
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));
    // Nenhuma ordem temporária aplicada antes da resposta.
    expect(queryClient.getQueryData(KEY_A)).toBe(PREV_A);

    resolveRpc({ data: RPC_ROWS, error: null });
    await pending;
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
    expect((queryClient.getQueryData(KEY_A) as { ok: boolean }).ok).toBe(true);
  });
});

describe('getReorderStagesErrorMessage', () => {
  it('cobre os erros conhecidos e o fallback genérico', () => {
    expect(getReorderStagesErrorMessage({ message: 'forbidden: manager/admin only' }))
      .toBe('Você não tem permissão para reordenar as etapas.');
    expect(getReorderStagesErrorMessage(new Error(REORDER_LOCAL_ERRORS.notAllowed)))
      .toBe('Você não tem permissão para reordenar as etapas.');
    expect(getReorderStagesErrorMessage({ message: 'no active profile for current user' }))
      .toBe('Sua sessão não possui um perfil ativo.');
    expect(getReorderStagesErrorMessage(new Error(REORDER_LOCAL_ERRORS.missingCompany)))
      .toBe('Sua sessão não possui um perfil ativo.');
    expect(getReorderStagesErrorMessage({ message: 'deadlock detected', code: '40P01' }))
      .toBe('Ocorreu um conflito ao salvar a ordem. Tente novamente.');
    expect(getReorderStagesErrorMessage({ message: 'serialization failure', code: '40001' }))
      .toBe('Ocorreu um conflito ao salvar a ordem. Tente novamente.');
    expect(getReorderStagesErrorMessage(new Error(REORDER_LOCAL_ERRORS.configMismatch)))
      .toBe('As etapas retornadas não correspondem à configuração esperada.');
    expect(getReorderStagesErrorMessage(new Error('anything else')))
      .toBe('Não foi possível salvar a nova ordem das etapas.');
    expect(getReorderStagesErrorMessage(undefined))
      .toBe('Não foi possível salvar a nova ordem das etapas.');
  });
});
