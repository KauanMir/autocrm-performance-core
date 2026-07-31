// Testes de isolamento fail-closed em FlowBusca/FlowNotificacoes/
// FlowPerfilVendedor (M1-E, E5-B2-A1 + E7-B1) — Visit/Deal/Sale e o
// catálogo de Vendedores (SellerService) são domínios comerciais locais sem
// company_id/backend remoto (auditoria E5-B2-A0/E7-A0). Em modo NÃO local,
// busca/notificações/perfil de vendedor nunca consultam esses quatro
// domínios; só Clientes (Lead, com backend remoto real) continua
// funcionando nos dois modos.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({
  isLocalCommercialDataAllowed: vi.fn(),
  visits: vi.fn(() => [] as any[]),
  deals: vi.fn(() => [] as any[]),
  sales: vi.fn(() => [] as any[]),
  sellers: vi.fn(() => [] as any[]),
}));

vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: m.isLocalCommercialDataAllowed,
}));

vi.mock('@/components/podiums/Podiums', () => ({ PLACE: [{ ring: '#gold' }, { ring: '#silver' }, { ring: '#bronze' }] }));

vi.mock('@/lib/services', () => ({
  LeadService: {
    getAll: () => [{ id: 'l1', name: 'Ana Vitória', phone: '(11) 90000-0000', car: 'Onix', urgency: 'green' }],
  },
  SellerService: {
    getAll: () => m.sellers(),
  },
  DealService: { getAll: () => m.deals() },
  VisitService: { getAll: () => m.visits() },
  SaleService: { getAll: () => m.sales() },
}));

import { FlowBusca, FlowNotificacoes, FlowPerfilVendedor } from '@/components/flows/Flows3';

beforeEach(() => {
  m.isLocalCommercialDataAllowed.mockReset();
  m.visits.mockReset().mockReturnValue([{ id: 'v1', client: 'Cliente Visita Antiga', car: 'Onix', time: '10:00', status: 'pendente' }]);
  m.deals.mockReset().mockReturnValue([{ id: 'd1', client: 'Cliente Proposta Antiga', car: 'Onix', value: 'R$ 1', status: 'aprovacao' }]);
  m.sales.mockReset().mockReturnValue([{ id: 's1', client: 'Cliente Venda Antiga', car: 'Onix', date: 'hoje' }]);
  m.sellers.mockReset().mockReturnValue([
    { id: 's1', name: 'Marcos Silva', team: 'Seminovos', sales: 5, visits: 3, leads: 4, conv: 20, move: 0 },
    { id: 's2', name: 'Ana Souza', team: 'Novos', sales: 3, visits: 2, leads: 2, conv: 15, move: 1 },
    { id: 's3', name: 'João Ferreira', team: 'Novos', sales: 1, visits: 1, leads: 1, conv: 10, move: -1 },
  ]);
});

describe('FlowBusca — isolamento por modo', () => {
  it('modo NÃO local: não chama DealService/SaleService/VisitService/SellerService.getAll, resultados de Propostas/Vendas/Visitas/Vendedores nunca aparecem', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Cliente' } });
    expect(m.deals).not.toHaveBeenCalled();
    expect(m.sales).not.toHaveBeenCalled();
    expect(m.visits).not.toHaveBeenCalled();
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.queryByText('Cliente Proposta Antiga')).toBeNull();
    expect(screen.queryByText('Cliente Venda Antiga')).toBeNull();
    expect(screen.queryByText('Cliente Visita Antiga')).toBeNull();
  });

  it('modo NÃO local: buscar por vendedor não retorna nenhum resultado (SellerService nunca consultado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Marcos' } });
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.queryByText('Marcos Silva')).toBeNull();
  });

  it('modo NÃO local: Clientes (Lead) continuam pesquisáveis normalmente', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Ana' } });
    expect(screen.getByText('Ana Vitória')).toBeInTheDocument();
  });

  it('modo local: Propostas/Vendas/Visitas/Vendedores continuam aparecendo (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Cliente' } });
    expect(screen.getByText(/Cliente Proposta Antiga/)).toBeInTheDocument();
    expect(screen.getByText('Cliente Venda Antiga')).toBeInTheDocument();
    expect(screen.getByText('Cliente Visita Antiga')).toBeInTheDocument();
  });

  it('modo local: buscar por vendedor retorna o resultado normalmente', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Marcos' } });
    expect(screen.getByText('Marcos Silva')).toBeInTheDocument();
  });
});

describe('FlowNotificacoes — isolamento por modo', () => {
  it('modo NÃO local: nenhum botão de ação abre confirmar-visita/aprovar-proposta (VisitService/DealService nunca chamados)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    const openFlow = vi.fn();
    render(<FlowNotificacoes payload={{}} close={() => {}} openFlow={openFlow} />);
    expect(screen.queryByText('Confirmar')).toBeNull();
    expect(screen.queryByText('Revisar')).toBeNull();
    expect(m.visits).not.toHaveBeenCalled();
    expect(m.deals).not.toHaveBeenCalled();
  });

  // M1-E E7-B1: achado real — a notificação de ranking abaixo abria
  // perfil-vendedor com SellerService.getAll()[2] (catálogo local, sem
  // company_id, sem backend remoto) incondicionalmente, mesmo fora do modo
  // local. Corrigida no mesmo isolamento das duas notificações de Visita/
  // Proposta acima.
  it('modo NÃO local: notificação de ranking (SellerService) não aparece', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    const openFlow = vi.fn();
    render(<FlowNotificacoes payload={{}} close={() => {}} openFlow={openFlow} />);
    expect(screen.queryByText(/ultrapassou você no ranking/)).toBeNull();
    expect(m.sellers).not.toHaveBeenCalled();
  });

  it('modo NÃO local: notificação de Ligar (Lead) continua funcionando', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    const openFlow = vi.fn();
    render(<FlowNotificacoes payload={{}} close={() => {}} openFlow={openFlow} />);
    fireEvent.click(screen.getByText('Ligar'));
    expect(openFlow).toHaveBeenCalledWith('ligar', expect.any(Object));
  });

  it('modo local: botões Confirmar/Revisar aparecem (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    render(<FlowNotificacoes payload={{}} close={() => {}} openFlow={() => {}} />);
    expect(screen.getByText('Confirmar')).toBeInTheDocument();
    expect(screen.getByText('Revisar')).toBeInTheDocument();
  });

  it('modo local: notificação de ranking continua aparecendo e abre o perfil do vendedor', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    const openFlow = vi.fn();
    render(<FlowNotificacoes payload={{}} close={() => {}} openFlow={openFlow} />);
    expect(screen.getByText(/ultrapassou você no ranking/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Ver')[0]);
    expect(openFlow).toHaveBeenCalledWith('perfil-vendedor', expect.any(Object));
  });
});

describe('FlowPerfilVendedor — isolamento por modo (M1-E E7-B1)', () => {
  // Achado do E7-A0: `payload.seller || SellerService.getAll()[0]` caía
  // sempre no primeiro Seller do catálogo local quando nenhum payload.seller
  // era fornecido — nunca deveria acontecer fora do modo local, já que não
  // existe backend remoto de desempenho de vendedores.
  it('modo NÃO local: mostra "Perfil indisponível", nunca chama SellerService, nunca fabrica métricas', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<FlowPerfilVendedor payload={{}} close={() => {}} openFlow={() => {}} />);
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.getByText('Perfil indisponível')).toBeInTheDocument();
    expect(screen.queryByText('Marcos Silva')).toBeNull();
    expect(screen.queryByText('vendas no mês')).toBeNull();
  });

  it('modo NÃO local: mesmo recebendo um payload.seller, permanece indisponível (sem módulo remoto de performance)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<FlowPerfilVendedor payload={{ seller: { id: 's1', name: 'Marcos Silva', sales: 5 } }} close={() => {}} openFlow={() => {}} />);
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.getByText('Perfil indisponível')).toBeInTheDocument();
  });

  it('modo local: perfil do vendedor renderiza normalmente (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    render(<FlowPerfilVendedor payload={{ seller: { id: 's1', name: 'Marcos Silva', team: 'Seminovos', sales: 5, visits: 3, leads: 4, conv: 20, move: 0, growth: 2 } }} close={() => {}} openFlow={() => {}} />);
    expect(screen.getAllByText('Marcos Silva').length).toBeGreaterThan(0);
    expect(screen.queryByText('Perfil indisponível')).toBeNull();
  });

  it('modo local: sem payload.seller, cai no primeiro Seller do catálogo local (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    render(<FlowPerfilVendedor payload={{}} close={() => {}} openFlow={() => {}} />);
    expect(m.sellers).toHaveBeenCalled();
    expect(screen.getAllByText('Marcos Silva').length).toBeGreaterThan(0);
  });
});
