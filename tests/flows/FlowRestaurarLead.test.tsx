// Testes de integração de FlowRestaurarLead (M1-E, E6-B2-B). Supabase
// mockado (rpc); AuthService/flags mockados; resolveLeadFlowContext/
// resolveLeadMutationCapabilities/useUnarchiveLead reais (mesmo padrão de
// FlowArquivarLead.test.tsx). Cobre: Manager-only (nunca canActorMutateLead,
// mesma capability canArchive, nunca canUnarchive), confirmação explícita,
// payload exato (sem restoreStageId), pending, sucesso, erros, troca de
// identidade, idempotência, stage/seller preservados.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  user: { current: null as any },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: m.isRemoteLeadsEnabled, isRemoteStagesEnabled: m.isRemoteStagesEnabled };
});

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
}));

import { FlowRestaurarLead } from '@/components/flows/FlowsShared';

function manager() {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
  };
}

function seller(sellerId: string | null = 's1') {
  return {
    id: 'user-2', name: 'Vendedor', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId },
  };
}

function archivedLead(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lead-1', name: 'Carlos Andrade', phone: '(11) 90000-0000', car: 'Golf GTI',
    stage: 'Novo', stageId: 'stage-new', seller: 'Marcos Silva', sellerId: 's1', urgency: 'green',
    archivedAt: '2026-07-29T10:00:00+00:00', version: 3,
    ...overrides,
  };
}

function renderFlow(lead: any, close = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlowRestaurarLead payload={{ lead }} close={close} />
    </QueryClientProvider>,
  );
  return { close, queryClient };
}

function mockRpc(overrides: Record<string, (args: any) => any> = {}) {
  m.rpc.mockImplementation((fn: string, args: any) => {
    if (overrides[fn]) return Promise.resolve(overrides[fn](args));
    if (fn === 'unarchive_lead') {
      return Promise.resolve({
        data: { id: 'lead-1', company_id: 'company-a', archived_at: null, stage_id: 'stage-new', seller_id: 's1', version: (args?.p_expected_version ?? 0) + 1 },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  m.rpc.mockReset();
  m.isRemoteLeadsEnabled.mockReturnValue(true);
  m.isRemoteStagesEnabled.mockReturnValue(true);
  m.user.current = manager();
  mockRpc();
});

describe('FlowRestaurarLead — Manager-only (sem exceção)', () => {
  it('Manager operacional: autorizado, confirmação exibida', () => {
    renderFlow(archivedLead());
    expect(screen.getByText(/Restaurar este Lead\?/)).toBeInTheDocument();
    expect(screen.queryByText('Você não possui permissão para restaurar este Lead.')).toBeNull();
  });

  it('Seller operacional (inclusive no próprio Lead): SEMPRE sem permissão — nunca canActorMutateLead', () => {
    m.user.current = seller('s1');
    renderFlow(archivedLead({ sellerId: 's1' }));
    expect(screen.getByText('Você não possui permissão para restaurar este Lead.')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('unarchive_lead', expect.anything());
  });

  it('Super Admin: sem permissão (capabilities todas false neste caminho)', () => {
    m.user.current = { id: 'sa-1', name: 'Admin', email: 'a@a.com', platformRole: 'super_admin', activeMembership: null };
    renderFlow(archivedLead());
    expect(screen.getByText('Você não possui permissão para restaurar este Lead.')).toBeInTheDocument();
  });
});

describe('FlowRestaurarLead — confirmação', () => {
  it('texto de confirmação menciona etapa e responsável preservados, nunca "recuperar item excluído"', () => {
    renderFlow(archivedLead());
    const text = screen.getByText(/Restaurar este Lead\?/).textContent ?? '';
    expect(text).toMatch(/etapa e o responsável anteriores/);
    expect(text).not.toMatch(/excluíd|deletad|lixeira/i);
  });

  it('Cancelar não chama a mutation', () => {
    const { close } = renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Cancelar'));
    expect(m.rpc).not.toHaveBeenCalledWith('unarchive_lead', expect.anything());
    expect(close).toHaveBeenCalled();
  });

  it('Restaurar Lead envia payload exato (leadId/expectedVersion, sem companyId/restoreStageId/sellerId/stageId)', async () => {
    renderFlow(archivedLead({ version: 6 }));
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('unarchive_lead', {
      p_lead_id: 'lead-1', p_expected_version: 6,
    }));
    const args = m.rpc.mock.calls.find((c) => c[0] === 'unarchive_lead')?.[1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_restore_stage_id');
    expect(args).not.toHaveProperty('p_seller_id');
    expect(args).not.toHaveProperty('p_stage_id');
  });
});

describe('FlowRestaurarLead — pending e duplo submit', () => {
  it('desabilita repetição enquanto pendente; uma única mutation', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    renderFlow(archivedLead());
    const confirmBtn = screen.getByText('Restaurar Lead');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(screen.getByText('Restaurando…')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Restaurando…'));
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', archived_at: null, stage_id: 'stage-new', seller_id: 's1', version: 4 }, error: null });
    await waitFor(() => expect(screen.getByText('Lead restaurado com sucesso')).toBeInTheDocument());
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'unarchive_lead').length).toBe(1);
  });
});

describe('FlowRestaurarLead — sucesso e stage/seller preservados', () => {
  it('mostra sucesso e Concluir fecha o flow', async () => {
    const { close } = renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Lead restaurado com sucesso')).toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Concluir'));
    expect(close).toHaveBeenCalled();
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    render(
      <QueryClientProvider client={queryClient}>
        <FlowRestaurarLead payload={{ lead: archivedLead() }} close={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Lead restaurado com sucesso')).toBeInTheDocument());
    expect(setDataSpy).not.toHaveBeenCalled();
  });

  it('idempotente: sucesso idempotente do backend (Lead já ativo) é tratado como sucesso', async () => {
    mockRpc({ unarchive_lead: () => ({ data: { id: 'lead-1', company_id: 'company-a', archived_at: null, stage_id: 'stage-new', seller_id: 's1', version: 3 }, error: null }) });
    renderFlow(archivedLead({ version: 999 }));
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Lead restaurado com sucesso')).toBeInTheDocument());
  });

  it('restauração preserva stage_id/seller_id existentes (contrato mantido, sem p_restore_stage_id)', async () => {
    renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('unarchive_lead', expect.anything()));
    const args = m.rpc.mock.calls.find((c) => c[0] === 'unarchive_lead')?.[1];
    expect(Object.keys(args)).toEqual(['p_lead_id', 'p_expected_version']);
  });
});

describe('FlowRestaurarLead — erros mantêm o flow aberto (exceto identity_changed)', () => {
  it('stale_write: mensagem sanitizada específica', async () => {
    mockRpc({ unarchive_lead: () => ({ data: null, error: { code: 'P0001', message: 'stale_write' } }) });
    renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Este Lead foi alterado por outra pessoa. Atualize os dados antes de restaurar.')).toBeInTheDocument());
  });

  it('lead_not_found: mensagem sanitizada específica', async () => {
    mockRpc({ unarchive_lead: () => ({ data: null, error: { code: 'P0001', message: 'lead_not_found' } }) });
    renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Este Lead não está mais disponível.')).toBeInTheDocument());
  });

  it('forbidden: mensagem sanitizada específica', async () => {
    mockRpc({ unarchive_lead: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Você não possui permissão para restaurar este Lead.')).toBeInTheDocument());
  });

  it('company_read_only: mensagem sanitizada específica', async () => {
    mockRpc({ unarchive_lead: () => ({ data: null, error: { code: 'P0001', message: 'company_read_only' } }) });
    renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Esta empresa está em modo somente leitura.')).toBeInTheDocument());
  });

  it('código desconhecido: mensagem genérica, nunca detalhe técnico', async () => {
    mockRpc({ unarchive_lead: () => ({ data: null, error: { code: 'XX000', message: 'algo_nunca_visto' } }) });
    renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(screen.getByText('Não foi possível restaurar o Lead.')).toBeInTheDocument());
  });

  it('nenhum retry automático — uma única chamada por clique', async () => {
    mockRpc({ unarchive_lead: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    renderFlow(archivedLead());
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(m.rpc.mock.calls.filter((c) => c[0] === 'unarchive_lead').length).toBe(1));
  });
});

describe('FlowRestaurarLead — troca de identidade', () => {
  it('empresa muda enquanto o flow está aberto: fecha sem mostrar sucesso', async () => {
    m.user.current = manager();
    const lead = archivedLead();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FlowRestaurarLead payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Restaurar este Lead\?/)).toBeInTheDocument();

    m.user.current = { ...manager(), activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } };
    rerender(
      <QueryClientProvider client={queryClient}>
        <FlowRestaurarLead payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Lead restaurado com sucesso')).toBeNull();
  });

  it('identity_changed durante a mutation: fecha o flow, nunca mostra sucesso', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const lead = archivedLead();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <FlowRestaurarLead payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Restaurar Lead'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('unarchive_lead', expect.anything()));

    const { bumpQueryCacheGeneration } = await import('@/lib/query/cacheIdentity');
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', archived_at: null, stage_id: 'stage-new', seller_id: 's1', version: 4 }, error: null });

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Lead restaurado com sucesso')).toBeNull();
  });
});

describe('FlowRestaurarLead — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('Manager operacional: ainda assim sem permissão (capabilities todas false)', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    renderFlow(archivedLead());
    expect(screen.getByText('Você não possui permissão para restaurar este Lead.')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('unarchive_lead', expect.anything());
  });
});
