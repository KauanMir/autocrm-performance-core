// PILOT-UI-TRUTH-FIXES-R1-EXEC — testes de reachability das superfícies
// removidas da produção (achados BLOCKER do PILOT-UI-TRUTH-AUDIT-A1 §1/§2/
// §3/§5): "Entrar com Google" (reusava handleLogin, sem OAuth real),
// "Criar conta"/signup self-service e o onboarding de 4 passos (nenhum dos
// dois persiste nada no backend), e o checkbox cosmético "Lembrar acesso".
// Mesmo contrato de NODE_ENV que já gateia TweaksPanel (components/App.tsx)
// — production/preview deploy roda com NODE_ENV!=='development' (o mesmo
// valor ambiente que os testes já têm por padrão, sem precisar de stub).
// Recuperação de senha (resetPasswordForEmail/verifyOtp/updateUser) nunca é
// tocada por este lote — mesmo padrão de AuthFlowOnboardingSellerGuard.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// OnboardingView (só alcançável em dev preview) chama SellerService.getAll()
// incondicionalmente quando isLocalCommercialDataAllowed()==true (mesmo
// achado do E7-C/AuthFlowOnboardingSellerGuard.test.tsx) — mocka as duas
// flags remotas para manter isLocalCommercialDataAllowed()==true de forma
// determinística, e SellerService.getAll() para nunca depender do
// StoreAdapter/localStorage real em jsdom.
vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: () => false, isRemoteStagesEnabled: () => false };
});

vi.mock('@/lib/services', () => ({
  AuthService: { login: vi.fn(), getCurrentUser: () => null },
  SellerService: { getAll: () => [{ id: 's1', name: 'Ana', team: 'A' }] },
}));

import { AuthFlow } from '@/components/auth/AuthFlow';

function renderView(view: string) {
  return render(<AuthFlow view={view} setView={vi.fn()} onAuthed={vi.fn()} onSignedUp={vi.fn()} />);
}

describe('AuthFlow — produção/preview (NODE_ENV padrão de teste, nunca "development")', () => {
  it('"Entrar com Google" não aparece no login', () => {
    renderView('login');
    expect(screen.queryByText('Entrar com Google')).toBeNull();
  });

  it('"Criar conta" não aparece no login', () => {
    renderView('login');
    expect(screen.queryByText('Criar conta')).toBeNull();
  });

  it('"Lembrar acesso" nunca aparece (removido, não é uma questão de ambiente)', () => {
    renderView('login');
    expect(screen.queryByText('Lembrar acesso')).toBeNull();
  });

  it('"Entrar"/"Esqueci minha senha" continuam disponíveis', () => {
    renderView('login');
    expect(screen.getByText('Entrar')).toBeInTheDocument();
    expect(screen.getByText('Esqueci minha senha')).toBeInTheDocument();
  });

  it('view="signup" cai para o login — signup self-service inacessível', () => {
    renderView('signup');
    expect(screen.getByText('Entrar no sistema')).toBeInTheDocument();
    expect(screen.queryByText('Sua empresa')).toBeNull();
  });

  it('view="onboarding" cai para o login — onboarding fake inacessível', () => {
    renderView('onboarding');
    expect(screen.getByText('Entrar no sistema')).toBeInTheDocument();
    expect(screen.queryByText('Cadastre sua empresa')).toBeNull();
  });

  it('view="recover" continua acessível (Recuperação de senha real)', () => {
    renderView('recover');
    expect(screen.getByText('Recuperar senha')).toBeInTheDocument();
  });
});

describe('AuthFlow — dev preview (NODE_ENV=development)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('"Entrar com Google" e "Criar conta" aparecem no login', () => {
    renderView('login');
    expect(screen.getByText('Entrar com Google')).toBeInTheDocument();
    expect(screen.getByText('Criar conta')).toBeInTheDocument();
  });

  it('view="signup" renderiza SignupView de verdade', () => {
    renderView('signup');
    expect(screen.getByText('Sua empresa')).toBeInTheDocument();
  });

  it('view="onboarding" renderiza OnboardingView de verdade', () => {
    renderView('onboarding');
    expect(screen.getByText('Cadastre sua empresa')).toBeInTheDocument();
  });
});
