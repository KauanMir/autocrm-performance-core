// tests/screens/ScreenAjustesMetaIntegrations.test.tsx — META-MVP2.
// Quem vê a aba "Integrações": flag ligada E (Super Admin com empresa aberta,
// para habilitar) OU (Manager com a empresa HABILITADA). Seller nunca. Pilotos
// ficam inalterados enquanto a empresa não for habilitada (padrão). A seção em si é stubada —
// o comportamento dela tem cobertura própria em
// tests/components/integrations/MetaIntegrationsTabSection.test.tsx.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// META-MVP1: o painel de operação tem testes próprios
// (tests/components/integrations/MetaLeadOpsPanel.test.tsx).
vi.mock('@/components/integrations/MetaLeadOpsPanel', () => ({ MetaLeadOpsPanel: () => null }));
import { render, screen, fireEvent } from '@testing-library/react';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import { META_OAUTH_REVIEW_TEST_COMPANY_ID } from '@/lib/capabilities';

const OTHER_COMPANY_ID = 'company-a';

const m = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  useReorderStages: vi.fn(),
  operational: { current: { mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false } as any },
  user: { current: null as any },
  leadAdsEnabled: { current: false },
  accessCalls: [] as { companyId: string | null; authorized: boolean }[],
  getAllLeads: vi.fn(() => [] as unknown[]),
}));

vi.mock('@/lib/hooks/useMetaLeadOps', () => ({
  useMetaLeadAdsAccess: (companyId: string | null, authorized: boolean) => {
    m.accessCalls.push({ companyId, authorized });
    return { data: authorized ? m.leadAdsEnabled.current : undefined, isLoading: false };
  },
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
    <div data-testid="meta-integrations-tab-stub" data-company={String(props.companyId)}
      data-super-admin={String(props.isSuperAdmin)} data-lead-ads-enabled={String(props.leadAdsEnabled)} />
  ),
}));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.getAllLeads() },
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
  m.leadAdsEnabled.current = false;
  m.accessCalls.length = 0;
  m.operational.current = { mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false };
  m.usePipelineStages.mockReturnValue(pipelineResult());
  m.useReorderStages.mockReturnValue({
    reorderStages: vi.fn().mockResolvedValue({ ok: true }),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  });
});


describe('aba Integrações — feature flag dedicada', () => {
  it('flag ausente + Super Admin na company de teste -> NÃO vê a aba', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', undefined as unknown as string);
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it("flag 'false' + Super Admin -> NÃO vê a aba", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it("flag 'false' + Manager com Lead Ads habilitado -> NÃO vê a aba", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    m.leadAdsEnabled.current = true;
    m.user.current = manager(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });
});

describe('aba Integrações — visibilidade multiempresa (META-MVP2)', () => {
  it('1. Super Admin na company de teste -> VÊ a aba, a seção e o diagnóstico de teste', () => {
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(META_OAUTH_REVIEW_TEST_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    fireEvent.click(screen.getByText('Integrações'));
    const stub = screen.getByTestId('meta-integrations-tab-stub');
    expect(stub).toHaveAttribute('data-company', META_OAUTH_REVIEW_TEST_COMPANY_ID);
    expect(stub).toHaveAttribute('data-super-admin', 'true');
    expect(screen.getByTestId('whatsapp-diagnostics-panel')).toBeInTheDocument();
  });

  it('2. Super Admin em OUTRA company -> VÊ a aba (para habilitar), sem diagnóstico de teste', () => {
    m.user.current = superAdminGlobal();
    m.operational.current = operationalSuperAdmin(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    fireEvent.click(screen.getByText('Integrações'));
    const stub = screen.getByTestId('meta-integrations-tab-stub');
    expect(stub).toHaveAttribute('data-company', OTHER_COMPANY_ID);
    expect(stub).toHaveAttribute('data-lead-ads-enabled', 'false');
    expect(screen.queryByTestId('whatsapp-diagnostics-panel')).toBeNull();
  });

  it('3. Super Admin global (sem empresa aberta) -> NÃO vê a aba', () => {
    m.user.current = superAdminGlobal();
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
  });

  it('4. Manager com a empresa DESABILITADA (padrão) -> NÃO vê a aba (pilotos inalterados)', () => {
    m.user.current = manager(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    for (const label of ['Empresa', 'Usuários', 'Follow-ups']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('Integrações')).toBeNull();
    expect(m.accessCalls.at(-1)).toEqual({ companyId: OTHER_COMPANY_ID, authorized: true });
  });

  it('5. Manager com a empresa HABILITADA -> VÊ a aba da própria empresa, sem controle de habilitação', () => {
    m.leadAdsEnabled.current = true;
    m.user.current = manager(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    fireEvent.click(screen.getByText('Integrações'));
    const stub = screen.getByTestId('meta-integrations-tab-stub');
    expect(stub).toHaveAttribute('data-company', OTHER_COMPANY_ID);
    expect(stub).toHaveAttribute('data-super-admin', 'false');
    expect(stub).toHaveAttribute('data-lead-ads-enabled', 'true');
  });

  it('6. Seller -> NUNCA vê a aba e nem consulta a habilitação, mesmo com a empresa habilitada', () => {
    m.leadAdsEnabled.current = true;
    m.user.current = seller(OTHER_COMPANY_ID);
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Integrações')).toBeNull();
    expect(m.accessCalls.every((call) => call.authorized === false)).toBe(true);
  });
});

// Achado com navegador real: a volta do OAuth abre Ajustes direto, antes de existir
// o espelho de leads. LeadService.getAll() lança e derrubava a tela do Manager.
describe('volta do OAuth abre Ajustes antes do espelho de leads (META-MVP2)', () => {
  const managerA = () => ({ ...m.user.current, activeMembership: { companyId: OTHER_COMPANY_ID, role: 'manager', sellerId: null } });

  afterEach(() => {
    m.getAllLeads.mockReset();
    m.getAllLeads.mockImplementation(() => []);
  });

  it('sem espelho: a tela renderiza e a aba Integrações continua disponível', async () => {
    const { RemoteLeadsError } = await import('@/lib/leads/errors');
    m.getAllLeads.mockImplementation(() => { throw new RemoteLeadsError('remote_leads_snapshot_unavailable'); });
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
    m.user.current = managerA();
    m.leadAdsEnabled.current = true;
    m.operational.current = { mode: 'membership', companyId: OTHER_COMPANY_ID, identity: { status: 'ready' }, isReadOnly: false };
    expect(() => render(<ScreenAjustes go={() => {}} />)).not.toThrow();
    expect(screen.getByRole('button', { name: 'Integrações' })).toBeInTheDocument();
  });

  it('outro erro de leads continua aparecendo: não é engolido', async () => {
    const { RemoteLeadsError } = await import('@/lib/leads/errors');
    m.getAllLeads.mockImplementation(() => { throw new RemoteLeadsError('remote_leads_invalid_context'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.user.current = managerA();
    m.operational.current = { mode: 'membership', companyId: OTHER_COMPANY_ID, identity: { status: 'ready' }, isReadOnly: false };
    expect(() => render(<ScreenAjustes go={() => {}} />)).toThrow('remote_leads_invalid_context');
  });
});
