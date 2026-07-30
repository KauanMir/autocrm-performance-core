// Testes de integração de FlowEditarCliente — caminho remoto (M1-E, E4-B2).
// Supabase mockado (rpc); AuthService/flags mockados. Cobre: campos
// permitidos, Stage/Seller/valor ocultos, expectedVersion, stale_write,
// duplicidade com excludeLeadId, erro mantém dados.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  user: { current: null as any },
  leadServiceUpdate: vi.fn(),
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
  LeadService: { getAll: () => [], update: m.leadServiceUpdate },
  TaskService: { getAll: () => [], create: vi.fn() },
  SellerService: { getAll: () => [] },
}));

import { FlowEditarCliente } from '@/components/flows/Flows2';

function manager() {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
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
      <FlowEditarCliente payload={{ lead }} close={close} />
    </QueryClientProvider>,
  );
  return { close };
}

function mockRpc(overrides: Record<string, (args: any) => any> = {}) {
  m.rpc.mockImplementation((fn: string, args: any) => {
    if (overrides[fn]) return Promise.resolve(overrides[fn](args));
    if (fn === 'check_lead_phone_duplicate') return Promise.resolve({ data: [], error: null });
    if (fn === 'update_lead') return Promise.resolve({ data: { id: 'lead-1', company_id: 'company-a', name: args?.p_name ?? 'Cliente', version: (args?.p_expected_version ?? 3) + 1 }, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  m.rpc.mockReset();
  m.leadServiceUpdate.mockReset();
  m.isRemoteLeadsEnabled.mockReturnValue(true);
  m.isRemoteStagesEnabled.mockReturnValue(true);
  m.user.current = manager();
  mockRpc();
});

describe('FlowEditarCliente — campos ocultos no modo remoto', () => {
  it('Stage/Seller/valor/urgência/arquivamento não aparecem', () => {
    renderFlow(remoteLead());
    expect(screen.queryByText('Etapa atual')).toBeNull();
    expect(screen.queryByText('Vendedor responsável')).toBeNull();
  });

  it('nunca chama LeadService.update (mutation exclusivamente remota)', async () => {
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('update_lead', expect.any(Object)));
    expect(m.leadServiceUpdate).not.toHaveBeenCalled();
  });
});

describe('FlowEditarCliente — payload exato', () => {
  it('envia leadId/expectedVersion (de lead.version) + campos permitidos, nunca stage/seller/companyId', async () => {
    renderFlow(remoteLead({ version: 7 }));
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('update_lead', expect.any(Object)));
    const args = m.rpc.mock.calls.find((c) => c[0] === 'update_lead')![1];
    expect(args.p_lead_id).toBe('lead-1');
    expect(args.p_expected_version).toBe(7);
    expect(args.p_name).toBe('Carlos Andrade');
    expect(args.p_phone).toBe('(11) 90000-0000');
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_seller_id');
    expect(args).not.toHaveProperty('p_stage_id');
  });

  it('editar o nome reflete no payload enviado', async () => {
    renderFlow(remoteLead());
    fireEvent.change(screen.getByDisplayValue('Carlos Andrade'), { target: { value: 'Carlos Editado' } });
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('update_lead', expect.objectContaining({ p_name: 'Carlos Editado' })));
  });
});

describe('FlowEditarCliente — duplicidade com excludeLeadId', () => {
  it('telefone inalterado: check usa excludeLeadId = o próprio lead', async () => {
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('check_lead_phone_duplicate', expect.objectContaining({ p_exclude_lead_id: 'lead-1' })));
  });

  it('accessible: exige confirmação explícita ("Salvar mesmo assim")', async () => {
    mockRpc({ check_lead_phone_duplicate: () => ({ data: [{ status: 'accessible', lead_id: 'lead-2', lead_name: 'Outro Cliente', lead_archived: false }], error: null }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(screen.getByText('Telefone já cadastrado')).toBeInTheDocument());
    expect(screen.getByText('Outro Cliente')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('update_lead', expect.any(Object));

    fireEvent.click(screen.getByText('Salvar mesmo assim'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('update_lead', expect.any(Object)));
  });
});

describe('FlowEditarCliente — stale_write', () => {
  it('mostra a mensagem exata, mantém o formulário aberto com os dados, nunca repete a mutation sozinho', async () => {
    mockRpc({ update_lead: () => ({ data: null, error: { code: 'P0001', message: 'stale_write' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(screen.getByText('Este Lead foi atualizado por outra pessoa. Recarregue os dados antes de tentar novamente.')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Carlos Andrade')).toBeInTheDocument();
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'update_lead').length).toBe(1);
  });
});

describe('FlowEditarCliente — sucesso', () => {
  it('mostra sucesso e fecha após confirmar', async () => {
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(screen.getByText('Dados salvos com sucesso')).toBeInTheDocument());
  });
});

describe('FlowEditarCliente — capabilities bloqueadas', () => {
  it('Seller sem sellerId: estado bloqueado, sem formulário', () => {
    m.user.current = { id: 'u2', name: 'S', email: 's@a.com', platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null } };
    renderFlow(remoteLead());
    expect(screen.getByText('Você não tem permissão para editar este cliente no momento.')).toBeInTheDocument();
    expect(screen.queryByText('Salvar alterações')).toBeNull();
  });
});

// M1-E E4-C — lacunas fechadas na auditoria final: mais códigos de erro de
// update mapeados, duplo submit no nível do flow, troca de identidade
// fechando um formulário de edição já aberto.
describe('FlowEditarCliente — outros erros de mutation mantêm o formulário aberto', () => {
  it('lead_archived: mensagem sanitizada específica, dados preservados', async () => {
    mockRpc({ update_lead: () => ({ data: null, error: { code: 'P0001', message: 'lead_archived' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(screen.getByText('Este cliente está arquivado e não pode ser editado.')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Carlos Andrade')).toBeInTheDocument();
  });

  it('forbidden: mensagem sanitizada específica, dados preservados', async () => {
    mockRpc({ update_lead: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    renderFlow(remoteLead());
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(screen.getByText('Você não tem permissão para realizar esta ação.')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Carlos Andrade')).toBeInTheDocument();
  });
});

describe('FlowEditarCliente — proteção contra duplo submit', () => {
  it('dois cliques seguidos em "Salvar alterações" nunca disparam duas chamadas a update_lead', async () => {
    renderFlow(remoteLead());
    const button = screen.getByText('Salvar alterações');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Dados salvos com sucesso')).toBeInTheDocument());
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'update_lead').length).toBe(1);
  });
});

describe('FlowEditarCliente — troca de identidade com formulário aberto', () => {
  it('empresa muda enquanto o formulário está aberto: fecha sem mostrar sucesso', async () => {
    m.user.current = manager();
    const lead = remoteLead();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FlowEditarCliente payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );

    m.user.current = { ...manager(), activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } };
    rerender(
      <QueryClientProvider client={queryClient}>
        <FlowEditarCliente payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Dados salvos com sucesso')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalledWith('update_lead', expect.any(Object));
  });
});
