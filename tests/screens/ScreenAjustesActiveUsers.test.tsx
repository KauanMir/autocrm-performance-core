// tests/screens/ScreenAjustesActiveUsers.test.tsx — guard/rollout da seção
// "Usuários ativos" dentro de ScreenAjustes (M1-F S5-D). ActiveUserList e
// InviteList são stubados aqui (comportamento interno já coberto em
// tests/components/users/ActiveUserList.test.tsx e
// tests/components/invites/InviteList.test.tsx) — este arquivo cobre
// exclusivamente: (1) a flag de rollout controla se o bloco aparece, (2)
// qual actor é repassado, (3) InviteList nunca regride (continua
// aparecendo, sempre ABAIXO de ActiveUserList).
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
  flag: { current: false },
  inviteListProps: { current: null as any },
  activeUserListProps: { current: null as any },
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({
  usePipelineStages: m.usePipelineStages,
}));

vi.mock('@/lib/hooks/useReorderStages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useReorderStages')>();
  return { ...actual, useReorderStages: m.useReorderStages };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/components/podiums/Podiums', () => ({ PLACE: {} }));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isActiveUsersEnabled: () => m.flag.current };
});

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  CompanyService: {
    get: () => ({ name: 'Loja', cnpj: '', phone: '', timezone: '' }),
    update: () => {},
  },
  PipelineService: { reorderStages: m.reorderStagesLocal, getStages: m.getStages },
}));

// Stubs — só gravam props recebidos, nenhum comportamento interno.
vi.mock('@/components/invites/InviteList', () => ({
  InviteList: (props: any) => {
    m.inviteListProps.current = props;
    return <div data-testid="invite-list-stub">lista de convites</div>;
  },
}));

vi.mock('@/components/users/ActiveUserList', () => ({
  ActiveUserList: (props: any) => {
    m.activeUserListProps.current = props;
    return <div data-testid="active-user-list-stub">usuários ativos</div>;
  },
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

const SUPER_ADMIN_USER = { id: 'u-sa', name: 'Super', email: 'sa@test.local', role: 'seller', sellerId: null, platformRole: 'super_admin', activeMembership: null };
const MANAGER_USER = { id: 'u-mgr', name: 'Manager', email: 'mgr@test.local', role: 'manager', sellerId: null, platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager' } };
const SELLER_USER = { id: 'u-sel', name: 'Seller', email: 'sel@test.local', role: 'seller', sellerId: 's1', platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller' } };

beforeEach(() => {
  m.user.current = null;
  m.flag.current = false;
  m.inviteListProps.current = null;
  m.activeUserListProps.current = null;
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

describe('ScreenAjustes — rollout de "Usuários ativos" (M1-F S5-D)', () => {
  it('flag DESLIGADA (produção sem as migrations aplicadas): ActiveUserList nunca é montado, mesmo para Super Admin — InviteList continua normal (sem regressão)', () => {
    m.flag.current = false;
    m.user.current = SUPER_ADMIN_USER;
    openUsuarios();
    expect(screen.queryByTestId('active-user-list-stub')).toBeNull();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
    expect(m.activeUserListProps.current).toBeNull();
  });

  it('flag LIGADA + Super Admin: ActiveUserList é montado com o actor correto', () => {
    m.flag.current = true;
    m.user.current = SUPER_ADMIN_USER;
    openUsuarios();
    expect(screen.getByTestId('active-user-list-stub')).toBeInTheDocument();
    expect(m.activeUserListProps.current.actor).toEqual({ kind: 'super_admin' });
    expect(m.activeUserListProps.current.userId).toBe('u-sa');
  });

  it('flag LIGADA + Manager com membership ativa: ActiveUserList monta com actor de empresa', () => {
    m.flag.current = true;
    m.user.current = MANAGER_USER;
    openUsuarios();
    expect(screen.getByTestId('active-user-list-stub')).toBeInTheDocument();
    expect(m.activeUserListProps.current.actor).toEqual({ kind: 'manager', companyId: 'company-a' });
  });

  it('flag LIGADA + Seller: aba Usuários nem aparece, logo ActiveUserList nunca monta', () => {
    m.flag.current = true;
    m.user.current = SELLER_USER;
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByTestId('active-user-list-stub')).toBeNull();
  });

  it('flag LIGADA: "Usuários ativos" (ActiveUserList) sempre aparece ANTES de "Convites" (InviteList) no DOM', () => {
    m.flag.current = true;
    m.user.current = SUPER_ADMIN_USER;
    openUsuarios();
    const activeUsersEl = screen.getByTestId('active-user-list-stub');
    const invitesEl = screen.getByTestId('invite-list-stub');
    // DOCUMENT_POSITION_FOLLOWING (4): activeUsersEl vem antes de invitesEl.
    // eslint-disable-next-line no-bitwise
    expect(activeUsersEl.compareDocumentPosition(invitesEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('InviteList recebe exatamente o mesmo userId/actor que ActiveUserList (nenhuma divergência de escopo entre as duas seções)', () => {
    m.flag.current = true;
    m.user.current = MANAGER_USER;
    openUsuarios();
    expect(m.inviteListProps.current.userId).toBe(m.activeUserListProps.current.userId);
    expect(m.inviteListProps.current.actor).toEqual(m.activeUserListProps.current.actor);
  });
});
