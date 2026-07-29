// tests/components/commercial/PlatformLeadDetails.test.tsx — leitura (S8-C2-B2)
// + ação "Editar" (S8-C2-C2) + mutations restantes: mover etapa, atribuir/
// desatribuir vendedor, arquivar/desarquivar, registrar evento, timeline
// manual (M1-F S8-C2-D2). Hooks de rede mockados — este arquivo cobre
// apenas a fiação da UI (chamadas corretas, gating por canMutate/archived,
// feedback de sucesso/erro), não o comportamento de rede em si (coberto
// pelos testes dedicados de cada hook).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PlatformLeadRow, PlatformPipelineStageRow, PlatformSellerRow } from '@/lib/commercial/repository';
import { PlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({
  moveLead: vi.fn(),
  applyEvent: vi.fn(),
  assignSeller: vi.fn(),
  archiveLead: vi.fn(),
  unarchiveLead: vi.fn(),
  addTimelineEntry: vi.fn(),
}));

vi.mock('@/lib/hooks/usePlatformLeadTimeline', () => ({
  usePlatformLeadTimeline: () => ({
    entries: [], isLoading: false, isError: false, isEmpty: true, hasData: false, refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/commercial/CommercialCompanyContext', () => ({
  useCommercialCompanyContext: () => ({
    selectedCompanyId: 'company-a', setSelectedCompanyId: vi.fn(), contextEpoch: 0,
  }),
}));

const SELLERS: PlatformSellerRow[] = [
  { seller_id: 'seller-1', name: 'Vendedor Um' },
  { seller_id: 'seller-2', name: 'Vendedor Dois' },
];

vi.mock('@/lib/hooks/usePlatformSellers', () => ({
  usePlatformSellers: () => ({
    sellers: SELLERS, isLoading: false, isError: false, isEmpty: false, hasData: true, refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useMovePlatformLead', () => ({
  useMovePlatformLead: () => ({ moveLead: mocks.moveLead, isPending: false }),
}));
vi.mock('@/lib/hooks/useApplyPlatformLeadEvent', () => ({
  useApplyPlatformLeadEvent: () => ({ applyEvent: mocks.applyEvent, isPending: false }),
}));
vi.mock('@/lib/hooks/useAssignPlatformLeadSeller', () => ({
  useAssignPlatformLeadSeller: () => ({ assignSeller: mocks.assignSeller, isPending: false }),
}));
vi.mock('@/lib/hooks/useArchivePlatformLead', () => ({
  useArchivePlatformLead: () => ({ archiveLead: mocks.archiveLead, isPending: false }),
}));
vi.mock('@/lib/hooks/useUnarchivePlatformLead', () => ({
  useUnarchivePlatformLead: () => ({ unarchiveLead: mocks.unarchiveLead, isPending: false }),
}));
vi.mock('@/lib/hooks/useAddPlatformLeadTimelineEntry', () => ({
  useAddPlatformLeadTimelineEntry: () => ({ addTimelineEntry: mocks.addTimelineEntry, isPending: false }),
}));

import { PlatformLeadDetails } from '@/components/commercial/PlatformLeadDetails';

function lead(overrides: Partial<PlatformLeadRow> = {}): PlatformLeadRow {
  return {
    id: 'lead-1', company_id: 'company-a', name: 'Cliente Teste', phone: '11988887777', car: 'Onix',
    stage_id: 'stage-1', seller_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z',
    created_by_profile_id: null, updated_at: '2026-01-01T00:00:00Z', updated_by_profile_id: null,
    urgency: 'green', temperature: null, payment_preference: null, source: null, value_amount: null,
    phone_digits: '11988887777', alert_label: null, last_activity_label: null, version: 1,
    ...overrides,
  } as PlatformLeadRow;
}

const stagesById: Readonly<Record<string, PlatformPipelineStageRow>> = {
  'stage-1': { id: 'stage-1', company_id: 'company-a', code: 'new', name: 'Novo', sort_order: 0, is_terminal: false, created_at: '', updated_at: '' },
  'stage-2': { id: 'stage-2', company_id: 'company-a', code: 'qualified', name: 'Qualificado', sort_order: 1, is_terminal: false, created_at: '', updated_at: '' },
};
const stages = Object.values(stagesById);

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.moveLead.mockResolvedValue(lead({ stage_id: 'stage-2' }));
  mocks.applyEvent.mockResolvedValue(lead());
  mocks.assignSeller.mockResolvedValue(lead());
  mocks.archiveLead.mockResolvedValue(lead({ archived_at: '2026-01-02T00:00:00Z' }));
  mocks.unarchiveLead.mockResolvedValue(lead());
  mocks.addTimelineEntry.mockResolvedValue({ id: 'entry-1' });
});

describe('PlatformLeadDetails — canMutate=false (comportamento original do B2)', () => {
  it('mostra o selo "Somente leitura", nenhum botão Editar, nenhuma acao', () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} />);
    expect(screen.getAllByText(/somente leitura/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Editar')).toBeNull();
    expect(screen.queryByTestId('platform-lead-actions')).toBeNull();
  });
});

describe('PlatformLeadDetails — canMutate=true', () => {
  it('mostra o botão Editar, nunca o selo "Somente leitura"', () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    expect(screen.getByText('Editar')).toBeInTheDocument();
    expect(screen.queryByText(/somente leitura/i)).toBeNull();
  });

  it('clicar Editar chama onEdit', () => {
    const onEdit = vi.fn();
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={onEdit} />);
    fireEvent.click(screen.getByText('Editar'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('mostra os controles de etapa/vendedor/evento/arquivar para lead ativo', () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    expect(screen.getByTestId('platform-lead-stage-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('platform-lead-seller-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('platform-lead-event-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('platform-lead-archive-trigger')).toHaveTextContent('Arquivar');
    expect(screen.getByTestId('platform-lead-timeline-form')).toBeInTheDocument();
  });

  it('lead arquivado: somente Desarquivar, sem etapa/vendedor/evento/timeline', () => {
    render(<PlatformLeadDetails lead={lead({ archived_at: '2026-01-02T00:00:00Z' })} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    expect(screen.queryByTestId('platform-lead-stage-trigger')).toBeNull();
    expect(screen.queryByTestId('platform-lead-seller-trigger')).toBeNull();
    expect(screen.queryByTestId('platform-lead-event-trigger')).toBeNull();
    expect(screen.queryByTestId('platform-lead-timeline-form')).toBeNull();
    expect(screen.getByTestId('platform-lead-archive-trigger')).toHaveTextContent('Desarquivar');
  });
});

describe('PlatformLeadDetails — mover etapa', () => {
  it('abre o menu, exclui a etapa atual, chama moveLead com a etapa escolhida', async () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-lead-stage-trigger'));
    const menu = screen.getByTestId('platform-lead-stage-menu');
    expect(menu).not.toHaveTextContent('Novo'); // etapa atual excluída do menu
    fireEvent.click(screen.getByText('Qualificado'));
    await waitFor(() => expect(mocks.moveLead).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-a', leadId: 'lead-1', stageId: 'stage-2', expectedVersion: 1,
    })));
    await waitFor(() => expect(screen.getByTestId('platform-lead-action-feedback')).toHaveTextContent('Lead movido.'));
  });
});

describe('PlatformLeadDetails — vendedor', () => {
  it('sem vendedor: mostra "Sem vendedor"; selecionar um vendedor chama assignSeller', async () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    expect(screen.getByTestId('platform-lead-seller-trigger')).toHaveTextContent('Sem vendedor');
    fireEvent.click(screen.getByTestId('platform-lead-seller-trigger'));
    fireEvent.click(screen.getByText('Vendedor Um'));
    await waitFor(() => expect(mocks.assignSeller).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-a', leadId: 'lead-1', sellerId: 'seller-1', expectedVersion: 1,
    })));
  });

  it('vendedor atribuído mas fora da lista atual: estado honesto, nunca um nome inventado', () => {
    render(<PlatformLeadDetails lead={lead({ seller_id: 'seller-desconhecido' })} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    expect(screen.getByTestId('platform-lead-seller-trigger')).toHaveTextContent('Vendedor anterior ou indisponível');
  });

  it('remover vendedor: "Sem vendedor" no menu envia sellerId null', async () => {
    render(<PlatformLeadDetails lead={lead({ seller_id: 'seller-1' })} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-lead-seller-trigger'));
    fireEvent.click(screen.getByTestId('platform-lead-seller-menu').querySelector('button')!);
    await waitFor(() => expect(mocks.assignSeller).toHaveBeenCalledWith(expect.objectContaining({ sellerId: null })));
  });
});

describe('PlatformLeadDetails — evento comercial', () => {
  it('abre o menu de eventos e chama applyEvent com o eventType real', async () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-lead-event-trigger'));
    fireEvent.click(screen.getByText('Visita confirmada pelo cliente'));
    await waitFor(() => expect(mocks.applyEvent).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-a', leadId: 'lead-1', eventType: 'visit_confirmed',
    })));
  });
});

describe('PlatformLeadDetails — arquivamento', () => {
  it('exige confirmação antes de chamar archiveLead', async () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-lead-archive-trigger'));
    expect(mocks.archiveLead).not.toHaveBeenCalled();
    expect(screen.getByTestId('platform-lead-archive-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(mocks.archiveLead).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-a', leadId: 'lead-1', expectedVersion: 1,
    })));
  });

  it('lead arquivado: confirmação chama unarchiveLead', async () => {
    render(<PlatformLeadDetails lead={lead({ archived_at: '2026-01-02T00:00:00Z' })} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-lead-archive-trigger'));
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(mocks.unarchiveLead).toHaveBeenCalledTimes(1));
    expect(mocks.archiveLead).not.toHaveBeenCalled();
  });
});

describe('PlatformLeadDetails — timeline manual', () => {
  it('submit vazio bloqueado (botão não aciona onSubmit)', () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    fireEvent.click(screen.getByText('Adicionar à timeline'));
    expect(mocks.addTimelineEntry).not.toHaveBeenCalled();
  });

  it('preenchido: chama addTimelineEntry com icon/color fixos e limpa o formulário', async () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    const labelInput = screen.getByLabelText('Título da anotação') as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: 'Cliente retornou contato' } });
    fireEvent.click(screen.getByText('Adicionar à timeline'));
    await waitFor(() => expect(mocks.addTimelineEntry).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-a', leadId: 'lead-1', label: 'Cliente retornou contato',
      icon: 'message', color: '#3B82F6',
    })));
    await waitFor(() => expect(labelInput.value).toBe(''));
  });
});

describe('PlatformLeadDetails — erro sanitizado', () => {
  it('erro da RPC nunca aparece cru — sempre a mensagem traduzida', async () => {
    mocks.moveLead.mockRejectedValue(new PlatformCommercialError('platform_commercial_lead_move_failed', {
      message: 'stage_not_found', operation: 'move_lead_to_stage',
    }));
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} stages={stages} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-lead-stage-trigger'));
    fireEvent.click(screen.getByText('Qualificado'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-action-feedback')).toHaveTextContent('A etapa selecionada não está mais disponível.'));
    expect(screen.queryByText('stage_not_found')).toBeNull();
  });
});
