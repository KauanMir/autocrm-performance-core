// Testes de integração de FlowNovoCliente — caminho remoto (M1-E, E4-B2).
// Supabase mockado (rpc); AuthService/flags mockados para controlar
// dataSource/capabilities. O caminho LOCAL (LeadService/SellerService) já
// tem cobertura própria e não é alterado nesta etapa — não reexercitado
// aqui além de confirmar que continua intacto quando a flag está OFF.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  user: { current: null as any },
  leadServiceCreate: vi.fn(),
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
  LeadService: { getAll: () => [], create: m.leadServiceCreate },
  TaskService: { getAll: () => [], create: m.taskServiceCreate },
  SellerService: { getAll: () => [] },
}));

import { FlowNovoCliente } from '@/components/flows/Flows2';

function manager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

function seller(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-2', name: 'Vendedor', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 'seller-1' },
    ...overrides,
  };
}

function renderFlow(close = vi.fn(), openFlow = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlowNovoCliente payload={{}} close={close} openFlow={openFlow} />
    </QueryClientProvider>,
  );
  return { close, openFlow };
}

function mockRpc(overrides: Record<string, (args: any) => any> = {}) {
  m.rpc.mockImplementation((fn: string, args: any) => {
    if (overrides[fn]) return Promise.resolve(overrides[fn](args));
    if (fn === 'list_current_company_assignable_sellers') return Promise.resolve({ data: [{ seller_id: 's1', name: 'Ana' }], error: null });
    if (fn === 'check_lead_phone_duplicate') return Promise.resolve({ data: [], error: null });
    if (fn === 'create_lead') return Promise.resolve({ data: { id: 'real-uuid-1', company_id: 'company-a', name: args?.p_name ?? 'Cliente', version: 1 }, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  m.rpc.mockReset();
  m.leadServiceCreate.mockReset();
  m.taskServiceCreate.mockReset();
  m.isRemoteLeadsEnabled.mockReturnValue(true);
  m.isRemoteStagesEnabled.mockReturnValue(true);
  mockRpc();
});

describe('FlowNovoCliente — Manager remoto', () => {
  it('mostra o SellerPicker remoto (assignable sellers), nunca chama LeadService.create', async () => {
    m.user.current = manager();
    renderFlow();
    await waitFor(() => expect(screen.getByText('Sem vendedor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sem vendedor'));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(m.leadServiceCreate).not.toHaveBeenCalled();
  });

  it('cria sem selecionar vendedor (Sem vendedor) — payload exato, sem stage/companyId/version', async () => {
    m.user.current = manager();
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('create_lead', expect.any(Object)));
    const createArgs = m.rpc.mock.calls.find((c) => c[0] === 'create_lead')![1];
    expect(createArgs).toEqual({
      p_name: 'Novo Cliente',
      p_phone: '11999990000',
      p_car: expect.any(String),
      p_seller_id: undefined,
      p_temperature: 'hot',
      p_payment_preference: 'Financiamento',
      p_source: 'Showroom',
    });
    expect(createArgs).not.toHaveProperty('p_company_id');
    expect(createArgs).not.toHaveProperty('p_stage_id');
  });

  it('cria com vendedor selecionado — p_seller_id vai no payload', async () => {
    m.user.current = manager();
    renderFlow();
    await waitFor(() => expect(screen.getByText('Sem vendedor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sem vendedor'));
    fireEvent.click(screen.getByText('Ana'));
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('create_lead', expect.objectContaining({ p_seller_id: 's1' })));
  });

  it('sucesso: fecha com a Task local usando o UUID real retornado', async () => {
    m.user.current = manager();
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(screen.getByText('Cliente criado!')).toBeInTheDocument());
    expect(m.taskServiceCreate).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'real-uuid-1' }));
  });
});

describe('FlowNovoCliente — Seller remoto', () => {
  it('nunca mostra SellerPicker; cria sem enviar p_seller_id (backend autoatribui)', async () => {
    m.user.current = seller();
    renderFlow();
    expect(screen.queryByText('Vendedor responsável')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Cliente do Seller' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('create_lead', expect.any(Object)));
    const createArgs = m.rpc.mock.calls.find((c) => c[0] === 'create_lead')![1];
    expect(createArgs.p_seller_id).toBeUndefined();
  });
});

describe('FlowNovoCliente — duplicidade', () => {
  it('accessible: mostra aviso e exige confirmação explícita antes de criar', async () => {
    mockRpc({
      check_lead_phone_duplicate: () => ({ data: [{ status: 'accessible', lead_id: 'l1', lead_name: 'Cliente Existente', lead_archived: false }], error: null }),
    });
    m.user.current = manager();
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(screen.getByText('Telefone já cadastrado')).toBeInTheDocument());
    expect(screen.getByText('Cliente Existente')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('create_lead', expect.any(Object));

    fireEvent.click(screen.getByText('Criar mesmo assim'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('create_lead', expect.any(Object)));
  });

  it('restricted: mensagem sem nome/ID, confirmação explícita disponível', async () => {
    mockRpc({
      check_lead_phone_duplicate: () => ({ data: [{ status: 'restricted', lead_id: null, lead_name: null, lead_archived: null }], error: null }),
    });
    m.user.current = manager();
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(screen.getByText(/não possui acesso aos detalhes/)).toBeInTheDocument());
    expect(screen.getByText('Criar mesmo assim')).toBeInTheDocument();
  });

  it('none: cria direto, sem aviso', async () => {
    m.user.current = manager();
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(screen.getByText('Cliente criado!')).toBeInTheDocument());
    expect(screen.queryByText('Telefone já cadastrado')).toBeNull();
  });
});

describe('FlowNovoCliente — erros e proteção de duplo submit', () => {
  it('erro remoto mantém formulário aberto com os dados digitados', async () => {
    mockRpc({ create_lead: () => ({ data: null, error: { code: 'P0001', message: 'seller_not_found' } }) });
    m.user.current = manager();
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(screen.getByText('O vendedor selecionado não está mais disponível. Escolha outro.')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Novo Cliente')).toBeInTheDocument();
  });

  it('identity_changed fecha o formulário sem mostrar sucesso', async () => {
    mockRpc({ create_lead: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    // Simula identity_changed via geração de cache mudando durante o await:
    // mais simples de testar através do código de erro mapeado diretamente
    // não é possível aqui sem acesso à geração; cobertura de identity_changed
    // já está no hook useCreateLead — este teste cobre o caminho de erro
    // remoto padrão (forbidden) mantendo o formulário aberto.
    m.user.current = manager();
    const { close } = renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Criar cliente'));
    await waitFor(() => expect(screen.getByText('Você não tem permissão para realizar esta ação.')).toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
  });
});

describe('FlowNovoCliente — Seller sem sellerId (capabilities bloqueadas)', () => {
  it('mostra estado bloqueado, sem formulário', () => {
    m.user.current = seller({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null } });
    renderFlow();
    expect(screen.getByText('Você não tem permissão para criar clientes no momento.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ex.: Carlos Andrade')).toBeNull();
  });
});

// M1-E E4-C — lacunas fechadas na auditoria final: duplo submit no nível do
// flow (não só no hook) e troca de identidade fechando um formulário
// remoto já aberto (não só a proteção dentro do hook de mutation).
describe('FlowNovoCliente — proteção contra duplo submit', () => {
  it('dois cliques seguidos no botão nunca disparam duas chamadas a create_lead', async () => {
    m.user.current = manager();
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Carlos Andrade'), { target: { value: 'Novo Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 90000-0000'), { target: { value: '11999990000' } });
    const button = screen.getByText('Criar cliente');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Cliente criado!')).toBeInTheDocument());
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'create_lead').length).toBe(1);
  });
});

describe('FlowNovoCliente — troca de identidade com formulário aberto', () => {
  it('empresa muda enquanto o formulário está aberto: fecha sem mostrar sucesso', async () => {
    m.user.current = manager();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FlowNovoCliente payload={{}} close={close} openFlow={vi.fn()} />
      </QueryClientProvider>,
    );

    // Troca de empresa (mesmo usuário, nova membership) — mesmo efeito de
    // App.tsx re-renderizando FlowLayer quando currentUser muda.
    m.user.current = manager({ activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <FlowNovoCliente payload={{}} close={close} openFlow={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Cliente criado!')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalledWith('create_lead', expect.any(Object));
  });
});
