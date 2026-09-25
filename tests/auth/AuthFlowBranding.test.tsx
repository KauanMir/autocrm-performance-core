// Testes de branding da tela pública de login (components/auth/AuthFlow.tsx,
// LoginView/AuthHero) — KAPA-CRM-BRANDING-R1 / LOGIN_BRAND_REMOVAL_A1 /
// LOGIN_BRAND_REFINEMENT_A4. Mesmo padrão de render de
// tests/auth/AuthFlowOnboardingSellerGuard.test.tsx.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthFlow } from '@/components/auth/AuthFlow';

function renderLogin() {
  return render(<AuthFlow view="login" setView={vi.fn()} onAuthed={vi.fn()} onSignedUp={vi.fn()} />);
}

describe('AuthFlow — branding do login', () => {
  it('nunca mostra o nome antigo do produto', () => {
    renderLogin();
    expect(screen.queryByText('AUTOCRM')).toBeNull();
    expect(screen.queryByText(/AutoCRM/)).toBeNull();
  });

  // LOGIN_BRAND_REFINEMENT_A4 — a assinatura "KAPA CRM" volta ao topo da
  // Hero, agora como uma linha discreta (ícone de pódio + wordmark), sem o
  // chip/ícone de carro nem o subtítulo "PERFORMANCE" da versão antiga.
  it('mostra "KAPA CRM" uma única vez, sem o subtítulo "PERFORMANCE"', () => {
    renderLogin();
    expect(screen.getAllByText('KAPA CRM')).toHaveLength(1);
    expect(screen.queryByText('PERFORMANCE')).toBeNull();
  });

  it('preserva o restante da tela: headline, texto de apoio e card de login', () => {
    renderLogin();
    expect(screen.getByText(/Cada venda é/)).toBeInTheDocument();
    expect(screen.getByText('O CRM que transforma vendedores em campeões')).toBeInTheDocument();
    expect(screen.getByText('Entrar no sistema')).toBeInTheDocument();
  });
});
