// tests/components/commercial/PlatformLeadEditModal.test.tsx — modal de
// edição de Lead da superfície platform (M1-F S8-C2-C2). Hooks mockados —
// nenhuma rede real. Foco na estratégia "pular duplicidade quando telefone
// não mudou" (check_lead_phone_duplicate não tem parâmetro de autoexclusão).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommercialCompanyRow, PlatformLeadRow } from '@/lib/commercial/repository';

const m = vi.hoisted(() => ({
  selectedCompanyId: { current: 'company-a' as string | null },
  updateLeadMock: vi.fn(),
  checkDuplicateMock: vi.fn(),
}));

vi.mock('@/lib/commercial/CommercialCompanyContext', () => ({
  useCommercialCompanyContext: () => ({
    selectedCompanyId: m.selectedCompanyId.current,
    setSelectedCompanyId: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useUpdatePlatformLead', () => ({
  useUpdatePlatformLead: () => ({
    updateLead: m.updateLeadMock, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useCheckPlatformLeadPhoneDuplicate', () => ({
  useCheckPlatformLeadPhoneDuplicate: () => ({
    checkDuplicate: m.checkDuplicateMock, isPending: false, isError: false, error: null, reset: vi.fn(),
  }),
}));

import { PlatformLeadEditModal } from '@/components/commercial/PlatformLeadEditModal';

function company(overrides: Partial<CommercialCompanyRow> = {}): CommercialCompanyRow {
  return { id: 'company-a', name: 'Empresa A', status: 'ativa', ...overrides };
}

function lead(overrides: Partial<PlatformLeadRow> = {}): PlatformLeadRow {
  return {
    id: 'lead-1', company_id: 'company-a', name: 'Cliente Original', phone: '11988887777', car: 'Onix',
    stage_id: 'stage-1', seller_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z',
    created_by_profile_id: null, updated_at: '2026-01-01T00:00:00Z', updated_by_profile_id: null,
    urgency: 'green', temperature: null, payment_preference: null, source: null, value_amount: null,
    phone_digits: '11988887777', alert_label: null, last_activity_label: null, version: 1,
    ...overrides,
  } as PlatformLeadRow;
}

beforeEach(() => {
  m.selectedCompanyId.current = 'company-a';
  m.updateLeadMock.mockReset();
  m.checkDuplicateMock.mockReset();
  m.checkDuplicateMock.mockResolvedValue([{ status: 'none', lead_id: null, lead_name: null, lead_archived: null }]);
  m.updateLeadMock.mockResolvedValue({ id: 'lead-1', version: 2 });
});

function renderModal(props: Partial<React.ComponentProps<typeof PlatformLeadEditModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(<PlatformLeadEditModal lead={lead()} company={company()} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

describe('PlatformLeadEditModal — pré-preenchimento', () => {
  it('campos vêm preenchidos com os valores reais do Lead', () => {
    renderModal();
    expect(screen.getByDisplayValue('Cliente Original')).toBeInTheDocument();
    expect(screen.getByDisplayValue('11988887777')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Onix')).toBeInTheDocument();
  });
});

describe('PlatformLeadEditModal — telefone inalterado: pula a checagem de duplicidade', () => {
  it('telefone não mudou: NUNCA chama checkDuplicate, chama updateLead direto', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Cliente Editado' } });
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(m.updateLeadMock).toHaveBeenCalledTimes(1));
    expect(m.checkDuplicateMock).not.toHaveBeenCalled();
  });
});

describe('PlatformLeadEditModal — telefone mudou: checa duplicidade', () => {
  it('telefone mudou, sem duplicidade: chama checkDuplicate e depois updateLead com o expected_version real', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('(11) 99999-9999'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(m.checkDuplicateMock).toHaveBeenCalledWith({ companyId: 'company-a', phone: '11999990000' }));
    await waitFor(() => expect(m.updateLeadMock).toHaveBeenCalledTimes(1));
    const payload = m.updateLeadMock.mock.calls[0][0];
    expect(payload.leadId).toBe('lead-1');
    expect(payload.expectedVersion).toBe(1);
    expect(payload.companyId).toBe('company-a');
  });

  it('telefone mudou, duplicidade encontrada: bloqueia, NUNCA chama updateLead', async () => {
    m.checkDuplicateMock.mockResolvedValue([{ status: 'accessible', lead_id: 'other', lead_name: 'Outro', lead_archived: false }]);
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('(11) 99999-9999'), { target: { value: '11999990000' } });
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-edit-duplicate')).toBeInTheDocument());
    expect(m.updateLeadMock).not.toHaveBeenCalled();
  });
});

describe('PlatformLeadEditModal — payload nunca inclui seller/stage/archived', () => {
  it('updateLead nunca recebe sellerId/stageId/archivedAt no payload', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(m.updateLeadMock).toHaveBeenCalledTimes(1));
    const payload = m.updateLeadMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty('sellerId');
    expect(payload).not.toHaveProperty('stageId');
    expect(payload).not.toHaveProperty('archivedAt');
  });
});

describe('PlatformLeadEditModal — proteção de troca de empresa', () => {
  it('selectedCompanyId diferente da empresa capturada: fecha imediatamente', () => {
    m.selectedCompanyId.current = 'company-b';
    const { onClose } = renderModal({ company: company({ id: 'company-a' }) });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
