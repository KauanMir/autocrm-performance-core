// Testes de AuthenticatedShellErrorBoundary (M1-E, E7-A2). Componente
// isolado — AuthService mockado (só logout()). console.error é
// silenciado/controlado (React sempre loga um erro capturado por boundary,
// independente de NODE_ENV) para não poluir a saída dos testes.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock('@/lib/services', () => ({
  AuthService: { logout: m.logout },
}));

import { AuthenticatedShellErrorBoundary } from '@/components/errors/AuthenticatedShellErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('detalhe técnico interno — nunca deve aparecer na UI');
  return <div>conteúdo normal</div>;
}

beforeEach(() => {
  m.logout.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── A. Render normal ────────────────────────────────────────────────────
describe('AuthenticatedShellErrorBoundary — render normal', () => {
  it('filho não lança: conteúdo aparece, fallback não aparece, logout não é chamado', () => {
    render(<AuthenticatedShellErrorBoundary><Bomb shouldThrow={false} /></AuthenticatedShellErrorBoundary>);
    expect(screen.getByText('conteúdo normal')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar esta área')).toBeNull();
    expect(m.logout).not.toHaveBeenCalled();
  });
});

// ── B. Erro de renderização ─────────────────────────────────────────────
describe('AuthenticatedShellErrorBoundary — erro de renderização', () => {
  it('captura o erro; árvore do teste não quebra; fallback amigável aparece; nenhum detalhe técnico', () => {
    render(<AuthenticatedShellErrorBoundary><Bomb shouldThrow={true} /></AuthenticatedShellErrorBoundary>);
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();
    expect(screen.getByText('Encontramos um erro inesperado. Você pode tentar novamente ou sair da sua conta.')).toBeInTheDocument();
    expect(screen.queryByText(/detalhe técnico interno/)).toBeNull();
    expect(screen.queryByText(/Error:/)).toBeNull();
    expect(screen.queryByText('conteúdo normal')).toBeNull();
  });
});

// ── C. Tentar novamente ──────────────────────────────────────────────────
describe('AuthenticatedShellErrorBoundary — Tentar novamente', () => {
  it('limpa o estado interno e permite o filho montar quando o erro deixa de existir', () => {
    let shouldThrow = true;
    function ControlledBomb() {
      if (shouldThrow) throw new Error('erro');
      return <div>recuperado</div>;
    }
    render(<AuthenticatedShellErrorBoundary><ControlledBomb /></AuthenticatedShellErrorBoundary>);
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Tentar novamente'));

    expect(screen.getByText('recuperado')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar esta área')).toBeNull();
  });
});

// ── D. Erro persistente ──────────────────────────────────────────────────
describe('AuthenticatedShellErrorBoundary — erro persistente', () => {
  it('filho continua lançando após "Tentar novamente": fallback permanece seguro, sem loop infinito', () => {
    render(<AuthenticatedShellErrorBoundary><Bomb shouldThrow={true} /></AuthenticatedShellErrorBoundary>);
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();
    // Chegar até aqui sem travar o test runner já prova a ausência de loop.
  });
});

// ── E. Logout ────────────────────────────────────────────────────────────
describe('AuthenticatedShellErrorBoundary — Sair da conta', () => {
  it('botão chama o logout oficial exatamente uma vez, sem depender da tela quebrada', () => {
    render(<AuthenticatedShellErrorBoundary><Bomb shouldThrow={true} /></AuthenticatedShellErrorBoundary>);
    fireEvent.click(screen.getByText('Sair da conta'));
    expect(m.logout).toHaveBeenCalledTimes(1);
  });

  it('clicar duas vezes não duplica a chamada além do esperado por clique', () => {
    render(<AuthenticatedShellErrorBoundary><Bomb shouldThrow={true} /></AuthenticatedShellErrorBoundary>);
    fireEvent.click(screen.getByText('Sair da conta'));
    fireEvent.click(screen.getByText('Sair da conta'));
    expect(m.logout).toHaveBeenCalledTimes(2);
  });
});

// ── F. Troca de identidade (reset via key) ──────────────────────────────
describe('AuthenticatedShellErrorBoundary — reset por troca de identidade', () => {
  it('trocar a key (identidade nova) remonta o boundary e limpa o erro anterior, sem vazamento de dado da identidade antiga', () => {
    const { rerender } = render(
      <AuthenticatedShellErrorBoundary key="identity-A"><Bomb shouldThrow={true} /></AuthenticatedShellErrorBoundary>,
    );
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();

    rerender(
      <AuthenticatedShellErrorBoundary key="identity-B"><Bomb shouldThrow={false} /></AuthenticatedShellErrorBoundary>,
    );

    expect(screen.queryByText('Não foi possível carregar esta área')).toBeNull();
    expect(screen.getByText('conteúdo normal')).toBeInTheDocument();
  });

  it('mesma key (identidade inalterada): erro anterior NÃO é limpo automaticamente', () => {
    const { rerender } = render(
      <AuthenticatedShellErrorBoundary key="identity-A"><Bomb shouldThrow={true} /></AuthenticatedShellErrorBoundary>,
    );
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();

    rerender(
      <AuthenticatedShellErrorBoundary key="identity-A"><Bomb shouldThrow={false} /></AuthenticatedShellErrorBoundary>,
    );

    // Mesma instância — hasError continua true até "Tentar novamente" ou
    // troca real de identidade, nunca por conta própria a cada render.
    expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument();
  });
});
