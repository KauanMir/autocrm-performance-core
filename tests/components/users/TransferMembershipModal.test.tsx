// tests/components/users/TransferMembershipModal.test.tsx — modal de
// transferência empresarial atômica (M1-F S6-F). useCompanies/
// useCompanyUsers/useTransferMembership mockados. Cobertura central: a
// empresa de origem NUNCA aparece como opção de destino; o sucessor é
// PROFILE_ID escolhido dentre membros ATIVOS da empresa de ORIGEM (nunca
// destino), com o MESMO papel do alvo.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';
import type { CompanyUserRow } from '@/lib/users/repository';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const m = vi.hoisted(() => ({
  useCompanies: vi.fn(),
  useCompanyUsers: vi.fn(),
  useTransferMembership: vi.fn(),
  transferMembershipMock: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useCompanies', () => ({ useCompanies: m.useCompanies }));
vi.mock('@/lib/hooks/useCompanyUsers', () => ({ useCompanyUsers: m.useCompanyUsers }));
vi.mock('@/lib/hooks/useTransferMembership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useTransferMembership')>();
  return { ...actual, useTransferMembership: m.useTransferMembership };
});

import { TransferMembershipModal } from '@/components/users/TransferMembershipModal';

function user(overrides: Partial<MembershipLifecycleTargetUser> = {}): MembershipLifecycleTargetUser {
  return {
    membership_id: 'membership-1', profile_id: 'profile-1', name: 'Ana Silva', email: 'ana@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'seller',
    ...overrides,
  };
}

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-b', name: 'Revenda Secundária', trade_name: null, cnpj: null, phone: null,
    timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-07-20T12:00:00+00:00', logo_path: null,
    ...overrides,
  };
}

function candidateRow(overrides: Partial<CompanyUserRow> = {}): CompanyUserRow {
  return {
    profile_id: 'profile-2', membership_id: 'membership-2', name: 'Bruno Souza', email: 'bruno@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'seller', created_at: '2026-07-20T12:00:00Z',
    ...overrides,
  };
}

function companiesResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['k'], companies: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function usersResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['k'], users: [],
    isLoading: false, isFetching: false, isFetchingNextPage: false, isError: false, error: null,
    isEmpty: true, hasData: false, hasMore: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  m.useCompanies.mockReturnValue(companiesResult({
    companies: [company(), company({ id: 'company-a', name: 'Revenda Premium (origem)' })],
    hasData: true, isEmpty: false,
  }));
  m.useCompanyUsers.mockReturnValue(usersResult({ users: [candidateRow(), user() as unknown as CompanyUserRow], hasData: true, isEmpty: false }));
  m.transferMembershipMock.mockReset();
  m.transferMembershipMock.mockResolvedValue({});
  m.useTransferMembership.mockReturnValue({ transferMembership: m.transferMembershipMock, isPending: false, reset: vi.fn() });
  m.openFlow.mockReset();
  (window as any).__openFlow = m.openFlow;
});

function renderModal(props: Partial<React.ComponentProps<typeof TransferMembershipModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(<TransferMembershipModal userId="actor-1" user={user()} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

describe('TransferMembershipModal — empresa de destino', () => {
  it('a empresa de ORIGEM nunca aparece como opção de destino', () => {
    renderModal();
    const select = screen.getByLabelText('Selecionar empresa de destino') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain('company-a');
    expect(optionValues).toContain('company-b');
  });

  it('sem empresa de destino selecionada: Transferir desabilitado mesmo com motivo preenchido', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    const button = screen.getByText('Transferir').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('not-allowed');
  });
});

describe('TransferMembershipModal — sucessor da empresa de ORIGEM', () => {
  it('busca candidatos via useCompanyUsers escopado pela empresa de origem e pelo MESMO papel do alvo', () => {
    renderModal();
    expect(m.useCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: 'company', companyId: 'company-a' },
      role: 'seller',
    }));
  });

  it('o próprio alvo NUNCA aparece como opção de sucessor', () => {
    renderModal();
    const select = screen.getByLabelText('Selecionar sucessor') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain('profile-1');
    expect(optionValues).toContain('profile-2');
  });
});

describe('TransferMembershipModal — chamada', () => {
  it('confirmar: envia sourceMembershipId/targetCompanyId/targetRole/successorProfileId/note exatos', async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Selecionar empresa de destino'), { target: { value: 'company-b' } });
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.change(screen.getByLabelText('Selecionar sucessor'), { target: { value: 'profile-2' } });
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Transferir'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.transferMembershipMock).toHaveBeenCalledWith({
      sourceMembershipId: 'membership-1', targetCompanyId: 'company-b', targetRole: 'manager',
      successorProfileId: 'profile-2', note: 'motivo válido',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('papel de destino default = papel de origem do alvo (nunca alterado sem interação)', async () => {
    renderModal({ user: user({ company_role: 'manager' }) });
    fireEvent.change(screen.getByLabelText('Selecionar empresa de destino'), { target: { value: 'company-b' } });
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Transferir'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.transferMembershipMock).toHaveBeenCalledWith(expect.objectContaining({ targetRole: 'manager' })));
  });

  it('erro same_company_transfer_forbidden: mantém o modal aberto', async () => {
    m.transferMembershipMock.mockRejectedValue(new Error('same_company_transfer_forbidden'));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Selecionar empresa de destino'), { target: { value: 'company-b' } });
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Transferir'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
