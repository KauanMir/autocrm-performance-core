// tests/commercial/PlatformCommercialOperationalMode.test.tsx — regressão do
// "Novo Lead não abre" observado em produção (2026-11-10, Super Admin dentro
// de /company/[id]). No modo operacional a empresa vem da URL e o seletor
// manual (CommercialCompanyContext) continua null. Antes da correção, os
// modais/detalhe comparavam esse null com company.id: o modal de criação se
// fechava no primeiro efeito e as ações do detalhe eram descartadas como
// "contexto trocado". Árvore REAL (CommercialCompanyProvider + tela + hooks);
// só a rede (supabase.rpc) e o contexto operacional são simulados.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  operationalCompanyId: { current: 'company-a' as string | null },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isSuperAdminCommercialWriteEnabled: () => true };
});

vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => ({
    mode: 'super_admin', companyId: m.operationalCompanyId.current,
    identity: { status: 'unavailable' }, isReadOnly: false,
  }),
}));

import { CommercialCompanyProvider } from '@/lib/commercial/CommercialCompanyContext';
import { PlatformCommercialClientsView } from '@/components/commercial/PlatformCommercialClientsView';

const COMPANY_A = { id: 'company-a', name: 'Empresa A', status: 'ativa' as const };
const COMPANY_B = { id: 'company-b', name: 'Empresa B', status: 'ativa' as const };
const STAGE_NEW = { id: 'stage-new', company_id: 'company-a', code: 'new', name: 'Novo', sort_order: 0, is_terminal: false, created_at: '', updated_at: '' };
const STAGE_QUALIFIED = { id: 'stage-qualified', company_id: 'company-a', code: 'qualified', name: 'Qualificado', sort_order: 1, is_terminal: false, created_at: '', updated_at: '' };

function baseLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1', company_id: 'company-a', name: 'Cliente Ficticio', phone: '11900000000', car: 'Onix',
    stage_id: 'stage-new', seller_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z',
    created_by_profile_id: null, updated_at: '2026-01-01T00:00:00Z', updated_by_profile_id: null,
    urgency: 'red', temperature: null, payment_preference: null, source: null, value_amount: null,
    phone_digits: '11900000000', alert_label: null, last_activity_label: null, version: 1,
    ...overrides,
  };
}

let leadsActive: Record<string, unknown>[];

beforeEach(() => {
  m.operationalCompanyId.current = 'company-a';
  leadsActive = [baseLead()];
  m.rpc.mockReset();
  m.rpc.mockImplementation((fn: string, args: Record<string, unknown> = {}) => {
    switch (fn) {
      case 'list_commercial_companies':
        return Promise.resolve({ data: [COMPANY_A, COMPANY_B], error: null });
      case 'list_pipeline_stages_for_company':
        return Promise.resolve({ data: [STAGE_NEW, STAGE_QUALIFIED], error: null });
      case 'list_platform_sellers_for_company':
        return Promise.resolve({ data: [], error: null });
      case 'list_platform_leads_for_company':
        return Promise.resolve({ data: args.p_archived ? [] : leadsActive, error: null });
      case 'list_platform_lead_timeline':
        return Promise.resolve({ data: [], error: null });
      case 'check_lead_phone_duplicate':
        return Promise.resolve({ data: [{ status: 'none', lead_id: null, lead_name: null }], error: null });
      case 'create_lead': {
        const lead = baseLead({ id: 'lead-2', name: args.p_name, phone: args.p_phone, car: args.p_car });
        leadsActive = [...leadsActive, lead];
        return Promise.resolve({ data: lead, error: null });
      }
      case 'move_lead_to_stage': {
        const lead = leadsActive.find((l) => l.id === args.p_lead_id)!;
        lead.stage_id = args.p_stage_id;
        lead.version = (lead.version as number) + 1;
        return Promise.resolve({ data: { ...lead }, error: null });
      }
      default:
        return Promise.resolve({ data: null, error: { message: `unmocked_rpc_${fn}` } });
    }
  });
});

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <CommercialCompanyProvider identityKey="sa-1">
        <PlatformCommercialClientsView userId="sa-1" platformRole="super_admin" />
      </CommercialCompanyProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
}

describe('Super Admin em /company/[id] (seletor manual vazio)', () => {
  it('"Novo Lead" abre o modal, que permanece aberto e cria o lead na empresa da URL', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Novo Lead')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Novo Lead'));

    await waitFor(() => expect(screen.getByText('NOVO LEAD: EMPRESA A')).toBeInTheDocument());
    // Ainda aberto depois que os efeitos rodaram.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('NOVO LEAD: EMPRESA A')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Teste Ficticio' } });
    fireEvent.change(screen.getByPlaceholderText('(11) 99999-9999'), { target: { value: '11900000001' } });
    fireEvent.change(screen.getByPlaceholderText('Ex.: Golf GTI 2022'), { target: { value: 'Gol' } });
    fireEvent.click(screen.getByText('Criar Lead'));

    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('create_lead', expect.objectContaining({
      p_company_id: 'company-a', p_name: 'Teste Ficticio', p_phone: '11900000001', p_car: 'Gol',
    })));
    await waitFor(() => expect(screen.queryByText('NOVO LEAD: EMPRESA A')).toBeNull());
  });

  it('ações do detalhe chegam à RPC com a empresa da URL', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('platform-lead-card-lead-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('platform-lead-card-lead-1'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-stage-trigger')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('platform-lead-stage-trigger'));
    fireEvent.click(screen.getByText('Qualificado'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('move_lead_to_stage', {
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_stage_id: 'stage-qualified', p_expected_version: 1,
    }));
  });

  it('troca de empresa na URL com o modal aberto fecha o modal sem criar nada', async () => {
    const view = renderView();
    await waitFor(() => expect(screen.getByText('Novo Lead')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Novo Lead'));
    await waitFor(() => expect(screen.getByText('NOVO LEAD: EMPRESA A')).toBeInTheDocument());

    m.operationalCompanyId.current = 'company-b';
    view.rerender();
    await waitFor(() => expect(screen.queryByText('NOVO LEAD: EMPRESA A')).toBeNull());
    expect(m.rpc).not.toHaveBeenCalledWith('create_lead', expect.anything());
  });
});
