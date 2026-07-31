// Testes de FlowVerClienteArquivado (M1-E, E6-B2-B). Detalhe read-only de
// Lead arquivado — recebe o Lead diretamente por payload (já adaptado pela
// tela de Arquivados), nunca busca na lista ativa, nunca chama LeadService.
// AuthService/flags mockados (mesmo padrão de FlowVerCliente/FlowLigarRemote).
// Cobre: nenhuma ação de Lead ativo, "Restaurar Lead" Manager-only.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  user: { current: null as any },
  from: vi.fn(),
  rpc: vi.fn(),
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

// M1-E E7-B2-A1 — timeline remota (RemoteLeadTimelinePanel).
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: m.from, rpc: m.rpc },
  isSupabaseConfigured: true,
}));

function mockTimelineReadResponse(response: { data: unknown; error: unknown }) {
  const order3 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order2 = vi.fn(() => ({ order: order3 }));
  const order1 = vi.fn(() => ({ order: order2 }));
  const eq2 = vi.fn(() => ({ order: order1 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  m.from.mockReturnValue({ select });
}

import { FlowVerClienteArquivado } from '@/components/flows/FlowsShared';

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

// M1-E E7-B2-A1 — quando canArchive é true (Manager operacional em
// remote_ready), FlowVerClienteArquivado monta RemoteLeadTimelinePanel
// (TanStack Query) — QueryClientProvider necessário. Supabase não é
// mockado neste arquivo, então a leitura nunca resolve dentro da janela
// síncrona do teste — suficiente para as asserções deste arquivo, que não
// dependem do conteúdo real da timeline.
function renderFlow(lead: any, close = vi.fn(), openFlow = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlowVerClienteArquivado payload={{ lead }} close={close} openFlow={openFlow} />
    </QueryClientProvider>,
  );
  return { close, openFlow };
}

beforeEach(() => {
  m.isRemoteLeadsEnabled.mockReturnValue(true);
  m.isRemoteStagesEnabled.mockReturnValue(true);
  m.user.current = manager();
  m.from.mockReset();
  m.rpc.mockReset();
  mockTimelineReadResponse({ data: [], error: null });
});

describe('FlowVerClienteArquivado — informações read-only', () => {
  it('mostra nome, telefone, veículo, etapa, vendedor histórico e data de arquivamento', () => {
    renderFlow(archivedLead());
    expect(screen.getAllByText('Carlos Andrade').length).toBeGreaterThan(0);
    expect(screen.getByText('(11) 90000-0000')).toBeInTheDocument();
    expect(screen.getByText('Golf GTI')).toBeInTheDocument();
    expect(screen.getAllByText('Novo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Marcos Silva').length).toBeGreaterThan(0);
    expect(screen.getByText('29/07/2026')).toBeInTheDocument();
  });

  it('Seller sem vendedor (sellerId null): mostra "—"', () => {
    renderFlow(archivedLead({ sellerId: null, seller: '—' }));
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('nenhuma ação de Lead ativo aparece (editar, ligar, mover, atribuir, arquivar, visita, proposta, venda, acompanhamento)', () => {
    renderFlow(archivedLead());
    for (const label of [
      'Ligar', 'Ligar agora', 'Agendar visita', 'Nova proposta', 'Acompanhar',
      'Editar dados', 'Alterar responsável', 'Arquivar Lead',
      'Registrar venda', 'Nova pendência',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

describe('FlowVerClienteArquivado — Restaurar Lead (Manager-only)', () => {
  it('Manager operacional: botão "Restaurar Lead" aparece', () => {
    renderFlow(archivedLead());
    expect(screen.getByText('Restaurar Lead')).toBeInTheDocument();
  });

  it('clicar em "Restaurar Lead" chama openFlow("restaurar-lead", { lead })', () => {
    const { openFlow } = renderFlow(archivedLead());
    screen.getByText('Restaurar Lead').click();
    expect(openFlow).toHaveBeenCalledWith('restaurar-lead', { lead: expect.objectContaining({ id: 'lead-1' }) });
  });

  it('Seller: "Restaurar Lead" nunca aparece', () => {
    m.user.current = seller('s1');
    renderFlow(archivedLead({ sellerId: 's1' }));
    expect(screen.queryByText('Restaurar Lead')).toBeNull();
  });

  it('Super Admin: "Restaurar Lead" nunca aparece', () => {
    m.user.current = { id: 'sa-1', name: 'Admin', email: 'a@a.com', platformRole: 'super_admin', activeMembership: null };
    renderFlow(archivedLead());
    expect(screen.queryByText('Restaurar Lead')).toBeNull();
  });

  it('remote_misconfigured: "Restaurar Lead" nunca aparece', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    renderFlow(archivedLead());
    expect(screen.queryByText('Restaurar Lead')).toBeNull();
  });
});

// M1-E E7-B2-A1 — timeline remota SOMENTE LEITURA no detalhe do Lead
// arquivado. Gate reaproveita capabilities.canArchive (Manager-only,
// exclusivo de remote_ready) — nunca ctx.dataSource==='remote' sozinho, que
// permaneceria 'remote' mesmo em remote_misconfigured.
describe('FlowVerClienteArquivado — timeline (E7-B2-A1)', () => {
  it('Manager operacional: mostra a timeline remota, nunca formulário de nota', async () => {
    mockTimelineReadResponse({
      data: [{ id: 't1', company_id: 'company-a', lead_id: 'lead-1', actor_profile_id: 'user-1', icon: 'inbox', color: '#8B8B93', label: 'Lead arquivado', detail: null, occurred_at: '2026-07-29T10:00:00Z', created_at: '2026-07-29T10:00:00Z' }],
      error: null,
    });
    renderFlow(archivedLead());
    await waitFor(() => expect(screen.getByText('Lead arquivado')).toBeInTheDocument());
    expect(m.from).toHaveBeenCalledWith('lead_timeline_entries');
    expect(screen.queryByPlaceholderText(/Digite uma observação/)).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('estado vazio correto quando não há entradas', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    renderFlow(archivedLead());
    await waitFor(() => expect(screen.getByText('Nenhum histórico registrado ainda.')).toBeInTheDocument());
  });

  it('Seller: timeline remota nunca é consultada (sem acesso a Lead arquivado)', async () => {
    m.user.current = seller('s1');
    renderFlow(archivedLead({ sellerId: 's1' }));
    await waitFor(() => expect(screen.queryByText('Restaurar Lead')).toBeNull());
    expect(m.from).not.toHaveBeenCalled();
  });

  it('Super Admin: timeline remota nunca é consultada (usa a superfície Platform)', async () => {
    m.user.current = { id: 'sa-1', name: 'Admin', email: 'a@a.com', platformRole: 'super_admin', activeMembership: null };
    renderFlow(archivedLead());
    await waitFor(() => expect(screen.queryByText('Restaurar Lead')).toBeNull());
    expect(m.from).not.toHaveBeenCalled();
  });

  it('remote_misconfigured: timeline remota nunca é consultada, fail-closed, sem crash', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    expect(() => renderFlow(archivedLead())).not.toThrow();
    await waitFor(() => expect(screen.queryByText('Restaurar Lead')).toBeNull());
    expect(m.from).not.toHaveBeenCalled();
  });
});
