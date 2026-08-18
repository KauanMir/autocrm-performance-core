// Testes de FlowVerCliente — boundary readOnly (M1-E, E3-B1). Leads remotos
// abrem este detalhe com payload.readOnly=true: nenhum botão de mutation
// (Ligar/Visita/Proposta/Acompanhar/Editar) pode ficar acessível. Sem mock
// de rede — LeadService (mock local, vazio) não é mais consultado quando
// payload.lead está ausente (PILOT-P0-A1-EXEC-FALLBACKS removeu o fallback
// `LeadService.getAll()[0]`; ver describe dedicado abaixo).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlowVerCliente } from '@/components/flows/FlowsShared';
import type { LeadMutationCapabilities } from '@/lib/leads/mutationCapabilities';

const m = vi.hoisted(() => ({ user: { current: null as any }, from: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
}));

// M1-E E7-B2-A1 — mock isolado do cliente Supabase para os testes de
// timeline remota (RemoteLeadTimelinePanel); os testes de botões acima não
// dependem dele (nunca fazem waitFor no conteúdo da timeline).
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

beforeEach(() => {
  m.from.mockReset();
  m.rpc.mockReset();
  mockTimelineReadResponse({ data: [], error: null });
});

// M1-E E7-B2-A1 — capabilities truthy monta RemoteLeadTimelinePanel, que usa
// TanStack Query (useLeadTimeline/useAddLeadTimelineEntry); sem rede real
// aqui (supabase não é mockado neste arquivo, então a query nunca resolve
// dentro da janela síncrona do teste — suficiente para os testes de botões,
// que não dependem do conteúdo da timeline em si).
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function manager() {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
  };
}

const NO_CAPS: LeadMutationCapabilities = {
  canCreate: false, canEditDetails: false, canApplyEvents: false,
  canMoveStage: false, canLogCallOutcome: false, canAssignSeller: false, canArchive: false,
};

function lead(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lead-1', name: 'Carlos Andrade', phone: '(11) 90000-0000', car: 'Golf GTI',
    stage: 'Novo', seller: 'Marcos Silva', sellerId: 's1', urgency: 'red',
    last: 'Sem contato', alert: 'Responder agora', pay: 'À vista', value: 'R$ 1',
    ...overrides,
  };
}

// PILOT-P0-A1-EXEC-FALLBACKS: antes, sem payload.lead o componente caía em
// `LeadService.getAll()[0]` — em modo remoto isso abriria o primeiro Lead
// real do snapshot (cliente errado). Agora renderiza um estado seguro e
// explícito, sem tocar lead.* nenhum e sem fabricar payload.
describe('FlowVerCliente — payload.lead ausente (PILOT-P0-A1-EXEC-FALLBACKS)', () => {
  it('sem payload.lead: renderiza "Cliente indisponível", nunca abre outro Lead, sem crash', () => {
    renderWithClient(<FlowVerCliente payload={{}} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.getByText('Cliente indisponível')).toBeInTheDocument();
    expect(screen.queryByText('Ligar agora')).toBeNull();
    expect(screen.queryByText('Editar dados')).toBeNull();
  });

  it('sem payload.lead: botão de fechar do FlowShell chama close()', () => {
    const close = vi.fn();
    renderWithClient(<FlowVerCliente payload={{}} close={close} openFlow={vi.fn()} />);
    // FlowShell renderiza dois controles de fechar (seta voltar + X), ambos
    // chamando onClose — qualquer um dos dois é suficiente para provar o
    // caminho de saída.
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(close).toHaveBeenCalled();
  });
});

describe('FlowVerCliente — modo normal (local, sem readOnly)', () => {
  it('mostra as 5 ações de mutation e o botão inline "Ligar agora"', () => {
    renderWithClient(<FlowVerCliente payload={{ lead: lead() }} close={vi.fn()} openFlow={vi.fn()} />);
    for (const label of ['Ligar', 'Agendar visita', 'Nova proposta', 'Acompanhar', 'Editar dados']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Ligar agora')).toBeInTheDocument();
  });

  it('clicar em uma ação chama openFlow com o lead e o flow correto', () => {
    const openFlow = vi.fn();
    renderWithClient(<FlowVerCliente payload={{ lead: lead() }} close={vi.fn()} openFlow={openFlow} />);
    screen.getByText('Editar dados').click();
    expect(openFlow).toHaveBeenCalledWith('editar-cliente', { lead: expect.objectContaining({ id: 'lead-1' }) });
  });
});

describe('FlowVerCliente — modo somente leitura (payload.readOnly=true)', () => {
  it('nenhuma das 5 ações de mutation é renderizada', () => {
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={vi.fn()} />);
    for (const label of ['Ligar', 'Agendar visita', 'Nova proposta', 'Acompanhar', 'Editar dados']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('o botão inline "Ligar agora" (Próxima ação recomendada) some', () => {
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.queryByText('Ligar agora')).toBeNull();
  });

  it('o detalhe (nome, veículo, cadastro) continua visível — somente as mutations somem', () => {
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.getAllByText('Carlos Andrade').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Golf GTI').length).toBeGreaterThan(0);
  });

  it('nenhum openFlow é chamado espontaneamente por estar em modo somente leitura', () => {
    const openFlow = vi.fn();
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={openFlow} />);
    expect(openFlow).not.toHaveBeenCalled();
  });
});

// M1-E E6-B2-A — "Alterar responsável"/"Arquivar Lead" aparecem só quando
// capabilities.canAssignSeller/canArchive são true (Manager operacional).
// Nunca aparecem no caminho local (capabilities ausente) nem para Seller
// (capabilities com os dois false).
describe('FlowVerCliente — botões Alterar responsável/Arquivar Lead (capabilities granulares)', () => {
  it('capabilities ausente (caminho local): nenhum dos dois botões aparece', () => {
    renderWithClient(<FlowVerCliente payload={{ lead: lead() }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.queryByText('Alterar responsável')).toBeNull();
    expect(screen.queryByText('Arquivar Lead')).toBeNull();
  });

  it('canAssignSeller/canArchive false (Seller): nenhum dos dois botões aparece', () => {
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canCreate: true, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.queryByText('Alterar responsável')).toBeNull();
    expect(screen.queryByText('Arquivar Lead')).toBeNull();
  });

  it('canAssignSeller/canArchive true (Manager operacional): os dois botões aparecem', () => {
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canAssignSeller: true, canArchive: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.getByText('Alterar responsável')).toBeInTheDocument();
    expect(screen.getByText('Arquivar Lead')).toBeInTheDocument();
  });

  it('clicar em "Alterar responsável" chama openFlow com o lead, sem capabilities extras no payload', () => {
    m.user.current = manager();
    const openFlow = vi.fn();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canAssignSeller: true, canArchive: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={openFlow} />);
    screen.getByText('Alterar responsável').click();
    expect(openFlow).toHaveBeenCalledWith('atribuir-vendedor', { lead: expect.objectContaining({ id: 'lead-1' }) });
  });

  it('clicar em "Arquivar Lead" chama openFlow com o lead', () => {
    m.user.current = manager();
    const openFlow = vi.fn();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canAssignSeller: true, canArchive: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={openFlow} />);
    screen.getByText('Arquivar Lead').click();
    expect(openFlow).toHaveBeenCalledWith('arquivar-lead', { lead: expect.objectContaining({ id: 'lead-1' }) });
  });
});

function seller(sellerId: string | null = 's1') {
  return {
    id: 'user-2', name: 'Vendedor', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId },
  };
}

function remoteEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't1', company_id: 'company-a', lead_id: 'lead-1', actor_profile_id: 'user-1',
    icon: 'phone', color: '#27C75F', label: 'Ligação feita', detail: 'Cliente confirmou',
    occurred_at: '2026-07-31T10:00:00Z', created_at: '2026-07-31T10:00:00Z',
    ...overrides,
  };
}

// M1-E E7-B2-A1 — timeline remota no detalhe do Lead ativo.
describe('FlowVerCliente — timeline (E7-B2-A1)', () => {
  it('modo local (capabilities ausente): mostra lead.timeline embutido, nunca consulta o Supabase', () => {
    renderWithClient(
      <FlowVerCliente payload={{ lead: lead({ timeline: [{ icon: 'phone', c: '#27C75F', t: 'Ligação feita', when: 'Hoje' }] }) }} close={vi.fn()} openFlow={vi.fn()} />,
    );
    expect(screen.getByText('Ligação feita')).toBeInTheDocument();
    expect(m.from).not.toHaveBeenCalled();
  });

  it('modo local sem timeline: mostra "Nenhum histórico registrado ainda."', () => {
    renderWithClient(<FlowVerCliente payload={{ lead: lead() }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.getByText('Nenhum histórico registrado ainda.')).toBeInTheDocument();
  });

  it('modo remoto: nunca usa lead.timeline (mesmo presente), consulta a timeline remota via RLS', async () => {
    mockTimelineReadResponse({ data: [remoteEntry()], error: null });
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(
      <FlowVerCliente
        payload={{ lead: lead({ timeline: [{ icon: 'phone', c: '#FF0000', t: 'DADO LOCAL NUNCA DEVE APARECER', when: 'Hoje' }] }), capabilities }}
        close={vi.fn()} openFlow={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Ligação feita')).toBeInTheDocument());
    expect(screen.queryByText('DADO LOCAL NUNCA DEVE APARECER')).toBeNull();
    expect(m.from).toHaveBeenCalledWith('lead_timeline_entries');
  });

  it('modo remoto: estado vazio correto', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Nenhum histórico registrado ainda.')).toBeInTheDocument());
  });

  it('modo remoto: erro sanitizado com retry funcional, nenhum detalhe técnico', async () => {
    mockTimelineReadResponse({ data: null, error: { code: '42501', message: 'permission denied' } });
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Não foi possível carregar o histórico.')).toBeInTheDocument());
    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(screen.queryByText(/42501/)).toBeNull();

    mockTimelineReadResponse({ data: [remoteEntry()], error: null });
    fireEvent.click(screen.getByText('Tentar novamente'));
    await waitFor(() => expect(screen.getByText('Ligação feita')).toBeInTheDocument());
  });

  it('Manager autorizado: formulário de nota manual aparece', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead({ sellerId: 's99' }), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Digite uma observação/)).toBeInTheDocument());
  });

  it('Seller autorizado no próprio Lead: formulário de nota manual aparece', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    m.user.current = seller('s1');
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead({ sellerId: 's1' }), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Digite uma observação/)).toBeInTheDocument());
  });

  it('Seller sem acesso ao Lead (Lead de outro Seller): formulário de nota manual NÃO aparece', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    m.user.current = seller('s1');
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead({ sellerId: 's2' }), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Nenhum histórico registrado ainda.')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/Digite uma observação/)).toBeNull();
  });

  it('nota vazia (ou só espaços) não envia: botão não chama a RPC', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead({ sellerId: 's99' }), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Digite uma observação/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Digite uma observação/), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Adicionar observação'));
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('sucesso: limpa o texto, mostra feedback de sucesso e atualiza a lista após invalidação', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    m.rpc.mockResolvedValue({ data: remoteEntry({ detail: 'Nova observação' }), error: null });
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead({ sellerId: 's99' }), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Digite uma observação/)).toBeInTheDocument());

    mockTimelineReadResponse({ data: [remoteEntry({ detail: 'Nova observação' })], error: null });
    const textarea = screen.getByPlaceholderText(/Digite uma observação/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Nova observação' } });
    fireEvent.click(screen.getByText('Adicionar observação'));

    await waitFor(() => expect(screen.getByText('Observação adicionada ao histórico.')).toBeInTheDocument());
    expect(textarea.value).toBe('');
    await waitFor(() => expect(screen.getByText(/Nova observação/)).toBeInTheDocument());
  });

  it('erro na nota: preserva o texto digitado, mostra feedback sanitizado', async () => {
    mockTimelineReadResponse({ data: [], error: null });
    m.rpc.mockResolvedValue({ data: null, error: { message: 'lead_archived' } });
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canEditDetails: true };
    renderWithClient(<FlowVerCliente payload={{ lead: lead({ sellerId: 's99' }), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Digite uma observação/)).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/Digite uma observação/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Texto que não deve sumir' } });
    fireEvent.click(screen.getByText('Adicionar observação'));

    await waitFor(() => expect(screen.getByText('Não foi possível adicionar a observação.')).toBeInTheDocument());
    expect(textarea.value).toBe('Texto que não deve sumir');
  });
});
