// tests/commercial/PlatformCommercialEndToEnd.test.tsx — auditoria integrada
// do S8-C2 (M1-F S8-C2-E). Diferente dos testes unitários já existentes
// (hooks/componentes mockados individualmente), este arquivo monta a árvore
// REAL (CommercialCompanyProvider + PlatformCommercialClientsView + todos os
// hooks reais) e mocka SOMENTE a fronteira de rede (supabase.rpc) — prova a
// FIAÇÃO completa do sistema, não cada peça isolada.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ rpc: vi.fn(), writeFlag: { current: true } }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isSuperAdminCommercialWriteEnabled: () => m.writeFlag.current };
});

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — mode:'none' preserva 100% este
// fluxo E2E existente (seletor manual via CommercialCompanyProvider REAL
// continua sendo a autoridade; nenhum contexto operacional /company/[id]
// nesta suíte).
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => ({
    mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false,
  }),
}));

import { CommercialCompanyProvider } from '@/lib/commercial/CommercialCompanyContext';
import { PlatformCommercialClientsView } from '@/components/commercial/PlatformCommercialClientsView';

const COMPANY_A = { id: 'company-a', name: 'Empresa A', status: 'ativa' as const };
const COMPANY_B = { id: 'company-b', name: 'Empresa B', status: 'ativa' as const };
const STAGE_NEW = { id: 'stage-new', company_id: 'company-a', code: 'new', name: 'Novo', sort_order: 0, is_terminal: false, created_at: '', updated_at: '' };
const STAGE_QUALIFIED = { id: 'stage-qualified', company_id: 'company-a', code: 'qualified', name: 'Qualificado', sort_order: 1, is_terminal: false, created_at: '', updated_at: '' };
const SELLER_1 = { seller_id: 'seller-1', name: 'Vendedor Um' };

function baseLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1', company_id: 'company-a', name: 'Cliente E2E', phone: '11988887777', car: 'Onix',
    stage_id: 'stage-new', seller_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z',
    created_by_profile_id: null, updated_at: '2026-01-01T00:00:00Z', updated_by_profile_id: null,
    urgency: 'red', temperature: null, payment_preference: null, source: null, value_amount: null,
    phone_digits: '11988887777', alert_label: null, last_activity_label: null, version: 1,
    ...overrides,
  };
}

describe('Fluxo integrado Super Admin — Empresa A ativa (READ+WRITE)', () => {
  let leadsActive: Record<string, unknown>[];
  let leadsArchived: Record<string, unknown>[];
  let timelineEntries: Record<string, unknown>[];

  beforeEach(() => {
    m.writeFlag.current = true;
    leadsActive = [baseLead()];
    leadsArchived = [];
    timelineEntries = [];

    m.rpc.mockReset();
    m.rpc.mockImplementation((fn: string, args: Record<string, unknown> = {}) => {
      switch (fn) {
        case 'list_commercial_companies':
          return Promise.resolve({ data: [COMPANY_A, COMPANY_B], error: null });
        case 'list_pipeline_stages_for_company':
          return Promise.resolve({ data: [STAGE_NEW, STAGE_QUALIFIED], error: null });
        case 'list_platform_sellers_for_company':
          return Promise.resolve({ data: [SELLER_1], error: null });
        case 'list_platform_leads_for_company':
          return Promise.resolve({ data: args.p_archived ? leadsArchived : leadsActive, error: null });
        case 'list_platform_lead_timeline':
          return Promise.resolve({ data: timelineEntries, error: null });
        case 'move_lead_to_stage': {
          const lead = leadsActive.find((l) => l.id === args.p_lead_id);
          if (!lead) return Promise.resolve({ data: null, error: { message: 'lead_not_found' } });
          lead.stage_id = args.p_stage_id;
          lead.version = (lead.version as number) + 1;
          return Promise.resolve({ data: { ...lead }, error: null });
        }
        case 'assign_lead_seller': {
          const lead = leadsActive.find((l) => l.id === args.p_lead_id);
          if (!lead) return Promise.resolve({ data: null, error: { message: 'lead_not_found' } });
          lead.seller_id = args.p_seller_id;
          lead.version = (lead.version as number) + 1;
          return Promise.resolve({ data: { ...lead }, error: null });
        }
        case 'apply_lead_event': {
          const lead = leadsActive.find((l) => l.id === args.p_lead_id);
          if (!lead) return Promise.resolve({ data: null, error: { message: 'lead_not_found' } });
          lead.urgency = 'green';
          lead.version = (lead.version as number) + 1;
          return Promise.resolve({ data: { ...lead }, error: null });
        }
        case 'add_lead_timeline_entry': {
          const entry = {
            id: 'entry-1', company_id: args.p_company_id, lead_id: args.p_lead_id,
            actor_profile_id: null, icon: args.p_icon, color: args.p_color,
            label: args.p_label, detail: args.p_detail ?? null,
            occurred_at: '2026-01-02T00:00:00Z', created_at: '2026-01-02T00:00:00Z',
          };
          timelineEntries = [...timelineEntries, entry];
          return Promise.resolve({ data: entry, error: null });
        }
        case 'archive_lead': {
          const idx = leadsActive.findIndex((l) => l.id === args.p_lead_id);
          if (idx === -1) return Promise.resolve({ data: null, error: { message: 'lead_not_found' } });
          const [lead] = leadsActive.splice(idx, 1);
          lead.archived_at = '2026-01-03T00:00:00Z';
          lead.version = (lead.version as number) + 1;
          leadsArchived = [...leadsArchived, lead];
          return Promise.resolve({ data: { ...lead }, error: null });
        }
        case 'unarchive_lead': {
          const idx = leadsArchived.findIndex((l) => l.id === args.p_lead_id);
          if (idx === -1) return Promise.resolve({ data: null, error: { message: 'lead_not_found' } });
          const [lead] = leadsArchived.splice(idx, 1);
          lead.archived_at = null;
          lead.version = (lead.version as number) + 1;
          leadsActive = [...leadsActive, lead];
          return Promise.resolve({ data: { ...lead }, error: null });
        }
        default:
          return Promise.resolve({ data: null, error: { message: `unmocked_rpc_${fn}` } });
      }
    });
  });

  afterEach(() => {
    (Element.prototype as any).scrollTo = undefined;
  });

  function renderView() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CommercialCompanyProvider identityKey="sa-1">
          <PlatformCommercialClientsView userId="sa-1" platformRole="super_admin" />
        </CommercialCompanyProvider>
      </QueryClientProvider>,
    );
  }

  async function selectCompanyA() {
    await waitFor(() => expect(screen.getByText('Selecionar empresa')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('commercial-company-selector').querySelector('button')!);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Empresa A'));
  }

  it('percorre o fluxo completo: selecionar empresa, abrir Lead, mover, atribuir, evento, timeline, arquivar, desarquivar', async () => {
    renderView();
    await selectCompanyA();

    // companyId sempre explícito nas RPCs de leitura.
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('list_platform_leads_for_company', { p_company_id: 'company-a', p_archived: false }));

    await waitFor(() => expect(screen.getByTestId('platform-lead-card-lead-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('platform-lead-card-lead-1'));

    // Mover etapa.
    await waitFor(() => expect(screen.getByTestId('platform-lead-stage-trigger')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('platform-lead-stage-trigger'));
    fireEvent.click(screen.getByText('Qualificado'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('move_lead_to_stage', {
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_stage_id: 'stage-qualified', p_expected_version: 1,
    }));

    // Atribuir vendedor real (nunca profile_id/membership_id).
    fireEvent.click(screen.getByTestId('platform-lead-seller-trigger'));
    fireEvent.click(screen.getByText('Vendedor Um'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('assign_lead_seller', expect.objectContaining({
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_seller_id: 'seller-1',
    })));

    // Evento comercial real.
    fireEvent.click(screen.getByTestId('platform-lead-event-trigger'));
    fireEvent.click(screen.getByText('Visita confirmada pelo cliente'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('apply_lead_event', expect.objectContaining({
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_event_type: 'visit_confirmed',
    })));

    // Timeline manual.
    fireEvent.change(screen.getByLabelText('Título da anotação'), { target: { value: 'Cliente retornou' } });
    fireEvent.click(screen.getByText('Adicionar à timeline'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('add_lead_timeline_entry', expect.objectContaining({
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_label: 'Cliente retornou',
    })));

    // Arquivar — some da lista ativa, o detalhe fecha (selectedLead vira null).
    fireEvent.click(screen.getByTestId('platform-lead-archive-trigger'));
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('archive_lead', expect.objectContaining({
      p_company_id: 'company-a', p_lead_id: 'lead-1',
    })));
    await waitFor(() => expect(screen.queryByTestId('platform-lead-card-lead-1')).toBeNull());
    expect(screen.queryByTestId('platform-lead-actions')).toBeNull();

    // Aba Arquivados mostra o Lead; abrir e desarquivar devolve para Ativos.
    fireEvent.click(screen.getByText('Arquivados'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-card-lead-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('platform-lead-card-lead-1'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-archive-trigger')).toHaveTextContent('Desarquivar'));
    fireEvent.click(screen.getByTestId('platform-lead-archive-trigger'));
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('unarchive_lead', expect.objectContaining({
      p_company_id: 'company-a', p_lead_id: 'lead-1',
    })));

    fireEvent.click(screen.getByText('Ativos'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-card-lead-1')).toBeInTheDocument());

    // Nenhuma chamada de rede jamais usou profile_id/membership_id no lugar do seller_id real.
    for (const call of m.rpc.mock.calls) {
      const args = call[1] as Record<string, unknown> | undefined;
      if (args) {
        expect(args).not.toHaveProperty('p_profile_id');
        expect(args).not.toHaveProperty('p_membership_id');
      }
    }
  });

  it('trocar para Empresa B fecha o detalhe e nunca reaproveita dado da Empresa A', async () => {
    renderView();
    await selectCompanyA();
    await waitFor(() => expect(screen.getByTestId('platform-lead-card-lead-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('platform-lead-card-lead-1'));
    await waitFor(() => expect(screen.getByTestId('platform-lead-actions')).toBeInTheDocument());

    await waitFor(() => expect(screen.getByText(/Acompanhando/)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('commercial-company-selector').querySelector('button')!);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Empresa B'));

    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('list_platform_leads_for_company', { p_company_id: 'company-b', p_archived: false }));
    expect(screen.queryByTestId('platform-lead-actions')).toBeNull();
    expect(screen.queryByTestId('platform-lead-card-lead-1')).toBeNull();
  });

  it('READ+WRITE porém empresa suspensa: leitura funciona, nenhuma ação de mutation aparece', async () => {
    m.rpc.mockImplementation((fn: string, args: Record<string, unknown> = {}) => {
      if (fn === 'list_commercial_companies') {
        return Promise.resolve({ data: [{ id: 'company-d', name: 'Empresa D', status: 'suspensa' }], error: null });
      }
      if (fn === 'list_pipeline_stages_for_company') return Promise.resolve({ data: [STAGE_NEW], error: null });
      if (fn === 'list_platform_leads_for_company') {
        return Promise.resolve({ data: [baseLead({ id: 'lead-d', company_id: 'company-d', stage_id: 'stage-new' })], error: null });
      }
      if (fn === 'list_platform_lead_timeline') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: { message: `unmocked_rpc_${fn}` } });
    });
    renderView();
    await waitFor(() => expect(screen.getByText('Selecionar empresa')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('commercial-company-selector').querySelector('button')!);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Empresa D'));

    await waitFor(() => expect(screen.getByTestId('platform-lead-card-lead-d')).toBeInTheDocument());
    expect(screen.queryByText('Novo Lead')).toBeNull();
    fireEvent.click(screen.getByTestId('platform-lead-card-lead-d'));
    await waitFor(() => expect(screen.getAllByText(/somente leitura/i).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId('platform-lead-actions')).toBeNull();

    expect(m.rpc).not.toHaveBeenCalledWith('move_lead_to_stage', expect.anything());
    expect(m.rpc).not.toHaveBeenCalledWith('archive_lead', expect.anything());
  });

  it('WRITE=false: leitura funciona, nenhuma ação de mutation aparece mesmo em empresa ativa', async () => {
    m.writeFlag.current = false;
    renderView();
    await selectCompanyA();
    await waitFor(() => expect(screen.getByTestId('platform-lead-card-lead-1')).toBeInTheDocument());
    expect(screen.queryByText('Novo Lead')).toBeNull();
    fireEvent.click(screen.getByTestId('platform-lead-card-lead-1'));
    await waitFor(() => expect(screen.getAllByText(/somente leitura/i).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId('platform-lead-actions')).toBeNull();
  });
});
