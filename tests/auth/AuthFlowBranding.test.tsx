// Testes de branding da tela pública de login (components/auth/AuthFlow.tsx,
// LoginView/AuthHero) — KAPA-CRM-BRANDING-R1. Mesmo padrão de render de
// tests/auth/AuthFlowOnboardingSellerGuard.test.tsx.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthFlow } from '@/components/auth/AuthFlow';

function renderLogin() {
  return render(<AuthFlow view="login" setView={vi.fn()} onAuthed={vi.fn()} onSignedUp={vi.fn()} />);
}

describe('AuthFlow — branding do login', () => {
  it('mostra "KAPA CRM" na tela de login', () => {
    renderLogin();
    expect(screen.getByText('KAPA CRM')).toBeInTheDocument();
  });

  it('nunca mostra o nome antigo do produto', () => {
    renderLogin();
    expect(screen.queryByText('AUTOCRM')).toBeNull();
    expect(screen.queryByText(/AutoCRM/)).toBeNull();
  });

  it('preserva o subtítulo "PERFORMANCE" (mesma identidade visual, só troca o nome)', () => {
    renderLogin();
    expect(screen.getByText('PERFORMANCE')).toBeInTheDocument();
  });
});
