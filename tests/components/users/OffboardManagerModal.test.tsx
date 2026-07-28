// tests/components/users/OffboardManagerModal.test.tsx — modal de
// desligamento de Manager (M1-F S6-F). useCompanyUsers/useOffboardManager
// mockados. Cobertura central: o seletor envia PROFILE_ID (nunca
// membership_id — contrato distinto de OffboardSellerModal), listando só
// candidatos com company_role='manager'.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';
import type { CompanyUserRow } from '@/lib/users/repository';

const m = vi.hoisted(() => ({
  useCompanyUsers: vi.fn(),
  useOffboardManager: vi.fn(),
  offboardManagerMock: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useCompanyUsers', () => ({ useCompanyUsers: m.useCompanyUsers }));
vi.mock('@/lib/hooks/useOffboardManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useOffboardManager')>();
  return { ...actual, useOffboardManager: m.useOffboardManager };
});

import { OffboardManagerModal } from '@/components/users/OffboardManagerModal';

function user(overrides: Partial<MembershipLifecycleTargetUser> = {}): MembershipLifecycleTargetUser {
  return {
    membership_id: 'membership-1', profile_id: 'profile-1', name: 'Carlos Manager', email: 'carlos@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'manager',
    ...overrides,
  };
}

function candidateRow(overrides: Partial<CompanyUserRow> = {}): CompanyUserRow {
  return {
    profile_id: 'profile-3', membership_id: 'membership-3', name: 'Diana Manager', email: 'diana@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'manager', created_at: '2026-07-20T12:00:00Z',
    ...overrides,
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
  m.useCompanyUsers.mockReturnValue(usersResult({ users: [candidateRow(), user() as unknown as CompanyUserRow], hasData: true, isEmpty: false }));
  m.offboardManagerMock.mockReset();
  m.offboardManagerMock.mockResolvedValue({});
  m.useOffboardManager.mockReturnValue({ offboardManager: m.offboardManagerMock, isPending: false, reset: vi.fn() });
  m.openFlow.mockReset();
  (window as any).__openFlow = m.openFlow;
});

function renderModal(props: Partial<React.ComponentProps<typeof OffboardManagerModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(<OffboardManagerModal userId="actor-1" user={user()} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

describe('OffboardManagerModal — seletor de sucessor', () => {
  it('busca candidatos via useCompanyUsers, escopado pela empresa de origem e role=manager', () => {
    renderModal();
    expect(m.useCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: 'company', companyId: 'company-a' },
      role: 'manager',
    }));
  });

  it('o próprio alvo NUNCA aparece como opção de sucessor', () => {
    renderModal();
    const select = screen.getByLabelText('Selecionar sucessor') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain('profile-1');
    expect(optionValues).toContain('profile-3');
  });
});

describe('OffboardManagerModal — chamada (contrato profile_id, nunca membership_id)', () => {
  it('confirmar com sucessor selecionado: envia successorProfileId (profile_id, nunca membership_id)', async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Selecionar sucessor'), { target: { value: 'profile-3' } });
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Desligar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.offboardManagerMock).toHaveBeenCalledWith({
      managerMembershipId: 'membership-1', successorProfileId: 'profile-3', note: 'motivo válido',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('confirmar sem sucessor: envia successorProfileId=null', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Desligar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.offboardManagerMock).toHaveBeenCalledWith({
      managerMembershipId: 'membership-1', successorProfileId: null, note: 'motivo válido',
    }));
  });

  it('erro last_manager_requires_successor: mantém o modal aberto, pede seleção de sucessor', async () => {
    m.offboardManagerMock.mockRejectedValue(new Error('last_manager_requires_successor'));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Desligar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/outro Manager ativo/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
