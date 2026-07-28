// tests/components/users/ContextualUsersTabContent.test.tsx — composição
// NOVA da aba Usuários com filtro contextual de empresa (M1-F S7-C).
// useCompanyScopeFilter/ActiveUserList/InactiveUserList/InviteList/
// CompanyScopeFilter são stubados — este arquivo é o único lugar
// autorizado a mockar useCompanyScopeFilter (finalidade: testar
// composição), nunca para esconder montagem indevida com a flag
// desligada (isso é responsabilidade de UsersTabSection, que escolhe não
// montar este componente nesse caso).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const m = vi.hoisted(() => ({
  useCompanyScopeFilter: vi.fn(),
  activeUserListProps: { current: null as any },
  inactiveUserListProps: { current: null as any },
  inviteListProps: { current: null as any },
  companyScopeFilterProps: { current: null as any },
}));

vi.mock('@/lib/hooks/useCompanyScopeFilter', () => ({ useCompanyScopeFilter: m.useCompanyScopeFilter }));

vi.mock('@/components/users/ActiveUserList', () => ({
  ActiveUserList: (props: any) => { m.activeUserListProps.current = props; return <div data-testid="active-user-list-stub" />; },
}));
vi.mock('@/components/users/InactiveUserList', () => ({
  InactiveUserList: (props: any) => { m.inactiveUserListProps.current = props; return <div data-testid="inactive-user-list-stub" />; },
}));
vi.mock('@/components/invites/InviteList', () => ({
  InviteList: (props: any) => { m.inviteListProps.current = props; return <div data-testid="invite-list-stub" />; },
}));
vi.mock('@/components/users/CompanyScopeFilter', () => ({
  CompanyScopeFilter: (props: any) => { m.companyScopeFilterProps.current = props; return <div data-testid="company-scope-filter-stub" />; },
}));

import { ContextualUsersTabContent } from '@/components/users/ContextualUsersTabContent';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-a', name: 'Revenda Premium', trade_name: null, cnpj: null, phone: null,
    timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-07-20T12:00:00+00:00',
    ...overrides,
  };
}

function scopeFilterResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    companyFilterId: null,
    setCompanyFilterId: vi.fn(),
    isSuperAdmin: true,
    companies: [company()],
    companiesLoading: false,
    ...over,
  };
}

beforeEach(() => {
  m.useCompanyScopeFilter.mockReturnValue(scopeFilterResult());
  m.activeUserListProps.current = null;
  m.inactiveUserListProps.current = null;
  m.inviteListProps.current = null;
  m.companyScopeFilterProps.current = null;
});

const BASE_PROPS = {
  userId: 'user-1',
  actor: SUPER_ADMIN,
  activeUsersEnabled: true,
  userLifecycleEnabled: true,
  userEmailEditEnabled: true,
};

describe('ContextualUsersTabContent — instancia useCompanyScopeFilter uma única vez', () => {
  it('chama useCompanyScopeFilter exatamente uma vez, com userId/actor', () => {
    render(<ContextualUsersTabContent {...BASE_PROPS} />);
    expect(m.useCompanyScopeFilter).toHaveBeenCalledTimes(1);
    expect(m.useCompanyScopeFilter).toHaveBeenCalledWith({ userId: 'user-1', actor: SUPER_ADMIN });
  });
});

describe('ContextualUsersTabContent — CompanyScopeFilter sempre presente', () => {
  it('renderiza CompanyScopeFilter com companies/companiesLoading/companyFilterId do hook', () => {
    m.useCompanyScopeFilter.mockReturnValue(scopeFilterResult({ companyFilterId: 'company-a', companiesLoading: true }));
    render(<ContextualUsersTabContent {...BASE_PROPS} />);
    expect(screen.getByTestId('company-scope-filter-stub')).toBeInTheDocument();
    expect(m.companyScopeFilterProps.current.companyFilterId).toBe('company-a');
    expect(m.companyScopeFilterProps.current.companiesLoading).toBe(true);
  });

  it('onChange do CompanyScopeFilter é o setCompanyFilterId do hook', () => {
    const setCompanyFilterId = vi.fn();
    m.useCompanyScopeFilter.mockReturnValue(scopeFilterResult({ setCompanyFilterId }));
    render(<ContextualUsersTabContent {...BASE_PROPS} />);
    expect(m.companyScopeFilterProps.current.onChange).toBe(setCompanyFilterId);
  });
});

describe('ContextualUsersTabContent — companyFilterId compartilhado entre as três listas', () => {
  it('ActiveUserList/InactiveUserList/InviteList recebem o MESMO externalCompanyFilterId do hook', () => {
    m.useCompanyScopeFilter.mockReturnValue(scopeFilterResult({ companyFilterId: 'company-a' }));
    render(<ContextualUsersTabContent {...BASE_PROPS} />);
    expect(m.activeUserListProps.current.externalCompanyFilterId).toBe('company-a');
    expect(m.inactiveUserListProps.current.externalCompanyFilterId).toBe('company-a');
    expect(m.inviteListProps.current.externalCompanyFilterId).toBe('company-a');
  });

  it('visão global (companyFilterId=null): as três listas recebem null (nunca undefined)', () => {
    m.useCompanyScopeFilter.mockReturnValue(scopeFilterResult({ companyFilterId: null }));
    render(<ContextualUsersTabContent {...BASE_PROPS} />);
    expect(m.activeUserListProps.current.externalCompanyFilterId).toBeNull();
    expect(m.inactiveUserListProps.current.externalCompanyFilterId).toBeNull();
    expect(m.inviteListProps.current.externalCompanyFilterId).toBeNull();
  });
});

describe('ContextualUsersTabContent — flags continuam controlando quais listas montam', () => {
  it('activeUsersEnabled=false: ActiveUserList nunca monta, mas o seletor e InviteList continuam', () => {
    render(<ContextualUsersTabContent {...BASE_PROPS} activeUsersEnabled={false} />);
    expect(screen.queryByTestId('active-user-list-stub')).toBeNull();
    expect(screen.getByTestId('company-scope-filter-stub')).toBeInTheDocument();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });

  it('userLifecycleEnabled=false: InactiveUserList nunca monta', () => {
    render(<ContextualUsersTabContent {...BASE_PROPS} userLifecycleEnabled={false} />);
    expect(screen.queryByTestId('inactive-user-list-stub')).toBeNull();
  });

  it('ambas desligadas: seletor e InviteList continuam (única superfície real restante)', () => {
    render(<ContextualUsersTabContent {...BASE_PROPS} activeUsersEnabled={false} userLifecycleEnabled={false} />);
    expect(screen.getByTestId('company-scope-filter-stub')).toBeInTheDocument();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });
});
