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

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — ScreenAjustes agora consome
// OperationalCompanyContext (aba Empresa). mode:'none' preserva 100% o
// comportamento anterior (Manager continua via activeMembership.companyId).
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => ({
    mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false,
  }),
}));

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
    m.user.current = { id: 'u-sa', name: 'Super', email: 'sa@test.local', platformRole: 'super_admin', activeMembership: null };
    openUsuarios();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });

  it('Manager com membership ATIVA vê a lista de convites', () => {
    m.user.current = { id: 'u-mgr', name: 'Manager', email: 'mgr@test.local', platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
    openUsuarios();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });

  it('Seller não vê a aba Usuários, logo nunca vê a lista', () => {
    m.user.current = { id: 'u-sel', name: 'Seller', email: 'sel@test.local', platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByTestId('invite-list-stub')).toBeNull();
  });

  it('Manager com membership INATIVA não vê a aba Usuários nem a lista', () => {
    m.user.current = { id: 'u-mgr2', name: 'Manager', email: 'mgr2@test.local', platformRole: null, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByTestId('invite-list-stub')).toBeNull();
  });

  it('M1-F S8-B1/S8-D2-A: sem platformRole/activeMembership não vê NENHUMA aba, nem Usuários — canAccessFullSettings nunca leu role, que agora nem existe mais no tipo', () => {
    // Fixture desatualizado por construção: antes desta migração,
    // canAccessFullSettings(role==='admin') bundlava a aba Usuários mesmo
    // sem actor resolvível, forçando InviteList a receber actor=null como
    // defesa em profundidade. Após S8-B1 esse estado intermediário é
    // estruturalmente impossível — quem tem fullSettingsAccess é sempre
    // platformRole==='super_admin', e esse ator SEMPRE resolve
    // inviteActor={kind:'super_admin'} (nunca null). O cenário real
    // remanescente é mais forte: sem identidade empresarial reconhecida,
    // nenhum acesso, nem a aba aparece.
    m.user.current = { id: 'u-admin', name: 'Admin', email: 'admin@test.local', platformRole: null, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByTestId('invite-list-stub')).toBeNull();
  });

  it('usuário nulo (sem sessão/inativo): nem a tela renderiza conteúdo autorizado', () => {
    m.user.current = null;
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByTestId('invite-list-stub')).toBeNull();
  });
});

describe('ScreenAjustes — actor repassado a InviteList', () => {
  it('Super Admin: actor={kind: super_admin}, userId correto', () => {
    m.user.current = { id: 'u-sa', name: 'Super', email: 'sa@test.local', platformRole: 'super_admin', activeMembership: null };
    openUsuarios();
    expect(m.inviteListProps.current.actor).toEqual({ kind: 'super_admin' });
    expect(m.inviteListProps.current.userId).toBe('u-sa');
  });

  it('Manager: actor.companyId vem de activeMembership', () => {
    m.user.current = {
      id: 'u-mgr', name: 'Manager', email: 'mgr@test.local',
      platformRole: null,
      activeMembership: { companyId: 'company-membership-real', role: 'manager', sellerId: null },
    };
    openUsuarios();
    expect(m.inviteListProps.current.actor).toEqual({ kind: 'manager', companyId: 'company-membership-real' });
  });
});
