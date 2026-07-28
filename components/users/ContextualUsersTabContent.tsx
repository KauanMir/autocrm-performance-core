'use client';
// components/users/ContextualUsersTabContent.tsx — composição NOVA da aba
// "Usuários" com filtro contextual de empresa (M1-F S7-C, §26 do design
// doc). Só é montado por UsersTabSection quando NEXT_PUBLIC_FF_COMPANY_
// SELECTOR está ligada E o ator é Super Admin — nunca para Manager/Seller,
// nunca com a flag desligada (ver LegacyUsersTabContent para esse caso).
//
// Único componente que chama useCompanyScopeFilter — UMA ÚNICA VEZ — e
// compartilha o mesmo companyFilterId entre
// ActiveUserList/InactiveUserList/InviteList via prop
// externalCompanyFilterId. Nunca um filtro por lista.
import React from 'react';
import { ActiveUserList } from '@/components/users/ActiveUserList';
import { InactiveUserList } from '@/components/users/InactiveUserList';
import { InviteList } from '@/components/invites/InviteList';
import { CompanyScopeFilter } from '@/components/users/CompanyScopeFilter';
import { useCompanyScopeFilter } from '@/lib/hooks/useCompanyScopeFilter';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

export type ContextualUsersTabContentProps = {
  userId: string;
  actor: CreateInviteActor | null;
  activeUsersEnabled: boolean;
  userLifecycleEnabled: boolean;
  userEmailEditEnabled: boolean;
};

export function ContextualUsersTabContent({
  userId, actor, activeUsersEnabled, userLifecycleEnabled, userEmailEditEnabled,
}: ContextualUsersTabContentProps) {
  // Estado único e compartilhado — nunca um por lista (§26.9). Reset por
  // troca de identidade/tipo de ator, validação contra useCompanies e
  // ausência de persistência já são responsabilidade do próprio hook
  // (M1-F S7-B). Este componente só é montado para Super Admin (garantido
  // pelo chamador, UsersTabSection), então scopeFilter.isSuperAdmin é
  // sempre true aqui — mas o hook continua sendo a única fonte de verdade,
  // nunca reafirmado por uma segunda checagem redundante.
  const scopeFilter = useCompanyScopeFilter({ userId, actor });

  // InviteList SEMPRE renderiza nesta aba (nunca condicionado a flag
  // própria), então sempre existe pelo menos uma superfície real para o
  // seletor filtrar, mesmo com ACTIVE_USERS/USER_LIFECYCLE desligadas
  // (§10 do S7-C) — o seletor nunca aparece sem nenhum conteúdo afetado.
  const externalCompanyFilterId = scopeFilter.companyFilterId;

  return (
    <>
      <CompanyScopeFilter
        companyFilterId={scopeFilter.companyFilterId}
        onChange={scopeFilter.setCompanyFilterId}
        companies={scopeFilter.companies}
        companiesLoading={scopeFilter.companiesLoading}
      />
      {activeUsersEnabled && (
        <ActiveUserList
          userId={userId}
          actor={actor}
          userEmailEditEnabled={userEmailEditEnabled}
          lifecycleEnabled={userLifecycleEnabled}
          externalCompanyFilterId={externalCompanyFilterId}
        />
      )}
      {userLifecycleEnabled && (
        <InactiveUserList userId={userId} actor={actor} externalCompanyFilterId={externalCompanyFilterId} />
      )}
      <InviteList userId={userId} actor={actor} externalCompanyFilterId={externalCompanyFilterId} />
    </>
  );
}
