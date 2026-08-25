// tests/screens/ScreenAjustesCompanySettings.test.tsx —
// COMPANY-SETTINGS-R1-EXEC. Cobre a aba "Empresa" de ScreenAjustes: quem a
// vê (Manager sim, Seller não, Super Admin não — decisão nova, inverte
// canAccessFullSettings), o split local (CompanyService fixture, intocado)
// vs remoto (useCompanySettings/useUpdateCompanySettings reais), name/cnpj
// read-only, phone/timezone editáveis, dirty state, loading, sucesso, erro
// sanitizado. useCompanySettings/useUpdateCompanySettings são mockados aqui
// (comportamento interno de cada hook já seria coberto em testes próprios
// se este lote os exigisse) — este arquivo cobre exclusivamente o que
// ScreenAjustes faz com o resultado deles.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import { PlatformCompanyError } from '@/lib/companies/errors';

const m = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  useReorderStages: vi.fn(),
  useCompanySettings: vi.fn(),
  useUpdateCompanySettings: vi.fn(),
  useUpdateCompanyLogo: vi.fn(),
  updateCompanySettings: vi.fn(),
  isLocalCommercialDataAllowed: vi.fn(),
  companyServiceGet: vi.fn(),
  companyServiceUpdate: vi.fn(),
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({
  usePipelineStages: m.usePipelineStages,
}));

vi.mock('@/lib/hooks/useReorderStages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useReorderStages')>();
  return { ...actual, useReorderStages: m.useReorderStages };
});

vi.mock('@/lib/hooks/useCompanySettings', () => ({
  useCompanySettings: m.useCompanySettings,
}));

vi.mock('@/lib/hooks/useUpdateCompanySettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useUpdateCompanySettings')>();
  return { ...actual, useUpdateCompanySettings: m.useUpdateCompanySettings };
});

// CompanyLogoSection (COMPANY-IDENTITY-LOGO-R1-EXEC) usa useUpdateCompanyLogo
// dentro da aba Empresa — mockado aqui pelo MESMO motivo de
// useUpdateCompanySettings acima (comportamento interno já é coberto em
// teste próprio; este arquivo cobre só o que ScreenAjustes faz com o
// resultado). Sem este mock, a versão real do hook chamaria useQueryClient()
// sem um QueryClientProvider no wrapper deste teste.
vi.mock('@/lib/hooks/useUpdateCompanyLogo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useUpdateCompanyLogo')>();
  return { ...actual, useUpdateCompanyLogo: m.useUpdateCompanyLogo };
});

vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: m.isLocalCommercialDataAllowed,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));
vi.mock('@/components/podiums/Podiums', () => ({ PLACE: {} }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  CompanyService: { get: m.companyServiceGet, update: m.companyServiceUpdate },
  PipelineService: { reorderStages: () => {}, getStages: () => [] },
}));

vi.mock('@/components/invites/InviteList', () => ({
  InviteList: () => <div data-testid="invite-list-stub" />,
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

function manager(companyId = 'company-a') {
  return { id: 'u-mgr', name: 'Gerente', email: 'mgr@test.local', platformRole: null, activeMembership: { companyId, role: 'manager', sellerId: null } };
}
function seller() {
  return { id: 'u-sel', name: 'Vendedor', email: 'sel@test.local', platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } };
}
function superAdmin() {
  return { id: 'u-sa', name: 'Admin', email: 'sa@test.local', platformRole: 'super_admin', activeMembership: null };
}

function remoteCompanyRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'company-a', name: 'Revenda Real Ltda', trade_name: null, cnpj: '11.222.333/0001-44',
    phone: '(11) 4000-0000', timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-01-01T00:00:00Z',
    logo_path: null,
    ...over,
  };
}

function updateHookResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    updateCompanySettings: m.updateCompanySettings,
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
    ...over,
  };
}

function updateLogoHookResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    setLogo: vi.fn(), removeLogo: vi.fn(),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  m.user.current = null;
  m.usePipelineStages.mockReturnValue(pipelineResult());
  m.useReorderStages.mockReturnValue({
    reorderStages: vi.fn().mockResolvedValue({ ok: true }),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  });
  m.companyServiceGet.mockReturnValue({ name: 'Loja Fixture', cnpj: '00.000.000/0001-00', phone: '(11) 3000-0000', timezone: 'America/Sao_Paulo' });
  m.companyServiceUpdate.mockReset();
  m.isLocalCommercialDataAllowed.mockReturnValue(true);
  m.useCompanySettings.mockReturnValue({ status: 'unavailable' });
  m.updateCompanySettings.mockReset().mockResolvedValue(remoteCompanyRow());
  m.useUpdateCompanySettings.mockReturnValue(updateHookResult());
  m.useUpdateCompanyLogo.mockReturnValue(updateLogoHookResult());
});

function openEmpresa() {
  render(<ScreenAjustes go={() => {}} />);
}

describe('ScreenAjustes — quem vê a aba Empresa (COMPANY-SETTINGS-R1-EXEC §14/§15)', () => {
  it('Manager com membership ATIVA vê a aba Empresa', () => {
    m.user.current = manager();
    openEmpresa();
    expect(screen.getByText('Empresa')).toBeInTheDocument();
  });

  it('Seller não vê a aba Empresa', () => {
    m.user.current = seller();
    openEmpresa();
    expect(screen.queryByText('Empresa')).toBeNull();
  });

  it('Super Admin NUNCA vê a aba Empresa na superfície genérica de Ajustes (sem company context)', () => {
    m.user.current = superAdmin();
    openEmpresa();
    expect(screen.queryByText('Empresa')).toBeNull();
    // Super Admin continua vendo Usuários normalmente (canManageInvites intocado).
    expect(screen.getByText('Usuários')).toBeInTheDocument();
  });
});

describe('ScreenAjustes — Empresa em modo LOCAL (preservado intacto)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
  });

  it('Manager local: mostra o fixture (CompanyService), zero chamada aos hooks remotos', () => {
    m.user.current = manager();
    openEmpresa();
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Loja Fixture')).toBeInTheDocument();
    expect(m.useCompanySettings).not.toHaveBeenCalled();
  });
});

describe('ScreenAjustes — Empresa em modo REMOTO (COMPANY-SETTINGS-R1-EXEC)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.user.current = manager();
  });

  it('loading: mostra estado de carregamento, fixture nunca aparece na tela', () => {
    m.useCompanySettings.mockReturnValue({ status: 'loading' });
    openEmpresa();
    expect(screen.getByText('Carregando dados da empresa…')).toBeInTheDocument();
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.queryByDisplayValue('Loja Fixture')).toBeNull();
  });

  it('error: mostra estado de erro com retry', () => {
    const retry = vi.fn();
    m.useCompanySettings.mockReturnValue({ status: 'error', retry });
    openEmpresa();
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('ready: name/cnpj sao somente leitura (nao sao <input>), phone/timezone sao editaveis', () => {
    m.useCompanySettings.mockReturnValue({ status: 'ready', company: remoteCompanyRow() });
    openEmpresa();

    expect(screen.getByText('Revenda Real Ltda')).toBeInTheDocument();
    expect(screen.getByText('11.222.333/0001-44')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Revenda Real Ltda')).toBeNull();
    expect(screen.queryByDisplayValue('11.222.333/0001-44')).toBeNull();
    expect(screen.getAllByText('Somente leitura').length).toBe(2);

    expect(screen.getByDisplayValue('(11) 4000-0000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('America/Sao_Paulo')).toBeInTheDocument();
    // Fixture local nunca aparece na tela nem é gravado no branch remoto.
    expect(screen.queryByDisplayValue('Loja Fixture')).toBeNull();
    expect(m.companyServiceUpdate).not.toHaveBeenCalled();
  });

  it('ready: Manager ve o bloco "Logo da empresa" com botao "Enviar logo" quando nao ha logo', () => {
    m.useCompanySettings.mockReturnValue({ status: 'ready', company: remoteCompanyRow({ logo_path: null }) });
    openEmpresa();
    expect(screen.getByText('Logo da empresa')).toBeInTheDocument();
    expect(screen.getByText('Enviar logo')).toBeInTheDocument();
    expect(screen.queryByText('Remover logo')).toBeNull();
  });

  it('ready: com logo existente, mostra "Trocar logo" e "Remover logo"', () => {
    m.useCompanySettings.mockReturnValue({
      status: 'ready',
      company: remoteCompanyRow({ logo_path: 'company-a/logos/abc.png' }),
    });
    openEmpresa();
    expect(screen.getByText('Trocar logo')).toBeInTheDocument();
    expect(screen.getByText('Remover logo')).toBeInTheDocument();
  });

  it('Remover logo chama removeLogo com o logo_path atual', () => {
    const removeLogo = vi.fn().mockResolvedValue({ company: remoteCompanyRow({ logo_path: null }), oldObjectCleanupFailed: false });
    m.useCompanySettings.mockReturnValue({
      status: 'ready',
      company: remoteCompanyRow({ logo_path: 'company-a/logos/abc.png' }),
    });
    m.useUpdateCompanyLogo.mockReturnValue(updateLogoHookResult({ removeLogo }));
    openEmpresa();
    fireEvent.click(screen.getByText('Remover logo'));
    expect(removeLogo).toHaveBeenCalledWith('company-a/logos/abc.png');
  });

  it('Salvar alterações comeca desabilitado (sem dirty state) e habilita ao editar', () => {
    m.useCompanySettings.mockReturnValue({ status: 'ready', company: remoteCompanyRow() });
    openEmpresa();

    const saveBtn = screen.getByText('Salvar alterações').closest('button') as HTMLElement;
    expect(saveBtn).toHaveStyle({ cursor: 'not-allowed' });

    fireEvent.change(screen.getByDisplayValue('(11) 4000-0000'), { target: { value: '(11) 9999-8888' } });
    expect(saveBtn).toHaveStyle({ cursor: 'pointer' });
  });

  it('salvar chama updateCompanySettings com phone/timezone editados', async () => {
    m.useCompanySettings.mockReturnValue({ status: 'ready', company: remoteCompanyRow() });
    openEmpresa();

    fireEvent.change(screen.getByDisplayValue('(11) 4000-0000'), { target: { value: '(11) 9999-8888' } });
    fireEvent.click(screen.getByText('Salvar alterações'));

    expect(m.updateCompanySettings).toHaveBeenCalledWith({ phone: '(11) 9999-8888', timezone: 'America/Sao_Paulo' });
  });

  it('timezone em branco impede salvar (canSave=false)', () => {
    m.useCompanySettings.mockReturnValue({ status: 'ready', company: remoteCompanyRow() });
    openEmpresa();

    fireEvent.change(screen.getByDisplayValue('America/Sao_Paulo'), { target: { value: '   ' } });
    const saveBtn = screen.getByText('Salvar alterações').closest('button') as HTMLElement;
    expect(saveBtn).toHaveStyle({ cursor: 'not-allowed' });
  });

  it('isPending: botao mostra "Salvando…" e fica desabilitado', () => {
    m.useCompanySettings.mockReturnValue({ status: 'ready', company: remoteCompanyRow() });
    m.useUpdateCompanySettings.mockReturnValue(updateHookResult({ isPending: true }));
    openEmpresa();
    expect(screen.getByText('Salvando…')).toBeInTheDocument();
  });

  it('erro sanitizado: mostra mensagem amigavel, nunca o codigo bruto', () => {
    m.useCompanySettings.mockReturnValue({ status: 'ready', company: remoteCompanyRow() });
    m.useUpdateCompanySettings.mockReturnValue(updateHookResult({
      isError: true,
      error: new PlatformCompanyError('platform_companies_update_settings_failed', { code: '42501' }),
    }));
    openEmpresa();
    expect(screen.getByText('Você não tem permissão para editar esta empresa.')).toBeInTheDocument();
    expect(screen.queryByText('42501')).toBeNull();
  });
});
