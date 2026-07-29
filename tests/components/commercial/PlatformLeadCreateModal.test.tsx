// tests/components/commercial/PlatformLeadCreateModal.test.tsx — modal de
// criação de Lead da superfície platform (M1-F S8-C2-C2). Hooks mockados —
// nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommercialCompanyRow } from '@/lib/commercial/repository';

const m = vi.hoisted(() => ({
  selectedCompanyId: { current: 'company-a' as string | null },
  sellers: { current: [] as Array<{ seller_id: string; name: string }> },
  createLeadMock: vi.fn(),
  checkDuplicateMock: vi.fn(),
}));

vi.mock('@/lib/commercial/CommercialCompanyContext', () => ({
  useCommercialCompanyContext: () => ({
    selectedCompanyId: m.selectedCompanyId.current,
    setSelectedCompanyId: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/usePlatformSellers', () => ({
  usePlatformSellers: () => ({
    queryEnabled: true, sellers: m.sellers.current, isLoading: false, isFetching: false,
    isError: false, error: null, isEmpty: m.sellers.current.length === 0, hasData: m.sellers.current.length > 0,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useCreatePlatformLead', () => ({
  useCreatePlatformLead: () => ({
    createLead: m.createLeadMock, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useCheckPlatformLeadPhoneDuplicate', () => ({
  useCheckPlatformLeadPhoneDuplicate: () => ({
    checkDuplicate: m.checkDuplicateMock, isPending: false, isError: false, error: null, reset: vi.fn(),
  }),
}));

import { PlatformLeadCreateModal } from '@/components/commercial/PlatformLeadCreateModal';

function company(overrides: Partial<CommercialCompanyRow> = {}): CommercialCompanyRow {
  return { id: 'company-a', name: 'Empresa A', status: 'ativa', ...overrides };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Cliente Teste' } });
  fireEvent.change(screen.getByPlaceholderText('(11) 99999-9999'), { target: { value: '11999990000' } });
  fireEvent.change(screen.getByPlaceholderText('Ex.: Golf GTI 2022'), { target: { value: 'Golf GTI' } });
}

beforeEach(() => {
  m.selectedCompanyId.current = 'company-a';
  m.sellers.current = [];
  m.createLeadMock.mockReset();
  m.checkDuplicateMock.mockReset();
  m.checkDuplicateMock.mockResolvedValue([{ status: 'none', lead_id: null, lead_name: null, lead_archived: null }]);
  m.createLeadMock.mockResolvedValue({ id: 'lead-1' });
});

function renderModal(props: Partial<React.ComponentProps<typeof PlatformLeadCreateModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(<PlatformLeadCreateModal company={company()} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

describe('PlatformLeadCreateModal — validação', () => {
  it('campos obrigatórios vazios: Criar Lead desabilitado', () => {
    renderModal();
    const button = screen.getByText('Criar Lead').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('not-allowed');
  });

  it('nome/telefone/carro preenchidos: habilita o botão', () => {
    renderModal();
    fillRequiredFields();
    const button = screen.getByText('Criar Lead').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('pointer');
  });
});

describe('PlatformLeadCreateModal — submit', () => {
  it('verifica duplicidade ANTES de criar, escopada à empresa', async () => {
    renderModal();
    fillRequiredFields();
    fireEvent.click(screen.getByText('Criar Lead'));
    await waitFor(() => expect(m.checkDuplicateMock).toHaveBeenCalledWith({ companyId: 'company-a', phone: '11999990000' }));
    await waitFor(() => expect(m.createLeadMock).toHaveBeenCalled());
  });

  it('duplicidade encontrada: bloqueia o envio, NUNCA chama createLead, mostra mensagem genérica', async () => {
    m.checkDuplicateMock.mockResolvedValue([{ status: 'accessible', lead_id: 'other', lead_name: 'Outro', lead_archived: false }]);
    renderModal();
    fillRequiredFields();
    fireEvent.click(screen.getByText('Criar Lead'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-create-duplicate')).toBeInTheDocument());
    expect(screen.getByText('Já existe um Lead com este telefone nesta empresa.')).toBeInTheDocument();
    expect(screen.queryByText('Outro')).toBeNull();
    expect(m.createLeadMock).not.toHaveBeenCalled();
  });

  it('sem duplicidade: chama createLead com companyId capturado e sem seller_id (nenhum vendedor selecionado)', async () => {
    const { onClose } = renderModal();
    fillRequiredFields();
    fireEvent.click(screen.getByText('Criar Lead'));
    await waitFor(() => expect(m.createLeadMock).toHaveBeenCalledTimes(1));
    const payload = m.createLeadMock.mock.calls[0][0];
    expect(payload.companyId).toBe('company-a');
    expect(payload.name).toBe('Cliente Teste');
    expect(payload.phone).toBe('11999990000');
    expect(payload.car).toBe('Golf GTI');
    expect(payload.sellerId).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('isContextStillValid reflete a empresa capturada — true enquanto o contexto não muda', async () => {
    renderModal();
    fillRequiredFields();
    fireEvent.click(screen.getByText('Criar Lead'));
    await waitFor(() => expect(m.createLeadMock).toHaveBeenCalledTimes(1));
    const payload = m.createLeadMock.mock.calls[0][0];
    expect(payload.isContextStillValid()).toBe(true);
  });
});

describe('PlatformLeadCreateModal — Seller picker', () => {
  it('lista "Sem vendedor" + vendedores reais; selecionar um envia seller_id real', async () => {
    m.sellers.current = [{ seller_id: 's1', name: 'Vendedor Um' }, { seller_id: 's2', name: 'Vendedor Dois' }];
    renderModal();
    fireEvent.click(screen.getByText('Sem vendedor'));
    fireEvent.click(screen.getByText('Vendedor Um'));
    fillRequiredFields();
    fireEvent.click(screen.getByText('Criar Lead'));
    await waitFor(() => expect(m.createLeadMock).toHaveBeenCalledTimes(1));
    expect(m.createLeadMock.mock.calls[0][0].sellerId).toBe('s1');
  });
});

describe('PlatformLeadCreateModal — proteção de troca de empresa', () => {
  it('selectedCompanyId diferente da empresa capturada: fecha imediatamente', () => {
    m.selectedCompanyId.current = 'company-b';
    const { onClose } = renderModal({ company: company({ id: 'company-a' }) });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
