'use client';
// components/users/UsersTabSection.tsx — roteador da composição da aba
// "Usuários" (M1-F S7-C, §26 do design doc). NUNCA chama hook algum
// diretamente — hooks não podem ser chamados condicionalmente dentro do
// MESMO componente, então a escolha entre os dois caminhos é feita
// escolhendo QUAL componente filho montar, nunca qual hook chamar.
//
// Caminho legado (LegacyUsersTabContent): COMPANY_SELECTOR desligada OU
// ator não é Super Admin (Manager/Seller sempre aqui). Zero chamada a
// useCompanyScopeFilter/useCompanies — preserva o comportamento do S5-D/
// S6-F byte a byte, sem nenhum requisito novo de QueryClientProvider.
//
// Caminho contextual (ContextualUsersTabContent): COMPANY_SELECTOR ligada
// E ator é Super Admin — único caso em que useCompanyScopeFilter é
// instanciado (dentro do próprio ContextualUsersTabContent, uma única
// vez), compartilhando companyFilterId entre as três listas.
//
// Extraído de components/screens/ScreensBiz.tsx (troca mecânica: só move
// a composição da aba Usuários para este módulo, sem alterar nenhuma
// outra lógica de ScreensBiz.tsx).
import React from 'react';
import { LegacyUsersTabContent } from '@/components/users/LegacyUsersTabContent';
import { ContextualUsersTabContent } from '@/components/users/ContextualUsersTabContent';
import { isCompanySelectorEnabled } from '@/lib/flags';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

export type UsersTabSectionProps = {
  userId: string;
  actor: CreateInviteActor | null;
  activeUsersEnabled: boolean;
  userLifecycleEnabled: boolean;
  userEmailEditEnabled: boolean;
};

export function UsersTabSection(props: UsersTabSectionProps) {
  const { actor } = props;
  const isSuperAdmin = actor?.kind === 'super_admin';
  const useContextualPath = isCompanySelectorEnabled() && isSuperAdmin;

  return useContextualPath
    ? <ContextualUsersTabContent {...props} />
    : <LegacyUsersTabContent {...props} />;
}
