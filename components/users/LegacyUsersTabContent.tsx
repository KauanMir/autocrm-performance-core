'use client';
// components/users/LegacyUsersTabContent.tsx — composição ANTIGA da aba
// "Usuários" (M1-F S5-D/S6-F), extraída de ScreensBiz.tsx sem NENHUMA
// alteração de comportamento. Usado sempre que o filtro contextual de
// empresa (S7-C) não se aplica — NEXT_PUBLIC_FF_COMPANY_SELECTOR desligada
// OU ator não é Super Admin (Manager/Seller sempre passam por aqui).
//
// Nunca chama useCompanyScopeFilter/useCompanies — zero query nova, zero
// requisito de QueryClientProvider além do que já existia antes do S7-C.
// Cada lista mantém seu próprio filtro interno de empresa (companyFilter
// local), exatamente como no S5-D/S6-F.
import React from 'react';
import { ActiveUserList } from '@/components/users/ActiveUserList';
import { InactiveUserList } from '@/components/users/InactiveUserList';
import { InviteList } from '@/components/invites/InviteList';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

export type LegacyUsersTabContentProps = {
  userId: string;
  actor: CreateInviteActor | null;
  activeUsersEnabled: boolean;
  userLifecycleEnabled: boolean;
  userEmailEditEnabled: boolean;
};

export function LegacyUsersTabContent({
  userId, actor, activeUsersEnabled, userLifecycleEnabled, userEmailEditEnabled,
}: LegacyUsersTabContentProps) {
  return (
    <>
      {activeUsersEnabled && (
        <ActiveUserList
          userId={userId}
          actor={actor}
          userEmailEditEnabled={userEmailEditEnabled}
          lifecycleEnabled={userLifecycleEnabled}
        />
      )}
      {userLifecycleEnabled && (
        <InactiveUserList userId={userId} actor={actor} />
      )}
      <InviteList userId={userId} actor={actor} />
    </>
  );
}
