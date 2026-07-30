// Testes de integração de FlowLigar — caminho remoto (M1-E, E5-B2-A2).
// Supabase mockado (rpc); AuthService/flags mockados; resolveLeadFlowContext/
// resolveLeadMutationCapabilities/canActorMutateLead/
// mapLeadHealthEventToRemoteEventType/useApplyLeadEvent reais (mesmo padrão
// de FlowEditarCliente.test.tsx). Cobre: capability+posse, 4 outcomes,
// payload exato, sem Task/timeline/StoreAdapter, pending, sucesso, erros,
// troca de identidade.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  user: { current: null as any },
  leadServiceUpdateHealth: vi.fn(),
  leadServiceAddToTimeline: vi.fn(),
  taskServiceCreate: vi.fn(),
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
  LeadService: { getAll: () => [], updateHealth: m.leadServiceUpdateHealth, addToTimeline: m.leadServiceAddToTimeline },
  TaskService: { getAll: () => [], create: m.taskServiceCreate },
  SellerService: { getAll: () => [] },
}));

import { FlowLigar } from '@/components/flows/FlowsShared';

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
    stage: 'Novo', stageId: 'stage-new', seller: 'Ana', sellerId: 's1', urgency: 'red',
    last: 'ok', alert: 'ok', pay: 'À vista', value: '—', temperature: 'warm', origem: 'Showroom',
    version: 3,
    ...overrides,
  };
}

function renderFlow(lead: any, close = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlowLigar payload={{ lead }} close={close} openFlow={vi.fn()} />
    </QueryClientProvider>,
  );
  return { close };
}

function mockRpc(overrides: Record<string, (args: any) => any> = {}) {
  m.rpc.mockImplementation((fn: string, args: any) => {
    if (overrides[fn]) return Promise.resolve(overrides[fn](args));
    if (fn === 'apply_lead_event') return Promise.resolve({ data: { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-new', urgency: 'amber', version: 4 }, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  m.rpc.mockReset();
  m.leadServiceUpdateHealth.mockReset();
  m.leadServiceAddToTimeline.mockReset();
  m.taskServiceCreate.mockReset();
  m.isRemoteLeadsEnabled.mockReturnValue(true);
  m.isRemoteStagesEnabled.mockReturnValue(true);
  m.user.current = manager();
  mockRpc();
});

describe('FlowLigar — capability e posse por Lead', () => {
  it('Manager operacional: autorizado em qualquer Lead da empresa', () => {
    renderFlow(remoteLead({ sellerId: 's-qualquer' }));
    expect(screen.getByText('Solicitou proposta')).toBeInTheDocument();
    expect(screen.queryByText('Você não tem permissão para registrar uma ligação neste Lead.')).toBeNull();
  });

  it('Seller operacional: autorizado no próprio Lead', () => {
    m.user.current = seller('s1');
    renderFlow(remoteLead({ sellerId: 's1' }));
    expect(screen.getByText('Solicitou proposta')).toBeInTheDocument();
  });

  it('Seller: NÃO autorizado em Lead de outro Seller', () => {
    m.user.current = seller('s1');
    renderFlow(remoteLead({ sellerId: 's2' }));
    expect(screen.getByText('Você não tem permissão para registrar uma ligação neste Lead.')).toBeInTheDocument();
    expect(screen.queryByText('Solicitou proposta')).toBeNull();
  });

  it('Seller: NÃO autorizado em Lead sem Seller', () => {
    m.user.current = seller('s1');
    renderFlow(remoteLead({ sellerId: null }));
    expect(screen.getByText('Você não tem permissão para registrar uma ligação neste Lead.')).toBeInTheDocument();
  });

  it('Seller sem sellerId próprio: nunca autorizado', () => {
    m.user.current = seller(null);
    renderFlow(remoteLead({ sellerId: 's1' }));
    expect(screen.getByText('Você não tem permissão para registrar uma ligação neste Lead.')).toBeInTheDocument();
  });
});

describe('FlowLigar — aviso honesto e labels', () => {
  it('mostra o aviso de ausência temporária de tarefa/timeline', () => {
    renderFlow(remoteLead());
    expect(screen.getByText(/o resultado será salvo no andamento do Lead/)).toBeInTheDocument();
  });

  it('mostra os 4 labels honestos, nunca "Visita agendada"/"Proposta criada"/"Tarefa criada"', () => {
    renderFlow(remoteLead());
    expect(screen.getByText('Demonstrou interesse em visita')).toBeInTheDocument();
    expect(screen.getByText('Solicitou proposta')).toBeInTheDocument();
    expect(screen.getByText('Pediu retorno')).toBeInTheDocument();
    expect(screen.getByText('Não atendeu')).toBeInTheDocument();
    expect(screen.queryByText(/Visita agendada/)).toBeNull();
    expect(screen.queryByText(/Proposta criada/)).toBeNull();
    expect(screen.queryByText(/Tarefa criada/)).toBeNull();
  });
});

describe('FlowLigar — payload e eventType por outcome', () => {
  const cases: Array<[string, string]> = [
    ['Demonstrou interesse em visita', 'call_outcome_visit'],
    ['Solicitou proposta', 'call_outcome_proposal'],
    ['Pediu retorno', 'call_outcome_callback'],
    ['Não atendeu', 'call_outcome_no_answer'],
  ];

  it.each(cases)('outcome "%s" chama apply_lead_event com eventType "%s", só leadId/eventType', async (label, eventType) => {
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText(label));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('apply_lead_event', { p_lead_id: 'lead-1', p_event_type: eventType }));
  });

  it('nunca chama LeadService/TaskService/StoreAdapter local', async () => {
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Pediu retorno'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalled());
    expect(m.leadServiceUpdateHealth).not.toHaveBeenCalled();
    expect(m.leadServiceAddToTimeline).not.toHaveBeenCalled();
    expect(m.taskServiceCreate).not.toHaveBeenCalled();
  });
});

describe('FlowLigar — pending e duplo submit', () => {
  it('desabilita os resultados e o botão durante o envio; uma única mutation', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Não atendeu'));
    const button = screen.getByText('Salvar resultado');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Salvando…')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvando…'));
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-new', urgency: 'amber', version: 4 }, error: null });
    await waitFor(() => expect(screen.getByText('Resultado da ligação registrado.')).toBeInTheDocument());
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'apply_lead_event').length).toBe(1);
  });
});

describe('FlowLigar — sucesso', () => {
  it('mostra sucesso sanitizado com botão Concluir que fecha o flow', async () => {
    const { close } = renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Solicitou proposta'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(screen.getByText('Resultado da ligação registrado.')).toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Concluir'));
    expect(close).toHaveBeenCalled();
  });
});

describe('FlowLigar — erros mantêm o flow aberto (exceto identity_changed)', () => {
  it('forbidden: mensagem sanitizada específica, seleção preservada', async () => {
    mockRpc({ apply_lead_event: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(screen.getByText('Você não possui permissão para registrar uma ligação neste Lead.')).toBeInTheDocument());
    expect(screen.queryByText('Resultado da ligação registrado.')).toBeNull();
  });

  it('lead_not_found: mensagem sanitizada específica', async () => {
    mockRpc({ apply_lead_event: () => ({ data: null, error: { code: 'P0001', message: 'lead_not_found' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(screen.getByText('Este Lead não está mais disponível.')).toBeInTheDocument());
  });

  it('lead_archived: mensagem sanitizada específica', async () => {
    mockRpc({ apply_lead_event: () => ({ data: null, error: { code: 'P0001', message: 'lead_archived' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(screen.getByText('Este Lead foi arquivado e não pode receber novas atividades.')).toBeInTheDocument());
  });

  it('company_read_only: mensagem sanitizada específica', async () => {
    mockRpc({ apply_lead_event: () => ({ data: null, error: { code: 'P0001', message: 'company_read_only' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(screen.getByText('Esta empresa está em modo somente leitura.')).toBeInTheDocument());
  });

  it('stage_not_found: mensagem sanitizada específica', async () => {
    mockRpc({ apply_lead_event: () => ({ data: null, error: { code: 'P0001', message: 'stage_not_found' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Demonstrou interesse em visita'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(screen.getByText('A etapa atual do Lead não está mais disponível.')).toBeInTheDocument());
  });

  it('código desconhecido: mensagem genérica, nunca detalhe técnico', async () => {
    mockRpc({ apply_lead_event: () => ({ data: null, error: { code: 'XX000', message: 'algo_nunca_visto' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(screen.getByText('Não foi possível registrar o resultado da ligação.')).toBeInTheDocument());
  });

  it('retry manual possível após erro (nova tentativa chama a RPC de novo)', async () => {
    mockRpc({ apply_lead_event: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));

    mockRpc();
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Resultado da ligação registrado.')).toBeInTheDocument());
  });
});

describe('FlowLigar — troca de identidade', () => {
  it('empresa muda enquanto o flow está aberto: fecha sem mostrar sucesso', async () => {
    m.user.current = manager();
    const lead = remoteLead();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FlowLigar payload={{ lead }} close={close} openFlow={vi.fn()} />
      </QueryClientProvider>,
    );

    m.user.current = { ...manager(), activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } };
    rerender(
      <QueryClientProvider client={queryClient}>
        <FlowLigar payload={{ lead }} close={close} openFlow={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Resultado da ligação registrado.')).toBeNull();
  });

  it('identity_changed durante a mutation: fecha o flow, nunca mostra sucesso', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const lead = remoteLead();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <FlowLigar payload={{ lead }} close={close} openFlow={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Não atendeu'));
    fireEvent.click(screen.getByText('Salvar resultado'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalled());

    const { bumpQueryCacheGeneration } = await import('@/lib/query/cacheIdentity');
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-new', urgency: 'amber', version: 4 }, error: null });

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Resultado da ligação registrado.')).toBeNull();
  });
});

describe('FlowLigar — caminho local intacto', () => {
  it('REMOTE_LEADS=false: monta o corpo local (roteiro de ligação), nunca chama apply_lead_event', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    renderFlow({
      id: 'l1', name: 'Carlos Andrade', phone: '(11) 90000-0000', car: 'Golf GTI',
      stage: 'Novo', seller: 'Marcos Silva', sellerId: 's1', urgency: 'red',
      last: 'ok', alert: 'ok', pay: 'À vista',
    });
    expect(screen.getByText('Roteiro da ligação')).toBeInTheDocument();
    expect(screen.queryByText('Demonstrou interesse em visita')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

// M1-E E5-C — lacuna fechada na regressão final: REMOTE_LEADS=true com
// REMOTE_STAGES=false (remote_misconfigured) nunca foi exercitado
// diretamente contra FlowLigar. dataSource continua 'remote' nesse modo
// (mesmo invariante do E3: a flag ligada nunca cai para local, mesmo
// mal configurada) — então FlowLigarRemote monta, mas
// resolveLeadMutationCapabilities devolve todas as capabilities false
// (flagMode !== 'remote_ready'), logo canActorMutateLead nunca autoriza:
// o resultado observável é o mesmo estado de "sem permissão" de um Seller
// em Lead alheio, nunca um fallback local e nunca um crash.
describe('FlowLigar — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('Manager operacional: ainda assim sem permissão (capabilities todas false), nunca cai para o corpo local', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    renderFlow(remoteLead());
    expect(screen.getByText('Você não tem permissão para registrar uma ligação neste Lead.')).toBeInTheDocument();
    expect(screen.queryByText('Roteiro da ligação')).toBeNull();
    expect(screen.queryByText('Solicitou proposta')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
