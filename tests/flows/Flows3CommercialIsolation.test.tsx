// Testes de isolamento fail-closed em FlowBusca/FlowNotificacoes (M1-E,
// E5-B2-A1) — Visit/Deal/Sale são domínios comerciais locais sem
// company_id/backend remoto (auditoria E5-B2-A0). Em modo NÃO local, busca e
// notificações nunca consultam esses três domínios; Clientes/Vendedores
// (Lead/Seller) continuam funcionando nos dois modos.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({
  isLocalCommercialDataAllowed: vi.fn(),
  visits: vi.fn(() => [] as any[]),
  deals: vi.fn(() => [] as any[]),
  sales: vi.fn(() => [] as any[]),
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
    getAll: () => [{ id: 's1', name: 'Marcos Silva', team: 'Seminovos', sales: 5 }],
  },
  DealService: { getAll: () => m.deals() },
  VisitService: { getAll: () => m.visits() },
  SaleService: { getAll: () => m.sales() },
}));

import { FlowBusca, FlowNotificacoes } from '@/components/flows/Flows3';

beforeEach(() => {
  m.isLocalCommercialDataAllowed.mockReset();
  m.visits.mockReset().mockReturnValue([{ id: 'v1', client: 'Cliente Visita Antiga', car: 'Onix', time: '10:00', status: 'pendente' }]);
  m.deals.mockReset().mockReturnValue([{ id: 'd1', client: 'Cliente Proposta Antiga', car: 'Onix', value: 'R$ 1', status: 'aprovacao' }]);
  m.sales.mockReset().mockReturnValue([{ id: 's1', client: 'Cliente Venda Antiga', car: 'Onix', date: 'hoje' }]);
});

describe('FlowBusca — isolamento por modo', () => {
  it('modo NÃO local: não chama DealService/SaleService/VisitService.getAll, resultados de Propostas/Vendas/Visitas nunca aparecem', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Cliente' } });
    expect(m.deals).not.toHaveBeenCalled();
    expect(m.sales).not.toHaveBeenCalled();
    expect(m.visits).not.toHaveBeenCalled();
    expect(screen.queryByText('Cliente Proposta Antiga')).toBeNull();
    expect(screen.queryByText('Cliente Venda Antiga')).toBeNull();
    expect(screen.queryByText('Cliente Visita Antiga')).toBeNull();
  });

  it('modo NÃO local: Clientes (Lead) continuam pesquisáveis normalmente', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Ana' } });
    expect(screen.getByText('Ana Vitória')).toBeInTheDocument();
  });

  it('modo local: Propostas/Vendas/Visitas continuam aparecendo (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    render(<FlowBusca payload={{}} close={() => {}} openFlow={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/), { target: { value: 'Cliente' } });
    expect(screen.getByText(/Cliente Proposta Antiga/)).toBeInTheDocument();
    expect(screen.getByText('Cliente Venda Antiga')).toBeInTheDocument();
    expect(screen.getByText('Cliente Visita Antiga')).toBeInTheDocument();
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
});
