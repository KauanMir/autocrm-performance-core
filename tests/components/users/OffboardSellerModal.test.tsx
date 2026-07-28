// tests/components/users/OffboardSellerModal.test.tsx — modal de
// desligamento de Seller (M1-F S6-F). useCompanyUsers/useOffboardSeller
// mockados. Cobertura central: o seletor de sucessor envia membership_id
// (nunca seller_id/profile_id) e o alvo nunca aparece como opção de si
// mesmo.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';
import type { CompanyUserRow } from '@/lib/users/repository';

const m = vi.hoisted(() => ({
  useCompanyUsers: vi.fn(),
  useOffboardSeller: vi.fn(),
  offboardSellerMock: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useCompanyUsers', () => ({ useCompanyUsers: m.useCompanyUsers }));
vi.mock('@/lib/hooks/useOffboardSeller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useOffboardSeller')>();
  return { ...actual, useOffboardSeller: m.useOffboardSeller };
});

import { OffboardSellerModal } from '@/components/users/OffboardSellerModal';

function user(overrides: Partial<MembershipLifecycleTargetUser> = {}): MembershipLifecycleTargetUser {
  return {
    membership_id: 'membership-1', profile_id: 'profile-1', name: 'Ana Silva', email: 'ana@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'seller',
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
  m.offboardSellerMock.mockReset();
  m.offboardSellerMock.mockResolvedValue({});
  m.useOffboardSeller.mockReturnValue({ offboardSeller: m.offboardSellerMock, isPending: false, reset: vi.fn() });
  m.openFlow.mockReset();
  (window as any).__openFlow = m.openFlow;
});

function renderModal(props: Partial<React.ComponentProps<typeof OffboardSellerModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(<OffboardSellerModal userId="actor-1" user={user()} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

describe('OffboardSellerModal — seletor de sucessor', () => {
  it('busca candidatos via useCompanyUsers, escopado pela empresa de origem e role=seller', () => {
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
    expect(optionValues).not.toContain('membership-1');
    expect(optionValues).toContain('membership-2');
  });

  it('motivo válido, sem sucessor selecionado: Desligar habilitado (sucessor é opcional na UI)', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    const button = screen.getByText('Desligar').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('pointer');
  });
});

describe('OffboardSellerModal — chamada (contrato membership_id, S6-E2)', () => {
  it('confirmar com sucessor selecionado: envia successorMembershipId (nunca seller_id/profile_id)', async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Selecionar sucessor'), { target: { value: 'membership-2' } });
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Desligar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.offboardSellerMock).toHaveBeenCalledWith({
      sellerMembershipId: 'membership-1', successorMembershipId: 'membership-2', note: 'motivo válido',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('confirmar sem sucessor: envia successorMembershipId=null', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Desligar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.offboardSellerMock).toHaveBeenCalledWith({
      sellerMembershipId: 'membership-1', successorMembershipId: null, note: 'motivo válido',
    }));
  });

  it('erro successor_required: mantém o modal aberto, explica leads em aberto', async () => {
    m.offboardSellerMock.mockRejectedValue(new Error('successor_required'));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Desligar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/leads em aberto/);
    expect(onClose).not.toHaveBeenCalled();
  });
});
