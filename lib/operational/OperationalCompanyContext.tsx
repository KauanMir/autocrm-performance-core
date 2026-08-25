'use client';
// lib/operational/OperationalCompanyContext.tsx — SUPER-ADMIN-COMPANY-
// CONTEXT-B1-EXEC. Fonte ÚNICA de "qual empresa operacional está aberta
// agora", generalizando a fonte real sem substituir a autoridade de
// nenhuma delas (§2/§3 do EXEC):
//   - Manager/Seller: companyId vem de activeMembership.companyId (mode
//     'membership') — comportamento 100% inalterado, nunca "descoberto"
//     aqui, sempre resolvido pelo chamador (App.tsx).
//   - Super Admin: companyId vem EXCLUSIVAMENTE da URL (/company/[id],
//     mode 'super_admin') — nunca localStorage/sessionStorage/cookie como
//     autoridade (§5/§6). O companyId da URL NUNCA é autorização por si só:
//     a autorização real acontece dentro de useActiveCompanyIdentity, que
//     só resolve 'ready' para uma empresa que a RLS companies_select_
//     accessible (can_access_company) realmente devolve para este usuário
//     — uma URL não-autorizada nunca monta a operação (§6/§7).
//   - Nenhum dos dois: mode 'none', companyId null.
//
// Sem impersonação (§1): este contexto nunca cria/lê membership, nunca
// atribui sellerId, nunca altera platformRole/claims — só decide qual
// companyId os hooks de leitura devem usar.
//
// A company REAL (nome/logo/timezone/status) é resolvida UMA vez aqui via
// useActiveCompanyIdentity (mesmo hook que Rail/Home já usavam para
// Manager/Seller) e disponibilizada a todo consumidor via `identity` —
// nenhum componente descendente chama o hook de novo (§2 do EXEC: "não
// passar companyId manualmente por dezenas de componentes").
import React, { createContext, useContext } from 'react';
import {
  useActiveCompanyIdentity,
  type ActiveCompanyIdentityState,
} from '@/lib/hooks/useActiveCompanyIdentity';

export type OperationalCompanyMode = 'none' | 'membership' | 'super_admin';

export type OperationalCompanyContextValue = {
  mode: OperationalCompanyMode;
  companyId: string | null;
  identity: ActiveCompanyIdentityState;
  // true SOMENTE quando mode==='super_admin', identity.status==='ready' e a
  // empresa está 'suspensa' (§8/§33 do EXEC) — Manager/Seller nunca ficam
  // read-only por este campo (membership em empresa suspensa é
  // estruturalmente impossível, can_access_company já nega).
  isReadOnly: boolean;
};

const OperationalCompanyContext = createContext<OperationalCompanyContextValue | null>(null);

export type OperationalCompanyProviderProps = {
  children: React.ReactNode;
  userId: string | null;
  userIsActive: boolean;
  // Manager/Seller — resolvido pelo chamador (currentUser.activeMembership),
  // nunca inferido aqui (§3 do EXEC).
  membershipCompanyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  // Super Admin — SOMENTE da URL (/company/[companyId]), nunca de estado
  // volátil (§5 do EXEC).
  isSuperAdmin: boolean;
  superAdminCompanyIdFromUrl: string | null;
};

export function OperationalCompanyProvider({
  children,
  userId,
  userIsActive,
  membershipCompanyId,
  membershipRole,
  isSuperAdmin,
  superAdminCompanyIdFromUrl,
}: OperationalCompanyProviderProps) {
  const hasSuperAdminCompany = isSuperAdmin && typeof superAdminCompanyIdFromUrl === 'string'
    && superAdminCompanyIdFromUrl.trim() !== '';
  const hasMembershipCompany = !isSuperAdmin && typeof membershipCompanyId === 'string'
    && membershipCompanyId.trim() !== '' && membershipRole !== null;

  const mode: OperationalCompanyMode = hasSuperAdminCompany
    ? 'super_admin'
    : hasMembershipCompany
      ? 'membership'
      : 'none';

  const companyId = mode === 'super_admin'
    ? superAdminCompanyIdFromUrl
    : mode === 'membership'
      ? membershipCompanyId
      : null;

  // Hook chamado SEMPRE (Rules of Hooks) — ele mesmo decide 'unavailable'
  // quando mode==='none' (companyId null, gate interno de hasCompany).
  const identity = useActiveCompanyIdentity({
    userId,
    companyId,
    membershipRole: mode === 'membership' ? membershipRole : null,
    userIsActive,
    isSuperAdminContext: mode === 'super_admin',
  });

  const isReadOnly = mode === 'super_admin'
    && identity.status === 'ready'
    && identity.company.status === 'suspensa';

  return (
    <OperationalCompanyContext.Provider value={{ mode, companyId, identity, isReadOnly }}>
      {children}
    </OperationalCompanyContext.Provider>
  );
}

export function useOperationalCompanyContext(): OperationalCompanyContextValue {
  const ctx = useContext(OperationalCompanyContext);
  if (!ctx) {
    throw new Error('useOperationalCompanyContext: deve ser usado dentro de OperationalCompanyProvider');
  }
  return ctx;
}
