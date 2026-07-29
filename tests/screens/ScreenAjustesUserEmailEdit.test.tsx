// tests/screens/ScreenAjustesUserEmailEdit.test.tsx — rollout da ação
// "Alterar e-mail" dentro de ScreenAjustes (M1-F S5-E1-B). ActiveUserList é
// stubado aqui (comportamento interno da ação já coberto em
// tests/components/users/ActiveUserList.test.tsx) — este arquivo cobre
// exclusivamente: a combinação das DUAS flags (NEXT_PUBLIC_FF_ACTIVE_USERS
// e NEXT_PUBLIC_FF_USER_EMAIL_EDIT) é corretamente repassada como o prop
// userEmailEditEnabled de ActiveUserList.
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
  userEmailEditFlag: { current: false },
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
  return {
    ...actual,
    isActiveUsersEnabled: () => m.activeUsersFlag.current,
    isUserEmailEditEnabled: () => m.userEmailEditFlag.current,
  };
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

vi.mock('@/components/invites/InviteList', () => ({
  InviteList: () => <div data-testid="invite-list-stub">lista de convites</div>,
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

const SUPER_ADMIN_USER = { id: 'u-sa', name: 'Super', email: 'sa@test.local', platformRole: 'super_admin', activeMembership: null };

beforeEach(() => {
  m.user.current = SUPER_ADMIN_USER;
  m.activeUsersFlag.current = false;
  m.userEmailEditFlag.current = false;
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

describe('ScreenAjustes — rollout combinado de "Alterar e-mail" (M1-F S5-E1-B)', () => {
  it('ACTIVE_USERS false: ActiveUserList nem monta (independente de USER_EMAIL_EDIT)', () => {
    m.activeUsersFlag.current = false;
    m.userEmailEditFlag.current = true;
    openUsuarios();
    expect(screen.queryByTestId('active-user-list-stub')).toBeNull();
  });

  it('ACTIVE_USERS true + USER_EMAIL_EDIT false: ActiveUserList monta com userEmailEditEnabled=false', () => {
    m.activeUsersFlag.current = true;
    m.userEmailEditFlag.current = false;
    openUsuarios();
    expect(screen.getByTestId('active-user-list-stub')).toBeInTheDocument();
    expect(m.activeUserListProps.current.userEmailEditEnabled).toBe(false);
  });

  it('ambas true: ActiveUserList monta com userEmailEditEnabled=true', () => {
    m.activeUsersFlag.current = true;
    m.userEmailEditFlag.current = true;
    openUsuarios();
    expect(screen.getByTestId('active-user-list-stub')).toBeInTheDocument();
    expect(m.activeUserListProps.current.userEmailEditEnabled).toBe(true);
  });

  it('ACTIVE_USERS false + USER_EMAIL_EDIT true: nunca chega a passar userEmailEditEnabled=true para lugar nenhum (componente nem monta)', () => {
    m.activeUsersFlag.current = false;
    m.userEmailEditFlag.current = true;
    openUsuarios();
    expect(m.activeUserListProps.current).toBeNull();
  });
});
