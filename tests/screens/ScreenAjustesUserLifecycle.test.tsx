// tests/screens/ScreenAjustesUserLifecycle.test.tsx — guard/rollout da
// interface de ciclo de vida empresarial (M1-F S6-F) dentro de ScreenAjustes.
// ActiveUserList/InactiveUserList/InviteList são stubados (comportamento
// interno já coberto em seus próprios arquivos de teste) — este arquivo
// cobre exclusivamente: (1) a flag NEXT_PUBLIC_FF_USER_LIFECYCLE só tem
// efeito combinada com ACTIVE_USERS, (2) InactiveUserList recebe o mesmo
// actor/userId que ActiveUserList/InviteList, (3) a ordem no DOM é sempre
// Usuários ativos → Usuários suspensos e desligados → Convites, (4)
// ActiveUserList recebe lifecycleEnabled corretamente combinado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PipelineStage } from '@/lib/pipeline/adapter';

const m = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  useReorderStages: vi.fn(),
  reorderStagesLocal: vi.fn(),
  getStages: vi.fn(),
  user: { current: null as any },
  activeUsersFlag: { current: false },
  userLifecycleFlag: { current: false },
  inviteListProps: { current: null as any },
  activeUserListProps: { current: null as any },
  inactiveUserListProps: { current: null as any },
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({ usePipelineStages: m.usePipelineStages }));

vi.mock('@/lib/hooks/useReorderStages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useReorderStages')>();
  return { ...actual, useReorderStages: m.useReorderStages };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — ScreenAjustes agora consome
// OperationalCompanyContext (aba Empresa). mode:'none' preserva 100% o
// comportamento anterior (Manager continua via activeMembership.companyId).
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => ({
    mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false,
  }),
}));
vi.mock('@/components/podiums/Podiums', () => ({ PLACE: {} }));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...actual,
    isActiveUsersEnabled: () => m.activeUsersFlag.current,
    isUserLifecycleEnabled: () => m.userLifecycleFlag.current,
  };
});

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  CompanyService: { get: () => ({ name: 'Loja', cnpj: '', phone: '', timezone: '' }), update: () => {} },
  PipelineService: { reorderStages: m.reorderStagesLocal, getStages: m.getStages },
}));

vi.mock('@/components/invites/InviteList', () => ({
  InviteList: (props: any) => { m.inviteListProps.current = props; return <div data-testid="invite-list-stub" />; },
}));

vi.mock('@/components/users/ActiveUserList', () => ({
  ActiveUserList: (props: any) => { m.activeUserListProps.current = props; return <div data-testid="active-user-list-stub" />; },
}));

vi.mock('@/components/users/InactiveUserList', () => ({
  InactiveUserList: (props: any) => { m.inactiveUserListProps.current = props; return <div data-testid="inactive-user-list-stub" />; },
}));

import { ScreenAjustes } from '@/components/screens/ScreensBiz';

function pipelineResult(over: Partial<Record<string, unknown>> = {}) {
  const stages = (over.stages as PipelineStage[] | undefined) ?? [];
  return {
    source: 'local', remoteStagesEnabled: false, queryEnabled: false,
    queryKey: ['k'], stages, byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: stages.length > 0,
    refetch: vi.fn(),
    ...over,
  };
}

const SUPER_ADMIN_USER = { id: 'u-sa', name: 'Super', email: 'sa@test.local', platformRole: 'super_admin', activeMembership: null };
const MANAGER_USER = { id: 'u-mgr', name: 'Manager', email: 'mgr@test.local', platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };

beforeEach(() => {
  m.user.current = null;
  m.activeUsersFlag.current = false;
  m.userLifecycleFlag.current = false;
  m.inviteListProps.current = null;
  m.activeUserListProps.current = null;
  m.inactiveUserListProps.current = null;
  m.getStages.mockReturnValue([]);
  m.usePipelineStages.mockReturnValue(pipelineResult());
  m.useReorderStages.mockReturnValue({
    reorderStages: vi.fn().mockResolvedValue({ ok: true }),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  });
});

function openUsuarios() {
  render(<ScreenAjustes go={() => {}} />);
  fireEvent.click(screen.getByText('Usuários'));
}

describe('ScreenAjustes — rollout do ciclo de vida empresarial (M1-F S6-F)', () => {
  it('ACTIVE_USERS ligada, USER_LIFECYCLE desligada: InactiveUserList nunca monta, ActiveUserList recebe lifecycleEnabled=false', () => {
    m.activeUsersFlag.current = true;
    m.userLifecycleFlag.current = false;
    m.user.current = SUPER_ADMIN_USER;
    openUsuarios();
    expect(screen.queryByTestId('inactive-user-list-stub')).toBeNull();
    expect(m.activeUserListProps.current.lifecycleEnabled).toBe(false);
  });

  it('ACTIVE_USERS desligada, USER_LIFECYCLE ligada: nenhuma das duas seções de ciclo de vida aparece (USER_LIFECYCLE sozinha não basta)', () => {
    m.activeUsersFlag.current = false;
    m.userLifecycleFlag.current = true;
    m.user.current = SUPER_ADMIN_USER;
    openUsuarios();
    expect(screen.queryByTestId('active-user-list-stub')).toBeNull();
    expect(screen.queryByTestId('inactive-user-list-stub')).toBeNull();
    // InviteList continua funcionando normalmente (sem regressão).
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });

  it('ambas ligadas + Super Admin: InactiveUserList monta com o actor correto, ActiveUserList recebe lifecycleEnabled=true', () => {
    m.activeUsersFlag.current = true;
    m.userLifecycleFlag.current = true;
    m.user.current = SUPER_ADMIN_USER;
    openUsuarios();
    expect(screen.getByTestId('inactive-user-list-stub')).toBeInTheDocument();
    expect(m.inactiveUserListProps.current.actor).toEqual({ kind: 'super_admin' });
    expect(m.inactiveUserListProps.current.userId).toBe('u-sa');
    expect(m.activeUserListProps.current.lifecycleEnabled).toBe(true);
  });

  it('ambas ligadas + Manager: InactiveUserList monta com actor de empresa', () => {
    m.activeUsersFlag.current = true;
    m.userLifecycleFlag.current = true;
    m.user.current = MANAGER_USER;
    openUsuarios();
    expect(m.inactiveUserListProps.current.actor).toEqual({ kind: 'manager', companyId: 'company-a' });
  });

  it('ordem no DOM: Usuários ativos → Usuários suspensos e desligados → Convites', () => {
    m.activeUsersFlag.current = true;
    m.userLifecycleFlag.current = true;
    m.user.current = SUPER_ADMIN_USER;
    openUsuarios();
    const activeEl = screen.getByTestId('active-user-list-stub');
    const inactiveEl = screen.getByTestId('inactive-user-list-stub');
    const invitesEl = screen.getByTestId('invite-list-stub');
    // eslint-disable-next-line no-bitwise
    expect(activeEl.compareDocumentPosition(inactiveEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(inactiveEl.compareDocumentPosition(invitesEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('InactiveUserList recebe exatamente o mesmo userId/actor que ActiveUserList/InviteList', () => {
    m.activeUsersFlag.current = true;
    m.userLifecycleFlag.current = true;
    m.user.current = MANAGER_USER;
    openUsuarios();
    expect(m.inactiveUserListProps.current.userId).toBe(m.activeUserListProps.current.userId);
    expect(m.inactiveUserListProps.current.actor).toEqual(m.activeUserListProps.current.actor);
    expect(m.inviteListProps.current.userId).toBe(m.activeUserListProps.current.userId);
  });
});
