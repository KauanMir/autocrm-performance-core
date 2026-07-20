// Testes de ScreenEmpresas (M1-F S3-B).
// useCompanies/useCreateCompany mockados (o comportamento de cada hook já é
// coberto em tests/hooks/); services/flags mockados; sem rede.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const m = vi.hoisted(() => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(),
  createCompanyMock: vi.fn(),
  user: { current: null as any },
  flag: { current: true },
}));

vi.mock('@/lib/hooks/useCompanies', () => ({ useCompanies: m.useCompanies }));

vi.mock('@/lib/hooks/useCreateCompany', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useCreateCompany')>();
  return { ...actual, useCreateCompany: m.useCreateCompany };
});

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isPlatformAdminEnabled: () => m.flag.current };
});

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
}));

import { ScreenEmpresas } from '@/components/screens/ScreenEmpresas';

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'c1',
    name: 'Revenda Premium',
    trade_name: null,
    cnpj: null,
    phone: null,
    timezone: 'America/Sao_Paulo',
    status: 'ativa',
    created_at: '2026-07-20T12:00:00+00:00',
    ...overrides,
  };
}

function companiesResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['platform-admin', 'u1', 'companies'],
    companies: [], isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function createResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    createCompany: m.createCompanyMock, isPending: false, isError: false,
    isSuccess: false, error: null, reset: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  m.flag.current = true;
  m.user.current = { id: 'u1', name: 'Super', email: 'super@a.com', role: 'admin', sellerId: null, companyId: null, platformRole: 'super_admin' };
  m.useCompanies.mockReturnValue(companiesResult());
  m.useCreateCompany.mockReturnValue(createResult());
  m.createCompanyMock.mockReset();
  m.createCompanyMock.mockResolvedValue(company({ id: 'new-1', name: 'Empresa Nova' }));
});

describe('ScreenEmpresas — autorização visual', () => {
  it('não renderiza nada quando a flag está OFF, mesmo para Super Admin', () => {
    m.flag.current = false;
    const { container } = render(<ScreenEmpresas />);
    expect(container).toBeEmptyDOMElement();
  });

  it('não renderiza nada para ADMIN legado (platformRole null), mesmo com a flag ON', () => {
    m.user.current = { id: 'u2', name: 'Admin', email: 'a@a.com', role: 'admin', sellerId: null, companyId: 'company-a', platformRole: null };
    const { container } = render(<ScreenEmpresas />);
    expect(container).toBeEmptyDOMElement();
  });

  it('não renderiza nada para Manager/Seller', () => {
    m.user.current = { id: 'u3', name: 'Manager', email: 'm@a.com', role: 'manager', sellerId: null, companyId: 'company-a', platformRole: null };
    const { container } = render(<ScreenEmpresas />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ScreenEmpresas — listagem', () => {
  it('loading state', () => {
    m.useCompanies.mockReturnValue(companiesResult({ isLoading: true, isEmpty: false }));
    render(<ScreenEmpresas />);
    expect(screen.getByText(/Carregando empresas/)).toBeInTheDocument();
  });

  it('empty state', () => {
    render(<ScreenEmpresas />);
    expect(screen.getByText(/Nenhuma empresa cadastrada/)).toBeInTheDocument();
  });

  it('error state com retry chamando refetch', () => {
    const refetch = vi.fn();
    m.useCompanies.mockReturnValue(companiesResult({ isError: true, isEmpty: false, refetch }));
    render(<ScreenEmpresas />);
    expect(screen.getByText(/Não foi possível carregar/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('sucesso com múltiplas empresas, status implantacao/ativa/suspensa exibidos corretamente', () => {
    m.useCompanies.mockReturnValue(companiesResult({
      isEmpty: false, hasData: true,
      companies: [
        company({ id: 'c1', name: 'Empresa Implantação', status: 'implantacao' }),
        company({ id: 'c2', name: 'Empresa Ativa', status: 'ativa' }),
        company({ id: 'c3', name: 'Empresa Suspensa', status: 'suspensa' }),
      ],
    }));
    render(<ScreenEmpresas />);
    expect(screen.getByText('Empresa Implantação')).toBeInTheDocument();
    expect(screen.getByText('Em implantação')).toBeInTheDocument();
    expect(screen.getByText('Empresa Ativa')).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(screen.getByText('Empresa Suspensa')).toBeInTheDocument();
    expect(screen.getByText('Suspensa')).toBeInTheDocument();
  });

  it('campos opcionais ausentes (trade_name/cnpj/phone null) não quebram a renderização', () => {
    m.useCompanies.mockReturnValue(companiesResult({
      isEmpty: false, hasData: true,
      companies: [company({ trade_name: null, cnpj: null, phone: null })],
    }));
    expect(() => render(<ScreenEmpresas />)).not.toThrow();
    expect(screen.queryByText(/CNPJ:/)).toBeNull();
  });

  it('nenhuma empresa cancelada é presumida na UI (a lista só reflete o que o hook retorna — RLS já omite)', () => {
    m.useCompanies.mockReturnValue(companiesResult({
      isEmpty: false, hasData: true,
      companies: [company({ status: 'ativa' })],
    }));
    render(<ScreenEmpresas />);
    expect(screen.queryByText(/[Cc]ancelada/)).toBeNull();
  });
});

describe('ScreenEmpresas — criação', () => {
  it('abre o formulário ao clicar em "Criar empresa"', () => {
    render(<ScreenEmpresas />);
    fireEvent.click(screen.getByText('Criar empresa'));
    expect(screen.getByPlaceholderText('Nome da empresa')).toBeInTheDocument();
  });

  it('nome obrigatório: botão de submit não chama createCompany com nome em branco', async () => {
    render(<ScreenEmpresas />);
    fireEvent.click(screen.getByText('Criar empresa'));
    const submitButtons = screen.getAllByText('Criar empresa');
    fireEvent.click(submitButtons[submitButtons.length - 1]);
    expect(m.createCompanyMock).not.toHaveBeenCalled();
  });

  it('payload correto (apenas campos preenchidos) e sucesso reseta/atualiza a lista', async () => {
    const refetch = vi.fn();
    m.useCompanies.mockReturnValue(companiesResult({ refetch }));
    render(<ScreenEmpresas />);
    fireEvent.click(screen.getByText('Criar empresa'));
    fireEvent.change(screen.getByPlaceholderText('Nome da empresa'), { target: { value: 'Empresa Nova' } });
    const submitButtons = screen.getAllByText('Criar empresa');
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(m.createCompanyMock).toHaveBeenCalledTimes(1));
    expect(m.createCompanyMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Empresa Nova' }));
    await waitFor(() => expect(screen.getByText(/criada com sucesso/)).toBeInTheDocument());
    expect(refetch).toHaveBeenCalled();
  });

  it('botão mostra estado de processamento e impede clique duplicado enquanto isPending', () => {
    m.useCreateCompany.mockReturnValue(createResult({ isPending: true }));
    render(<ScreenEmpresas />);
    fireEvent.click(screen.getByText('Criar empresa'));
    fireEvent.change(screen.getByPlaceholderText('Nome da empresa'), { target: { value: 'Empresa Nova' } });
    expect(screen.getByText('Criando…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Criando…'));
    expect(m.createCompanyMock).not.toHaveBeenCalled();
  });

  it('erro mapeado é exibido e os campos preenchidos permanecem intactos', () => {
    m.useCreateCompany.mockReturnValue(createResult({ isError: true, error: new Error('create-company-blank-name') }));
    render(<ScreenEmpresas />);
    fireEvent.click(screen.getByText('Criar empresa'));
    fireEvent.change(screen.getByPlaceholderText('Nome da empresa'), { target: { value: 'Nome Preenchido' } });
    expect(screen.getByText('Informe o nome da empresa.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nome da empresa')).toHaveValue('Nome Preenchido');
  });

  it('nenhuma empresa é selecionada automaticamente após sucesso (sem navegação/seleção)', async () => {
    render(<ScreenEmpresas />);
    fireEvent.click(screen.getByText('Criar empresa'));
    fireEvent.change(screen.getByPlaceholderText('Nome da empresa'), { target: { value: 'Empresa Nova' } });
    const submitButtons = screen.getAllByText('Criar empresa');
    fireEvent.click(submitButtons[submitButtons.length - 1]);
    await waitFor(() => expect(m.createCompanyMock).toHaveBeenCalled());
    // Tela de sucesso não expõe nenhum controle de "entrar na empresa"/seleção.
    expect(screen.queryByText(/[Ss]elecionar/)).toBeNull();
    expect(screen.queryByText(/[Ee]ntrar na empresa/)).toBeNull();
  });
});
