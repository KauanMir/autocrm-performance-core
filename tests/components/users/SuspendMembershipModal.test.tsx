// tests/components/users/SuspendMembershipModal.test.tsx — modal de
// suspensão empresarial (M1-F S6-F). useSuspendMembership mockado — nenhuma
// rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';

const m = vi.hoisted(() => ({
  useSuspendMembership: vi.fn(),
  suspendMembershipMock: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useSuspendMembership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSuspendMembership')>();
  return { ...actual, useSuspendMembership: m.useSuspendMembership };
});

import { SuspendMembershipModal } from '@/components/users/SuspendMembershipModal';

function user(overrides: Partial<MembershipLifecycleTargetUser> = {}): MembershipLifecycleTargetUser {
  return {
    membership_id: 'membership-1', profile_id: 'profile-1', name: 'Ana Silva', email: 'ana@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'seller',
    ...overrides,
  };
}

beforeEach(() => {
  m.suspendMembershipMock.mockReset();
  m.suspendMembershipMock.mockResolvedValue({});
  m.useSuspendMembership.mockReturnValue({ suspendMembership: m.suspendMembershipMock, isPending: false, reset: vi.fn() });
  m.openFlow.mockReset();
  (window as any).__openFlow = m.openFlow;
});

function renderModal(props: Partial<React.ComponentProps<typeof SuspendMembershipModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(<SuspendMembershipModal userId="actor-1" user={user()} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

describe('SuspendMembershipModal — validação', () => {
  it('motivo vazio: Suspender desabilitado', () => {
    renderModal();
    const button = screen.getByText('Suspender').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('not-allowed');
  });

  it('motivo com 1-2 caracteres: continua desabilitado', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'ab' } });
    const button = screen.getByText('Suspender').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('not-allowed');
  });

  it('motivo válido (>=3 caracteres): habilita o botão', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    const button = screen.getByText('Suspender').closest('button') as HTMLButtonElement;
    expect(button.style.cursor).toBe('pointer');
  });
});

describe('SuspendMembershipModal — confirmação e chamada', () => {
  it('clicar Suspender abre confirmação, nunca chama a mutation direto', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Suspender'));
    expect(m.openFlow).toHaveBeenCalledWith('confirmar', expect.objectContaining({ title: 'Suspender usuário?' }));
    expect(m.suspendMembershipMock).not.toHaveBeenCalled();
  });

  it('confirmar: chama suspendMembership com membershipId/note exatos, fecha em sucesso', async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Suspender'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.suspendMembershipMock).toHaveBeenCalledWith({ membershipId: 'membership-1', note: 'motivo válido' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('erro: mantém o modal aberto, mostra mensagem amigável', async () => {
    m.suspendMembershipMock.mockRejectedValue(new Error('last_manager_requires_successor'));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Descreva o motivo (obrigatório)'), { target: { value: 'motivo válido' } });
    fireEvent.click(screen.getByText('Suspender'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/outro Manager ativo/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
