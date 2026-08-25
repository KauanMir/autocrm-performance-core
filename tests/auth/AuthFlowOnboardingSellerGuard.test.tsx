// Testes de OnboardingView (components/auth/AuthFlow.tsx) — M1-E E7-C.
// Achado de auditoria: a etapa "Adicione seus vendedores" chamava
// SellerService.getAll() incondicionalmente. SellerService tem
// assertLocalCommercialDataAllowed desde o E7-B1 (lança em modo remoto) —
// essa tela é alcançável por qualquer visitante real (view="onboarding",
// alcançada via "Criar conta" na tela de login), sem nenhuma sessão/empresa
// ainda, então o gate depende só da flag global. Este teste trava que o
// modo remoto nunca chama SellerService.getAll() aqui (lista vazia em vez
// de crash), e que o modo local continua funcionando como antes.
//
// PILOT-UI-TRUTH-FIXES-R1-EXEC §3: view="onboarding" agora só renderiza em
// NODE_ENV==='development' (fora disso cai para o login — signup
// self-service não persiste nada, BLOCKER do PILOT-UI-TRUTH-AUDIT-A1). Este
// arquivo testa o comportamento INTERNO de OnboardingView (que continua
// existindo para preview/dev), então força NODE_ENV='development' — a
// reachability em produção tem cobertura própria (AuthFlowProductionGates).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const m = vi.hoisted(() => ({
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  sellerServiceGetAll: vi.fn(),
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: m.isRemoteLeadsEnabled, isRemoteStagesEnabled: m.isRemoteStagesEnabled };
});

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => null },
  SellerService: { getAll: m.sellerServiceGetAll },
}));

import { AuthFlow } from '@/components/auth/AuthFlow';

function renderOnboarding() {
  return render(<AuthFlow view="onboarding" setView={vi.fn()} onAuthed={vi.fn()} onSignedUp={vi.fn()} />);
}

function goToVendedoresStep() {
  fireEvent.click(screen.getByText('Continuar'));
}

beforeEach(() => {
  m.sellerServiceGetAll.mockReset().mockReturnValue([
    { id: 's1', name: 'Ana', team: 'A' },
    { id: 's2', name: 'Bruno', team: 'B' },
  ]);
});

describe('OnboardingView — modo local (REMOTE_LEADS=false)', () => {
  it('chama SellerService.getAll() e renderiza a lista demo normalmente', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    renderOnboarding();
    goToVendedoresStep();
    expect(m.sellerServiceGetAll).toHaveBeenCalled();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });
});

describe('OnboardingView — remote_ready (REMOTE_LEADS=true, REMOTE_STAGES=true)', () => {
  it('NUNCA chama SellerService.getAll() — sem crash, lista vazia', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    expect(() => {
      renderOnboarding();
      goToVendedoresStep();
    }).not.toThrow();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText('Ana')).toBeNull();
  });
});

describe('OnboardingView — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('NUNCA chama SellerService.getAll() — sem crash, lista vazia (fail-closed também aqui)', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    expect(() => {
      renderOnboarding();
      goToVendedoresStep();
    }).not.toThrow();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });
});
