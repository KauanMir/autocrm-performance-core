// tests/components/users/ActiveUserList.test.tsx — listagem real de
// usuários ativos (M1-F S5-D). useCompanyUsers/useCompanies mockados —
// nenhuma rede real. EditUserModal é stubado (seu comportamento próprio já
// é coberto em EditUserModal.test.tsx) — este arquivo cobre listagem,
// escopos, busca/filtros, paginação, matriz de atores e integração com o
// modal.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CompanyUserRow } from '@/lib/users/repository';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

const m = vi.hoisted(() => ({
  useCompanyUsers: vi.fn(),
  useCompanies: vi.fn(),
  editModalProps: { current: null as any },
  changeEmailModalProps: { current: null as any },
}));

vi.mock('@/lib/hooks/useCompanyUsers', () => ({ useCompanyUsers: m.useCompanyUsers }));
vi.mock('@/lib/hooks/useCompanies', () => ({ useCompanies: m.useCompanies }));

vi.mock('@/components/users/EditUserModal', () => ({
  EditUserModal: (props: any) => {
    m.editModalProps.current = props;
    return <div data-testid="edit-user-modal-stub">modal aberto</div>;
  },
}));

vi.mock('@/components/users/ChangeUserEmailModal', () => ({
  ChangeUserEmailModal: (props: any) => {
    m.changeEmailModalProps.current = props;
    return <div data-testid="change-email-modal-stub">modal de e-mail aberto</div>;
  },
}));

import { ActiveUserList } from '@/components/users/ActiveUserList';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };
const MANAGER: CreateInviteActor = { kind: 'manager', companyId: 'company-a' };

function row(overrides: Partial<CompanyUserRow> = {}): CompanyUserRow {
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

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-a', name: 'Revenda Premium', trade_name: null, cnpj: null, phone: null,
    timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-07-20T12:00:00+00:00',
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

function companiesResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['k'], companies: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  m.useCompanyUsers.mockReturnValue(usersResult());
  m.useCompanies.mockReturnValue(companiesResult());
  m.editModalProps.current = null;
  m.changeEmailModalProps.current = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('ActiveUserList — guard', () => {
  it('actor null: não renderiza nada', () => {
    const { container } = render(<ActiveUserList userId="user-1" actor={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(m.useCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({ authorized: false, scope: null }));
  });
});

describe('ActiveUserList — escopos', () => {
  it('Super Admin: escopo platform, companyId null por padrão', () => {
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(m.useCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({
      authorized: true, scope: { kind: 'platform', companyId: null },
    }));
  });

  it('Manager: escopo company com companyId da activeMembership, nunca seletor', () => {
    render(<ActiveUserList userId="user-2" actor={MANAGER} />);
    expect(m.useCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({
      authorized: true, scope: { kind: 'company', companyId: 'company-a' },
    }));
    // Manager nunca vê filtro de empresa.
    expect(screen.queryByLabelText('Filtrar por empresa')).toBeNull();
  });

  it('Super Admin: useCompanies autorizado; Manager: não autorizado', () => {
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(m.useCompanies).toHaveBeenCalledWith(expect.objectContaining({ authorized: true }));
    render(<ActiveUserList userId="user-2" actor={MANAGER} />);
    expect(m.useCompanies).toHaveBeenCalledWith(expect.objectContaining({ authorized: false }));
  });
});

describe('ActiveUserList — estados de carregamento/vazio/erro', () => {
  it('loading: mostra texto de carregamento', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ isLoading: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Carregando usuários…')).toBeInTheDocument();
  });

  it('vazio sem filtros: "Nenhum usuário ativo ainda."', () => {
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Nenhum usuário ativo ainda.')).toBeInTheDocument();
  });

  it('vazio com busca: mensagem diferente ("...para os filtros atuais.")', async () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ isEmpty: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.change(screen.getByLabelText('Buscar usuário por nome ou e-mail'), { target: { value: 'zzz' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'zzz' }));
    expect(screen.getByText('Nenhum usuário encontrado para os filtros atuais.')).toBeInTheDocument();
  });

  it('erro: mensagem amigável e Tentar novamente, sem erro bruto', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ isError: true, isEmpty: false, error: { message: 'permission denied', code: '42501' } }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Não foi possível carregar os usuários.')).toBeInTheDocument();
    expect(screen.queryByText(/42501/)).toBeNull();
  });

  it('Tentar novamente chama refetch', () => {
    const refetch = vi.fn();
    m.useCompanyUsers.mockReturnValue(usersResult({ isError: true, isEmpty: false, refetch }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ActiveUserList — colunas', () => {
  it('renderiza nome/email/papel; Empresa só para Super Admin', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'manager' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('ana@test.local')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText('Revenda Premium')).toBeInTheDocument();
  });

  it('Manager: coluna Empresa não aparece', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-2" actor={MANAGER} />);
    expect(screen.queryByText('Revenda Premium')).toBeNull();
  });

  it('nenhum id técnico (profile_id/membership_id) aparece como texto visível', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.queryByText('profile-1')).toBeNull();
    expect(screen.queryByText('membership-1')).toBeNull();
  });
});

describe('ActiveUserList — busca e filtros', () => {
  it('busca é debounced (300ms) e trimada antes de chegar ao hook', async () => {
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.change(screen.getByLabelText('Buscar usuário por nome ou e-mail'), { target: { value: '  ana  ' } });
    expect(m.useCompanyUsers).not.toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' }));
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(m.useCompanyUsers).not.toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' }));
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' }));
  });

  it('botão de limpar busca reseta o campo e a busca efetiva', async () => {
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    const input = screen.getByLabelText('Buscar usuário por nome ou e-mail') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ana' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' }));
    fireEvent.click(screen.getByLabelText('Limpar busca'));
    expect(input.value).toBe('');
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: null }));
  });

  it('filtro de papel Managers/Sellers/Todos chega ao hook', () => {
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Managers'));
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'manager' }));
    fireEvent.click(screen.getByText('Sellers'));
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'seller' }));
    fireEvent.click(screen.getByText('Todos'));
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: null }));
  });

  it('Super Admin: filtro de empresa altera companyId do escopo', () => {
    m.useCompanies.mockReturnValue(companiesResult({ companies: [company()], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByLabelText('Filtrar por empresa'));
    fireEvent.click(screen.getByText('Revenda Premium'));
    expect(m.useCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: 'platform', companyId: 'company-a' },
    }));
  });
});

describe('ActiveUserList — paginação (carregar mais)', () => {
  it('hasMore=false: mostra "Fim da lista.", nenhum botão Carregar mais', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true, hasMore: false }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByTestId('active-users-end')).toBeInTheDocument();
    expect(screen.queryByText('Carregar mais')).toBeNull();
  });

  it('hasMore=true: botão Carregar mais chama fetchNextPage', () => {
    const fetchNextPage = vi.fn();
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true, hasMore: true, fetchNextPage }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Carregar mais'));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('durante isFetchingNextPage: texto muda para "Carregando…", nunca dispara uma segunda chamada', () => {
    const fetchNextPage = vi.fn();
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true, hasMore: true, isFetchingNextPage: true, fetchNextPage }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Carregando…'));
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});

describe('ActiveUserList — matriz de atores', () => {
  it('Super Admin: linha de Seller e de Manager mostram botão Editar (papel editável)', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({
      users: [row({ membership_id: 'm-seller', company_role: 'seller' }), row({ membership_id: 'm-manager', company_role: 'manager', profile_id: 'profile-2' })],
      isEmpty: false, hasData: true,
    }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getAllByText('Editar')).toHaveLength(2);
  });

  it('Super Admin editando a si mesmo: canEditRole=false (nunca o próprio cargo)', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({
      users: [row({ profile_id: 'super-admin-1' })], isEmpty: false, hasData: true,
    }));
    render(<ActiveUserList userId="super-admin-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Editar'));
    expect(m.editModalProps.current.canEditRole).toBe(false);
    expect(m.editModalProps.current.canEditName).toBe(true);
  });

  it('Manager vendo outro Manager: "Somente leitura", nenhum botão Editar', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({
      users: [row({ company_role: 'manager' })], isEmpty: false, hasData: true,
    }));
    render(<ActiveUserList userId="user-2" actor={MANAGER} />);
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(screen.queryByText('Editar')).toBeNull();
  });

  it('Manager vendo Seller: botão Editar habilitado, canEditRole sempre false', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({
      users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true,
    }));
    render(<ActiveUserList userId="user-2" actor={MANAGER} />);
    fireEvent.click(screen.getByText('Editar'));
    expect(m.editModalProps.current.canEditName).toBe(true);
    expect(m.editModalProps.current.canEditRole).toBe(false);
  });

  it('botões ocultos (Manager sobre outro Manager) não são a única proteção — canEditRole nunca chega true por essa via', () => {
    // Mesmo se um bug de UI tentasse renderizar o botão, rowCapabilities()
    // é a única fonte de decisão — testado diretamente via o modal recebido.
    m.useCompanyUsers.mockReturnValue(usersResult({
      users: [row({ company_role: 'manager', profile_id: 'other-manager' })], isEmpty: false, hasData: true,
    }));
    render(<ActiveUserList userId="user-2" actor={MANAGER} />);
    expect(screen.queryByText('Editar')).toBeNull();
    expect(m.editModalProps.current).toBeNull();
  });
});

describe('ActiveUserList — integração com o modal de edição', () => {
  it('fechar o modal devolve o foco ao botão Editar que o abriu', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    const editBtn = screen.getByText('Editar').closest('button') as HTMLButtonElement;
    editBtn.focus();
    fireEvent.click(editBtn);
    expect(m.editModalProps.current).toBeTruthy();
    m.editModalProps.current.onClose();
    expect(document.activeElement).toBe(editBtn);
  });
});

// ── M1-F S5-E1-B — ação "Alterar e-mail" (separada de nome/papel) ──────────

describe('ActiveUserList — rollout de "Alterar e-mail"', () => {
  it('userEmailEditEnabled omitido (default false): nenhuma ação de e-mail, mesmo para Super Admin', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.queryByText('Alterar e-mail')).toBeNull();
  });

  it('userEmailEditEnabled=false explícito: nenhuma ação de e-mail', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled={false} />);
    expect(screen.queryByText('Alterar e-mail')).toBeNull();
  });

  it('userEmailEditEnabled=true + Super Admin: ação disponível', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    expect(screen.getByText('Alterar e-mail')).toBeInTheDocument();
  });

  it('userEmailEditEnabled=true + Manager: ação NUNCA aparece (edição de e-mail é exclusiva de Super Admin)', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-2" actor={MANAGER} userEmailEditEnabled />);
    expect(screen.queryByText('Alterar e-mail')).toBeNull();
  });
});

describe('ActiveUserList — matriz de atores para "Alterar e-mail"', () => {
  it('Super Admin vê a ação para Manager', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'manager' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    expect(screen.getByText('Alterar e-mail')).toBeInTheDocument();
  });

  it('Super Admin vê a ação para Seller', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    expect(screen.getByText('Alterar e-mail')).toBeInTheDocument();
  });

  it('Super Admin NUNCA vê a ação na própria linha (autoalteração bloqueada na UI, em profundidade)', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ profile_id: 'super-admin-1' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="super-admin-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    expect(screen.queryByText('Alterar e-mail')).toBeNull();
    // "Editar" (nome) continua disponível para o próprio ator.
    expect(screen.getByText('Editar')).toBeInTheDocument();
  });

  it('Manager vendo Seller (nome editável): mesmo assim nunca vê "Alterar e-mail"', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-2" actor={MANAGER} userEmailEditEnabled />);
    expect(screen.getByText('Editar')).toBeInTheDocument();
    expect(screen.queryByText('Alterar e-mail')).toBeNull();
  });

  it('não mistura a ação de e-mail com a de nome/papel: os dois botões existem lado a lado, nunca substituem um ao outro', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    expect(screen.getByText('Editar')).toBeInTheDocument();
    expect(screen.getByText('Alterar e-mail')).toBeInTheDocument();
  });
});

describe('ActiveUserList — integração com o modal de e-mail', () => {
  it('clicar "Alterar e-mail" abre ChangeUserEmailModal com o usuário correto, nunca junto do EditUserModal', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    fireEvent.click(screen.getByText('Alterar e-mail'));
    expect(m.changeEmailModalProps.current).toBeTruthy();
    expect(m.changeEmailModalProps.current.user.profile_id).toBe('profile-1');
    expect(m.editModalProps.current).toBeNull();
    expect(screen.queryByTestId('edit-user-modal-stub')).toBeNull();
  });

  it('fechar o modal de e-mail devolve o foco ao botão que o abriu', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    const emailBtn = screen.getByText('Alterar e-mail').closest('button') as HTMLButtonElement;
    emailBtn.focus();
    fireEvent.click(emailBtn);
    expect(m.changeEmailModalProps.current).toBeTruthy();
    m.changeEmailModalProps.current.onClose();
    expect(document.activeElement).toBe(emailBtn);
  });

  it('abrir "Editar" nunca monta o modal de e-mail junto', () => {
    m.useCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<ActiveUserList userId="user-1" actor={SUPER_ADMIN} userEmailEditEnabled />);
    fireEvent.click(screen.getByText('Editar'));
    expect(m.editModalProps.current).toBeTruthy();
    expect(m.changeEmailModalProps.current).toBeNull();
  });
});
