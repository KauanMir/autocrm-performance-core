// tests/components/users/InactiveUserList.test.tsx — listagem de usuários
// suspensos/desligados (M1-F S6-F). useInactiveCompanyUsers/useCompanies
// mockados — nenhuma rede real. Os quatro modais são stubados (seu
// comportamento próprio já é coberto nos arquivos dedicados) — este arquivo
// cobre listagem, escopos, filtros, paginação, matriz de atores e a
// integração com o modal certo por ação.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { InactiveCompanyUserRow } from '@/lib/inactiveUsers/repository';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

const m = vi.hoisted(() => ({
  useInactiveCompanyUsers: vi.fn(),
  useCompanies: vi.fn(),
  reactivateModalProps: { current: null as any },
  offboardSellerModalProps: { current: null as any },
  offboardManagerModalProps: { current: null as any },
  transferModalProps: { current: null as any },
}));

vi.mock('@/lib/hooks/useInactiveCompanyUsers', () => ({ useInactiveCompanyUsers: m.useInactiveCompanyUsers }));
vi.mock('@/lib/hooks/useCompanies', () => ({ useCompanies: m.useCompanies }));

vi.mock('@/components/users/ReactivateMembershipModal', () => ({
  ReactivateMembershipModal: (props: any) => { m.reactivateModalProps.current = props; return <div data-testid="reactivate-modal-stub" />; },
}));
vi.mock('@/components/users/OffboardSellerModal', () => ({
  OffboardSellerModal: (props: any) => { m.offboardSellerModalProps.current = props; return <div data-testid="offboard-seller-modal-stub" />; },
}));
vi.mock('@/components/users/OffboardManagerModal', () => ({
  OffboardManagerModal: (props: any) => { m.offboardManagerModalProps.current = props; return <div data-testid="offboard-manager-modal-stub" />; },
}));
vi.mock('@/components/users/TransferMembershipModal', () => ({
  TransferMembershipModal: (props: any) => { m.transferModalProps.current = props; return <div data-testid="transfer-modal-stub" />; },
}));

import { InactiveUserList } from '@/components/users/InactiveUserList';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };
const MANAGER: CreateInviteActor = { kind: 'manager', companyId: 'company-a' };

function row(overrides: Partial<InactiveCompanyUserRow> = {}): InactiveCompanyUserRow {
  return {
    profile_id: 'profile-1', membership_id: 'membership-1', name: 'Ana Silva', email: 'ana@test.local',
    company_id: 'company-a', company_name: 'Revenda Premium', company_role: 'seller',
    lifecycle_status: 'suspended', is_active: false,
    created_at: '2026-07-20T12:00:00Z', updated_at: '2026-07-21T12:00:00Z',
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
  m.useInactiveCompanyUsers.mockReturnValue(usersResult());
  m.useCompanies.mockReturnValue(companiesResult());
  m.reactivateModalProps.current = null;
  m.offboardSellerModalProps.current = null;
  m.offboardManagerModalProps.current = null;
  m.transferModalProps.current = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('InactiveUserList — guard', () => {
  it('actor null: não renderiza nada', () => {
    const { container } = render(<InactiveUserList userId="user-1" actor={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(m.useInactiveCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({ authorized: false, scope: null }));
  });
});

describe('InactiveUserList — escopos', () => {
  it('Super Admin: escopo platform', () => {
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(m.useInactiveCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({
      authorized: true, scope: { kind: 'platform', companyId: null },
    }));
  });

  it('Manager: escopo company com companyId da activeMembership', () => {
    render(<InactiveUserList userId="user-2" actor={MANAGER} />);
    expect(m.useInactiveCompanyUsers).toHaveBeenCalledWith(expect.objectContaining({
      authorized: true, scope: { kind: 'company', companyId: 'company-a' },
    }));
  });
});

describe('InactiveUserList — estados', () => {
  it('loading: mostra texto de carregamento', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ isLoading: true }));
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Carregando usuários…')).toBeInTheDocument();
  });

  it('vazio sem filtros: mensagem específica de inativos', () => {
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Nenhum usuário suspenso ou desligado.')).toBeInTheDocument();
  });

  it('erro: mensagem amigável, Tentar novamente chama refetch', () => {
    const refetch = vi.fn();
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ isError: true, isEmpty: false, refetch }));
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Não foi possível carregar os usuários.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('InactiveUserList — filtros', () => {
  it('busca é debounced (300ms)', async () => {
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.change(screen.getByLabelText('Buscar usuário inativo por nome ou e-mail'), { target: { value: 'ana' } });
    expect(m.useInactiveCompanyUsers).not.toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' }));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(m.useInactiveCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' }));
  });

  it('filtro de status Suspensos/Desligados/Todos chega ao hook', () => {
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Suspensos'));
    expect(m.useInactiveCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ lifecycle: 'suspended' }));
    fireEvent.click(screen.getByText('Desligados'));
    expect(m.useInactiveCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ lifecycle: 'offboarded' }));
    fireEvent.click(screen.getByText('Todos'));
    expect(m.useInactiveCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ lifecycle: null }));
  });

  it('filtro de papel Managers/Sellers chega ao hook', () => {
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Managers'));
    expect(m.useInactiveCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'manager' }));
    fireEvent.click(screen.getByText('Sellers'));
    expect(m.useInactiveCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'seller' }));
  });

  it('Manager: nenhum filtro de empresa', () => {
    render(<InactiveUserList userId="user-2" actor={MANAGER} />);
    expect(screen.queryByLabelText('Filtrar por empresa')).toBeNull();
  });

  it('Super Admin: filtro de empresa altera o escopo', () => {
    m.useCompanies.mockReturnValue(companiesResult({ companies: [company()], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByLabelText('Filtrar por empresa'));
    fireEvent.click(screen.getByText('Revenda Premium'));
    expect(m.useInactiveCompanyUsers).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: 'platform', companyId: 'company-a' },
    }));
  });
});

describe('InactiveUserList — paginação', () => {
  it('hasMore=false: "Fim da lista."', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true, hasMore: false }));
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByTestId('inactive-users-end')).toBeInTheDocument();
  });

  it('hasMore=true: Carregar mais chama fetchNextPage', () => {
    const fetchNextPage = vi.fn();
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true, hasMore: true, fetchNextPage }));
    render(<InactiveUserList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Carregar mais'));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});

describe('InactiveUserList — matriz de atores e ações', () => {
  it('Super Admin, alvo suspenso: Reativar/Desligar/Transferir aparecem', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row({ lifecycle_status: 'suspended' })], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="admin-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Reativar')).toBeInTheDocument();
    expect(screen.getByText('Desligar')).toBeInTheDocument();
    expect(screen.getByText('Transferir')).toBeInTheDocument();
  });

  it('Super Admin, alvo desligado: Somente leitura, nenhuma ação', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row({ lifecycle_status: 'offboarded' })], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="admin-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(screen.queryByText('Reativar')).toBeNull();
  });

  it('Manager, Seller suspenso da própria empresa: Reativar/Desligar, nunca Transferir', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({
      users: [row({ company_role: 'seller', company_id: 'company-a', lifecycle_status: 'suspended' })], isEmpty: false, hasData: true,
    }));
    render(<InactiveUserList userId="manager-1" actor={MANAGER} />);
    expect(screen.getByText('Reativar')).toBeInTheDocument();
    expect(screen.getByText('Desligar')).toBeInTheDocument();
    expect(screen.queryByText('Transferir')).toBeNull();
  });

  it('Manager, Manager suspenso da própria empresa: somente leitura (nunca Manager sobre Manager)', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({
      users: [row({ company_role: 'manager', company_id: 'company-a', lifecycle_status: 'suspended' })], isEmpty: false, hasData: true,
    }));
    render(<InactiveUserList userId="manager-1" actor={MANAGER} />);
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
  });
});

describe('InactiveUserList — integração com os modais corretos por ação', () => {
  it('Reativar abre ReactivateMembershipModal com o usuário certo', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="admin-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Reativar'));
    expect(m.reactivateModalProps.current.user.membership_id).toBe('membership-1');
  });

  it('Desligar sobre Seller abre OffboardSellerModal, nunca OffboardManagerModal', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'seller' })], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="admin-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Desligar'));
    expect(m.offboardSellerModalProps.current).toBeTruthy();
    expect(m.offboardManagerModalProps.current).toBeNull();
  });

  it('Desligar sobre Manager abre OffboardManagerModal, nunca OffboardSellerModal', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row({ company_role: 'manager' })], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="admin-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Desligar'));
    expect(m.offboardManagerModalProps.current).toBeTruthy();
    expect(m.offboardSellerModalProps.current).toBeNull();
  });

  it('Transferir abre TransferMembershipModal', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="admin-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Transferir'));
    expect(m.transferModalProps.current).toBeTruthy();
  });

  it('fechar o modal devolve o foco ao botão que o abriu', () => {
    m.useInactiveCompanyUsers.mockReturnValue(usersResult({ users: [row()], isEmpty: false, hasData: true }));
    render(<InactiveUserList userId="admin-1" actor={SUPER_ADMIN} />);
    const reactivateBtn = screen.getByText('Reativar').closest('button') as HTMLButtonElement;
    reactivateBtn.focus();
    fireEvent.click(reactivateBtn);
    m.reactivateModalProps.current.onClose();
    expect(document.activeElement).toBe(reactivateBtn);
  });
});
