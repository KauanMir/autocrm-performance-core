// Testes de integração visual do modo WRITE em PlatformCommercialClientsView
// (M1-F S8-C2-C2). Hooks de dados mockados diretamente — foco na MATRIZ de
// visibilidade botão "Novo Lead" / selo "somente leitura", nunca em rede.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CommercialCompanyRow, PlatformLeadRow } from '@/lib/commercial/repository';

const m = vi.hoisted(() => ({
  writeFlag: { current: false },
  selectedCompanyId: { current: null as string | null },
  companies: { current: [] as CommercialCompanyRow[] },
  leads: { current: [] as PlatformLeadRow[] },
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isSuperAdminCommercialWriteEnabled: () => m.writeFlag.current };
});

vi.mock('@/lib/commercial/CommercialCompanyContext', () => ({
  useCommercialCompanyContext: () => ({
    selectedCompanyId: m.selectedCompanyId.current,
    setSelectedCompanyId: vi.fn(),
  }),
}));

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — mode:'none' preserva 100% o
// comportamento anterior (seletor manual via CommercialCompanyContext
// continua sendo a autoridade quando não há contexto operacional /
// company/[id]).
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => ({
    mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false,
  }),
}));

vi.mock('@/lib/hooks/useCommercialCompanies', () => ({
  useCommercialCompanies: () => ({
    queryEnabled: true, companies: m.companies.current, isLoading: false, isFetching: false,
    isError: false, error: null, isEmpty: m.companies.current.length === 0, hasData: m.companies.current.length > 0,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/usePlatformLeads', () => ({
  usePlatformLeads: () => ({
    queryEnabled: true, leads: m.leads.current, isLoading: false, isFetching: false,
    isError: false, error: null, isEmpty: m.leads.current.length === 0, hasData: m.leads.current.length > 0,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/usePlatformPipelineStages', () => ({
  usePlatformPipelineStages: () => ({
    queryEnabled: true, stages: [], stagesById: {}, isLoading: false, isFetching: false,
    isError: false, error: null, isEmpty: true, hasData: false, refetch: vi.fn(),
  }),
}));

import { PlatformCommercialClientsView } from '@/components/commercial/PlatformCommercialClientsView';

function company(overrides: Partial<CommercialCompanyRow> = {}): CommercialCompanyRow {
  return { id: 'company-a', name: 'Empresa A', status: 'ativa', ...overrides };
}

beforeEach(() => {
  m.writeFlag.current = false;
  m.selectedCompanyId.current = null;
  m.companies.current = [];
  m.leads.current = [];
});

describe('PlatformCommercialClientsView — botão "Novo Lead" e selo somente leitura', () => {
  it('READ apenas (WRITE off): nenhum botão "Novo Lead", selo "somente leitura" visível', () => {
    m.writeFlag.current = false;
    m.selectedCompanyId.current = 'company-a';
    m.companies.current = [company({ status: 'ativa' })];
    render(<PlatformCommercialClientsView userId="u1" platformRole="super_admin" />);
    expect(screen.queryByText('Novo Lead')).toBeNull();
    expect(screen.getByText(/somente leitura/i)).toBeInTheDocument();
  });

  it('READ+WRITE, empresa ATIVA: botão "Novo Lead" visível, selo "somente leitura" ausente', () => {
    m.writeFlag.current = true;
    m.selectedCompanyId.current = 'company-a';
    m.companies.current = [company({ status: 'ativa' })];
    render(<PlatformCommercialClientsView userId="u1" platformRole="super_admin" />);
    expect(screen.getByText('Novo Lead')).toBeInTheDocument();
    expect(screen.queryByText(/somente leitura/i)).toBeNull();
  });

  it('READ+WRITE, empresa em IMPLANTACAO: botão "Novo Lead" visível', () => {
    m.writeFlag.current = true;
    m.selectedCompanyId.current = 'company-a';
    m.companies.current = [company({ status: 'implantacao' })];
    render(<PlatformCommercialClientsView userId="u1" platformRole="super_admin" />);
    expect(screen.getByText('Novo Lead')).toBeInTheDocument();
  });

  it('READ+WRITE, empresa SUSPENSA: nenhum botão "Novo Lead", selo "somente leitura" volta a aparecer', () => {
    m.writeFlag.current = true;
    m.selectedCompanyId.current = 'company-a';
    m.companies.current = [company({ status: 'suspensa' })];
    render(<PlatformCommercialClientsView userId="u1" platformRole="super_admin" />);
    expect(screen.queryByText('Novo Lead')).toBeNull();
    expect(screen.getByText(/somente leitura/i)).toBeInTheDocument();
  });

  it('READ+WRITE, empresa CANCELADA: nenhum botão "Novo Lead"', () => {
    m.writeFlag.current = true;
    m.selectedCompanyId.current = 'company-a';
    m.companies.current = [company({ status: 'cancelada' })];
    render(<PlatformCommercialClientsView userId="u1" platformRole="super_admin" />);
    expect(screen.queryByText('Novo Lead')).toBeNull();
  });

  it('READ+WRITE, nenhuma empresa selecionada: nenhum botão "Novo Lead" (nunca inferido)', () => {
    m.writeFlag.current = true;
    m.selectedCompanyId.current = null;
    render(<PlatformCommercialClientsView userId="u1" platformRole="super_admin" />);
    expect(screen.queryByText('Novo Lead')).toBeNull();
  });
});
