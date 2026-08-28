// COMPETITION-REWARDS-V1-B2-EXEC §2/§45/§46/§47/§51 — quem vê a aba
// "Competição" de ScreenAjustes. Manager (membership ATIVA) sim; Seller
// não; Super Admin contextual não; Super Admin global (sem membership) não.
// A seção em si é stubada — o comportamento dela tem cobertura própria em
// tests/components/competitionRewards/CompetitionRewardsTabSection.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PipelineStage } from '@/lib/pipeline/adapter';

const m = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  useReorderStages: vi.fn(),
  operational: { current: { mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false } as any },
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({ usePipelineStages: m.usePipelineStages }));
vi.mock('@/lib/hooks/useReorderStages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useReorderStages')>();
  return { ...actual, useReorderStages: m.useReorderStages };
});
vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => m.operational.current,
}));
vi.mock('@/components/podiums/Podiums', () => ({ PLACE: {} }));
vi.mock('@/components/invites/InviteList', () => ({ InviteList: () => <div data-testid="invite-list-stub" /> }));
vi.mock('@/components/users/UsersTabSection', () => ({ UsersTabSection: () => <div data-testid="users-tab-stub" /> }));
vi.mock('@/components/followUpTemplates/FollowUpsTabSection', () => ({ FollowUpsTabSection: () => <div data-testid="followups-tab-stub" /> }));
vi.mock('@/components/competitionRewards/CompetitionRewardsTabSection', () => ({
  CompetitionRewardsTabSection: (props: Record<string, unknown>) => (
    <div data-testid="competition-tab-stub" data-company={String(props.companyId)} data-read={String(props.readAuthorized)} />
  ),
}));
vi.mock('@/components/competitionRewards/CompetitionRewardHistorySection', () => ({
  CompetitionRewardHistorySection: (props: Record<string, unknown>) => (
    <div data-testid="competition-history-stub" data-company={String(props.companyId)} data-role={String(props.membershipRole)} />
  ),
}));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  CompanyService: { get: () => ({ name: 'Loja', cnpj: '', phone: '', timezone: 'America/Sao_Paulo' }), update: () => {} },
  PipelineService: { reorderStages: () => {}, getStages: () => [] },
}));

import { ScreenAjustes } from '@/components/screens/ScreensBiz';

function pipelineResult(over: Partial<Record<string, unknown>> = {}) {
  const stages = (over.stages as PipelineStage[] | undefined) ?? [];
  return {
    source: 'local', remoteStagesEnabled: false, queryEnabled: false, queryKey: ['k'],
    stages, byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: stages.length > 0, refetch: vi.fn(),
    ...over,
  };
}

function manager(companyId = 'company-a') {
  return { id: 'u-mgr', name: 'Gerente', email: 'mgr@t.local', platformRole: null, activeMembership: { companyId, role: 'manager', sellerId: null } };
}
function seller() {
  return { id: 'u-sel', name: 'Vendedor', email: 'sel@t.local', platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } };
}
function superAdminGlobal() {
  return { id: 'u-sa', name: 'Admin', email: 'sa@t.local', platformRole: 'super_admin', activeMembership: null };
}

beforeEach(() => {
  m.user.current = null;
  m.operational.current = { mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false };
  m.usePipelineStages.mockReturnValue(pipelineResult());
  m.useReorderStages.mockReturnValue({
    reorderStages: vi.fn().mockResolvedValue({ ok: true }),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  });
});

describe('aba Competição — visibilidade (§2/§51)', () => {
  it('Manager com membership ATIVA vê a aba e abre a seção com companyId da membership', () => {
    m.user.current = manager('company-a');
    render(<ScreenAjustes go={() => {}} />);
    const tab = screen.getByText('Competição');
    expect(tab).toBeInTheDocument();
    fireEvent.click(tab);
    const stub = screen.getByTestId('competition-tab-stub');
    expect(stub).toHaveAttribute('data-company', 'company-a');
    expect(stub).toHaveAttribute('data-read', 'true');
  });

  it('Seller NÃO vê a aba Competição', () => {
    m.user.current = seller();
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Competição')).toBeNull();
  });

  it('Super Admin contextual (empresa aberta em /company/[id]) NÃO vê a aba de config', () => {
    m.user.current = superAdminGlobal();
    m.operational.current = { mode: 'super_admin', companyId: 'company-x', identity: { status: 'ready', company: { status: 'ativa' } }, isReadOnly: false };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Competição')).toBeNull();
  });

  it('Super Admin global (sem membership) NÃO vê a aba Competição', () => {
    m.user.current = superAdminGlobal();
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Competição')).toBeNull();
  });
});

describe('regressão — abas existentes preservadas (§48)', () => {
  it('Manager continua vendo Empresa / Usuários / Follow-ups além de Competição', () => {
    m.user.current = manager('company-a');
    render(<ScreenAjustes go={() => {}} />);
    for (const label of ['Empresa', 'Usuários', 'Follow-ups', 'Competição']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
