// tests/screens/ScreenAjustesMetaIntegrations.test.tsx — META-OAUTH-REVIEW-UI.
// Quem vê a aba "Integrações" de ScreenAjustes: SOMENTE Super Admin operando
// explicitamente no contexto da company de teste fixa (App Review da Meta).
// Nenhum Manager/Seller (mesmo na company de teste), nenhum Super Admin em
// qualquer OUTRA company, nenhum piloto afetado. A seção em si é stubada —
// o comportamento dela tem cobertura própria em
// tests/components/integrations/MetaIntegrationsTabSection.test.tsx.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import { META_OAUTH_REVIEW_TEST_COMPANY_ID } from '@/lib/capabilities';

const OTHER_COMPANY_ID = 'company-a';

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
  CompetitionRewardsTabSection: () => <div data-testid="competition-tab-stub" />,
}));
vi.mock('@/components/competitionRewards/CompetitionRewardHistorySection', () => ({
  CompetitionRewardHistorySection: () => <div data-testid="competition-history-stub" />,
}));
vi.mock('@/components/integrations/MetaIntegrationsTabSection', () => ({
  MetaIntegrationsTabSection: (props: Record<string, unknown>) => (
    <div data-testid="meta-integrations-tab-stub" data-company={String(props.companyId)} />
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

function manager(companyId = OTHER_COMPANY_ID) {
  return { id: 'u-mgr', name: 'Gerente', email: 'mgr@t.local', platformRole: null, activeMembership: { companyId, role: 'manager', sellerId: null } };
}
function seller(companyId = OTHER_COMPANY_ID) {
  return { id: 'u-sel', name: 'Vendedor', email: 'sel@t.local', platformRole: null, activeMembership: { companyId, role: 'seller', sellerId: 's1' } };
}
function superAdminGlobal() {
  return { id: 'u-sa', name: 'Admin', email: 'sa@t.local', platformRole: 'super_admin', activeMembership: null };
}

function operationalSuperAdmin(companyId: string) {
  return { mode: 'super_admin', companyId, identity: { status: 'ready', company: { status: 'implantacao' } }, isReadOnly: false };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  m.user.current = null;
  m.operational.current = { mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false };
  m.usePipelineStages.mockReturnValue(pipelineResult());
  m.useReorderStages.mockReturnValue({
    reorderStages: vi.fn().mockResolvedValue({ ok: true }),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  });
});

describe('aba Integrações — feature flag dedicada (META-OAUTH-REVIEW-UI)', () => {
  it('flag ausente + Super Admin na company de teste -> NÃO vê a aba', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', undefined as unknown as string);
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it("flag 'false' + Super Admin na company de teste -> NÃO vê a aba", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it("flag 'true' + Super Admin na company de teste -> VÊ a aba", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.getByText('Integrações')).toBeInTheDocument();
  });

  it("flag 'true' + Super Admin em OUTRA company -> NÃO vê a aba", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it("flag 'true' + Manager na company de teste -> NÃO vê a aba", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
    m.user.current = manager(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });
});

describe('aba Integrações — visibilidade (META-OAUTH-REVIEW-UI)', () => {
  it('1. Super Admin operando na company de teste -> VÊ a aba e abre a seção com o companyId de teste', () => {
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    const tab = screen.getByText('Integrações');
    expect(tab).toBeInTheDocument();
    fireEvent.click(tab);
    const stub = screen.getByTestId('meta-integrations-tab-stub');
    expect(stub).toHaveAttribute('data-company', META_OAUTH_REVIEW_TEST_COMPANY_ID);
  });

  it('2. Super Admin operando em OUTRA company -> NÃO vê a aba (nem no DOM)', () => {
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
    expect(screen.queryByTestId('meta-integrations-tab-stub')).toBeNull();
  });

  it('3. Super Admin global (sem contexto operacional aberto) -> NÃO vê a aba', () => {
    m.user.current = superAdminGlobal();
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it('4. Manager na company de teste -> NÃO vê a aba, mesmo sendo a company certa', () => {
    m.user.current = manager(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
    expect(screen.queryByTestId('meta-integrations-tab-stub')).toBeNull();
  });

  it('5. Seller na company de teste -> NÃO vê a aba', () => {
    m.user.current = seller(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it('6. Manager em company comum (piloto real) -> nenhuma mudança: continua vendo as abas de sempre, sem Integrações', () => {
    m.user.current = manager(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    for (const label of ['Empresa', 'Usuários', 'Follow-ups']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('Integrações')).toBeNull();
  });
});
