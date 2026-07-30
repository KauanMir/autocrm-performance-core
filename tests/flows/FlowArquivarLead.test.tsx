// Testes de integração de FlowArquivarLead (M1-E, E6-B2-A). Supabase
// mockado (rpc); AuthService/flags mockados; resolveLeadFlowContext/
// resolveLeadMutationCapabilities/useArchiveLead reais (mesmo padrão de
// FlowLigarRemote.test.tsx). Cobre: Manager-only (nunca canActorMutateLead),
// confirmação explícita, payload exato, pending, sucesso, erros, troca de
// identidade, idempotência.
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

import { FlowArquivarLead } from '@/components/flows/FlowsShared';

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

function remoteLead(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lead-1', name: 'Carlos Andrade', phone: '(11) 90000-0000', car: 'Golf GTI',
    stage: 'Novo', stageId: 'stage-new', seller: 'Marcos Silva', sellerId: 's1', urgency: 'red',
    last: 'ok', alert: 'ok', pay: 'À vista', value: '—', version: 3,
    ...overrides,
  };
}

function renderFlow(lead: any, close = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlowArquivarLead payload={{ lead }} close={close} />
    </QueryClientProvider>,
  );
  return { close, queryClient };
}

function mockRpc(overrides: Record<string, (args: any) => any> = {}) {
  m.rpc.mockImplementation((fn: string, args: any) => {
    if (overrides[fn]) return Promise.resolve(overrides[fn](args));
    if (fn === 'archive_lead') {
      return Promise.resolve({
        data: { id: 'lead-1', company_id: 'company-a', archived_at: '2026-07-30T10:00:00+00:00', version: (args?.p_expected_version ?? 0) + 1 },
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

describe('FlowArquivarLead — Manager-only (sem exceção)', () => {
  it('Manager operacional: autorizado, confirmação exibida', () => {
    renderFlow(remoteLead());
    expect(screen.getByText(/Arquivar este Lead\?/)).toBeInTheDocument();
    expect(screen.queryByText('Você não possui permissão para arquivar este Lead.')).toBeNull();
  });

  it('Seller operacional (inclusive no próprio Lead): SEMPRE sem permissão — nunca canActorMutateLead', () => {
    m.user.current = seller('s1');
    renderFlow(remoteLead({ sellerId: 's1' }));
    expect(screen.getByText('Você não possui permissão para arquivar este Lead.')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('archive_lead', expect.anything());
  });

  it('Super Admin: sem permissão (capabilities todas false neste caminho)', () => {
    m.user.current = { id: 'sa-1', name: 'Admin', email: 'a@a.com', platformRole: 'super_admin', activeMembership: null };
    renderFlow(remoteLead());
    expect(screen.getByText('Você não possui permissão para arquivar este Lead.')).toBeInTheDocument();
  });
});

describe('FlowArquivarLead — confirmação', () => {
  it('texto de confirmação nunca usa "excluir"/"apagar"/"remover definitivamente"', () => {
    renderFlow(remoteLead());
    const text = screen.getByText(/Arquivar este Lead\?/).textContent ?? '';
    expect(text).not.toMatch(/excluir|apagar|remover definitivamente/i);
  });

  it('Cancelar não chama a mutation', () => {
    const { close } = renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Cancelar'));
    expect(m.rpc).not.toHaveBeenCalledWith('archive_lead', expect.anything());
    expect(close).toHaveBeenCalled();
  });

  it('Arquivar Lead envia payload exato (leadId/expectedVersion, sem companyId)', async () => {
    renderFlow(remoteLead({ version: 6 }));
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('archive_lead', {
      p_lead_id: 'lead-1', p_expected_version: 6,
    }));
    expect(m.rpc.mock.calls.find((c) => c[0] === 'archive_lead')?.[1]).not.toHaveProperty('p_company_id');
  });
});

describe('FlowArquivarLead — pending e duplo submit', () => {
  it('desabilita repetição enquanto pendente; uma única mutation', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    renderFlow(remoteLead());
    const confirmBtn = screen.getByText('Arquivar Lead');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(screen.getByText('Arquivando…')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Arquivando…'));
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', archived_at: '2026-07-30T10:00:00+00:00', version: 4 }, error: null });
    await waitFor(() => expect(screen.getByText('Lead arquivado com sucesso')).toBeInTheDocument());
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'archive_lead').length).toBe(1);
  });
});

describe('FlowArquivarLead — sucesso', () => {
  it('mostra sucesso e Concluir fecha o flow', async () => {
    const { close } = renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Lead arquivado com sucesso')).toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Concluir'));
    expect(close).toHaveBeenCalled();
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    render(
      <QueryClientProvider client={queryClient}>
        <FlowArquivarLead payload={{ lead: remoteLead() }} close={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Lead arquivado com sucesso')).toBeInTheDocument());
    expect(setDataSpy).not.toHaveBeenCalled();
  });

  it('idempotente: sucesso idempotente do backend é tratado como sucesso', async () => {
    mockRpc({ archive_lead: (args) => ({ data: { id: 'lead-1', company_id: 'company-a', archived_at: '2026-07-29T10:00:00+00:00', version: 3 }, error: null }) });
    renderFlow(remoteLead({ version: 99 }));
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Lead arquivado com sucesso')).toBeInTheDocument());
  });
});

describe('FlowArquivarLead — erros mantêm o flow aberto (exceto identity_changed)', () => {
  it('stale_write: mensagem sanitizada específica', async () => {
    mockRpc({ archive_lead: () => ({ data: null, error: { code: 'P0001', message: 'stale_write' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Este Lead foi alterado por outra pessoa. Atualize os dados antes de arquivar.')).toBeInTheDocument());
  });

  it('lead_not_found: mensagem sanitizada específica', async () => {
    mockRpc({ archive_lead: () => ({ data: null, error: { code: 'P0001', message: 'lead_not_found' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Este Lead não está mais disponível.')).toBeInTheDocument());
  });

  it('forbidden: mensagem sanitizada específica', async () => {
    mockRpc({ archive_lead: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Você não possui permissão para arquivar este Lead.')).toBeInTheDocument());
  });

  it('company_read_only: mensagem sanitizada específica', async () => {
    mockRpc({ archive_lead: () => ({ data: null, error: { code: 'P0001', message: 'company_read_only' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Esta empresa está em modo somente leitura.')).toBeInTheDocument());
  });

  it('código desconhecido: mensagem genérica, nunca detalhe técnico', async () => {
    mockRpc({ archive_lead: () => ({ data: null, error: { code: 'XX000', message: 'algo_nunca_visto' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(screen.getByText('Não foi possível arquivar o Lead.')).toBeInTheDocument());
  });

  it('nenhum retry automático — uma única chamada por clique', async () => {
    mockRpc({ archive_lead: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(m.rpc.mock.calls.filter((c) => c[0] === 'archive_lead').length).toBe(1));
  });
});

describe('FlowArquivarLead — troca de identidade', () => {
  it('empresa muda enquanto o flow está aberto: fecha sem mostrar sucesso', async () => {
    m.user.current = manager();
    const lead = remoteLead();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FlowArquivarLead payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Arquivar este Lead\?/)).toBeInTheDocument();

    m.user.current = { ...manager(), activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } };
    rerender(
      <QueryClientProvider client={queryClient}>
        <FlowArquivarLead payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Lead arquivado com sucesso')).toBeNull();
  });

  it('identity_changed durante a mutation: fecha o flow, nunca mostra sucesso', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const lead = remoteLead();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <FlowArquivarLead payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Arquivar Lead'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('archive_lead', expect.anything()));

    const { bumpQueryCacheGeneration } = await import('@/lib/query/cacheIdentity');
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', archived_at: '2026-07-30T10:00:00+00:00', version: 4 }, error: null });

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Lead arquivado com sucesso')).toBeNull();
  });
});

describe('FlowArquivarLead — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('Manager operacional: ainda assim sem permissão (capabilities todas false)', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    renderFlow(remoteLead());
    expect(screen.getByText('Você não possui permissão para arquivar este Lead.')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('archive_lead', expect.anything());
  });
});
