// tests/screens/ScreenAjustesInvites.test.tsx — guard da área Usuários
// dentro de ScreenAjustes (M1-F S4-F2/S4-F3). InviteList é stubado aqui
// (seu comportamento interno — listagem, reenvio, cancelamento — já é
// coberto em tests/components/invites/InviteList.test.tsx) — este arquivo
// cobre exclusivamente QUEM chega a ver a aba/o componente e QUAL actor é
// repassado a ele.
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
  inviteListProps: { current: null as any },
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

// Stub da lista real: só grava os props recebidos, nenhum comportamento
// interno (isso já é testado em InviteList.test.tsx).
vi.mock('@/components/invites/InviteList', () => ({
  InviteList: (props: any) => {
    m.inviteListProps.current = props;
    return <div data-testid="invite-list-stub">lista de convites</div>;
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

beforeEach(() => {
  m.user.current = null;
  m.inviteListProps.current = null;
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

describe('ScreenAjustes — quem vê a área Usuários (M1-F S4-F2/S4-F3)', () => {
  it('Super Admin ativo vê a lista de convites', () => {
    m.user.current = { id: 'u-sa', name: 'Super', email: 'sa@test.local', role: 'seller', sellerId: null, companyId: null, platformRole: 'super_admin', activeMembership: null };
    openUsuarios();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });

  it('Manager com membership ATIVA vê a lista de convites', () => {
    m.user.current = { id: 'u-mgr', name: 'Manager', email: 'mgr@test.local', role: 'manager', sellerId: null, companyId: 'company-a', platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager' } };
    openUsuarios();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });

  it('Seller não vê a aba Usuários, logo nunca vê a lista', () => {
    m.user.current = { id: 'u-sel', name: 'Seller', email: 'sel@test.local', role: 'seller', sellerId: 's1', companyId: 'company-a', platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller' } };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByTestId('invite-list-stub')).toBeNull();
  });

  it('Manager com membership INATIVA não vê a aba Usuários nem a lista', () => {
    m.user.current = { id: 'u-mgr2', name: 'Manager', email: 'mgr2@test.local', role: 'manager', sellerId: null, companyId: 'company-a', platformRole: null, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByTestId('invite-list-stub')).toBeNull();
  });

  it('admin legado (canAccessFullSettings) SEM Super Admin/membership de manager real: vê a aba, InviteList recebe actor=null (não renderiza nada por dentro)', () => {
    m.user.current = { id: 'u-admin', name: 'Admin', email: 'admin@test.local', role: 'admin', sellerId: null, companyId: 'company-a', platformRole: null, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);
    fireEvent.click(screen.getByText('Usuários'));
    expect(m.inviteListProps.current.actor).toBeNull();
  });

  it('usuário nulo (sem sessão/inativo): nem a tela renderiza conteúdo autorizado', () => {
    m.user.current = null;
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByTestId('invite-list-stub')).toBeNull();
  });
});

describe('ScreenAjustes — actor repassado a InviteList', () => {
  it('Super Admin: actor={kind: super_admin}, userId correto', () => {
    m.user.current = { id: 'u-sa', name: 'Super', email: 'sa@test.local', role: 'seller', sellerId: null, companyId: null, platformRole: 'super_admin', activeMembership: null };
    openUsuarios();
    expect(m.inviteListProps.current.actor).toEqual({ kind: 'super_admin' });
    expect(m.inviteListProps.current.userId).toBe('u-sa');
  });

  it('Manager: actor.companyId vem de activeMembership, nunca de companyId legado', () => {
    m.user.current = {
      id: 'u-mgr', name: 'Manager', email: 'mgr@test.local', role: 'manager', sellerId: null,
      companyId: 'company-LEGADO-diferente', // deve ser ignorado
      platformRole: null,
      activeMembership: { companyId: 'company-membership-real', role: 'manager' },
    };
    openUsuarios();
    expect(m.inviteListProps.current.actor).toEqual({ kind: 'manager', companyId: 'company-membership-real' });
  });
});
