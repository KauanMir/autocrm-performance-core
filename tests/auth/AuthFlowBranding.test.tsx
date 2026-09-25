// Testes de branding da tela pública de login (components/auth/AuthFlow.tsx,
// LoginView/AuthHero) — KAPA-CRM-BRANDING-R1 / LOGIN_BRAND_REMOVAL_A1. Mesmo
// padrão de render de tests/auth/AuthFlowOnboardingSellerGuard.test.tsx.
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

  // LOGIN_BRAND_REMOVAL_A1 — o bloco visual (ícone do carro + "KAPA CRM" +
  // "PERFORMANCE") foi removido da tela de login; nenhuma logo o substitui
  // por enquanto.
  it('não mostra mais o bloco "KAPA CRM" / "PERFORMANCE"', () => {
    renderLogin();
    expect(screen.queryByText('KAPA CRM')).toBeNull();
    expect(screen.queryByText('PERFORMANCE')).toBeNull();
  });

  it('preserva o restante da tela: headline, texto de apoio e card de login', () => {
    renderLogin();
    expect(screen.getByText(/Cada venda é/)).toBeInTheDocument();
    expect(screen.getByText('O CRM que transforma vendedores em campeões')).toBeInTheDocument();
    expect(screen.getByText('Entrar no sistema')).toBeInTheDocument();
  });
});
