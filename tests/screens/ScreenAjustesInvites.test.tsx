// tests/screens/ScreenAjustesInvites.test.tsx — guard do botão "Convidar"
// e do InviteUserModal dentro de ScreenAjustes (M1-F S4-F2). O modal real é
// stubado aqui (seu comportamento interno já é coberto em
// tests/components/invites/InviteUserModal.test.tsx) — este arquivo cobre
// exclusivamente QUEM vê o botão e QUAL actor chega até o modal.
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
  inviteModalProps: { current: null as any },
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

// Stub do modal real: só grava os props recebidos, nenhum comportamento
// interno (isso já é testado em InviteUserModal.test.tsx).
vi.mock('@/components/invites/InviteUserModal', () => ({
  InviteUserModal: (props: any) => {
    m.inviteModalProps.current = props;
    return (
      <div data-testid="invite-modal-stub">
        modal aberto
        <button onClick={props.onClose}>fechar-stub</button>
      </div>
    );
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
  m.inviteModalProps.current = null;
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

describe('ScreenAjustes — botão "Convidar" por ator (M1-F S4-F2)', () => {
  it('Super Admin ativo vê o botão Convidar', () => {
    m.user.current = { id: 'u-sa', name: 'Super', email: 'sa@test.local', role: 'seller', sellerId: null, companyId: null, platformRole: 'super_admin', activeMembership: null };
    openUsuarios();
    expect(screen.getByText('Convidar')).toBeInTheDocument();
  });

  it('Manager com membership ATIVA vê o botão Convidar', () => {
    m.user.current = { id: 'u-mgr', name: 'Manager', email: 'mgr@test.local', role: 'manager', sellerId: null, companyId: 'company-a', platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager' } };
    openUsuarios();
    expect(screen.getByText('Convidar')).toBeInTheDocument();
  });

  it('Seller não vê a aba Usuários, logo nunca vê o botão', () => {
    m.user.current = { id: 'u-sel', name: 'Seller', email: 'sel@test.local', role: 'seller', sellerId: 's1', companyId: 'company-a', platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller' } };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByText('Convidar')).toBeNull();
  });

  it('Manager com membership INATIVA não vê a aba Usuários nem o botão', () => {
    m.user.current = { id: 'u-mgr2', name: 'Manager', email: 'mgr2@test.local', role: 'manager', sellerId: null, companyId: 'company-a', platformRole: null, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByText('Convidar')).toBeNull();
  });

  it('admin legado (canAccessFullSettings) SEM Super Admin/membership de manager real: vê a aba mas NÃO o botão (backend também não autorizaria)', () => {
    m.user.current = { id: 'u-admin', name: 'Admin', email: 'admin@test.local', role: 'admin', sellerId: null, companyId: 'company-a', platformRole: null, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);
    fireEvent.click(screen.getByText('Usuários'));
    expect(screen.queryByText('Convidar')).toBeNull();
  });

  it('usuário nulo (sem sessão/inativo): nem a tela renderiza conteúdo autorizado', () => {
    m.user.current = null;
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Convidar')).toBeNull();
  });
});

describe('ScreenAjustes — abertura do modal e actor repassado', () => {
  it('clicar Convidar abre o modal (Super Admin)', () => {
    m.user.current = { id: 'u-sa', name: 'Super', email: 'sa@test.local', role: 'seller', sellerId: null, companyId: null, platformRole: 'super_admin', activeMembership: null };
    openUsuarios();
    fireEvent.click(screen.getByText('Convidar'));
    expect(screen.getByTestId('invite-modal-stub')).toBeInTheDocument();
    expect(m.inviteModalProps.current.actor).toEqual({ kind: 'super_admin' });
    expect(m.inviteModalProps.current.userId).toBe('u-sa');
  });

  it('clicar Convidar abre o modal (Manager) com actor.companyId vindo de activeMembership, nunca de companyId legado', () => {
    m.user.current = {
      id: 'u-mgr', name: 'Manager', email: 'mgr@test.local', role: 'manager', sellerId: null,
      companyId: 'company-LEGADO-diferente', // deve ser ignorado
      platformRole: null,
      activeMembership: { companyId: 'company-membership-real', role: 'manager' },
    };
    openUsuarios();
    fireEvent.click(screen.getByText('Convidar'));
    expect(m.inviteModalProps.current.actor).toEqual({ kind: 'manager', companyId: 'company-membership-real' });
  });

  it('modal fechado por padrão; onClose remove o modal', () => {
    m.user.current = { id: 'u-sa', name: 'Super', email: 'sa@test.local', role: 'seller', sellerId: null, companyId: null, platformRole: 'super_admin', activeMembership: null };
    openUsuarios();
    expect(screen.queryByTestId('invite-modal-stub')).toBeNull();
    fireEvent.click(screen.getByText('Convidar'));
    expect(screen.getByTestId('invite-modal-stub')).toBeInTheDocument();
    fireEvent.click(screen.getByText('fechar-stub'));
    expect(screen.queryByTestId('invite-modal-stub')).toBeNull();
  });
});
