// Testes de integração de FlowAtribuirVendedor (M1-E, E6-B2-A). Supabase
// mockado (rpc); AuthService/flags mockados; resolveLeadFlowContext/
// resolveLeadMutationCapabilities/useCurrentCompanyAssignableSellers/
// useAssignLeadSeller/isNoOpSellerAssignment reais (mesmo padrão de
// FlowLigarRemote.test.tsx). Cobre: Manager-only (nunca canActorMutateLead),
// Seller histórico (estado undefined), same-seller no-op, payload exato,
// pending, sucesso, erros, troca de identidade.
//
// Nota de teste: o nome do vendedor atual aparece tanto no painel
// "Responsável atual" quanto (quando operacional) no próprio trigger do
// SellerPicker — por isso a abertura do picker sempre usa o ÚLTIMO
// elemento retornado por getAllByText (o trigger é sempre o último no DOM,
// já que o painel "Responsável atual" é renderizado antes do picker).
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

import { FlowAtribuirVendedor } from '@/components/flows/FlowsShared';

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

const ASSIGNABLE_ROWS = [
  { seller_id: 's1', name: 'Marcos Silva' },
  { seller_id: 's2', name: 'Ana Costa' },
];

function renderFlow(lead: any, close = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlowAtribuirVendedor payload={{ lead }} close={close} />
    </QueryClientProvider>,
  );
  return { close, queryClient };
}

function mockRpc(overrides: Record<string, (args: any) => any> = {}) {
  m.rpc.mockImplementation((fn: string, args: any) => {
    if (overrides[fn]) return Promise.resolve(overrides[fn](args));
    if (fn === 'list_current_company_assignable_sellers') return Promise.resolve({ data: ASSIGNABLE_ROWS, error: null });
    if (fn === 'assign_lead_seller') {
      return Promise.resolve({
        data: { id: 'lead-1', company_id: 'company-a', seller_id: args?.p_seller_id ?? null, version: 4 },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

// Abre o dropdown do SellerPicker clicando no ÚLTIMO elemento com o texto
// atualmente exibido pelo trigger (o painel "Responsável atual" sempre
// renderiza o mesmo texto ANTES do picker quando o Seller é operacional).
function openPickerShowing(text: string) {
  const matches = screen.getAllByText(text);
  fireEvent.click(matches[matches.length - 1]);
}

beforeEach(() => {
  m.rpc.mockReset();
  m.isRemoteLeadsEnabled.mockReturnValue(true);
  m.isRemoteStagesEnabled.mockReturnValue(true);
  m.user.current = manager();
  mockRpc();
});

describe('FlowAtribuirVendedor — Manager-only (sem exceção)', () => {
  it('Manager operacional: autorizado, picker carregado', async () => {
    renderFlow(remoteLead());
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    expect(screen.queryByText('Você não possui permissão para alterar o responsável deste Lead.')).toBeNull();
  });

  it('Seller operacional (inclusive no próprio Lead): SEMPRE sem permissão — nunca canActorMutateLead', () => {
    m.user.current = seller('s1');
    renderFlow(remoteLead({ sellerId: 's1' }));
    expect(screen.getByText('Você não possui permissão para alterar o responsável deste Lead.')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('assign_lead_seller', expect.anything());
  });

  it('Super Admin: sem permissão (capabilities todas false neste caminho)', () => {
    m.user.current = { id: 'sa-1', name: 'Admin', email: 'a@a.com', platformRole: 'super_admin', activeMembership: null };
    renderFlow(remoteLead());
    expect(screen.getByText('Você não possui permissão para alterar o responsável deste Lead.')).toBeInTheDocument();
  });
});

describe('FlowAtribuirVendedor — Seller atual operacional (Cenário A)', () => {
  it('inicia pré-selecionado com o sellerId atual; Salvar desabilitado sem mudança', async () => {
    renderFlow(remoteLead({ sellerId: 's1' }));
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).not.toHaveBeenCalledWith('assign_lead_seller', expect.anything()));
  });

  it('trocar para outro Seller habilita Salvar e envia o payload exato (leadId/sellerId/expectedVersion, sem companyId)', async () => {
    renderFlow(remoteLead({ sellerId: 's1', version: 5 }));
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    openPickerShowing('Marcos Silva');
    fireEvent.click(screen.getByText('Ana Costa'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('assign_lead_seller', {
      p_lead_id: 'lead-1', p_seller_id: 's2', p_expected_version: 5,
    }));
    expect(m.rpc.mock.calls.find((c) => c[0] === 'assign_lead_seller')?.[1]).not.toHaveProperty('p_company_id');
  });

  it('escolher "Sem vendedor" explicitamente envia sellerId null', async () => {
    renderFlow(remoteLead({ sellerId: 's1', version: 2 }));
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    openPickerShowing('Marcos Silva');
    fireEvent.click(screen.getByText('Sem vendedor'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('assign_lead_seller', {
      p_lead_id: 'lead-1', p_seller_id: null, p_expected_version: 2,
    }));
  });
});

describe('FlowAtribuirVendedor — Lead sem Seller (Cenário B)', () => {
  it('inicia explicitamente em "Sem vendedor"; Salvar desabilitado sem mudança (null/null é no-op)', async () => {
    renderFlow(remoteLead({ sellerId: null, seller: '—' }));
    await waitFor(() => expect(screen.getByText('Sem vendedor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).not.toHaveBeenCalledWith('assign_lead_seller', expect.anything()));
  });

  it('trocar para um Seller operacional habilita Salvar', async () => {
    renderFlow(remoteLead({ sellerId: null, seller: '—', version: 1 }));
    await waitFor(() => expect(screen.getByText('Sem vendedor')).toBeInTheDocument());
    openPickerShowing('Sem vendedor');
    fireEvent.click(screen.getByText('Ana Costa'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('assign_lead_seller', {
      p_lead_id: 'lead-1', p_seller_id: 's2', p_expected_version: 1,
    }));
  });
});

describe('FlowAtribuirVendedor — Seller atual histórico/inativo (Cenário C)', () => {
  it('nome atual exibido fora do picker; picker começa sem escolha (placeholder), nome não aparece no trigger', async () => {
    renderFlow(remoteLead({ sellerId: 's-antigo', seller: 'Carlos Desligado' }));
    await waitFor(() => expect(screen.getByText('Selecione uma nova opção')).toBeInTheDocument());
    // "Carlos Desligado" aparece só no painel "Responsável atual" — nunca
    // duplicado no trigger do picker, que mostra o placeholder.
    expect(screen.getAllByText('Carlos Desligado').length).toBe(1);
  });

  it('submit bloqueado sem escolha explícita', async () => {
    renderFlow(remoteLead({ sellerId: 's-antigo', seller: 'Carlos Desligado' }));
    await waitFor(() => expect(screen.getByText('Selecione uma nova opção')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).not.toHaveBeenCalledWith('assign_lead_seller', expect.anything()));
  });

  it('escolher "Sem vendedor" explicitamente habilita submit (null nunca é o estado inicial)', async () => {
    renderFlow(remoteLead({ sellerId: 's-antigo', seller: 'Carlos Desligado', version: 7 }));
    await waitFor(() => expect(screen.getByText('Selecione uma nova opção')).toBeInTheDocument());
    openPickerShowing('Selecione uma nova opção');
    fireEvent.click(screen.getByText('Sem vendedor'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('assign_lead_seller', {
      p_lead_id: 'lead-1', p_seller_id: null, p_expected_version: 7,
    }));
  });

  it('Seller operacional pode ser escolhido normalmente', async () => {
    renderFlow(remoteLead({ sellerId: 's-antigo', seller: 'Carlos Desligado', version: 1 }));
    await waitFor(() => expect(screen.getByText('Selecione uma nova opção')).toBeInTheDocument());
    openPickerShowing('Selecione uma nova opção');
    fireEvent.click(screen.getByText('Ana Costa'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('assign_lead_seller', {
      p_lead_id: 'lead-1', p_seller_id: 's2', p_expected_version: 1,
    }));
  });
});

describe('FlowAtribuirVendedor — pending e duplo submit', () => {
  it('desabilita repetição enquanto pendente; uma única mutation', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation((fn: string) => {
      if (fn === 'list_current_company_assignable_sellers') return Promise.resolve({ data: ASSIGNABLE_ROWS, error: null });
      return new Promise((resolve) => { resolveRpc = resolve; });
    });
    renderFlow(remoteLead({ sellerId: 's1' }));
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    openPickerShowing('Marcos Silva');
    fireEvent.click(screen.getByText('Ana Costa'));
    const saveBtn = screen.getByText('Salvar');
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByText('Salvando…')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Salvando…'));
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', seller_id: 's2', version: 4 }, error: null });
    await waitFor(() => expect(screen.getByText('Responsável atualizado com sucesso')).toBeInTheDocument());
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'assign_lead_seller').length).toBe(1);
  });
});

describe('FlowAtribuirVendedor — sucesso', () => {
  it('mostra sucesso e Concluir fecha o flow', async () => {
    const { close } = renderFlow(remoteLead({ sellerId: 's1', version: 3 }));
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    openPickerShowing('Marcos Silva');
    fireEvent.click(screen.getByText('Ana Costa'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(screen.getByText('Responsável atualizado com sucesso')).toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Concluir'));
    expect(close).toHaveBeenCalled();
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    render(
      <QueryClientProvider client={queryClient}>
        <FlowAtribuirVendedor payload={{ lead: remoteLead({ sellerId: 's1', version: 3 }) }} close={vi.fn()} />
      </QueryClientProvider>,
    );
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    openPickerShowing('Marcos Silva');
    fireEvent.click(screen.getByText('Ana Costa'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(screen.getByText('Responsável atualizado com sucesso')).toBeInTheDocument());
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('FlowAtribuirVendedor — erros mantêm o flow aberto (exceto identity_changed)', () => {
  async function triggerAssign() {
    renderFlow(remoteLead({ sellerId: 's1', version: 3 }));
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    openPickerShowing('Marcos Silva');
    fireEvent.click(screen.getByText('Ana Costa'));
    fireEvent.click(screen.getByText('Salvar'));
  }

  it('seller_not_found: mensagem sanitizada específica', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'P0001', message: 'seller_not_found' } }) });
    await triggerAssign();
    await waitFor(() => expect(screen.getByText('O vendedor selecionado não está mais disponível.')).toBeInTheDocument());
  });

  it('stale_write: mensagem sanitizada específica', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'P0001', message: 'stale_write' } }) });
    await triggerAssign();
    await waitFor(() => expect(screen.getByText('Este Lead foi alterado por outra pessoa. Feche e abra novamente para continuar.')).toBeInTheDocument());
  });

  it('lead_archived: mensagem sanitizada específica', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'P0001', message: 'lead_archived' } }) });
    await triggerAssign();
    await waitFor(() => expect(screen.getByText('Este Lead foi arquivado e não pode ser reatribuído.')).toBeInTheDocument());
  });

  it('lead_not_found: mensagem sanitizada específica', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'P0001', message: 'lead_not_found' } }) });
    await triggerAssign();
    await waitFor(() => expect(screen.getByText('Este Lead não está mais disponível.')).toBeInTheDocument());
  });

  it('forbidden: mensagem sanitizada específica', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    await triggerAssign();
    await waitFor(() => expect(screen.getByText('Você não possui permissão para alterar o responsável deste Lead.')).toBeInTheDocument());
  });

  it('company_read_only: mensagem sanitizada específica', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'P0001', message: 'company_read_only' } }) });
    await triggerAssign();
    await waitFor(() => expect(screen.getByText('Esta empresa está em modo somente leitura.')).toBeInTheDocument());
  });

  it('código desconhecido: mensagem genérica, nunca detalhe técnico', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'XX000', message: 'algo_nunca_visto' } }) });
    await triggerAssign();
    await waitFor(() => expect(screen.getByText('Não foi possível alterar o responsável.')).toBeInTheDocument());
  });

  it('nenhum retry automático — uma única chamada por clique', async () => {
    mockRpc({ assign_lead_seller: () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }) });
    await triggerAssign();
    await waitFor(() => expect(m.rpc.mock.calls.filter((c) => c[0] === 'assign_lead_seller').length).toBe(1));
  });
});

describe('FlowAtribuirVendedor — troca de identidade', () => {
  it('empresa muda enquanto o flow está aberto: fecha sem mostrar sucesso', async () => {
    m.user.current = manager();
    const lead = remoteLead({ sellerId: 's1' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FlowAtribuirVendedor payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));

    m.user.current = { ...manager(), activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } };
    rerender(
      <QueryClientProvider client={queryClient}>
        <FlowAtribuirVendedor payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Responsável atualizado com sucesso')).toBeNull();
  });

  it('identity_changed durante a mutation: fecha o flow, nunca mostra sucesso', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    m.rpc.mockImplementation((fn: string) => {
      if (fn === 'list_current_company_assignable_sellers') return Promise.resolve({ data: ASSIGNABLE_ROWS, error: null });
      return new Promise((resolve) => { resolveRpc = resolve; });
    });
    const lead = remoteLead({ sellerId: 's1', version: 3 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <FlowAtribuirVendedor payload={{ lead }} close={close} />
      </QueryClientProvider>,
    );
    // Espera exatamente 2 ocorrências (painel "Responsável atual" + trigger
    // do picker) — confirma que o catálogo terminou de carregar e a
    // inicialização (useEffect) já rodou; durante o loading só o painel
    // mostra o nome (o trigger mostra "Carregando vendedores…").
    await waitFor(() => expect(screen.getAllByText('Marcos Silva').length).toBe(2));
    openPickerShowing('Marcos Silva');
    fireEvent.click(screen.getByText('Ana Costa'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('assign_lead_seller', expect.anything()));

    const { bumpQueryCacheGeneration } = await import('@/lib/query/cacheIdentity');
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: { id: 'lead-1', company_id: 'company-a', seller_id: 's2', version: 4 }, error: null });

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Responsável atualizado com sucesso')).toBeNull();
  });
});

describe('FlowAtribuirVendedor — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('Manager operacional: ainda assim sem permissão (capabilities todas false)', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    renderFlow(remoteLead());
    expect(screen.getByText('Você não possui permissão para alterar o responsável deste Lead.')).toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalledWith('assign_lead_seller', expect.anything());
  });
});
