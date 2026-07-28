'use client';
// components/users/MembershipLifecycleActions.tsx — botões de ação do ciclo
// de vida empresarial (M1-F S6-F), compartilhados entre ActiveUserList
// (linhas ativas) e InactiveUserList (linhas suspensas/desligadas) — a
// mesma lógica de "quais botões aparecem" seria duplicada nos dois lugares
// sem este componente. A decisão de QUAIS botões aparecem nunca é feita
// aqui: vem inteiramente de membershipLifecycleCapabilities() (lib/
// capabilities.ts), resolvida pelo chamador linha a linha. Mesmo padrão de
// captura de foco de ActiveUserList (document.activeElement no momento do
// clique, já que LBtn não repassa o evento).
import React from 'react';
import { LBtn } from '@/components/ui/kit';
import type { MembershipLifecycleCapabilities } from '@/lib/capabilities';

export type MembershipLifecycleActionsProps = {
  capabilities: MembershipLifecycleCapabilities;
  onSuspend: (trigger: HTMLElement | null) => void;
  onReactivate: (trigger: HTMLElement | null) => void;
  onOffboard: (trigger: HTMLElement | null) => void;
  onTransfer: (trigger: HTMLElement | null) => void;
};

export function MembershipLifecycleActions({
  capabilities,
  onSuspend,
  onReactivate,
  onOffboard,
  onTransfer,
}: MembershipLifecycleActionsProps) {
  const { canSuspend, canReactivate, canOffboard, canTransfer } = capabilities;
  if (!canSuspend && !canReactivate && !canOffboard && !canTransfer) return null;

  return (
    <>
      {canSuspend && (
        <LBtn size="sm" kind="ghost" icon="alert" aria-label="Suspender usuário"
          onClick={() => onSuspend(document.activeElement as HTMLElement | null)}>
          Suspender
        </LBtn>
      )}
      {canReactivate && (
        <LBtn size="sm" kind="ghost" icon="refresh" aria-label="Reativar usuário"
          onClick={() => onReactivate(document.activeElement as HTMLElement | null)}>
          Reativar
        </LBtn>
      )}
      {canOffboard && (
        <LBtn size="sm" kind="ghost" icon="alert" aria-label="Desligar usuário"
          onClick={() => onOffboard(document.activeElement as HTMLElement | null)}>
          Desligar
        </LBtn>
      )}
      {canTransfer && (
        <LBtn size="sm" kind="ghost" icon="refresh" aria-label="Transferir usuário"
          onClick={() => onTransfer(document.activeElement as HTMLElement | null)}>
          Transferir
        </LBtn>
      )}
    </>
  );
}
