// tests/components/users/EditUserModal.test.tsx — modal de edição de
// nome/papel (M1-F S5-D). useUpdateProfileName/useUpdateMembershipRole
// mockados — nenhuma rede real, nenhum comportamento de hook re-testado
// aqui (isso já é coberto em tests/hooks/).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CompanyUserRow } from '@/lib/users/repository';

const m = vi.hoisted(() => ({
  useUpdateProfileName: vi.fn(),
  useUpdateMembershipRole: vi.fn(),
  updateProfileNameMock: vi.fn(),
  updateMembershipRoleMock: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useUpdateProfileName', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useUpdateProfileName')>();
  return { ...actual, useUpdateProfileName: m.useUpdateProfileName };
});

vi.mock('@/lib/hooks/useUpdateMembershipRole', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useUpdateMembershipRole')>();
  return { ...actual, useUpdateMembershipRole: m.useUpdateMembershipRole };
});

import { EditUserModal } from '@/components/users/EditUserModal';

function userRow(overrides: Partial<CompanyUserRow> = {}): CompanyUserRow {
  return {
    profile_id: 'profile-1',
    membership_id: 'membership-1',
    name: 'Ana Silva',
    email: 'ana@test.local',
    company_id: 'company-a',
    company_name: 'Revenda Premium',
    company_role: 'seller',
    created_at: '2026-07-20T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  m.updateProfileNameMock.mockReset();
  m.updateMembershipRoleMock.mockReset();
  m.updateProfileNameMock.mockResolvedValue({ profile_id: 'profile-1', name: 'Ana Nova', updated_at: '2026-07-21T00:00:00Z' });
  m.updateMembershipRoleMock.mockResolvedValue({ membership_id: 'membership-1', profile_id: 'profile-1', company_id: 'company-a', company_role: 'manager' });
  m.useUpdateProfileName.mockReturnValue({ updateProfileName: m.updateProfileNameMock, isPending: false, reset: vi.fn() });
  m.useUpdateMembershipRole.mockReturnValue({ updateMembershipRole: m.updateMembershipRoleMock, isPending: false, reset: vi.fn() });
  m.openFlow.mockReset();
  (window as any).__openFlow = m.openFlow;
});

function renderModal(props: Partial<React.ComponentProps<typeof EditUserModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <EditUserModal userId="actor-1" user={userRow()} canEditName canEditRole onClose={onClose} {...props} />,
  );
  return { onClose, ...utils };
}

describe('EditUserModal — renderização por capability', () => {
  it('canEditName=true: campo Nome é editável e pré-preenchido', () => {
    renderModal({ canEditName: true, canEditRole: false });
    const input = screen.getByPlaceholderText('Nome completo') as HTMLInputElement;
    expect(input.value).toBe('Ana Silva');
  });

  it('canEditName=false: mostra o nome como texto, nunca como campo editável', () => {
    renderModal({ canEditName: false, canEditRole: false });
    expect(screen.queryByPlaceholderText('Nome completo')).toBeNull();
    expect(screen.getByText('Ana Silva')).toBeInTheDocument();
  });

  it('canEditRole=true: mostra seletor de papel (Vendedor/Manager)', () => {
    renderModal({ canEditRole: true });
    expect(screen.getByText('Vendedor')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
  });

  it('canEditRole=false: nenhum seletor de papel (Manager sobre Seller, ou self)', () => {
    renderModal({ canEditRole: false });
    expect(screen.queryByText('Manager')).toBeNull();
  });
});

describe('EditUserModal — validação e botão salvar', () => {
  it('sem nenhuma alteração: Salvar desabilitado (cursor not-allowed)', () => {
    renderModal();
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('nome em branco após trim: Salvar desabilitado, mensagem de validação visível', () => {
    renderModal({ canEditRole: false });
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: '   ' } });
    expect(screen.getByText('Informe um nome válido com até 120 caracteres.')).toBeInTheDocument();
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('nome acima de 120 caracteres: Salvar desabilitado', () => {
    renderModal({ canEditRole: false });
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'a'.repeat(121) } });
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('mudar só o nome habilita Salvar sem exigir mudança de papel', () => {
    renderModal({ canEditRole: false });
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'pointer' });
  });
});

describe('EditUserModal — alterar somente o nome', () => {
  it('salva direto (sem confirmação), fecha o modal em sucesso', async () => {
    const { onClose } = renderModal({ canEditRole: false });
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    fireEvent.click(screen.getByText('Salvar'));
    expect(m.openFlow).not.toHaveBeenCalled();
    await waitFor(() => expect(m.updateProfileNameMock).toHaveBeenCalledWith({ targetProfileId: 'profile-1', name: 'Ana Nova' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(m.updateMembershipRoleMock).not.toHaveBeenCalled();
  });

  it('erro: mantém o modal aberto, mostra a mensagem, nunca fecha', async () => {
    m.updateProfileNameMock.mockRejectedValue(new Error('user_inactive'));
    const { onClose } = renderModal({ canEditRole: false });
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Este usuário está inativo/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EditUserModal — alterar papel', () => {
  it('mudar o papel exige confirmação ANTES de qualquer chamada de rede', () => {
    renderModal();
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.click(screen.getByText('Salvar'));
    expect(m.openFlow).toHaveBeenCalledWith('confirmar', expect.objectContaining({ title: 'Promover a Manager?' }));
    expect(m.updateMembershipRoleMock).not.toHaveBeenCalled();
  });

  it('promoção a Manager: mensagem menciona preservação de histórico e fim de novas atribuições como Seller', () => {
    renderModal();
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.click(screen.getByText('Salvar'));
    const payload = m.openFlow.mock.calls[0][1];
    expect(payload.message).toMatch(/histórico será preservado/);
    expect(payload.message).toMatch(/novas atribuições como Vendedor serão interrompidas/);
  });

  it('rebaixamento a Vendedor: mensagem menciona reaproveitamento do cadastro e exigência de outro Manager', () => {
    renderModal({ user: userRow({ company_role: 'manager' }) });
    fireEvent.click(screen.getByText('Vendedor'));
    fireEvent.click(screen.getByText('Salvar'));
    const payload = m.openFlow.mock.calls[0][1];
    expect(payload.message).toMatch(/cadastro anterior será reutilizado/);
    expect(payload.message).toMatch(/outro Manager/);
  });

  it('confirmar: chama updateMembershipRole com membershipId/companyId/role exatos, fecha em sucesso', async () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.updateMembershipRoleMock).toHaveBeenCalledWith({
      membershipId: 'membership-1', companyId: 'company-a', role: 'manager',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('erro conhecido (last_manager_requires_successor): mensagem em português simples, modal continua aberto', async () => {
    m.updateMembershipRoleMock.mockRejectedValue(new Error('last_manager_requires_successor'));
    const { onClose } = renderModal({ user: userRow({ company_role: 'manager' }) });
    fireEvent.click(screen.getByText('Vendedor'));
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByText(/A empresa precisa ter outro Manager antes desta alteração/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EditUserModal — nome e papel juntos (ordem previsível, sem atomicidade fingida)', () => {
  it('ambos com sucesso: nome é chamado antes do papel, modal fecha', async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(m.updateProfileNameMock).toHaveBeenCalled();
    expect(m.updateMembershipRoleMock).toHaveBeenCalled();
    const nameOrder = m.updateProfileNameMock.mock.invocationCallOrder[0];
    const roleOrder = m.updateMembershipRoleMock.mock.invocationCallOrder[0];
    expect(nameOrder).toBeLessThan(roleOrder);
  });

  it('nome funciona, papel falha: NÃO fecha, mensagem indica sucesso parcial (papel não foi alterado)', async () => {
    m.updateMembershipRoleMock.mockRejectedValue(new Error('seller_state_conflict'));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Nome alterado com sucesso/)).toBeInTheDocument();
    expect(screen.getByText(/inconsistente e precisa de revisão/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('nome falha, papel funciona: NÃO fecha, mensagem reporta ambos os resultados reais', async () => {
    m.updateProfileNameMock.mockRejectedValue(new Error('invalid_name'));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.updateMembershipRoleMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Informe um nome válido/)).toBeInTheDocument();
    expect(screen.getByText(/Papel alterado com sucesso/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EditUserModal — guarda de envio duplo', () => {
  it('clique duplo em Salvar (nome só) gera uma única chamada', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    m.updateProfileNameMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    renderModal({ canEditRole: false });
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    const saveBtn = screen.getByText('Salvar');
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    resolveFn({ profile_id: 'profile-1', name: 'Ana Nova', updated_at: '2026-07-21T00:00:00Z' });
    await waitFor(() => expect(m.updateProfileNameMock).toHaveBeenCalledTimes(1));
  });
});

describe('EditUserModal — cancelar/fechar', () => {
  it('botão Cancelar chama onClose sem tentar nenhuma mutation', () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Ana Nova' } });
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(m.updateProfileNameMock).not.toHaveBeenCalled();
  });

  it('Escape chama onClose', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
