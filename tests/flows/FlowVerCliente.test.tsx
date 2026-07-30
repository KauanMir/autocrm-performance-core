// Testes de FlowVerCliente — boundary readOnly (M1-E, E3-B1). Leads remotos
// abrem este detalhe com payload.readOnly=true: nenhum botão de mutation
// (Ligar/Visita/Proposta/Acompanhar/Editar) pode ficar acessível. Sem mock
// de rede — LeadService só é usado no fallback payload.lead ausente (não
// exercitado aqui, o payload sempre traz o lead).
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowVerCliente } from '@/components/flows/FlowsShared';
import type { LeadMutationCapabilities } from '@/lib/leads/mutationCapabilities';

const m = vi.hoisted(() => ({ user: { current: null as any } }));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
}));

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

describe('FlowVerCliente — modo normal (local, sem readOnly)', () => {
  it('mostra as 5 ações de mutation e o botão inline "Ligar agora"', () => {
    render(<FlowVerCliente payload={{ lead: lead() }} close={vi.fn()} openFlow={vi.fn()} />);
    for (const label of ['Ligar', 'Agendar visita', 'Nova proposta', 'Acompanhar', 'Editar dados']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Ligar agora')).toBeInTheDocument();
  });

  it('clicar em uma ação chama openFlow com o lead e o flow correto', () => {
    const openFlow = vi.fn();
    render(<FlowVerCliente payload={{ lead: lead() }} close={vi.fn()} openFlow={openFlow} />);
    screen.getByText('Editar dados').click();
    expect(openFlow).toHaveBeenCalledWith('editar-cliente', { lead: expect.objectContaining({ id: 'lead-1' }) });
  });
});

describe('FlowVerCliente — modo somente leitura (payload.readOnly=true)', () => {
  it('nenhuma das 5 ações de mutation é renderizada', () => {
    render(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={vi.fn()} />);
    for (const label of ['Ligar', 'Agendar visita', 'Nova proposta', 'Acompanhar', 'Editar dados']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('o botão inline "Ligar agora" (Próxima ação recomendada) some', () => {
    render(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.queryByText('Ligar agora')).toBeNull();
  });

  it('o detalhe (nome, veículo, cadastro) continua visível — somente as mutations somem', () => {
    render(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.getAllByText('Carlos Andrade').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Golf GTI').length).toBeGreaterThan(0);
  });

  it('nenhum openFlow é chamado espontaneamente por estar em modo somente leitura', () => {
    const openFlow = vi.fn();
    render(<FlowVerCliente payload={{ lead: lead(), readOnly: true }} close={vi.fn()} openFlow={openFlow} />);
    expect(openFlow).not.toHaveBeenCalled();
  });
});

// M1-E E6-B2-A — "Alterar responsável"/"Arquivar Lead" aparecem só quando
// capabilities.canAssignSeller/canArchive são true (Manager operacional).
// Nunca aparecem no caminho local (capabilities ausente) nem para Seller
// (capabilities com os dois false).
describe('FlowVerCliente — botões Alterar responsável/Arquivar Lead (capabilities granulares)', () => {
  it('capabilities ausente (caminho local): nenhum dos dois botões aparece', () => {
    render(<FlowVerCliente payload={{ lead: lead() }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.queryByText('Alterar responsável')).toBeNull();
    expect(screen.queryByText('Arquivar Lead')).toBeNull();
  });

  it('canAssignSeller/canArchive false (Seller): nenhum dos dois botões aparece', () => {
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canCreate: true, canEditDetails: true };
    render(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.queryByText('Alterar responsável')).toBeNull();
    expect(screen.queryByText('Arquivar Lead')).toBeNull();
  });

  it('canAssignSeller/canArchive true (Manager operacional): os dois botões aparecem', () => {
    m.user.current = manager();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canAssignSeller: true, canArchive: true };
    render(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={vi.fn()} />);
    expect(screen.getByText('Alterar responsável')).toBeInTheDocument();
    expect(screen.getByText('Arquivar Lead')).toBeInTheDocument();
  });

  it('clicar em "Alterar responsável" chama openFlow com o lead, sem capabilities extras no payload', () => {
    m.user.current = manager();
    const openFlow = vi.fn();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canAssignSeller: true, canArchive: true };
    render(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={openFlow} />);
    screen.getByText('Alterar responsável').click();
    expect(openFlow).toHaveBeenCalledWith('atribuir-vendedor', { lead: expect.objectContaining({ id: 'lead-1' }) });
  });

  it('clicar em "Arquivar Lead" chama openFlow com o lead', () => {
    m.user.current = manager();
    const openFlow = vi.fn();
    const capabilities: LeadMutationCapabilities = { ...NO_CAPS, canAssignSeller: true, canArchive: true };
    render(<FlowVerCliente payload={{ lead: lead(), capabilities }} close={vi.fn()} openFlow={openFlow} />);
    screen.getByText('Arquivar Lead').click();
    expect(openFlow).toHaveBeenCalledWith('arquivar-lead', { lead: expect.objectContaining({ id: 'lead-1' }) });
  });
});
