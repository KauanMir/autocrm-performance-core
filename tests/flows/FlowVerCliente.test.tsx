// Testes de FlowVerCliente — boundary readOnly (M1-E, E3-B1). Leads remotos
// abrem este detalhe com payload.readOnly=true: nenhum botão de mutation
// (Ligar/Visita/Proposta/Acompanhar/Editar) pode ficar acessível. Sem mock
// de rede — LeadService só é usado no fallback payload.lead ausente (não
// exercitado aqui, o payload sempre traz o lead).
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowVerCliente } from '@/components/flows/FlowsShared';

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
}));

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
