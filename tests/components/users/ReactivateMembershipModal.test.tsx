// tests/components/users/ReactivateMembershipModal.test.tsx — modal de
// reativação empresarial (M1-F S6-F). useReactivateMembership mockado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';

const m = vi.hoisted(() => ({
  useReactivateMembership: vi.fn(),
  reactivateMembershipMock: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useReactivateMembership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useReactivateMembership')>();
  return { ...actual, useReactivateMembership: m.useReactivateMembership };
});

import { ReactivateMembershipModal } from '@/components/users/ReactivateMembershipModal';

function user(overrides: Partial<MembershipLifecycleTargetUser> = {}): MembershipLifecycleTargetUser {
  return {
    membership_id: 'membership-1', profile_id: 'profile-1', name: 'Ana Silva', email: 'ana@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'seller',
    ...overrides,
  };
}

beforeEach(() => {
  m.reactivateMembershipMock.mockReset();
  m.reactivateMembershipMock.mockResolvedValue({});
  m.useReactivateMembership.mockReturnValue({ reactivateMembership: m.reactivateMembershipMock, isPending: false, reset: vi.fn() });
  m.openFlow.mockReset();
  (window as any).__openFlow = m.openFlow;
});

function renderModal(props: Partial<React.ComponentProps<typeof ReactivateMembershipModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(<ReactivateMembershipModal userId="actor-1" user={user()} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

describe('ReactivateMembershipModal — motivo é opcional', () => {
  it('sem preencher motivo: Reativar já habilitado', () => {
    renderModal();
    const button = screen.getByText('Reativar').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('pointer');
  });

  it('confirmar sem motivo: chama reactivateMembership com note=null', async () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Reativar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.reactivateMembershipMock).toHaveBeenCalledWith({ membershipId: 'membership-1', note: null }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('confirmar com motivo: chama reactivateMembership com o texto', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo, se desejar'), { target: { value: 'motivo opcional' } });
    fireEvent.click(screen.getByText('Reativar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.reactivateMembershipMock).toHaveBeenCalledWith({ membershipId: 'membership-1', note: 'motivo opcional' }));
  });
});

describe('ReactivateMembershipModal — confirmação', () => {
  it('clicar Reativar abre confirmação, nunca chama a mutation direto', () => {
    renderModal();
    fireEvent.click(screen.getByText('Reativar'));
    expect(m.openFlow).toHaveBeenCalledWith('confirmar', expect.objectContaining({ title: 'Reativar usuário?' }));
    expect(m.reactivateMembershipMock).not.toHaveBeenCalled();
  });

  it('erro: mantém o modal aberto, mostra mensagem amigável', async () => {
    m.reactivateMembershipMock.mockRejectedValue(new Error('membership_lifecycle_conflict'));
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Reativar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/desligado/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
