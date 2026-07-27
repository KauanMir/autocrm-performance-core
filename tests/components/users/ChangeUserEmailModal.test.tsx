// tests/components/users/ChangeUserEmailModal.test.tsx — modal SEPARADO de
// alteração de e-mail (M1-F S5-E1-B). useUpdateUserEmail mockado — nenhuma
// rede real, nenhum comportamento de hook re-testado aqui (isso já é
// coberto em tests/hooks/useUpdateUserEmail.test.tsx).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CompanyUserRow } from '@/lib/users/repository';

const m = vi.hoisted(() => ({
  useUpdateUserEmail: vi.fn(),
  updateUserEmailMock: vi.fn(),
  getSession: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useUpdateUserEmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useUpdateUserEmail')>();
  return { ...actual, useUpdateUserEmail: m.useUpdateUserEmail };
});

vi.mock('@/lib/services', () => ({
  AuthService: { getSession: m.getSession },
}));

import { ChangeUserEmailModal } from '@/components/users/ChangeUserEmailModal';

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
  m.updateUserEmailMock.mockReset();
  m.updateUserEmailMock.mockResolvedValue({ outcome: 'ok', profileId: 'profile-1', email: 'novo@test.local' });
  m.useUpdateUserEmail.mockReturnValue({ updateUserEmail: m.updateUserEmailMock, isPending: false, reset: vi.fn() });
  m.getSession.mockReset();
  m.getSession.mockResolvedValue({ data: { session: { access_token: 'access-token-x' } } });
  m.openFlow.mockReset();
  (window as any).__openFlow = m.openFlow;
});

function renderModal(props: Partial<React.ComponentProps<typeof ChangeUserEmailModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <ChangeUserEmailModal userId="actor-1" user={userRow()} onClose={onClose} {...props} />,
  );
  return { onClose, ...utils };
}

describe('ChangeUserEmailModal — renderização', () => {
  it('mostra nome do usuário e e-mail atual', () => {
    renderModal();
    expect(screen.getByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('ana@test.local')).toBeInTheDocument();
  });

  it('avisa sobre impacto no login', () => {
    renderModal();
    expect(screen.getByText(/passará a ser usado para entrar na conta/)).toBeInTheDocument();
  });

  it('avisa que sessões abertas não são encerradas automaticamente', () => {
    renderModal();
    expect(screen.getByText(/sessões que já estão abertas não serão encerradas automaticamente/)).toBeInTheDocument();
  });

  it('não exibe platform_role/company_id/membership_id/dados técnicos', () => {
    renderModal();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/company-a/);
    expect(html).not.toMatch(/membership-1/);
    expect(html).not.toMatch(/super_admin/);
  });

  it('foco inicial cai no campo Novo e-mail', () => {
    renderModal();
    expect(screen.getByPlaceholderText('novo@email.com')).toHaveFocus();
  });

  it('Escape chama onClose', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ChangeUserEmailModal — validação', () => {
  it('sem preencher nada: Salvar desabilitado', () => {
    renderModal();
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('mesmo e-mail (normalizado) do atual: Salvar desabilitado', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: '  Ana@Test.Local  ' } });
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('e-mail com formato inválido: Salvar desabilitado, mensagem visível', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'nao-e-email' } });
    expect(screen.getByText('Informe um endereço de e-mail válido.')).toBeInTheDocument();
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('e-mail com espaço interno: Salvar desabilitado', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'a b@test.local' } });
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('e-mail válido e diferente do atual: Salvar habilitado', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    expect(screen.getByText('Salvar')).toHaveStyle({ cursor: 'pointer' });
  });
});

describe('ChangeUserEmailModal — confirmação obrigatória', () => {
  it('clicar Salvar abre confirmação ANTES de qualquer chamada de rede', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    expect(m.openFlow).toHaveBeenCalledWith('confirmar', expect.objectContaining({ title: 'Alterar e-mail de acesso?' }));
    expect(m.updateUserEmailMock).not.toHaveBeenCalled();
  });

  it('mensagem de confirmação identifica o usuário afetado e o novo e-mail digitado', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    const payload = m.openFlow.mock.calls[0][1];
    expect(payload.message).toMatch(/Ana Silva/);
    expect(payload.message).toMatch(/novo@test\.local/);
  });

  it('Cancelar (dispensar a confirmação) nunca chama o backend', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    expect(m.openFlow.mock.calls[0][1].cancelLabel).toBe('Cancelar');
    expect(m.updateUserEmailMock).not.toHaveBeenCalled();
  });

  it('confirmar: chama updateUserEmail exatamente uma vez com profileId/email corretos', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.updateUserEmailMock).toHaveBeenCalledWith({ profileId: 'profile-1', email: 'novo@test.local' }));
    expect(m.updateUserEmailMock).toHaveBeenCalledTimes(1);
  });
});

describe('ChangeUserEmailModal — sucesso e erro', () => {
  it('sucesso: fecha o modal', async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('erro (domain_error): mantém modal aberto, preserva o valor digitado, mostra mensagem sanitizada', async () => {
    m.updateUserEmailMock.mockResolvedValue({ outcome: 'domain_error', code: 'email_already_in_use' });
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Este e-mail não está disponível.')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('novo@email.com') as HTMLInputElement).value).toBe('novo@test.local');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('email_compensation_failed: mensagem de revisão administrativa, modal continua aberto', async () => {
    m.updateUserEmailMock.mockResolvedValue({ outcome: 'domain_error', code: 'email_compensation_failed' });
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByText(/precisa de revisão administrativa/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clique duplo em confirmar gera uma única chamada', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    m.updateUserEmailMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Salvar'));
    const onConfirm = m.openFlow.mock.calls[0][1].onConfirm;
    onConfirm();
    onConfirm();
    resolveFn({ outcome: 'ok', profileId: 'profile-1', email: 'novo@test.local' });
    await waitFor(() => expect(m.updateUserEmailMock).toHaveBeenCalledTimes(1));
  });
});

describe('ChangeUserEmailModal — cancelar', () => {
  it('botão Cancelar (rodapé) chama onClose sem tentar mutation', () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('novo@email.com'), { target: { value: 'novo@test.local' } });
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(m.updateUserEmailMock).not.toHaveBeenCalled();
  });
});
