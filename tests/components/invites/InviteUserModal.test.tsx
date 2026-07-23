// tests/components/invites/InviteUserModal.test.tsx — modal real de
// convite (M1-F S4-F2). useCompanies/useCreateInvite/AuthService mockados
// — nenhuma rede real, nenhum comportamento de hook re-testado aqui (isso
// já é coberto em tests/hooks/).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

const m = vi.hoisted(() => ({
  useCompanies: vi.fn(),
  useCreateInvite: vi.fn(),
  createInviteMock: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/hooks/useCompanies', () => ({ useCompanies: m.useCompanies }));

vi.mock('@/lib/hooks/useCreateInvite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useCreateInvite')>();
  return { ...actual, useCreateInvite: m.useCreateInvite };
});

vi.mock('@/lib/services', () => ({
  AuthService: { getSession: m.getSession },
}));

import { InviteUserModal } from '@/components/invites/InviteUserModal';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };
const MANAGER: CreateInviteActor = { kind: 'manager', companyId: 'company-a' };

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-a', name: 'Revenda Premium', trade_name: null, cnpj: null, phone: null,
    timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-07-20T12:00:00+00:00',
    ...overrides,
  };
}

function companiesResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['k'], companies: [company()],
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

function okResult(overrides: Record<string, unknown> = {}) {
  return { outcome: 'ok', inviteId: 'invite-1', status: 'pending', deliveryStatus: 'sent', expiresAt: '2026-08-01T00:00:00Z', ...overrides };
}

beforeEach(() => {
  m.useCompanies.mockReturnValue(companiesResult());
  m.createInviteMock.mockReset();
  m.createInviteMock.mockResolvedValue(okResult());
  m.useCreateInvite.mockReturnValue({ createInvite: m.createInviteMock, isPending: false, reset: vi.fn() });
  m.getSession.mockReset();
  m.getSession.mockResolvedValue({ data: { session: { access_token: 'access-token-x' } } });
});

function renderModal(props: Partial<React.ComponentProps<typeof InviteUserModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <InviteUserModal userId="user-1" actor={SUPER_ADMIN} onClose={onClose} {...props} />,
  );
  return { onClose, ...utils };
}

function fillBasics(name = 'Fulano de Tal', email = 'fulano@test.local') {
  fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText('pessoa@exemplo.com'), { target: { value: email } });
}

describe('InviteUserModal — abre e fecha', () => {
  it('renderiza título e descrição corretos', () => {
    renderModal();
    expect(screen.getByText('Convidar usuário')).toBeInTheDocument();
    expect(screen.getByText('Envie um convite para uma pessoa acessar o AutoCRM.')).toBeInTheDocument();
  });

  it('botão Cancelar chama onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('X do cabeçalho chama onClose', () => {
    const { onClose } = renderModal();
    const buttons = screen.getAllByRole('button');
    const closeBtn = buttons.find((b) => b.querySelector('svg') && b.textContent === '')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape chama onClose', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('foco inicial cai no campo Nome', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Nome completo')).toHaveFocus();
  });
});

describe('InviteUserModal — campos obrigatórios', () => {
  it('botão de envio fica desabilitado (opacidade reduzida) com nome/e-mail em branco', () => {
    renderModal();
    const submitBtn = screen.getByText('Enviar convite');
    expect(submitBtn).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('clicar Enviar convite com campos vazios não chama createInvite', () => {
    renderModal();
    fireEvent.click(screen.getByText('Enviar convite'));
    expect(m.createInviteMock).not.toHaveBeenCalled();
  });

  it('e-mail sem formato válido não permite envio, e mostra a dica de validação', () => {
    renderModal();
    fillBasics('Fulano', 'nao-e-email');
    expect(screen.getByText('Informe um e-mail válido.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Enviar convite'));
    expect(m.createInviteMock).not.toHaveBeenCalled();
  });
});

describe('InviteUserModal — sucesso', () => {
  it('mostra confirmação e não expõe link/token/hash na tela', async () => {
    renderModal();
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    fireEvent.click(screen.getByText('Enviar convite'));

    await waitFor(() => expect(screen.getByText(/Um e-mail com as instruções de acesso/)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/token|hash|convite\/aceitar|http/i);
  });

  it('fechar após sucesso chama onClose', async () => {
    const { onClose } = renderModal();
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    fireEvent.click(screen.getByText('Enviar convite'));
    await waitFor(() => expect(screen.getByText(/Um e-mail com as instruções de acesso/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Fechar'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('InviteUserModal — erro preserva o formulário', () => {
  it('erro de domínio (duplicate_pending): mostra mensagem amigável, campos continuam preenchidos, modal não fecha', async () => {
    m.createInviteMock.mockResolvedValue({ outcome: 'domain_error', code: 'duplicate_pending' });
    const { onClose } = renderModal();
    fillBasics('Fulano', 'dup@test.local');
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    fireEvent.click(screen.getByText('Enviar convite'));

    await waitFor(() => expect(screen.getByText(/Já existe um convite pendente/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Fulano')).toBeInTheDocument();
    expect(screen.getByDisplayValue('dup@test.local')).toBeInTheDocument();
  });

  it('erro local (rejeição de createInvite, ex.: sessão expirada) também é exibido sem fechar o modal', async () => {
    m.createInviteMock.mockRejectedValue(new Error('create-invite-missing-session'));
    const { onClose } = renderModal();
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    fireEvent.click(screen.getByText('Enviar convite'));

    await waitFor(() => expect(screen.getByText(/sessão expirou/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('InviteUserModal — clique duplo', () => {
  it('cliques rápidos e repetidos geram uma única chamada a createInvite', async () => {
    let resolveCreate: (v: unknown) => void = () => {};
    m.createInviteMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    renderModal();
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));

    const submitBtn = screen.getByText('Enviar convite');
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    resolveCreate(okResult());
    await waitFor(() => expect(screen.getByText(/Um e-mail com as instruções de acesso/)).toBeInTheDocument());
    expect(m.createInviteMock).toHaveBeenCalledTimes(1);
  });
});

describe('InviteUserModal — Super Admin: função e empresa', () => {
  it('escolhe seller: exige empresa antes de habilitar envio', () => {
    renderModal({ actor: SUPER_ADMIN });
    fillBasics();
    expect(screen.getByText('Enviar convite')).toHaveStyle({ cursor: 'not-allowed' });
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    expect(screen.getByText('Enviar convite')).toHaveStyle({ cursor: 'pointer' });
  });

  it('escolhe manager: também exige empresa', async () => {
    renderModal({ actor: SUPER_ADMIN });
    fillBasics('Gerente Novo', 'gerente@test.local');
    fireEvent.click(screen.getByText('Gerente'));
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    fireEvent.click(screen.getByText('Enviar convite'));

    await waitFor(() => expect(m.createInviteMock).toHaveBeenCalledWith(
      expect.objectContaining({ roleKind: 'manager', companyId: 'company-a' }),
    ));
  });

  it('escolhe super_admin: campo de empresa desaparece e o envio não exige empresa', async () => {
    renderModal({ actor: SUPER_ADMIN });
    fillBasics('Novo Super', 'sa2@test.local');
    fireEvent.click(screen.getByText('Super Admin'));
    expect(screen.queryByText('Empresa')).toBeNull();
    fireEvent.click(screen.getByText('Enviar convite'));

    await waitFor(() => expect(m.createInviteMock).toHaveBeenCalledWith(
      expect.objectContaining({ roleKind: 'super_admin', companyId: null }),
    ));
  });

  it('trocar de seller (com empresa escolhida) para super_admin limpa a empresa selecionada', () => {
    renderModal({ actor: SUPER_ADMIN });
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    expect(screen.getByText('Revenda Premium')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Super Admin'));
    expect(screen.queryByText('Empresa')).toBeNull();
  });

  it('lista de empresas exclui empresas suspensas', () => {
    m.useCompanies.mockReturnValue(companiesResult({
      companies: [company({ id: 'a', name: 'Empresa Ativa', status: 'ativa' }), company({ id: 's', name: 'Empresa Suspensa', status: 'suspensa' })],
    }));
    renderModal({ actor: SUPER_ADMIN });
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    expect(screen.getByText('Empresa Ativa')).toBeInTheDocument();
    expect(screen.queryByText('Empresa Suspensa')).toBeNull();
  });

  it('estado de carregamento das empresas é exibido', () => {
    m.useCompanies.mockReturnValue(companiesResult({ isLoading: true, companies: [] }));
    renderModal({ actor: SUPER_ADMIN });
    expect(screen.getByText('Carregando empresas…')).toBeInTheDocument();
  });

  it('estado de erro das empresas é exibido', () => {
    m.useCompanies.mockReturnValue(companiesResult({ isError: true, companies: [] }));
    renderModal({ actor: SUPER_ADMIN });
    expect(screen.getByText('Não foi possível carregar as empresas.')).toBeInTheDocument();
  });
});

describe('InviteUserModal — Manager: sem escolha de função/empresa', () => {
  it('não exibe seletor de Função nem de Empresa', () => {
    renderModal({ actor: MANAGER });
    expect(screen.queryByText('Função')).toBeNull();
    expect(screen.getByText('Função: Vendedor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Selecione a empresa/ })).toBeNull();
  });

  it('não chama useCompanies como autorizado (Manager nunca busca a listagem)', () => {
    renderModal({ actor: MANAGER });
    expect(m.useCompanies).toHaveBeenCalledWith(expect.objectContaining({ authorized: false }));
  });

  it('envio usa role seller (nunca exibe nem envia outro role_kind) — o companyId real é resolvido dentro de useCreateInvite a partir do actor (ver tests/hooks/useCreateInvite.test.tsx), aqui só confirmamos que o actor correto chega até o hook', async () => {
    renderModal({ actor: MANAGER });
    fillBasics('Vendedor Novo', 'vendedor@test.local');
    fireEvent.click(screen.getByText('Enviar convite'));

    expect(m.useCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ actor: MANAGER }));
    await waitFor(() => expect(m.createInviteMock).toHaveBeenCalledWith(
      expect.objectContaining({ roleKind: 'seller' }),
    ));
  });
});

describe('InviteUserModal — segurança', () => {
  it('nenhum acesso a localStorage/sessionStorage durante todo o fluxo', async () => {
    const lsSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderModal();
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    fireEvent.click(screen.getByText('Enviar convite'));
    await waitFor(() => expect(screen.getByText(/Um e-mail com as instruções de acesso/)).toBeInTheDocument());
    expect(lsSpy).not.toHaveBeenCalled();
    lsSpy.mockRestore();
  });

  it('access token nunca aparece em nenhum atributo do DOM', async () => {
    renderModal();
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /Selecione a empresa/ }));
    fireEvent.click(screen.getByText('Revenda Premium'));
    fireEvent.click(screen.getByText('Enviar convite'));
    await waitFor(() => expect(screen.getByText(/Um e-mail com as instruções de acesso/)).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain('access-token-x');
  });
});
