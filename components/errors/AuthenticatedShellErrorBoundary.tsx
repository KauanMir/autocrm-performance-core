'use client';
// components/errors/AuthenticatedShellErrorBoundary.tsx — última camada de
// proteção do shell autenticado (M1-E, E7-A2). Protege Rail + tela atual +
// flows/modais montados dentro do shell (components/App.tsx) contra um
// erro inesperado de renderização derrubando a árvore inteira — achado do
// E7-A0 (ausência total de error boundary em qualquer lugar do app,
// confirmado por auditoria; nenhuma implementação equivalente existia).
//
// NUNCA substitui tratamento de erro local, validações, capabilities,
// guards ou estados fail-closed já existentes (remote_misconfigured,
// LocalCommercialUnavailableCard, mensagens sanitizadas de RPC, etc.) —
// esses continuam tratando seus próprios casos ANTES de qualquer throw
// chegar até aqui. Este boundary só existe para o que sobra: um erro
// verdadeiramente inesperado.
//
// LIMITAÇÃO DOCUMENTADA (React nativo, sem lib nova): Error Boundaries
// capturam erros de renderização, construtores e métodos de lifecycle dos
// componentes filhos — NUNCA event handlers, callbacks assíncronos,
// promises rejeitadas fora do render, erros server-side/Route Handlers,
// nem erros antes da montagem do React. Não é uma solução universal de
// tratamento de erros.
import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { AuthService } from '@/lib/services';

export interface AuthenticatedShellErrorBoundaryProps {
  children: React.ReactNode;
}

interface AuthenticatedShellErrorBoundaryState {
  hasError: boolean;
}

export class AuthenticatedShellErrorBoundary extends React.Component<
  AuthenticatedShellErrorBoundaryProps,
  AuthenticatedShellErrorBoundaryState
> {
  state: AuthenticatedShellErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AuthenticatedShellErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Log técnico SOMENTE para desenvolvimento — nunca exposto na UI,
    // nunca enviado a nenhum serviço externo (Sentry/telemetria/RPC/
    // localStorage ficam fora de escopo desta etapa, de propósito).
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.error('[AutoCRM] AuthenticatedShellErrorBoundary capturou um erro inesperado:', error, info.componentStack);
    }
  }

  // "Tentar novamente": recuperação controlada pelo React — limpa o
  // próprio estado e deixa o React tentar montar o subtree de novo, nunca
  // um window.location.reload() como primeira solução.
  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  // Fluxo OFICIAL de logout, já usado pelo botão "Sair" do Rail — nunca
  // duplicado aqui. AuthService.logout() já dispara window.__logout()
  // internamente (lib/services.ts), o que zera currentUser em App() e
  // desmonta este próprio boundary (a árvore autenticada some, a tela de
  // login assume) — nenhuma chamada adicional é necessária ou correta.
  private handleLogout = (): void => {
    void AuthService.logout();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ height: '100vh', width: '100%', display: 'grid', placeItems: 'center', background: 'var(--ink-900, #0a0a0b)', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(255,59,59,.12)', border: '1px solid rgba(255,59,59,.35)', display: 'grid', placeItems: 'center', color: '#FF6B6B' }}>
              <Icon name="alert" size={26} stroke={2.2} />
            </div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fff' }}>Não foi possível carregar esta área</h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--txt-lo, #8b8b93)', lineHeight: 1.5 }}>
              Encontramos um erro inesperado. Você pode tentar novamente ou sair da sua conta.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <LBtn kind="gold" icon="refresh" onClick={this.handleRetry}>Tentar novamente</LBtn>
              <LBtn kind="ghost" icon="logout" onClick={this.handleLogout}>Sair da conta</LBtn>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
