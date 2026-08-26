// Testes de navegação — Super Admin NUNCA recebe os ids operacionais
// Manager/Seller-only (COMMERCIAL-REMOTE-FINAL-AUDIT-A1-R1). Achado real da
// auditoria: allowedNavIds (components/App.tsx) só filtrava 'clientes'/
// 'andamento' da base de NAV_ROLES.admin — 'pendencias'/'visitas'/
// 'propostas'/'vendas'/'resultados' passavam direto, apesar de Tasks/
// Visits/Deals/Sales/Results negarem Super Admin por construção no RLS
// (nenhum RPC equivalente existe para esse papel). Diferente de
// Clientes/Andamento, esses cinco não têm NENHUM caminho de re-concessão —
// a exclusão é permanente, nunca reaparece via capability+flag.
//
// Mesmo molde de tests/navigation/commercialWorkspaceAccess.test.tsx: App
// real + telas stubadas, flags mockadas de forma controlada.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  superAdminReadFlag: { current: false },
  superAdminWriteFlag: { current: false },
  remoteTasksFlag: { current: false },
  remoteVisitsFlag: { current: false },
  remoteDealsFlag: { current: false },
  remoteSalesFlag: { current: false },
  isManager: { current: false },
  restoredUser: { current: null as User | null },
  nextUser: { current: null as User | null },
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...actual,
    isSuperAdminCommercialReadEnabled: () => m.superAdminReadFlag.current,
    isSuperAdminCommercialWriteEnabled: () => m.superAdminWriteFlag.current,
    isRemoteTasksEnabled: () => m.remoteTasksFlag.current,
    isRemoteVisitsEnabled: () => m.remoteVisitsFlag.current,
    isRemoteDealsEnabled: () => m.remoteDealsFlag.current,
    isRemoteSalesEnabled: () => m.remoteSalesFlag.current,
  };
});

vi.mock('@/lib/store', () => ({ subscribeStore: () => () => {} }));

// SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — testes abaixo (describe
// "Super Admin operacional") sobrescrevem para mode:'super_admin'; todos os
// demais (generic Super Admin, Manager, Seller) mantêm o default 'none' já
// provado pela suíte inteira acima.
const opContext = { current: { mode: 'none' as 'none' | 'super_admin', companyId: null as string | null, identity: { status: 'unavailable' as const }, isReadOnly: false } };
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => opContext.current,
  OperationalCompanyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — Rail (dentro de App real) agora usa
// next/navigation's useRouter ("Voltar para Empresas"). App Router real
// exige contexto ausente neste harness de render isolado.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/services', () => ({
  AuthService: {
    restoreSession: () => Promise.resolve(m.restoredUser.current),
    getCurrentUser: () => m.restoredUser.current,
    logout: () => Promise.resolve(),
    // Legado real (lib/services.ts:195-197): isManager() retorna true para
    // Super Admin (isPlatformSuperAdmin() || currentRole()==='manager').
    // O teste crítico abaixo prova que allowedNavIds NUNCA consulta isso —
    // a exclusão dos 5 ids operacionais é por platformRole/activeMembership,
    // nunca pelo legado local que confundia Super Admin com Manager.
    isManager: () => m.isManager.current,
  },
  SellerService: { getAll: () => [], getById: () => null },
  TaskService: { getAll: () => [] },
  PipelineService: { getStages: () => [] },
}));

vi.mock('@/components/ui/TweaksPanel', () => ({
  useTweaks: () => [{ podium: 'D', anim: false, showRevenue: false }, vi.fn()],
  TweaksPanel: () => null,
  TweakSection: () => null,
  TweakRadio: () => null,
  TweakToggle: () => null,
  TweakButton: () => null,
}));

vi.mock('@/components/auth/AuthFlow', () => ({
  AuthFlow: ({ onAuthed }: { onAuthed: (u: User) => void }) => (
    <button data-testid="mock-login" onClick={() => m.nextUser.current && onAuthed(m.nextUser.current)}>
      mock-login
    </button>
  ),
}));

vi.mock('@/components/screens/Home', () => ({
  Home: () => <div data-testid="screen-home">home</div>,
}));

vi.mock('@/components/screens/ScreensOps', () => ({
  ScreenClientes: () => <div data-testid="screen-clientes">clientes</div>,
  ScreenAndamento: () => <div data-testid="screen-andamento">andamento</div>,
  ScreenPendencias: () => <div data-testid="screen-pendencias">pendencias</div>,
}));

vi.mock('@/components/screens/ScreensBiz', () => ({
  ScreenVisitas: () => <div data-testid="screen-visitas">visitas</div>,
  ScreenPropostas: () => <div data-testid="screen-propostas">propostas</div>,
  ScreenVendas: () => <div data-testid="screen-vendas">vendas</div>,
  ScreenResultados: () => <div data-testid="screen-resultados">resultados</div>,
  ScreenAjustes: () => <div data-testid="screen-ajustes">ajustes</div>,
}));

vi.mock('@/components/screens/ScreenEmpresas', () => ({
  ScreenEmpresas: () => <div data-testid="screen-empresas">empresas</div>,
}));

vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';

function user(label: string, platformRole: 'super_admin' | null = null, activeMembership: User['activeMembership'] = null): User {
  return {
    id: `u-${label}-${platformRole ?? 'none'}`,
    name: label,
    email: `${label}@a.com`,
    platformRole,
    activeMembership,
  };
}

const OPERATIONAL_NAV = [
  { label: 'Pendências', testId: 'screen-pendencias', go: 'pendencias' },
  { label: 'Visitas', testId: 'screen-visitas', go: 'visitas' },
  { label: 'Propostas', testId: 'screen-propostas', go: 'propostas' },
  { label: 'Vendas', testId: 'screen-vendas', go: 'vendas' },
  { label: 'Resultados', testId: 'screen-resultados', go: 'resultados' },
] as const;

async function renderApp(initial: User | null) {
  m.restoredUser.current = initial;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
}

function switchUser(next: User | null) {
  act(() => { (window as any).__logout(); });
  if (next) {
    m.nextUser.current = next;
    m.restoredUser.current = next;
    fireEvent.click(screen.getByTestId('mock-login'));
  }
}

beforeEach(() => {
  m.superAdminReadFlag.current = false;
  m.superAdminWriteFlag.current = false;
  m.remoteTasksFlag.current = false;
  m.remoteVisitsFlag.current = false;
  m.remoteDealsFlag.current = false;
  m.remoteSalesFlag.current = false;
  m.isManager.current = false;
  m.restoredUser.current = null;
  opContext.current = { mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false };
});

describe('Super Admin — ids operacionais Manager/Seller-only nunca aparecem no menu (R1-EXEC §8)', () => {
  it('nenhum dos 5 labels operacionais é renderizado no Rail', async () => {
    await renderApp(user('admin', 'super_admin'));
    for (const { label } of OPERATIONAL_NAV) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    // Ajustes/Empresas continuam fora de escopo deste fix — não afetados.
  });

  it.each(OPERATIONAL_NAV)('Manager em "$go" → troca para Super Admin: guarda síncrona (effectiveCurrent) cai em home, tela nunca fica montada nem por um frame', async ({ label, go, testId }) => {
    // Prova mais forte que "o botão não existe": um Manager navega
    // legitimamente até a tela, e só então o usuário ativo muda para Super
    // Admin. O estado `current` interno continua apontando para o id
    // proibido — só a guarda síncrona de render (effectiveCurrent, nunca um
    // useEffect assíncrono) impede a tela de aparecer.
    await renderApp(user('manager', null, { companyId: 'company-a', role: 'manager', sellerId: null }));
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());

    switchUser(user('admin', 'super_admin'));

    expect(screen.queryByTestId(testId)).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
    void go; // apenas identifica o caso no nome do teste
  });
});

describe('Super Admin — modo local: legado AuthService.isManager()=true não reabre os ids operacionais (R1-EXEC §6/§11)', () => {
  it('isManager()=true (comportamento real do legado) não muda o resultado de allowedNavIds', async () => {
    m.isManager.current = true; // exatamente o gap identificado na auditoria
    await renderApp(user('admin', 'super_admin'));
    for (const { label } of OPERATIONAL_NAV) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});

describe('Super Admin — modo remoto: flags comerciais ON não substituem autorização de papel (R1-EXEC §7/§12)', () => {
  it('REMOTE_TASKS/VISITS/DEALS/SALES=true com SUPER_ADMIN_COMMERCIAL_READ/WRITE=false: ainda sem os 5 ids', async () => {
    m.remoteTasksFlag.current = true;
    m.remoteVisitsFlag.current = true;
    m.remoteDealsFlag.current = true;
    m.remoteSalesFlag.current = true;
    m.superAdminReadFlag.current = false;
    m.superAdminWriteFlag.current = false;
    await renderApp(user('admin', 'super_admin'));
    for (const { label } of OPERATIONAL_NAV) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});

describe('Manager — módulos comerciais preservados (R1-EXEC §9)', () => {
  it('Manager continua recebendo Pendências/Visitas/Propostas/Vendas/Resultados', async () => {
    await renderApp(user('manager', null, { companyId: 'company-a', role: 'manager', sellerId: null }));
    for (const { label } of OPERATIONAL_NAV) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});

describe('Seller — navegação preservada, Resultados continua ausente (R1-EXEC §10)', () => {
  it('Seller vê Pendências/Visitas/Propostas/Vendas, nunca Resultados (NAV_ROLES.seller inalterado)', async () => {
    await renderApp(user('seller', null, { companyId: 'company-a', role: 'seller', sellerId: null }));
    expect(screen.getByRole('button', { name: 'Pendências' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visitas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propostas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vendas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resultados' })).toBeNull();
  });
});

// ── SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — Super Admin OPERACIONAL ──
// Diferente de todo o resto deste arquivo (Super Admin GENÉRICO, mode:
// 'none', sempre excluído dos 5 ids): aqui operational.mode==='super_admin'
// — Pendências/Visitas/Propostas passam a ser permitidos (operationalSuperAdminNavIds,
// components/App.tsx), Vendas/Resultados continuam AUSENTES (V2B, fora de
// escopo deste lote).
describe('Super Admin operacional (contextual): Pendências/Visitas/Propostas/Vendas/Resultados aparecem (V2B)', () => {
  beforeEach(() => {
    m.superAdminReadFlag.current = true;
    opContext.current = {
      mode: 'super_admin', companyId: 'company-op-1',
      identity: { status: 'ready', company: { id: 'company-op-1', name: 'Empresa Aberta', logoPath: null, timezone: 'America/Sao_Paulo', status: 'ativa' } } as any,
      isReadOnly: false,
    };
  });

  it('Pendências/Visitas/Propostas/Vendas/Resultados aparecem no Rail', async () => {
    await renderApp(user('admin', 'super_admin'));
    expect(screen.getByRole('button', { name: 'Pendências' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visitas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propostas' })).toBeInTheDocument();
    // SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §19 — Vendas/Resultados
    // entram na mesma lista de ids operacionais (mesma flag, mesma
    // condição de canAccessCommercialWorkspace).
    expect(screen.getByRole('button', { name: 'Vendas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resultados' })).toBeInTheDocument();
  });

  it('Usuários/Convites continuam fora da operação da empresa (§19)', async () => {
    await renderApp(user('admin', 'super_admin'));
    expect(screen.queryByRole('button', { name: 'Usuários' })).toBeNull();
  });

  it('SUPER_ADMIN_COMMERCIAL_READ=false: Pendências/Visitas/Propostas/Vendas/Resultados voltam a ficar ausentes mesmo com mode super_admin', async () => {
    m.superAdminReadFlag.current = false;
    await renderApp(user('admin', 'super_admin'));
    expect(screen.queryByRole('button', { name: 'Pendências' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Visitas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Propostas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vendas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resultados' })).toBeNull();
  });

  it('clique em Pendências navega e monta ScreenPendencias', async () => {
    await renderApp(user('admin', 'super_admin'));
    fireEvent.click(screen.getByRole('button', { name: 'Pendências' }));
    await waitFor(() => expect(screen.getByTestId('screen-pendencias')).toBeInTheDocument());
  });
});
