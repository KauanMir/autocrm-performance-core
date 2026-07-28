// tests/components/users/MembershipLifecycleActions.test.tsx — botões de
// ação do ciclo de vida empresarial (M1-F S6-F), compartilhados entre
// ActiveUserList/InactiveUserList. Nenhuma decisão de capability é tomada
// aqui — só renderização condicional a partir do objeto recebido.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MembershipLifecycleActions } from '@/components/users/MembershipLifecycleActions';
import type { MembershipLifecycleCapabilities } from '@/lib/capabilities';

const NONE: MembershipLifecycleCapabilities = { canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false };

function renderActions(capabilities: MembershipLifecycleCapabilities) {
  const onSuspend = vi.fn();
  const onReactivate = vi.fn();
  const onOffboard = vi.fn();
  const onTransfer = vi.fn();
  const utils = render(
    <MembershipLifecycleActions
      capabilities={capabilities}
      onSuspend={onSuspend}
      onReactivate={onReactivate}
      onOffboard={onOffboard}
      onTransfer={onTransfer}
    />,
  );
  return { onSuspend, onReactivate, onOffboard, onTransfer, ...utils };
}

describe('MembershipLifecycleActions — renderização condicional', () => {
  it('nenhuma capability: nada é renderizado', () => {
    const { container } = renderActions(NONE);
    expect(container).toBeEmptyDOMElement();
  });

  it('canSuspend: mostra só o botão Suspender', () => {
    renderActions({ ...NONE, canSuspend: true });
    expect(screen.getByText('Suspender')).toBeInTheDocument();
    expect(screen.queryByText('Reativar')).toBeNull();
    expect(screen.queryByText('Desligar')).toBeNull();
    expect(screen.queryByText('Transferir')).toBeNull();
  });

  it('canReactivate: mostra só o botão Reativar', () => {
    renderActions({ ...NONE, canReactivate: true });
    expect(screen.getByText('Reativar')).toBeInTheDocument();
    expect(screen.queryByText('Suspender')).toBeNull();
  });

  it('canOffboard + canTransfer: mostra Desligar e Transferir juntos', () => {
    renderActions({ ...NONE, canOffboard: true, canTransfer: true });
    expect(screen.getByText('Desligar')).toBeInTheDocument();
    expect(screen.getByText('Transferir')).toBeInTheDocument();
  });

  it('todas as quatro: todos os botões aparecem', () => {
    renderActions({ canSuspend: true, canReactivate: true, canOffboard: true, canTransfer: true });
    expect(screen.getByText('Suspender')).toBeInTheDocument();
    expect(screen.getByText('Reativar')).toBeInTheDocument();
    expect(screen.getByText('Desligar')).toBeInTheDocument();
    expect(screen.getByText('Transferir')).toBeInTheDocument();
  });
});

describe('MembershipLifecycleActions — callbacks', () => {
  it('clicar em cada botão chama exatamente o callback correspondente', () => {
    const { onSuspend, onReactivate, onOffboard, onTransfer } = renderActions({
      canSuspend: true, canReactivate: true, canOffboard: true, canTransfer: true,
    });
    screen.getByText('Suspender').closest('button')?.click();
    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(onReactivate).not.toHaveBeenCalled();

    screen.getByText('Reativar').closest('button')?.click();
    expect(onReactivate).toHaveBeenCalledTimes(1);

    screen.getByText('Desligar').closest('button')?.click();
    expect(onOffboard).toHaveBeenCalledTimes(1);

    screen.getByText('Transferir').closest('button')?.click();
    expect(onTransfer).toHaveBeenCalledTimes(1);
  });
});
